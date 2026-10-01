import { canonicalSchema, decode, encode, indexKey, record, sameKeys } from "./schema.js";
import type { Row, Schema, TableSchema, Values } from "./schema.js";
import type { Indexes, Storage, StoredTable } from "./storage.js";

/** Symbols keep raw metadata separate even when applications use identically named columns. */
export const ROW_ID: unique symbol = Symbol("EvieDB row ID");
export const INDEXES: unique symbol = Symbol("EvieDB indexes");
export type RawRow<T extends TableSchema> = Row<T> & { [ROW_ID]: string };
export type RawDatabase<S extends Schema> = {
  [K in keyof S]: RawRow<S[K]>[];
} & { [INDEXES]: { [K in keyof S]: Indexes } };

type SuppliedFields<R, P> = P & { [K in keyof P]: K extends keyof R ? R[K] : never };

export interface Table<R> {
  readonly length: number;
  read(): R[];
  read<K extends keyof R>(column: K): R[K][];
  filter<const P extends Partial<R>>(predicate: SuppliedFields<R, P> | ((row: R) => boolean)): Table<R>;
  insert(row: R): void;
  update<const P extends Partial<R>>(changes: SuppliedFields<R, P>): void;
  delete(): void;
}
export type Database<S extends Schema> = {
  readonly [K in keyof S]: Table<Row<S[K]>>;
} & {
  push(): void;
  write(callback: (database: RawDatabase<S>) => void): void;
};

/** Annotate the handle to allow TypeScript's assertion-method narrowing. */
export interface Initialization {
  definedb<const S extends Schema>(schema: S): asserts this is DefinedDatabase<S>;
}
/** Inferred return form: eviedb.init().definedb(schema).db. */
export interface Initializer {
  definedb<const S extends Schema>(schema: S): DefinedDatabase<S>;
}
export interface DefinedDatabase<S extends Schema> extends Initialization {
  readonly db: Database<S>;
}

interface State {
  rows: Map<string, Values>;
  indexes: Indexes;
}

function copyIndexes(indexes: Indexes): Indexes {
  return Object.fromEntries(Object.entries(indexes).map(([field, index]) => [field, Object.fromEntries(Object.entries(index).map(([key, ids]) => [key, [...ids]]))]));
}
function equivalentIndexes(value: unknown, expected: Indexes): boolean {
  if (!record(value) || !sameKeys(value, Object.keys(expected))) return false;
  return Object.entries(expected).every(([field, index]) => {
    const actual = value[field];
    return record(actual) && sameKeys(actual, Object.keys(index)) && Object.entries(index).every(([key, ids]) => {
      const list = actual[key];
      if (!Array.isArray(list) || list.length !== ids.length) return false;
      const remaining = new Set(ids);
      for (const id of list) if (typeof id !== "string" || !remaining.delete(id)) return false;
      return true;
    });
  });
}

export class Engine {
  readonly schema: Schema;
  private readonly persisted = new Map<string, State>();
  private readonly staged = new Map<string, State>();
  private inWrite = false;

  constructor(schema: Schema, private readonly storage: Storage) {
    this.schema = canonicalSchema(schema);
    const stored = storage.schema();
    if (stored !== undefined && !this.compatible(stored)) throw new Error("Incompatible persisted schema; migrations are not supported in v0");
  }

  private compatible(value: unknown): boolean {
    if (!record(value) || !sameKeys(value, Object.keys(this.schema))) return false;
    for (const [table, fields] of Object.entries(this.schema)) {
      const actual = value[table];
      if (!record(actual) || !sameKeys(actual, Object.keys(fields))) return false;
      for (const [name, field] of Object.entries(fields)) {
        const found = actual[name];
        if (!record(found) || !sameKeys(found, ["kind", "required", "unique", "index"])) return false;
        if (found.kind !== field.kind || found.required !== field.required || found.unique !== field.unique || found.index !== field.index) return false;
      }
    }
    return true;
  }

  private state(table: string, rows: Map<string, Values>): State {
    const fields = this.schema[table];
    const indexes: Indexes = Object.create(null);
    const unique = new Map<string, Set<string>>();
    for (const [name, field] of Object.entries(fields)) {
      if (field.index) indexes[name] = Object.create(null);
      if (field.unique) unique.set(name, new Set());
    }
    for (const [id, values] of rows) {
      if (typeof id !== "string" || !id.length) throw new Error("Invalid internal row ID");
      if (!sameKeys(values, Object.keys(fields))) throw new Error("Row does not match schema columns");
      for (const [name, field] of Object.entries(fields)) {
        const value = values[name];
        encode(value, field);
        const key = indexKey(value, field);
        if (field.unique && value !== undefined) {
          const present = unique.get(name)!;
          if (present.has(key)) throw new Error(`Unique constraint violated: ${table}.${name}`);
          present.add(key);
        }
        if (field.index) (indexes[name][key] ??= []).push(id);
      }
    }
    return { rows, indexes };
  }

  load(table: string): State {
    const loaded = this.persisted.get(table);
    if (loaded) return loaded;
    const stored = this.storage.table(table, this.schema[table]);
    if (!record(stored) || !sameKeys(stored, ["rows", "indexes"]) || !Array.isArray(stored.rows)) throw new Error("Malformed persisted table");
    const rows = new Map<string, Values>();
    const fields = this.schema[table];
    for (const row of stored.rows) {
      if (!record(row) || !sameKeys(row, ["id", "values"]) || typeof row.id !== "string" || !row.id.length || rows.has(row.id)) throw new Error("Malformed persisted row identity");
      if (!record(row.values) || !sameKeys(row.values, Object.keys(fields))) throw new Error("Malformed persisted row columns");
      const values: Values = Object.create(null);
      for (const [name, field] of Object.entries(fields)) values[name] = decode(row.values[name], field);
      rows.set(row.id, values);
    }
    const state = this.state(table, rows);
    if (!equivalentIndexes(stored.indexes, state.indexes)) throw new Error("Inconsistent persisted indexes");
    this.persisted.set(table, state);
    return state;
  }

  private logical(table: string): State { return this.staged.get(table) ?? this.load(table); }
  private mutable(): void { if (this.inWrite) throw new Error("Use the supplied raw database inside write()"); }

  read(table: string, selection?: ReadonlySet<string>): Values[] {
    const rows = this.load(table).rows;
    const result: Values[] = [];
    for (const id of selection ?? rows.keys()) {
      const values = rows.get(id);
      if (values) result.push({ ...values });
    }
    return result;
  }

  select(table: string, selection: ReadonlySet<string> | undefined, predicate: Partial<Values> | ((row: Values) => boolean)): Set<string> {
    const state = this.load(table);
    let candidates: Iterable<string> = selection ?? state.rows.keys();
    if (typeof predicate !== "function") {
      let shortest: string[] | undefined;
      for (const [name, value] of Object.entries(predicate)) {
        const field = this.schema[table][name];
        if (!field) throw new Error(`Unknown filter column: ${name}`);
        if (field.index) {
          const ids = state.indexes[name][indexKey(value, field)] ?? [];
          if (!shortest || ids.length < shortest.length) shortest = ids;
        }
      }
      if (shortest) candidates = shortest;
    }
    const result = new Set<string>();
    for (const id of candidates) {
      if (selection && !selection.has(id)) continue;
      const row = state.rows.get(id);
      if (row && (typeof predicate === "function" ? predicate({ ...row }) : Object.entries(predicate).every(([key, value]) => row[key] === value))) result.add(id);
    }
    return result;
  }

  insert(table: string, input: Values): void {
    this.mutable();
    const rows = new Map(this.logical(table).rows);
    const fields = this.schema[table];
    if (Object.keys(input).some(key => !Object.hasOwn(fields, key))) throw new Error("Unknown insert column");
    const values: Values = Object.create(null);
    for (const name of Object.keys(fields)) values[name] = input[name];
    let id: string;
    do { id = this.storage.rowId(); } while (rows.has(id));
    rows.set(id, values);
    this.staged.set(table, this.state(table, rows));
  }

  update(table: string, selection: ReadonlySet<string> | undefined, changes: Values): void {
    this.mutable();
    if (Object.keys(changes).some(key => !Object.hasOwn(this.schema[table], key))) throw new Error("Unknown update column");
    const rows = new Map(this.logical(table).rows);
    for (const id of selection ?? rows.keys()) {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, ...changes });
    }
    // Publish only after every affected row and constraint passed.
    this.staged.set(table, this.state(table, rows));
  }

  delete(table: string, selection?: ReadonlySet<string>): void {
    this.mutable();
    const rows = new Map(this.logical(table).rows);
    if (!selection) rows.clear();
    else for (const id of selection) rows.delete(id);
    this.staged.set(table, this.state(table, rows));
  }

  write(callback: (raw: RawDatabase<Schema>) => void): void {
    this.mutable();
    const raw: Record<string | symbol, unknown> = Object.create(null);
    const metadata: Record<string, Indexes> = Object.create(null);
    for (const table of Object.keys(this.schema)) {
      const state = this.logical(table);
      raw[table] = [...state.rows].map(([id, row]) => ({ ...row, [ROW_ID]: id }));
      metadata[table] = copyIndexes(state.indexes);
    }
    raw[INDEXES] = metadata;
    this.inWrite = true;
    try {
      const result: unknown = callback(raw as RawDatabase<Schema>);
      if (result !== null && (typeof result === "object" || typeof result === "function") &&
          typeof (result as { then?: unknown }).then === "function") {
        // Observe rejection without accepting any of the detached callback state.
        void Promise.resolve(result).catch(() => {});
        throw new Error("write() callbacks must be synchronous");
      }
    }
    finally { this.inWrite = false; }
    if (!sameKeys(raw, Object.keys(this.schema)) || Reflect.ownKeys(raw).length !== Object.keys(this.schema).length + 1) throw new Error("Raw write changed database shape");
    const editedIndexes = raw[INDEXES];
    if (!record(editedIndexes) || !sameKeys(editedIndexes, Object.keys(this.schema))) throw new Error("Raw write changed index shape");
    const accepted = new Map<string, State>();
    for (const [table, fields] of Object.entries(this.schema)) {
      const input = raw[table];
      if (!Array.isArray(input)) throw new Error("Raw table must be an array");
      const rows = new Map<string, Values>();
      for (const entry of input) {
        if (!record(entry)) throw new Error("Raw row must be an object");
        const id = (entry as Record<string | symbol, unknown>)[ROW_ID];
        if (typeof id !== "string") throw new Error("Raw row needs an internal row ID");
        if (!id.length || rows.has(id)) throw new Error("Duplicate or invalid internal row ID");
        if (!sameKeys(entry, Object.keys(fields)) || !Object.hasOwn(entry, ROW_ID) || Reflect.ownKeys(entry).length !== Object.keys(fields).length + 1) throw new Error("Raw write changed row columns");
        const values: Values = Object.create(null);
        for (const name of Object.keys(fields)) values[name] = entry[name] as Values[string];
        rows.set(id, values);
      }
      const state = this.state(table, rows);
      // Raw metadata must describe the resulting rows, even if left untouched.
      if (!equivalentIndexes(editedIndexes[table], state.indexes)) throw new Error("Raw write left inconsistent indexes");
      accepted.set(table, state);
    }
    for (const [table, state] of accepted) this.staged.set(table, state);
  }

  push(): void {
    this.mutable();
    const next = new Map<string, State>();
    try {
      const encoded = new Map<string, StoredTable>();
      for (const [table, fields] of Object.entries(this.schema)) {
        const state = this.logical(table);
        next.set(table, state);
        encoded.set(table, {
          rows: [...state.rows].map(([id, row]) => ({ id, values: Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, encode(row[name], field)])) })),
          indexes: copyIndexes(state.indexes),
        });
      }
      this.storage.commit(this.schema, encoded);
    } catch (error) {
      this.staged.clear();
      throw error;
    }
    for (const [table, state] of next) this.persisted.set(table, state);
    this.staged.clear();
  }

  database<S extends Schema>(): Database<S> {
    const database: Record<string, unknown> = Object.create(null);
    for (const table of Object.keys(this.schema)) database[table] = new TableView(this, table);
    database.push = () => this.push();
    database.write = (callback: (raw: RawDatabase<Schema>) => void) => this.write(callback);
    return Object.freeze(database) as Database<S>;
  }
}

class TableView implements Table<Values> {
  constructor(private readonly engine: Engine, private readonly table: string, private readonly selection?: ReadonlySet<string>) {}
  get length(): number { return this.engine.read(this.table, this.selection).length; }
  read(): Values[];
  read<K extends keyof Values>(column: K): Values[K][];
  read(column?: keyof Values): Values[] | Values[keyof Values][] {
    const rows = this.engine.read(this.table, this.selection);
    if (column === undefined) return rows;
    if (!Object.hasOwn(this.engine.schema[this.table], column)) throw new Error("Unknown read column");
    return rows.map(row => row[column]);
  }
  filter(predicate: Partial<Values> | ((row: Values) => boolean)): Table<Values> {
    return new TableView(this.engine, this.table, this.engine.select(this.table, this.selection, predicate));
  }
  insert(row: Values): void { this.engine.insert(this.table, row); }
  update(changes: Values): void { this.engine.update(this.table, this.selection, changes); }
  delete(): void { this.engine.delete(this.table, this.selection); }
}

export function initialize(storage: Storage): Initializer {
  let database: Database<Schema> | undefined;
  const initializer = {
    definedb(schema: Schema) {
      if (database) throw new Error("Database schema is already defined");
      database = new Engine(schema, storage).database();
      return initializer;
    },
    get db() {
      if (!database) throw new Error("Call definedb() before using the database");
      return database;
    },
  };
  return initializer as Initializer;
}

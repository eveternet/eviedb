import { decode, encode, key, record, sameKeys, type Schema, type TableSchema, type Row, type Values } from './schema.js';
import type { Storage, DiskState, Indexes } from './storage.js';

/** Raw metadata uses symbols so every schema column name remains available. */
export const rowId: unique symbol = Symbol('EvieDB.rowId');
export const indexes: unique symbol = Symbol('EvieDB.indexes');
export type RawDatabase<S extends Schema> = {
  [K in keyof S]: Array<Row<S[K]> & { [rowId]: string }>;
} & { [indexes]: Record<keyof S, Indexes> };
export interface Table<T extends TableSchema> {
  readonly length: number;
  read(): Row<T>[];
  read<K extends keyof Row<T>>(column: K): Row<T>[K][];
  filter(criteria: Partial<Row<T>> | ((row: Row<T>) => boolean)): Table<T>;
  insert(row: Row<T>): void;
  update<P extends Partial<Row<T>>>(changes: P & { [K in keyof P]: K extends keyof Row<T> ? Row<T>[K] : never }): void;
  delete(): void;
}
export type Database<S extends Schema> = {
  readonly [K in keyof S]: Table<S[K]>;
} & {
  push(): void;
  write(callback: (database: RawDatabase<S>) => void): void;
};
type Rows = Map<string, Values>;
interface State { tables: Record<string, Rows>; indexes: Record<string, Indexes> }
function dictionary<T>(): Record<string, T> { return Object.create(null) as Record<string, T>; }
function cloneIndexes(input: Record<string, Indexes>): Record<string, Indexes> {
  const result = dictionary<Indexes>();
  for (const [table, fields] of Object.entries(input)) {
    result[table] = dictionary<Record<string, string[]>>();
    for (const [field, mapping] of Object.entries(fields)) {
      const copy = result[table][field] = dictionary<string[]>();
      for (const [value, ids] of Object.entries(mapping)) copy[value] = [...ids];
    }
  }
  return result;
}
function buildIndexes(schema: TableSchema, rows: Rows): Indexes {
  const result = dictionary<Record<string, string[]>>();
  for (const [name, field] of Object.entries(schema)) {
    if (!field.index && !field.unique) continue;
    const mapping = dictionary<string[]>();
    for (const [id, row] of rows) {
      const value = row[name];
      const k = key(value);
      const bucket = mapping[k] ?? (mapping[k] = []);
      if (field.unique && value !== undefined && bucket.length) throw new Error(`Unique constraint failed: ${name}`);
      bucket.push(id);
    }
    if (field.index) result[name] = mapping;
  }
  return result;
}
function indexesEqual(actual: unknown, expected: Record<string, Indexes>): boolean {
  if (!record(actual) || !sameKeys(actual, expected)) return false;
  for (const table of Object.keys(expected)) {
    const fields = actual[table];
    if (!record(fields) || !sameKeys(fields, expected[table])) return false;
    for (const field of Object.keys(expected[table])) {
      const mapping = fields[field], target = expected[table][field];
      if (!record(mapping) || !sameKeys(mapping, target)) return false;
      for (const k of Object.keys(target)) {
        const ids = mapping[k];
        if (!Array.isArray(ids) || ids.length !== target[k].length || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !target[k].includes(id))) return false;
      }
    }
  }
  return true;
}

export class Engine<S extends Schema> {
  readonly db: Database<S>;
  private persisted?: State;
  private staged?: State;
  private busy = false;
  private nextId = 0;
  private readonly prefix = Math.random().toString(36).slice(2);
  constructor(readonly schema: S, private readonly storage: Storage) {
    const db = dictionary<unknown>();
    for (const table of Object.keys(schema)) db[table] = this.table(table);
    db.push = () => this.push();
    db.write = (callback: (data: RawDatabase<S>) => void) => this.write(callback);
    this.db = Object.freeze(db) as Database<S>;
  }
  private empty(): State {
    const tables = dictionary<Rows>(), mappings = dictionary<Indexes>();
    for (const name of Object.keys(this.schema)) {
      tables[name] = new Map();
      mappings[name] = buildIndexes(this.schema[name], tables[name]);
    }
    return { tables, indexes: mappings };
  }
  private load(): State {
    if (this.persisted) return this.persisted;
    const disk = this.storage.load();
    const state = this.empty();
    if (disk !== undefined) {
      if (!record(disk) || !sameKeys(disk, { tables: 0, indexes: 0 }) || !record(disk.tables) || !sameKeys(disk.tables, this.schema)) throw new Error('Malformed database storage');
      for (const [table, schema] of Object.entries(this.schema)) {
        const rows = disk.tables[table];
        if (!Array.isArray(rows)) throw new Error('Malformed stored table');
        for (const row of rows) {
          if (!record(row) || !sameKeys(row, { id: 0, values: 0 }) || typeof row.id !== 'string' || !row.id || state.tables[table].has(row.id) || !record(row.values) || !sameKeys(row.values, schema)) throw new Error('Malformed stored row');
          const values: Values = {};
          for (const name of Object.keys(schema)) Object.defineProperty(values, name, { value: decode(row.values[name], schema[name]), writable: true, enumerable: true, configurable: true });
          state.tables[table].set(row.id, values);
        }
        state.indexes[table] = buildIndexes(schema, state.tables[table]);
      }
      if (!indexesEqual(disk.indexes, state.indexes)) throw new Error('Inconsistent stored indexes');
    }
    this.persisted = state;
    return state;
  }
  private logical(): State { return this.staged ?? this.load(); }
  private mutate(action: () => void): void {
    if (this.busy) throw new Error('Reentrant mutation is not supported');
    this.busy = true;
    try { action(); } finally { this.busy = false; }
  }
  private change(table: string, change: (rows: Rows) => void): void {
    this.mutate(() => {
      const before = this.logical();
      const rows = new Map(before.tables[table]);
      change(rows);
      const mapping = buildIndexes(this.schema[table], rows);
      this.staged = {
        tables: { ...before.tables, [table]: rows },
        indexes: { ...before.indexes, [table]: mapping },
      };
    });
  }
  private values(table: string, input: Values): Values {
    // Typed inputs are trusted; codecs handle representability at persistence.
    return Object.fromEntries(Object.keys(this.schema[table]).map(name => [name, input[name]]));
  }
  private table(name: string, selection?: ReadonlySet<string>): Table<TableSchema> {
    const rows = () => {
      const all = this.load().tables[name];
      return selection ? [...selection].flatMap(id => all.has(id) ? [[id, all.get(id)!] as const] : []) : [...all];
    };
    const targeted = (id: string) => selection === undefined || selection.has(id);
    const read = (column?: string) => rows().map(([, row]) => column === undefined ? { ...row } : row[column]);
    return Object.freeze({
      get length() { return rows().length; },
      read,
      filter: (criteria: Partial<Values> | ((row: Values) => boolean)) => {
        const persisted = this.load();
        const entries = typeof criteria === 'function' ? [] : Object.entries(criteria);
        let candidates: Iterable<string> = selection ?? persisted.tables[name].keys();
        // Intersect indexed buckets first; no table scan for indexed equality.
        let smallest: string[] | undefined;
        for (const [field, value] of entries) {
          if (!Object.hasOwn(persisted.indexes[name], field)) continue;
          const bucket = persisted.indexes[name][field][key(value)] ?? [];
          if (!smallest || bucket.length < smallest.length) smallest = bucket;
        }
        if (smallest) candidates = smallest;
        const selected = new Set<string>();
        for (const id of candidates) {
          if (!targeted(id)) continue;
          const row = persisted.tables[name].get(id);
          if (!row) continue;
          const match = typeof criteria === 'function' ? criteria({ ...row }) : entries.every(([field, value]) => row[field] === value);
          if (match) selected.add(id);
        }
        return this.table(name, selected);
      },
      insert: (input: Values) => this.change(name, all => {
        let id: string;
        do { id = `${this.prefix}:${++this.nextId}`; } while (all.has(id));
        all.set(id, this.values(name, input));
      }),
      update: (changes: Partial<Values>) => this.change(name, all => {
        for (const [id, row] of all) if (targeted(id)) all.set(id, this.values(name, { ...row, ...changes }));
      }),
      delete: () => this.change(name, all => {
        for (const id of all.keys()) if (targeted(id)) all.delete(id);
      }),
    }) as Table<TableSchema>;
  }
  private write(callback: (data: RawDatabase<S>) => void): void {
    this.mutate(() => {
      const before = this.logical();
      const raw = dictionary<unknown>() as RawDatabase<S>;
      for (const [table, rows] of Object.entries(before.tables)) {
        (raw as Record<string, unknown>)[table] = [...rows].map(([id, row]) => ({ ...row, [rowId]: id }));
      }
      raw[indexes] = cloneIndexes(before.indexes) as Record<keyof S, Indexes>;
      const result: unknown = callback(raw);
      if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('write() callbacks must be synchronous');
      if (!sameKeys(raw, this.schema) || Object.getOwnPropertySymbols(raw).length !== 1 || !Object.hasOwn(raw, indexes)) throw new Error('Raw write changed database shape');
      const next = this.empty();
      for (const [table, schema] of Object.entries(this.schema)) {
        const rows: unknown = raw[table];
        if (!Array.isArray(rows)) throw new Error('Invalid raw table');
        for (const row of rows) {
          if (!record(row) || !sameKeys(row, schema) || Object.getOwnPropertySymbols(row).length !== 1 || !Object.hasOwn(row, rowId)) throw new Error('Raw write changed row shape');
          const id = (row as { [rowId]: unknown })[rowId];
          if (typeof id !== 'string' || !id || next.tables[table].has(id)) throw new Error('Invalid raw row identity');
          // Copy accepted data; retained callback references cannot mutate state.
          next.tables[table].set(id, this.values(table, row as Values));
        }
        next.indexes[table] = buildIndexes(schema, next.tables[table]);
      }
      if (!indexesEqual(raw[indexes], next.indexes)) throw new Error('Inconsistent raw indexes');
      this.staged = next;
    });
  }
  private disk(state: State): DiskState {
    const tables = dictionary<DiskState['tables'][string]>();
    for (const [table, rows] of Object.entries(state.tables)) tables[table] = [...rows].map(([id, row]) => ({ id, values: Object.fromEntries(Object.entries(row).map(([field, value]) => [field, encode(value)])) }));
    return { tables, indexes: cloneIndexes(state.indexes) };
  }
  private push(): void {
    this.mutate(() => {
      const persisted = this.load();
      const next = this.staged ?? persisted;
      try {
        this.storage.commit(this.schema, this.disk(next));
        this.persisted = next;
      } finally {
        // Failure drops the entire pending batch, leaving the committed snapshot.
        this.staged = undefined;
      }
    });
  }
}

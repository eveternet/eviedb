import * as fs from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cwd } from "node:process";
import type { Schema } from "./schema.js";
import type { Storage, StoredTable, Indexes } from "./storage.js";

/** Node and Bun use one location in the current application environment. */
export class NodeStorage implements Storage {
  private readonly root: string;
  private generation: string | undefined;

  constructor() {
    this.root = join(cwd(), ".eviedb");
    try {
      const head: unknown = JSON.parse(fs.readFileSync(join(this.root, "HEAD.json"), "utf8"));
      if (typeof head !== "string" || !/^generation-[a-f0-9-]+$/.test(head)) throw new Error("Malformed storage head");
      this.generation = head;
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  }

  schema(): unknown | undefined {
    if (!this.generation) return undefined;
    return JSON.parse(fs.readFileSync(join(this.root, this.generation, "schema.json"), "utf8"));
  }

  table(name: string, schema: Schema[string]): unknown {
    if (!this.generation) return { rows: [], indexes: Object.fromEntries(Object.entries(schema).filter(([, f]) => f.index).map(([name]) => [name, {}])) };
    const directory = join(this.root, this.generation);
    const rows: unknown = JSON.parse(fs.readFileSync(join(directory, `${this.filename(name)}.json`), "utf8"));
    const indexes: Indexes = Object.create(null);
    for (const [field, definition] of Object.entries(schema)) {
      if (definition.index) indexes[field] = JSON.parse(fs.readFileSync(join(directory, "indexes", `${this.filename(name)}.${this.filename(field)}.json`), "utf8"));
    }
    return { rows, indexes };
  }

  rowId(): string { return randomUUID(); }
  private filename(name: string): string { return Buffer.from(name).toString("hex") || "empty"; }

  commit(schema: Schema, tables: ReadonlyMap<string, StoredTable>): void {
    fs.mkdirSync(this.root, { recursive: true });
    const generation = `generation-${randomUUID()}`;
    const directory = join(this.root, generation);
    const head = join(this.root, `head-${randomUUID()}.tmp`);
    try {
      fs.mkdirSync(directory);
      fs.mkdirSync(join(directory, "indexes"));
      this.writeFile(join(directory, "schema.json"), schema);
      for (const [table, data] of tables) {
        this.writeFile(join(directory, `${this.filename(table)}.json`), data.rows);
        for (const [field, index] of Object.entries(data.indexes)) {
          this.writeFile(join(directory, "indexes", `${this.filename(table)}.${this.filename(field)}.json`), index);
        }
      }
      this.writeFile(head, generation);
      // The only commit point. No fallible operation follows it.
      fs.renameSync(head, join(this.root, "HEAD.json"));
    } catch (error) {
      // Cleanup must never mask the persistence failure or affect the old generation.
      try { fs.rmSync(head, { force: true }); } catch {}
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
      throw error;
    }
    this.generation = generation;
  }

  private writeFile(path: string, data: unknown): void {
    const file = fs.openSync(path, "wx");
    try {
      fs.writeFileSync(file, JSON.stringify(data));
      fs.fsyncSync(file);
    } finally { fs.closeSync(file); }
  }
}

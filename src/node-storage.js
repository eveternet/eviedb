import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Node/Bun adapter. Each working directory owns one database. Immutable
 * generations contain separate table and index JSON files; CURRENT is the
 * single atomic commit point. Unreferenced generations are harmless after a
 * failed write or interruption. Multi-process writers and crash durability
 * beyond atomic replacement are outside v0.
 * @implements {import('./storage.js').Storage}
 */
export class NodeStorage {
  constructor() {
    this.root = path.resolve('.eviedb');
    this.manifest = undefined;
  }
  readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  schema() {
    let current;
    try { current = fs.readFileSync(path.join(this.root, 'CURRENT'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    if (!/^[a-f0-9-]{36}$/.test(current)) throw new Error('Malformed EvieDB manifest');
    const manifest = this.readJSON(path.join(this.root, current, 'manifest.json'));
    if (manifest.version !== 1 || !Array.isArray(manifest.tables)) throw new Error('Malformed EvieDB manifest');
    this.manifest = { current, ...manifest };
    return manifest.schema;
  }
  load() {
    if (!this.manifest) return undefined;
    const { current, tables } = this.manifest;
    const directory = path.join(this.root, current);
    const data = { tables: Object.create(null), indexes: Object.create(null) };
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      if (typeof table !== 'string' || Object.hasOwn(data.tables, table)) throw new Error('Malformed table manifest');
      data.tables[table] = this.readJSON(path.join(directory, `table-${i}.json`));
      data.indexes[table] = Object.create(null);
      const fields = Object.keys(this.manifest.schema[table]).filter(name => this.manifest.schema[table][name].index);
      for (let j = 0; j < fields.length; j++) data.indexes[table][fields[j]] = this.readJSON(path.join(directory, `index-${i}-${j}.json`));
    }
    return data;
  }
  /** @param {import('./schema.js').Schema} schema @param {import('./storage.js').DiskState} snapshot */
  commit(schema, snapshot) {
    fs.mkdirSync(this.root, { recursive: true });
    const generation = randomUUID();
    const directory = path.join(this.root, generation);
    const pending = path.join(this.root, `${generation}.tmp`);
    const tables = Object.keys(schema);
    const manifest = { version: 1, schema, tables };
    try {
      fs.mkdirSync(directory);
      for (let i = 0; i < tables.length; i++) {
        fs.writeFileSync(path.join(directory, `table-${i}.json`), JSON.stringify(snapshot.tables[tables[i]]));
        const fields = Object.keys(snapshot.indexes[tables[i]]);
        for (let j = 0; j < fields.length; j++) fs.writeFileSync(path.join(directory, `index-${i}-${j}.json`), JSON.stringify(snapshot.indexes[tables[i]][fields[j]]));
      }
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
      fs.writeFileSync(pending, generation);
      fs.renameSync(pending, path.join(this.root, 'CURRENT'));
    } catch (error) {
      // Cleanup must never mask the original failure or affect committed data.
      try { fs.rmSync(pending, { force: true }); } catch {}
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
      throw error;
    }
    // Nothing that can fail is performed after the commit point.
    this.manifest = { current: generation, ...manifest };
  }
}

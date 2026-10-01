import { initialize } from '../dist/database.js';
import { string, number, boolean, ROW_ID, INDEXES } from 'eviedb';

// Raw edits must supply matching metadata. This helper is only test setup.
export function reindexUsers(raw) {
  for (const [name, field] of Object.entries(schema.users)) {
    if (!field.index) continue;
    const index = {};
    for (const row of raw.users) {
      const value = row[name];
      const key = value === undefined ? 'undefined' : JSON.stringify(String(value));
      (index[key] ??= []).push(row[ROW_ID]);
    }
    raw[INDEXES].users[name] = index;
  }
}

export const schema = {
  users: {
    id: number({ unique: true, index: true }),
    firstname: string({ index: true }),
    lastname: string(),
    score: number({ required: false, index: true }),
    active: boolean({ index: true }),
    email: string({ required: false, unique: true, index: true }),
  },
  posts: {
    title: string(),
    author: number({ index: true }),
  },
};

export function user(id, changes = {}) {
  return { id, firstname: 'Evie', lastname: 'Kabeewie', active: false, ...changes };
}

export class MemoryStorage {
  metadata;
  tables = new Map();
  loads = [];
  commits = 0;
  nextId = 1;
  fail = false;
  schema() { return structuredClone(this.metadata); }
  table(name, fields) {
    this.loads.push(name);
    return structuredClone(this.tables.get(name) ?? {
      rows: [], indexes: Object.fromEntries(Object.entries(fields).filter(([, field]) => field.index).map(([name]) => [name, {}])),
    });
  }
  rowId() { return `row-${this.nextId++}`; }
  commit(schema, tables) {
    if (this.fail) throw new Error('Injected storage failure');
    this.metadata = structuredClone(schema);
    this.tables = structuredClone(tables);
    this.commits++;
  }
}

export function open(storage = new MemoryStorage(), definition = schema) {
  const initialization = initialize(storage);
  initialization.definedb(definition);
  return initialization.db;
}
export function seeded() {
  const storage = new MemoryStorage();
  const db = open(storage);
  db.users.insert(user(1, { score: 10, email: 'one@example.com' }));
  db.users.insert(user(2, { firstname: 'Other', score: 100 }));
  db.users.insert(user(3, { score: 200 }));
  db.push();
  return { db, storage };
}

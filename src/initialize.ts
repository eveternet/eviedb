import { Engine, type Database } from './engine.js';
import { normalizeSchema, type Schema } from './schema.js';
import type { Storage } from './storage.js';

/**
 * TypeScript assertion methods require an explicit receiver annotation:
 * const database: Definition = eviedb.init();
 * database.definedb(schema);
 * export default database.db;
 * Alternatively use the typed return: const database = eviedb.init().definedb(schema).
 */
export interface Definition {
  definedb<const S extends Schema>(schema: S): asserts this is Definition & { readonly db: Database<S> };
}
export interface Initializer {
  definedb<const S extends Schema>(schema: S): { readonly db: Database<S> };
}
// Internal factory keeps the database engine testable without public path/config options.
export function createInitializer(storage: Storage): Initializer {
  let database: unknown;
  const initializer = {
    get db() { if (!database) throw new Error('Define a schema before accessing db'); return database; },
    definedb<S extends Schema>(input: S) {
      if (database) throw new Error('Database schema is already defined');
      const schema = normalizeSchema(input) as S;
      const stored = storage.schema();
      if (stored !== undefined) {
        let normalized: Schema;
        try { normalized = normalizeSchema(stored as Schema); } catch { throw new Error('Malformed stored schema'); }
        if (JSON.stringify(normalized) !== JSON.stringify(schema)) throw new Error('Incompatible database schema');
      }
      database = new Engine(schema, storage).db;
      return initializer as unknown as { readonly db: Database<S> };
    },
  };
  return initializer;
}

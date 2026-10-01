import type { Schema } from './schema.js';

/** Internal synchronous storage boundary; not part of the application API. */
export interface Storage {
  schema(): unknown | undefined;
  load(): unknown | undefined;
  /** Must either commit everything or leave the last snapshot unchanged. */
  commit(schema: Schema, snapshot: DiskState): void;
}
export interface DiskRow { id: string; values: Record<string, string | null> }
export type Indexes = Record<string, Record<string, string[]>>;
export interface DiskState {
  tables: Record<string, DiskRow[]>;
  indexes: Record<string, Indexes>;
}

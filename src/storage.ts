import type { EncodedValues, Schema } from "./schema.js";

export interface StoredRow { id: string; values: EncodedValues }
export type Index = Record<string, string[]>;
export type Indexes = Record<string, Index>;
export interface StoredTable { rows: StoredRow[]; indexes: Indexes }

/** Internal boundary. A failed commit must leave the previously opened state unchanged. */
export interface Storage {
  schema(): unknown | undefined;
  table(name: string, schema: Schema[string]): unknown;
  commit(schema: Schema, tables: ReadonlyMap<string, StoredTable>): void;
  rowId(): string;
}

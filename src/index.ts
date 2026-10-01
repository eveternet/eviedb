import { NodeStorage } from './node-storage.js';
import { createInitializer, type Initializer } from './initialize.js';
export type { Definition, Initializer } from './initialize.js';
export { string, number, boolean } from './schema.js';
export type { Field, FieldOptions, Schema, TableSchema, Row } from './schema.js';
export { rowId, indexes } from './engine.js';
export type { Database, Table, RawDatabase } from './engine.js';

export function init(): Initializer { return createInitializer(new NodeStorage()); }
const eviedb = { init };
export { eviedb };
export default eviedb;

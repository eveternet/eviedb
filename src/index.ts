import { initialize } from "./database.js";
import type { Initialization } from "./database.js";
import { NodeStorage } from "./node-storage.js";

export { string, number, boolean } from "./schema.js";
export type { Field, FieldOptions, Row, Schema, TableSchema } from "./schema.js";
export { ROW_ID, INDEXES } from "./database.js";
export type { Initialization, DefinedDatabase, Database, Table, RawDatabase, RawRow } from "./database.js";

export function init(): Initialization { return initialize(new NodeStorage()); }
export default { init };

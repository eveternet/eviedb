import eviedb, { string, number, boolean, ROW_ID, INDEXES } from "../src/index.js";
import type { Initialization, Row, FieldOptions } from "../src/index.js";

function inferredSchema() {
  const database: Initialization = eviedb.init();
  database.definedb({
    users: {
      id: number({ unique: true, index: true }),
      firstname: string(),
      lastname: string(),
      score: number({ required: false }),
      active: boolean(),
    },
  });
  const db = database.db;
  db.users.insert({ id: 1, firstname: "Evie", lastname: "Kabeewie", active: true });
  db.users.insert({ id: 2, firstname: "Evie", lastname: "Kabeewie", active: true, score: undefined });
  const names: string[] = db.users.read("firstname");
  const scores: (number | undefined)[] = db.users.read("score");
  const ids: number[] = db.users.read("id");
  const active: boolean = db.users.read()[0].active;
  db.users.update({ score: undefined });
  db.users.filter({ score: undefined }).update({ active: true });
  db.users.filter(row => row.score !== undefined && row.score > 10).delete();
  const result: void = db.push();
  db.write(raw => {
    const id: string = raw.users[0][ROW_ID];
    const index: string[] | undefined = raw[INDEXES].users.id['"1"'];
    raw.users[0].active = true;
    void [id, index];
  });
  // @ts-expect-error Missing required fields.
  db.users.insert({ id: 1 });
  // @ts-expect-error Wrong application scalar type.
  db.users.update({ active: "true" });
  // @ts-expect-error Required fields cannot be undefined.
  db.users.update({ firstname: undefined });
  // @ts-expect-error Required filter fields cannot be undefined either.
  db.users.filter({ firstname: undefined });
  // @ts-expect-error Extra update fields are not part of the declared schema.
  db.users.update({ active: true, extra: 1 });
  // @ts-expect-error Extra filter fields are not part of the declared schema.
  db.users.filter({ active: true, extra: 1 });
  // @ts-expect-error Optional is not nullable.
  db.users.update({ score: null });
  // @ts-expect-error Unknown table.
  db.unknown.read();
  // @ts-expect-error Unknown field.
  db.users.read("unknown");
  // @ts-expect-error Unknown filter field.
  db.users.filter({ unknown: 1 });
  // @ts-expect-error No data stored on table interfaces.
  db.users.items;
  // @ts-expect-error Internal IDs never appear on application row types.
  db.users.read()[0][ROW_ID];
  // @ts-expect-error Wrong type inferred for numeric columns.
  const invalid: string[] = db.users.read("id");
  void [names, scores, ids, active, result, invalid];
}

const fields = { required: string(), optional: boolean({ required: false }) };
const inferred: Row<typeof fields> = { required: "yes" };
// @ts-expect-error Required by default.
const missing: Row<typeof fields> = {};
// @ts-expect-error Required does not mean nullable.
const nullable: Row<typeof fields> = { required: null };
void [inferredSchema, inferred, missing, nullable];

function dynamicOptions(options: FieldOptions) {
  const fields = { value: string(options) };
  // A runtime-selected required option cannot promise a value is always present.
  const value: string | undefined = ({} as Row<typeof fields>).value;
  // @ts-expect-error Runtime optionality must be reflected in the inferred type.
  const alwaysPresent: string = ({} as Row<typeof fields>).value;
  void [value, alwaysPresent];
}
void dynamicOptions;

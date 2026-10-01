import eviedb, { string, number, boolean, rowId, indexes, type Definition, type Row } from 'eviedb';
const schema = { users: { id: number({ unique: true, index: true }), name: string(), active: boolean(), score: number({ required: false }), alias: string({ required: false, unique: true }) } };
// Both declaration forms preserve schema inference without any/unknown rows.
const database: Definition = eviedb.init();
database.definedb(schema);
const db = database.db;
const inferred = eviedb.init().definedb(schema).db;
db.users.insert({ id: 1, name: 'Evie', active: true });
inferred.users.insert({ id: 2, name: 'Other', active: false, score: undefined });
const names: string[] = db.users.read('name');
const scores: (number | undefined)[] = db.users.read('score');
const rows: Row<typeof schema.users>[] = db.users.read();
db.users.filter(row => row.id > 1).update({ active: false, score: undefined });
db.users.filter({ alias: undefined });
db.write(raw => { const id: string = raw.users[0][rowId]; const ids: string[] = raw[indexes].users.id['1']; raw.users[0].active = false; void id; void ids; });
// @ts-expect-error unknown table
void db.missing;
// @ts-expect-error internal IDs are absent from normal rows
void rows[0][rowId];
// @ts-expect-error schema-required column missing
db.users.insert({ name: 'Evie', active: true });
// @ts-expect-error wrong scalar type
db.users.insert({ id: '1', name: 'Evie', active: true });
// @ts-expect-error required field rejects undefined
db.users.insert({ id: undefined, name: 'Evie', active: true });
// @ts-expect-error optional does not mean nullable
db.users.insert({ id: 1, name: 'Evie', active: true, score: null });
// @ts-expect-error unknown read column
db.users.read('missing');
// @ts-expect-error wrong filter value
db.users.filter({ id: '1' });
// @ts-expect-error wrong update value
db.users.update({ active: 1 });
// @ts-expect-error required fields cannot be cleared in a partial update
db.users.update({ name: undefined });
// @ts-expect-error unknown update column
db.users.update({ missing: true });
// @ts-expect-error read is a function, not a row array
const snapshots: Row<typeof schema.users>[] = db.users.read;
// @ts-expect-error dataless tables have no items
void db.users.items;
void names; void scores; void snapshots;

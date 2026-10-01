import { describe, expect, test } from 'bun:test';
import eviedb, { string, number, boolean, rowId, indexes } from 'eviedb';
import { createInitializer } from '../dist/initialize.js';
import { decode, encode } from '../dist/schema.js';

const schema = {
  users: {
    id: number({ unique: true, index: true }),
    name: string({ index: true }),
    active: boolean(),
    score: number({ required: false }),
    email: string({ required: false, unique: true, index: true }),
  },
  posts: { author: number({ index: true }), text: string() },
};
const user = (id, extra = {}) => ({ id, name: 'Evie', active: true, ...extra });
function memory() {
  let saved, storedSchema;
  return {
    loads: 0, commits: 0, fail: false,
    schema() { return storedSchema; },
    load() { this.loads++; return saved === undefined ? undefined : structuredClone(saved); },
    commit(s, data) {
      this.commits++;
      if (this.fail) throw new Error('disk failed');
      saved = structuredClone(data); storedSchema = structuredClone(s);
    },
    corrupt(fn) { fn(saved); },
  };
}
function open(storage = memory(), declaration = schema) { return createInitializer(storage).definedb(declaration).db; }
function seeded() { const storage = memory(), db = open(storage); db.users.insert(user(1)); db.users.insert(user(2, { name: 'Else', active: false })); db.push(); return { db, storage }; }

test('public entry and schema field defaults', () => {
  expect(typeof eviedb.init).toBe('function');
  expect(string()).toEqual({ kind: 'string', required: true, unique: false, index: false });
  expect(number({ required: false, unique: true, index: true })).toEqual({ kind: 'number', required: false, unique: true, index: true });
});
test('data loads lazily and cached; table objects contain no row data', () => {
  const storage = memory(), db = open(storage);
  expect(storage.loads).toBe(0);
  expect('items' in db.users).toBe(false);
  expect(db.users.length).toBe(0);
  db.users.read(); expect(storage.loads).toBe(1);
});
test('create, insert, push, reopen, read, including finite numbers and undefined', () => {
  const storage = memory(), db = open(storage);
  for (const [id, score] of [[1, -0], [2, Number.MAX_VALUE], [3, Number.MIN_VALUE], [4, undefined]]) db.users.insert(user(id, { score }));
  expect(db.push()).toBeUndefined();
  const reopened = open(storage);
  expect(reopened.users.read()).toEqual(db.users.read());
  expect(Object.is(reopened.users.read('score')[0], -0)).toBe(true);
  expect(Object.getOwnPropertySymbols(reopened.users.read()[0])).toEqual([]);
});
test('reads and filters use persisted state; whole-table mutations use staged state', () => {
  const { db } = seeded();
  db.users.insert(user(3)); db.users.update({ active: false });
  expect(db.users.length).toBe(2);
  expect(db.users.filter({ active: true }).read('id')).toEqual([1]);
  db.users.filter({ active: true }).update({ name: 'Selected' });
  db.push();
  expect(db.users.read('active')).toEqual([false, false, false]);
  expect(db.users.read('name')).toEqual(['Selected', 'Else', 'Evie']);
});
test('retained selections keep identities and read fresh persisted values', () => {
  const { db } = seeded();
  const selected = db.users.filter({ name: 'Evie' }); const snapshot = selected.read()[0];
  selected.update({ name: 'Changed' }); db.users.insert(user(3)); db.push();
  expect(selected.length).toBe(1); expect(selected.read('name')).toEqual(['Changed']);
  expect(snapshot.name).toBe('Evie');
  expect(selected.filter({ name: 'Evie' }).length).toBe(0);
  selected.update({ active: false }); db.push();
  expect(db.users.filter({ id: 3 }).read('active')).toEqual([true]);
});
test('selected deleted rows are skipped and empty mutations are no-ops', () => {
  const { db } = seeded(); const selected = db.users.filter({ id: 1 });
  selected.delete(); selected.update({ name: 'Gone' });
  expect(selected.length).toBe(1); db.push();
  expect(selected.read()).toEqual([]); expect(selected.length).toBe(0);
  selected.delete(); selected.update({ id: 2 }); db.push();
  expect(db.users.read('id')).toEqual([2]);
});
test('read snapshots and callback arguments do not mutate database state', () => {
  const { db } = seeded(); const first = db.users.read(); first[0].name = 'local'; first.pop();
  db.users.filter(row => { row.name = 'callback local'; return true; });
  db.push(); expect(db.users.read('name')).toEqual(['Evie', 'Else']);
  expect(db.users.read()[0]).not.toBe(db.users.read()[0]);
});
test('immediate uniqueness rollback preserves earlier staged work', () => {
  const { db } = seeded(); db.users.insert(user(3));
  expect(() => db.users.insert(user(3))).toThrow('Unique');
  expect(() => db.users.filter({ id: 1 }).update({ id: 3 })).toThrow('Unique');
  db.push(); expect(db.users.read('id')).toEqual([1, 2, 3]);
});
test('optional unique fields permit absence; present values collide immediately', () => {
  const db = open(); db.users.insert(user(1)); db.users.insert(user(2, { email: undefined }));
  db.users.insert(user(3, { email: 'a' }));
  expect(() => db.users.insert(user(4, { email: 'a' }))).toThrow(); db.push();
  expect(db.users.filter({ email: undefined }).length).toBe(2);
  db.users.filter({ id: 3 }).update({ email: undefined }); db.users.insert(user(4, { email: 'a' })); db.push();
  expect(db.users.filter({ email: 'a' }).read('id')).toEqual([4]);
});
test('bulk update is all or nothing, including other columns', () => {
  const { db } = seeded(); db.users.insert(user(3));
  expect(() => db.users.update({ id: 4, name: 'must rollback' })).toThrow();
  db.push(); expect(db.users.read('id')).toEqual([1, 2, 3]); expect(db.users.read('name')).toEqual(['Evie', 'Else', 'Evie']);
});
test('object filters AND indexed and unindexed fields; callback filters scan', () => {
  const { db } = seeded();
  expect(db.users.filter({ name: 'Evie', active: false }).length).toBe(0);
  expect(db.users.filter({ name: 'Evie', active: true }).read('id')).toEqual([1]);
  expect(db.users.filter({ id: 404 }).length).toBe(0);
  expect(db.users.filter({}).length).toBe(2);
  let calls = 0; expect(db.users.filter(row => { calls++; return row.id > 1; }).read('id')).toEqual([2]); expect(calls).toBe(2);
});
test('partial updates replace only supplied fields, including explicit undefined', () => {
  const { db } = seeded(); db.users.update({ score: 100 }); db.users.filter({ id: 1 }).update({ score: undefined }); db.push();
  expect(db.users.read('score')).toEqual([undefined, 100]); expect(db.users.read('name')).toEqual(['Evie', 'Else']);
});
test('filtered insertion targets underlying table without expanding selection', () => {
  const { db } = seeded(), selected = db.users.filter({ id: 1 });
  expect(selected.insert(user(3, { name: 'Not matching' }))).toBeUndefined(); db.push();
  expect(selected.read('id')).toEqual([1]); expect(db.users.length).toBe(3);
});
test('delete and reinsertion release unique values; whole-table delete removes staged inserts', () => {
  const { db } = seeded(); db.users.filter({ id: 1 }).delete(); db.users.insert(user(1, { name: 'Replacement' })); db.push();
  expect(db.users.filter({ id: 1 }).read('name')).toEqual(['Replacement']);
  db.users.insert(user(3)); db.users.delete(); db.push(); expect(db.users.length).toBe(0);
});
test('raw writes see logical state and ordinary typed values', () => {
  const { db } = seeded(); db.users.insert(user(3, { score: 200 }));
  expect(db.write(raw => { for (const row of raw.users) if (row.score > 100) row.active = false; })).toBeUndefined();
  expect(db.users.length).toBe(2); db.push(); expect(db.users.filter({ id: 3 }).read('active')).toEqual([false]);
});
test('raw metadata edits, insertions and deletions are accepted when consistent', () => {
  const { db } = seeded();
  db.write(raw => {
    const first = raw.users[0], old = first[rowId]; first[rowId] = 'edited';
    for (const mapping of Object.values(raw[indexes].users)) for (const ids of Object.values(mapping)) { const i = ids.indexOf(old); if (i >= 0) ids[i] = 'edited'; }
    raw.posts.push({ author: 1, text: 'hi', [rowId]: 'post' });
    raw[indexes].posts.author['1'] = ['post'];
  }); db.push(); expect(db.posts.read()).toEqual([{ author: 1, text: 'hi' }]);
  db.write(raw => { raw.posts.splice(0); raw[indexes].posts.author = {}; }); db.push(); expect(db.posts.length).toBe(0);
});
test('raw callback references cannot mutate accepted state afterward', () => {
  const { db } = seeded(); let retained;
  db.write(raw => { retained = raw; raw.users[0].active = false; });
  retained.users[0].active = true; retained[indexes].users.id = {}; db.push();
  expect(db.users.read('active')).toEqual([false, false]);
});
for (const [label, corrupt] of Object.entries({
  'table removal': raw => { delete raw.posts; },
  'table addition': raw => { raw.other = []; },
  'column removal': raw => { delete raw.users[0].name; },
  'column addition': raw => { raw.users[0].other = 1; },
  'identity duplication': raw => { raw.users[1][rowId] = raw.users[0][rowId]; },
  'identity removal': raw => { delete raw.users[0][rowId]; },
  'stale index': raw => { raw.users[0].id = 99; },
  'dangling index': raw => { raw[indexes].users.id['1'].push('missing'); },
  'unique collision': raw => { raw.users[1].id = 1; },
  'callback exception': raw => { raw.users[0].active = false; throw new Error('callback'); },
})) test(`invalid raw write rolls back: ${label}`, () => {
  const { db } = seeded(); db.users.insert(user(3));
  expect(() => db.write(corrupt)).toThrow(); db.push();
  expect(db.users.read('id')).toEqual([1, 2, 3]); expect(db.users.read('active')).toEqual([true, false, true]);
});
test('reentrant mutations and asynchronous raw callbacks cannot escape rollback', () => {
  const { db } = seeded();
  expect(() => db.write(() => db.users.delete())).toThrow('Reentrant');
  expect(() => db.write(async raw => { raw.users[0].active = false; })).toThrow('synchronous');
  db.push(); expect(db.users.read('active')).toEqual([true, false]);
});
test('indexes follow updates and deletes in staged raw state and on reopen', () => {
  const { db, storage } = seeded(); db.users.filter({ id: 1 }).update({ name: 'Else' });
  db.write(raw => { expect(raw[indexes].users.name['"Else"'].length).toBe(2); expect(raw[indexes].users.name['"Evie"']).toBeUndefined(); });
  expect(db.users.filter({ name: 'Else' }).length).toBe(1); db.push();
  expect(open(storage).users.filter({ name: 'Else' }).length).toBe(2);
  db.users.filter({ id: 1 }).delete(); db.push(); expect(open(storage).users.filter({ name: 'Else' }).read('id')).toEqual([2]);
});
test('failed push restores persisted state and discards the whole staged batch', () => {
  const { db, storage } = seeded(); const selected = db.users.filter({ id: 1 });
  db.users.insert(user(3)); selected.delete(); db.posts.insert({ author: 3, text: 'pending' }); storage.fail = true;
  expect(() => db.push()).toThrow('disk failed'); expect(selected.read('id')).toEqual([1]);
  expect(db.users.read('id')).toEqual([1, 2]); expect(db.posts.length).toBe(0);
  storage.fail = false; db.push(); expect(open(storage).users.read('id')).toEqual([1, 2]);
  db.users.insert(user(3)); db.push(); expect(db.users.length).toBe(3);
});
test('schema compatibility checks all declarations but ignores declaration order', () => {
  const { storage } = seeded();
  for (const changed of [ { ...schema, users: { ...schema.users, id: string({ unique: true, index: true }) } }, { ...schema, users: { ...schema.users, name: string() } }, { ...schema, users: { ...schema.users, email: string({ required: false, index: true }) } }, { ...schema, users: { ...schema.users, score: number() } }, { users: schema.users }, { ...schema, extra: {} } ]) expect(() => open(storage, changed)).toThrow('Incompatible');
  const reversed = Object.fromEntries(Object.entries(schema).reverse().map(([t, fields]) => [t, Object.fromEntries(Object.entries(fields).reverse())]));
  expect(open(storage, reversed).users.length).toBe(2);
});
test('malformed persisted values and indexes fail lazily on decoding', () => {
  const { storage } = seeded(); storage.corrupt(disk => { disk.tables.users[0].values.active = 'yes'; });
  const db = open(storage); expect(() => db.users.read()).toThrow('Malformed');
  const other = seeded().storage; other.corrupt(disk => { disk.indexes.users.id = {}; }); expect(() => open(other).users.read()).toThrow('Inconsistent');
});
test('number codec is canonical and rejects unsupported stored encodings', () => {
  for (const value of [0, -0, 1, -1, 1e21, 0.1, Number.MIN_VALUE]) expect(Object.is(decode(encode(value), number()), value)).toBe(true);
  for (const value of ['NaN', 'Infinity', '-Infinity', '01', '', '1.0']) expect(() => decode(value, number())).toThrow();
  for (const value of [NaN, Infinity, -Infinity]) expect(() => encode(value)).toThrow();
});
test('prototype-shaped schema names and string index values remain ordinary data', () => {
  const declaration = JSON.parse('{"__proto__":{}}');
  Object.defineProperty(declaration.__proto__, '__proto__', { value: string({ index: true }), enumerable: true });
  declaration.__proto__.constructor = string();
  const storage = memory(), db = open(storage, declaration);
  db.__proto__.insert(JSON.parse('{"__proto__":"__proto__","constructor":"ok"}')); db.push();
  expect(open(storage, declaration).__proto__.filter(JSON.parse('{"__proto__":"__proto__"}')).read()).toEqual([JSON.parse('{"__proto__":"__proto__","constructor":"ok"}')]);
});
test('a replacement with the same application key does not revive an old selection', () => {
  const { db } = seeded(); const selected = db.users.filter({ id: 1 });
  selected.delete(); db.users.insert(user(1, { name: 'Replacement' })); db.push();
  expect(selected.length).toBe(0); selected.update({ name: 'Wrong' }); db.push();
  expect(db.users.filter({ id: 1 }).read('name')).toEqual(['Replacement']);
});
test('zero and negative zero have equal index and uniqueness semantics', () => {
  const db = open(); db.users.insert(user(-0));
  expect(() => db.users.insert(user(0))).toThrow('Unique'); db.push();
  expect(db.users.filter({ id: 0 }).length).toBe(1); expect(Object.is(db.users.read('id')[0], -0)).toBe(true);
});
test('a raw index-key update can commit when its metadata is updated consistently', () => {
  const { db, storage } = seeded();
  db.write(raw => { const row = raw.users[0]; row.id = 9; delete raw[indexes].users.id['1']; raw[indexes].users.id['9'] = [row[rowId]]; });
  db.push(); expect(open(storage).users.filter({ id: 9 }).read('name')).toEqual(['Evie']);
});

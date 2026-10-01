import { describe, expect, test } from 'bun:test';
import eviedb, { init, string, number, boolean, ROW_ID, INDEXES } from 'eviedb';
import { MemoryStorage, open, seeded, schema, user } from './helpers.mjs';

describe('schema and codecs', () => {
  test('public entry, scalar defaults and immutable definitions', () => {
    expect(eviedb.init).toBe(init);
    for (const scalar of [string, number, boolean]) {
      expect(scalar()).toMatchObject({ required: true, unique: false, index: false });
      expect(Object.isFrozen(scalar())).toBe(true);
      expect(scalar({ required: false, unique: true, index: true })).toMatchObject({ required: false, unique: true, index: true });
    }
  });

  test('finite numbers, negative zero, strings and booleans survive encoding', () => {
    const storage = new MemoryStorage();
    const db = open(storage);
    const values = [-0, Number.MIN_VALUE, Number.MAX_VALUE, -2.5, 1e-20];
    for (let i = 0; i < values.length; i++) db.users.insert(user(i + 1, { score: values[i], firstname: 'undefined\n"\\\u0000', active: i % 2 === 0 }));
    db.push();
    const reopened = open(storage);
    reopened.users.read().forEach((row, i) => {
      expect(Object.is(row.score, values[i])).toBe(true);
      expect(row.firstname).toBe('undefined\n"\\\u0000');
      expect(row.active).toBe(i % 2 === 0);
    });
  });

  test('unsupported numeric encodings fail staging and preserve earlier work', () => {
    const db = open();
    db.users.insert(user(1));
    for (const score of [NaN, Infinity, -Infinity]) expect(() => db.users.insert(user(2, { score }))).toThrow('finite');
    db.push();
    expect(db.users.read('id')).toEqual([1]);
  });

  test('schema is copied, and equivalent reordered declarations reopen', () => {
    const storage = new MemoryStorage();
    const mutable = { users: { id: number() } };
    const db = open(storage, mutable);
    mutable.users.extra = string();
    db.users.insert({ id: 1 });
    db.push();
    expect(open(storage, { users: { id: number() } }).users.read()).toEqual([{ id: 1 }]);
    const { storage: populated } = seeded();
    const reversed = Object.fromEntries(Object.entries(schema).reverse().map(([table, fields]) => [table, Object.fromEntries(Object.entries(fields).reverse())]));
    expect(open(populated, reversed).users.length).toBe(3);
  });

  test('changed tables, columns, scalar type or constraints fail on definition', () => {
    const { storage } = seeded();
    const variants = [
      { users: schema.users },
      { ...schema, extra: {} },
      { ...schema, users: { ...schema.users, extra: string() } },
      { ...schema, users: { ...schema.users, id: string({ unique: true, index: true }) } },
      { ...schema, users: { ...schema.users, id: number({ index: true }) } },
      { ...schema, users: { ...schema.users, score: number({ index: true }) } },
      { ...schema, users: { ...schema.users, active: boolean() } },
    ];
    for (const variant of variants) expect(() => open(storage, variant)).toThrow('Incompatible');
  });
});

describe('persisted visibility and retained identities', () => {
  test('table data is loaded only when an operation needs it', () => {
    const storage = new MemoryStorage();
    const db = open(storage);
    expect(storage.loads).toEqual([]);
    expect(db.users).not.toHaveProperty('items');
    expect(storage.loads).toEqual([]);
    expect(db.users.length).toBe(0);
    expect(storage.loads).toEqual(['users']);
    db.users.read();
    expect(storage.loads).toEqual(['users']);
    db.posts.read();
    expect(storage.loads).toEqual(['users', 'posts']);
  });

  test('create, insert, push, reopen and read', () => {
    const storage = new MemoryStorage();
    const db = open(storage);
    expect(db.users.insert(user(1))).toBeUndefined();
    expect(db.users.read()).toEqual([]);
    expect(db.push()).toBeUndefined();
    expect(open(storage).users.read()).toEqual([user(1, { score: undefined, email: undefined })]);
  });

  test('reads, filters and length ignore all staged operations', () => {
    const { db } = seeded();
    db.users.insert(user(4));
    db.users.filter({ id: 1 }).update({ firstname: 'Changed' });
    db.users.filter({ id: 2 }).delete();
    expect(db.users.length).toBe(3);
    expect(db.users.read('id')).toEqual([1, 2, 3]);
    expect(db.users.filter({ firstname: 'Changed' }).length).toBe(0);
    expect(db.users.filter({ firstname: 'Evie' }).read('id')).toEqual([1, 3]);
    expect(db.users.filter(row => row.id === 4).length).toBe(0);
    db.push();
    expect(db.users.read('id')).toEqual([1, 3, 4]);
    expect(db.users.filter({ firstname: 'Changed' }).read('id')).toEqual([1]);
  });

  test('insert then whole-table update then delete operates in call order', () => {
    const db = open();
    db.users.insert(user(1));
    db.users.update({ active: true, score: 7 });
    db.users.insert(user(2));
    db.users.update({ lastname: 'New' });
    db.users.delete();
    db.users.insert(user(3));
    db.users.update({ score: 9 });
    db.push();
    expect(db.users.read()).toEqual([user(3, { score: 9, email: undefined })]);
  });

  test('retained selection keeps IDs and reads their current persisted values', () => {
    const { db } = seeded();
    const retained = db.users.filter({ firstname: 'Evie' });
    const snapshot = retained.read()[0];
    retained.update({ firstname: 'Changed' });
    db.users.insert(user(4));
    db.push();
    expect(retained.read('id')).toEqual([1, 3]);
    expect(retained.read('firstname')).toEqual(['Changed', 'Changed']);
    expect(snapshot.firstname).toBe('Evie');
    expect(db.users.filter({ firstname: 'Evie' }).read('id')).toEqual([4]);
    retained.filter({ score: 200 }).update({ active: true });
    db.push();
    expect(retained.read().find(row => row.id === 3).active).toBe(true);
  });

  test('deleted identities are skipped in reads and staged mutations', () => {
    const { db } = seeded();
    const retained = db.users.filter({ firstname: 'Evie' });
    db.users.filter({ id: 1 }).delete();
    retained.update({ score: 2 });
    expect(retained.length).toBe(2);
    db.push();
    expect(retained.read('id')).toEqual([3]);
    expect(retained.read('score')).toEqual([2]);
    retained.delete();
    retained.update({ score: 3 });
    db.push();
    expect(retained.length).toBe(0);
    expect(() => retained.update({ id: 1 })).not.toThrow();
    expect(() => retained.delete()).not.toThrow();
  });

  test('reusing a user field value does not revive an old selection', () => {
    const { db } = seeded();
    const retained = db.users.filter({ id: 1 });
    retained.delete();
    db.users.insert(user(1));
    db.push();
    expect(retained.read()).toEqual([]);
    expect(db.users.filter({ id: 1 }).length).toBe(1);
  });

  test('all reads and callback arguments are independent ordinary snapshots', () => {
    const { db } = seeded();
    const first = db.users.read()[0];
    const second = db.users.read()[0];
    expect(first).not.toBe(second);
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
    expect(Reflect.ownKeys(first)).toEqual(['active', 'email', 'firstname', 'id', 'lastname', 'score']);
    first.firstname = 'Local';
    expect(second.firstname).toBe('Evie');
    db.users.filter(row => { row.active = true; return true; });
    db.push();
    expect(db.users.read('active')).toEqual([false, false, false]);
    expect(first).not.toHaveProperty('delete');
  });

  test('insert through a selection targets the base table without joining selection', () => {
    const { db } = seeded();
    const retained = db.users.filter({ id: 1 });
    expect(retained.insert(user(4, { firstname: 'Different' }))).toBeUndefined();
    retained.update({ score: 1 });
    db.push();
    expect(retained.read('id')).toEqual([1]);
    expect(db.users.filter({ id: 4 }).read('score')).toEqual([undefined]);
  });
});

describe('constraints, filters and indexes', () => {
  test('uniqueness fails immediately while previously staged changes survive', () => {
    const { db } = seeded();
    db.users.insert(user(4));
    expect(() => db.users.insert(user(4))).toThrow('Unique');
    expect(() => db.users.filter({ id: 1 }).update({ id: 4 })).toThrow('Unique');
    db.push();
    expect(db.users.read('id')).toEqual([1, 2, 3, 4]);
  });

  test('non-indexed unique fields still enforce constraints', () => {
    const db = open(new MemoryStorage(), { rows: { name: string({ unique: true }) } });
    db.rows.insert({ name: 'One' });
    expect(() => db.rows.insert({ name: 'One' })).toThrow('Unique');
    db.push();
    expect(db.rows.read()).toEqual([{ name: 'One' }]);
  });

  test('optional unique absence permits multiple rows and can be restored', () => {
    const { db } = seeded();
    db.users.insert(user(4));
    db.users.filter({ id: 1 }).update({ email: undefined });
    db.users.filter({ id: 2 }).update({ email: 'one@example.com' });
    expect(() => db.users.filter({ id: 3 }).update({ email: 'one@example.com' })).toThrow('Unique');
    db.push();
    expect(db.users.filter({ email: undefined }).read('id')).toEqual([1, 3, 4]);
    expect(db.users.filter({ email: 'one@example.com' }).read('id')).toEqual([2]);
  });

  test('bulk update failure rolls back the entire operation', () => {
    const { db } = seeded();
    db.posts.insert({ title: 'Previously staged', author: 1 });
    db.users.filter({ id: 1 }).update({ score: 99 });
    expect(() => db.users.update({ email: 'everyone@example.com', active: true })).toThrow('Unique');
    db.push();
    expect(db.users.read('active')).toEqual([false, false, false]);
    expect(db.users.read('email')).toEqual(['one@example.com', undefined, undefined]);
    expect(db.users.filter({ id: 1 }).read('score')).toEqual([99]);
    expect(db.posts.length).toBe(1);
  });

  test('partial replacements, optional undefined and staged delete free unique values', () => {
    const { db } = seeded();
    const one = db.users.filter({ id: 1 });
    one.update({ score: undefined });
    one.delete();
    db.users.filter({ id: 2 }).update({ email: 'one@example.com', lastname: 'Updated' });
    db.push();
    expect(db.users.filter({ id: 2 }).read()[0]).toMatchObject({ score: 100, active: false, lastname: 'Updated', email: 'one@example.com' });
  });

  test('object AND filters combine indexes and unindexed comparisons', () => {
    const { db } = seeded();
    expect(db.users.filter({ firstname: 'Evie', lastname: 'Kabeewie', score: 200 }).read('id')).toEqual([3]);
    expect(db.users.filter({ firstname: 'Evie', score: 100 }).length).toBe(0);
    expect(db.users.filter({}).length).toBe(3);
    expect(db.users.filter({ firstname: 'missing' }).length).toBe(0);
    expect(db.users.filter(row => row.score > 50).read('id')).toEqual([2, 3]);
  });

  test('object filtering uses index candidates instead of scanning every row', () => {
    const { storage } = seeded();
    let decoyReads = 0;
    const db = open(storage);
    // Access internal engine only to instrument row visitation, not to define expected results.
    const table = db.users;
    const state = table.engine.load('users');
    const decoy = [...state.rows.values()].find(row => row.id === 2);
    Object.defineProperty(decoy, 'firstname', { get() { decoyReads++; return 'Other'; }, enumerable: true });
    expect(table.filter({ firstname: 'Evie' }).read('id')).toEqual([1, 3]);
    expect(decoyReads).toBe(0);
    table.filter(row => row.firstname === 'Evie');
    expect(decoyReads).toBeGreaterThan(0);
  });

  test('updates/deletes persist consistent indexes and indexed results after reopen', () => {
    const { db, storage } = seeded();
    db.users.filter({ id: 1 }).update({ firstname: 'Other', score: undefined });
    db.users.filter({ id: 2 }).delete();
    db.users.insert(user(4, { score: 200 }));
    db.push();
    const reopened = open(storage);
    expect(reopened.users.filter({ firstname: 'Other' }).read('id')).toEqual([1]);
    expect(reopened.users.filter({ score: 200 }).read('id')).toEqual([3, 4]);
    expect(reopened.users.filter({ score: undefined }).read('id')).toEqual([1]);
    expect(reopened.users.filter({ id: 2 }).length).toBe(0);
    const persisted = storage.tables.get('users');
    for (const index of Object.values(persisted.indexes)) {
      const ids = Object.values(index).flat();
      expect(ids.sort()).toEqual(persisted.rows.map(row => row.id).sort());
    }
  });

  test('zero and negative zero compare equal for indexes and uniqueness', () => {
    const db = open();
    db.users.insert(user(-0));
    expect(() => db.users.insert(user(0))).toThrow('Unique');
    db.push();
    expect(db.users.filter({ id: 0 }).length).toBe(1);
    expect(db.users.filter({ id: -0 }).length).toBe(1);
    expect(Object.is(db.users.read('id')[0], -0)).toBe(true);
  });
});

describe('raw writes', () => {
  test('raw write sees staged rows and exposes identity/index metadata', () => {
    const { db } = seeded();
    db.users.insert(user(4, { score: 300 }));
    expect(db.write(raw => {
      expect(raw.users.length).toBe(4);
      expect(typeof raw.users[0][ROW_ID]).toBe('string');
      expect(Object.values(raw[INDEXES].users.id).flat()).toContain(raw.users[0][ROW_ID]);
      for (const user of raw.users) if (user.score > 100) user.active = true;
    })).toBeUndefined();
    expect(db.users.read('active')).toEqual([false, false, false]);
    db.push();
    expect(db.users.read('active')).toEqual([false, false, true, true]);
  });

  test('raw add/edit/delete operations maintain indexes and isolate escaped references', () => {
    const { db, storage } = seeded();
    let escaped;
    db.write(raw => {
      raw.users = raw.users.filter(row => row.id !== 2);
      raw.users[0].firstname = 'New';
      raw.users.push({ ...user(4), [ROW_ID]: 'custom-identity' });
      escaped = raw;
    });
    escaped.users[0].firstname = 'Leaked';
    escaped[INDEXES].users.id = {};
    db.push();
    expect(open(storage).users.filter({ firstname: 'New' }).read('id')).toEqual([1]);
    expect(db.users.read('id')).toEqual([1, 3, 4]);
  });

  test('consistent explicit index and ID changes are accepted', () => {
    const { db, storage } = seeded();
    const retained = db.users.filter({ id: 1 });
    db.write(raw => {
      const before = raw.users[0][ROW_ID];
      raw.users[0][ROW_ID] = 'replacement';
      for (const index of Object.values(raw[INDEXES].users)) {
        for (const [key, ids] of Object.entries(index)) index[key] = ids.map(id => id === before ? 'replacement' : id);
      }
    });
    db.push();
    expect(retained.length).toBe(0);
    expect(open(storage).users.filter({ id: 1 }).length).toBe(1);
  });

  test('failed callbacks, invalid shape, IDs, constraints and metadata rollback together', () => {
    const { db } = seeded();
    db.users.insert(user(4));
    const failures = [
      raw => { raw.users[0].active = true; throw new Error('Callback failed'); },
      raw => { delete raw.posts; },
      raw => { raw.unknown = []; },
      raw => { raw.users[0].extra = 'column'; },
      raw => { delete raw.users[0].firstname; },
      raw => { delete raw.users[0][ROW_ID]; },
      raw => { raw.users[0][ROW_ID] = raw.users[1][ROW_ID]; },
      raw => { raw.users[0].id = raw.users[1].id; },
      raw => { raw[INDEXES].users.id['"1"'] = ['missing']; },
      raw => { delete raw[INDEXES].users.firstname; },
      raw => { raw.posts.push({ title: 'Cannot survive', author: 1, [ROW_ID]: 'post' }); raw.users[0].id = 2; },
    ];
    for (const fail of failures) expect(() => db.write(fail)).toThrow();
    db.push();
    expect(db.users.read('id')).toEqual([1, 2, 3, 4]);
    expect(db.users.read('active')).toEqual([false, false, false, false]);
    expect(db.posts.length).toBe(0);
  });

  test('metadata symbols do not collide with application field names', () => {
    const definition = { rows: { id: string(), __proto__: undefined, ROW_ID: string(), INDEXES: string() } };
    // Define unusual names as own properties, rather than JavaScript object-literal prototype syntax.
    delete definition.rows.__proto__;
    Object.defineProperty(definition.rows, '__proto__', { value: string(), enumerable: true });
    const db = open(new MemoryStorage(), definition);
    db.rows.insert({ id: 'app-id', ROW_ID: 'app-row-id', INDEXES: 'app-indexes', ['__proto__']: 'plain' });
    db.push();
    expect(db.rows.read()[0]).toEqual({ id: 'app-id', ROW_ID: 'app-row-id', INDEXES: 'app-indexes', ['__proto__']: 'plain' });
    db.write(raw => { expect(raw.rows[0].ROW_ID).toBe('app-row-id'); expect(raw.rows[0][ROW_ID]).not.toBe('app-id'); });
  });
});

describe('push failure and malformed storage', () => {
  test('push failure discards staged tables/indexes and restores persisted logical state', () => {
    const { db, storage } = seeded();
    const selection = db.users.filter({ id: 1 });
    selection.update({ id: 10, firstname: 'Changed' });
    db.users.filter({ id: 2 }).delete();
    db.users.insert(user(4));
    db.posts.insert({ title: 'Staged', author: 10 });
    storage.fail = true;
    expect(() => db.push()).toThrow('Injected');
    expect(selection.read('id')).toEqual([1]);
    expect(db.users.read('id')).toEqual([1, 2, 3]);
    expect(db.users.filter({ firstname: 'Changed' }).length).toBe(0);
    expect(() => db.users.insert(user(1))).toThrow('Unique');
    expect(db.posts.length).toBe(0);
    storage.fail = false;
    db.users.insert(user(4));
    db.push();
    expect(open(storage).users.read('id')).toEqual([1, 2, 3, 4]);
    expect(open(storage).posts.length).toBe(0);
  });

  test('failure of a first push also discards staged work', () => {
    const storage = new MemoryStorage();
    const db = open(storage);
    db.users.insert(user(1));
    storage.fail = true;
    expect(() => db.push()).toThrow();
    expect(storage.metadata).toBeUndefined();
    storage.fail = false;
    db.push();
    expect(open(storage).users.read()).toEqual([]);
  });

  test('malformed data/indexes are decoding errors at lazy load', () => {
    const corruptions = [
      table => { table.rows[0].values.active = 'yes'; },
      table => { table.rows[0].values.id = '01'; },
      table => { table.rows[0].values.id = 'Infinity'; },
      table => { table.rows[0].values.firstname = null; },
      table => { delete table.rows[0].values.score; },
      table => { table.rows[0].values.extra = 'column'; },
      table => { table.rows[1].id = table.rows[0].id; },
      table => { table.rows[1].values.id = table.rows[0].values.id; },
      table => { table.indexes.id = {}; },
      table => { table.indexes.id['"1"'].push('ghost'); },
    ];
    for (const corrupt of corruptions) {
      const { storage } = seeded();
      corrupt(storage.tables.get('users'));
      const db = open(storage);
      expect(() => db.users.read()).toThrow();
    }
  });
});

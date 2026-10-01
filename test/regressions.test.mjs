import { describe, expect, test } from 'bun:test';
import { number, string, ROW_ID, INDEXES } from 'eviedb';
import { initialize } from '../dist/database.js';
import { MemoryStorage, open, seeded, user } from './helpers.mjs';

describe('reviewed v0 regressions', () => {
  for (const rejects of [false, true]) {
    test(`async raw callback ${rejects ? 'rejects' : 'resolves'} after await without partial staging`, async () => {
      const { db, storage } = seeded();
      db.users.insert(user(4));
      db.write(raw => { raw.users[0].lastname = 'Earlier successful write'; });
      const callback = async raw => {
        raw.users[0].lastname = 'Must be discarded before await';
        raw.posts.push({ title: 'Must be discarded', author: 1, [ROW_ID]: 'async-post' });
        await Promise.resolve();
        raw.users[1].lastname = 'Must be discarded after await';
        if (rejects) throw new Error('Rejected callback');
      };
      expect(() => db.write(callback)).toThrow('synchronous');
      // Allow the rejected callback to finish; the engine observes its rejection.
      await new Promise(resolve => setImmediate(resolve));
      db.push();
      const reopened = open(storage);
      expect(reopened.users.read('id')).toEqual([1, 2, 3, 4]);
      expect(reopened.users.read('lastname')).toEqual(['Earlier successful write', 'Kabeewie', 'Kabeewie', 'Kabeewie']);
      expect(reopened.posts.read()).toEqual([]);
    });
  }

  test('already rejected async callback stages nothing and does not leak rejection', async () => {
    const { db } = seeded();
    db.users.insert(user(4));
    expect(() => db.write(async raw => {
      raw.users[0].lastname = 'Discarded';
      throw new Error('Rejected before await');
    })).toThrow('synchronous');
    await new Promise(resolve => setImmediate(resolve));
    db.push();
    expect(db.users.read('id')).toEqual([1, 2, 3, 4]);
    expect(db.users.read('lastname')).toEqual(Array(4).fill('Kabeewie'));
  });

  test('Promise and custom thenable returns are rejected with rollback', async () => {
    const { db } = seeded();
    db.users.insert(user(4));
    for (const result of [Promise.resolve(), { then(resolve) { resolve(); } }, Object.assign(() => {}, { then(resolve) { resolve(); } })]) {
      expect(() => db.write(raw => {
        raw.users[0].lastname = 'Discarded';
        return result;
      })).toThrow('synchronous');
    }
    await new Promise(resolve => setImmediate(resolve));
    db.push();
    expect(db.users.read('id')).toEqual([1, 2, 3, 4]);
    expect(db.users.read('lastname')).toEqual(Array(4).fill('Kabeewie'));
  });

  test('raw writes reject unchanged old indexes after an internal ID edit across all tables', () => {
    const { db, storage } = seeded();
    db.posts.insert({ title: 'Earlier staged post', author: 1 });
    expect(() => db.write(raw => {
      raw.posts[0].title = 'Discarded edit';
      raw.users[0][ROW_ID] = 'new-id-with-stale-indexes';
    })).toThrow('inconsistent indexes');
    db.push();
    const reopened = open(storage);
    expect(reopened.users.filter({ id: 1 }).read('firstname')).toEqual(['Evie']);
    expect(reopened.posts.read('title')).toEqual(['Earlier staged post']);
  });

  test('deleting an optional raw column fails while explicit undefined succeeds', () => {
    const storage = new MemoryStorage();
    const definition = { rows: { id: number(), note: string({ required: false }) } };
    const db = open(storage, definition);
    db.rows.insert({ id: 1, note: 'Present' });
    db.rows.insert({ id: 2 });
    db.push();
    db.rows.insert({ id: 3 });
    for (const index of [0, 1]) {
      expect(() => db.write(raw => {
        raw.rows[0].id = 99;
        delete raw.rows[index].note;
      })).toThrow('columns');
    }
    db.write(raw => { raw.rows[0].note = undefined; });
    db.push();
    const rows = open(storage, definition).rows.read();
    expect(rows).toEqual([{ id: 1, note: undefined }, { id: 2, note: undefined }, { id: 3, note: undefined }]);
    expect(rows.every(row => Object.hasOwn(row, 'note'))).toBe(true);
  });

  test('non-unique raw index buckets reject duplicates and accept reordered IDs', () => {
    const { db } = seeded();
    expect(() => db.write(raw => {
      const ids = raw[INDEXES].users.firstname['"Evie"'];
      ids[1] = ids[0];
    })).toThrow('inconsistent indexes');
    db.write(raw => { raw[INDEXES].users.firstname['"Evie"'].reverse(); });
    db.push();
    expect(db.users.filter({ firstname: 'Evie' }).read('id')).toEqual([1, 3]);
  });

  test('a corrupt unloaded table does not block another table or eagerly load it', () => {
    const { storage } = seeded();
    storage.loads.length = 0;
    storage.tables.set('posts', { rows: 'corrupt', indexes: {} });
    const db = open(storage);
    expect(storage.loads).toEqual([]);
    expect(db.users.read('id')).toEqual([1, 2, 3]);
    expect(storage.loads).toEqual(['users']);
    expect(() => db.posts.read()).toThrow('Malformed');
  });

  test('unsupported numbers fail insert, update and raw write during staging', () => {
    const { db, storage } = seeded();
    db.users.insert(user(4));
    for (const score of [NaN, Infinity, -Infinity]) {
      expect(() => db.users.insert(user(5, { score }))).toThrow('finite');
      expect(() => db.users.update({ score })).toThrow('finite');
      expect(() => db.write(raw => {
        raw.users[0].lastname = 'Discarded';
        raw.users[0].score = score;
      })).toThrow('finite');
    }
    db.push();
    const reopened = open(storage);
    expect(reopened.users.read('id')).toEqual([1, 2, 3, 4]);
    expect(reopened.users.read('score')).toEqual([10, 100, 200, undefined]);
    expect(reopened.users.read('lastname')).toEqual(Array(4).fill('Kabeewie'));
  });

  test('chained initialization returns the defined handle and still rejects redefinition', () => {
    const initializer = initialize(new MemoryStorage());
    const defined = initializer.definedb({ rows: { value: string() } });
    expect(defined).toBe(initializer);
    defined.db.rows.insert({ value: 'Chained' });
    defined.db.push();
    expect(defined.db.rows.read()).toEqual([{ value: 'Chained' }]);
    expect(() => defined.definedb({ rows: { value: string() } })).toThrow('already defined');
  });
});

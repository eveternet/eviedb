import { describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import eviedb, { string, number, ROW_ID, INDEXES } from 'eviedb';
import { schema, user } from './helpers.mjs';

function inDirectory(callback) {
  const original = process.cwd();
  const directory = fs.mkdtempSync(join(tmpdir(), 'eviedb-test-'));
  try { process.chdir(directory); return callback(directory); }
  finally { process.chdir(original); fs.rmSync(directory, { recursive: true, force: true }); }
}
function open(definition = schema) {
  const initialization = eviedb.init();
  initialization.definedb(definition);
  return initialization.db;
}
function populated() {
  const db = open();
  db.users.insert(user(1, { score: 42 }));
  db.users.insert(user(2));
  db.posts.insert({ title: 'Original', author: 1 });
  db.push();
  return db;
}
function generation(directory) {
  const root = join(directory, '.eviedb');
  return join(root, JSON.parse(fs.readFileSync(join(root, 'HEAD.json'), 'utf8')));
}

describe('Node/Bun disk storage', () => {
  test('default init owns its location and persists tables plus separate JSON indexes', () => inDirectory(directory => {
    const db = open();
    expect(fs.existsSync(join(directory, '.eviedb'))).toBe(false);
    db.users.insert(user(1, { score: -0 }));
    db.posts.insert({ title: 'Related', author: 1 });
    expect(fs.existsSync(join(directory, '.eviedb'))).toBe(false);
    expect(db.push()).toBeUndefined();
    const location = generation(directory);
    expect(fs.readdirSync(join(location, 'indexes')).length).toBe(6);
    const indexFiles = fs.readdirSync(join(location, 'indexes'));
    for (const filename of indexFiles) expect(typeof JSON.parse(fs.readFileSync(join(location, 'indexes', filename), 'utf8'))).toBe('object');
    const reopened = open();
    expect(reopened.users.read('id')).toEqual([1]);
    expect(Object.is(reopened.users.read('score')[0], -0)).toBe(true);
    const author = reopened.users.filter({ id: reopened.posts.read()[0].author }).read()[0];
    expect(author.firstname).toBe('Evie');
  }));

  test('bulk and raw mutations persist and reopen with valid indexes', () => inDirectory(() => {
    const db = populated();
    db.users.update({ active: true });
    db.write(raw => {
      raw.users[0].firstname = 'Changed';
      raw.posts[0].title = 'Updated';
      raw[INDEXES].users.firstname = {
        '"Changed"': [raw.users[0][ROW_ID]], '"Evie"': [raw.users[1][ROW_ID]],
      };
    });
    db.users.filter({ id: 2 }).delete();
    db.push();
    const reopened = open();
    expect(reopened.users.filter({ firstname: 'Changed', active: true }).read('id')).toEqual([1]);
    expect(reopened.posts.read('title')).toEqual(['Updated']);
  }));

  test('row files are lazy while schema incompatibility fails during definedb', () => inDirectory(directory => {
    populated();
    const path = join(generation(directory), Buffer.from('users').toString('hex') + '.json');
    fs.writeFileSync(path, 'invalid JSON');
    const reopened = open();
    expect(reopened.posts.length).toBe(1);
    expect(() => reopened.users.read()).toThrow();
    expect(() => open({ users: { id: string() } })).toThrow('Incompatible');
  }));

  test('malformed head and referenced schema fail instead of creating an empty database', () => inDirectory(directory => {
    populated();
    const head = join(directory, '.eviedb', 'HEAD.json');
    const before = fs.readFileSync(head, 'utf8');
    fs.writeFileSync(head, '"../outside"');
    expect(() => eviedb.init()).toThrow('Malformed');
    fs.writeFileSync(head, before);
    fs.unlinkSync(join(generation(directory), 'schema.json'));
    expect(() => open()).toThrow();
  }));

  // Schema, each table and index, then the pending head are written separately.
  const files = 2 + Object.keys(schema).length + Object.values(schema).flatMap(fields => Object.values(fields)).filter(field => field.index).length;
  for (const [operation, steps] of [['mkdirSync', 3], ['openSync', files], ['writeFileSync', files], ['fsyncSync', files], ['closeSync', files], ['renameSync', 1]]) {
    for (let failure = 1; failure <= steps; failure++) {
      test(`failure at ${operation} step ${failure} leaves previous disk state and discards staged changes`, () => inDirectory(directory => {
        const db = populated();
        const head = join(directory, '.eviedb', 'HEAD.json');
        const before = fs.readFileSync(head, 'utf8');
        db.users.filter({ id: 1 }).update({ firstname: 'Staged' });
        db.users.filter({ id: 2 }).delete();
        db.users.insert(user(3));
        db.posts.update({ title: 'Staged' });
        const original = fs[operation];
        let calls = 0;
        const mock = spyOn(fs, operation).mockImplementation((...args) => {
          calls++;
          if (calls === failure) {
            // Close the real descriptor before simulating a close failure.
            if (operation === 'closeSync') original(...args);
            throw new Error(`Injected ${operation} failure`);
          }
          return original(...args);
        });
        try { expect(() => db.push()).toThrow(`Injected ${operation} failure`); }
        finally { mock.mockRestore(); }
        expect(fs.readFileSync(head, 'utf8')).toBe(before);
        expect(fs.readdirSync(join(directory, '.eviedb')).sort()).toEqual(['HEAD.json', JSON.parse(before)].sort());
        expect(db.users.filter({ firstname: 'Staged' }).length).toBe(0);
        expect(db.users.read('id')).toEqual([1, 2]);
        expect(() => db.users.insert(user(1))).toThrow('Unique');
        db.push();
        const reopened = open();
        expect(reopened.users.read('id')).toEqual([1, 2]);
        expect(reopened.users.filter({ firstname: 'Evie' }).length).toBe(2);
        expect(reopened.posts.read('title')).toEqual(['Original']);
      }));
    }
  }

  test('a published manifest with no schema metadata fails initialization', () => inDirectory(directory => {
    populated();
    const schemaFile = join(generation(directory), 'schema.json');
    // This format stores the schema itself as the generation metadata. A
    // manifest-shaped object lacking that schema must never mean "new database".
    const malformed = JSON.stringify({ version: 1, tables: Object.keys(schema) });
    fs.writeFileSync(schemaFile, malformed);
    expect(() => open()).toThrow('Incompatible');
    expect(fs.readFileSync(schemaFile, 'utf8')).toBe(malformed);
  }));

  test('cleanup failures preserve the original fsync failure and committed state', () => inDirectory(() => {
    const db = populated();
    db.users.delete();
    const sync = spyOn(fs, 'fsyncSync').mockImplementation(() => { throw new Error('Original fsync failure'); });
    const cleanup = spyOn(fs, 'rmSync').mockImplementation(() => { throw new Error('Cleanup failure'); });
    try { expect(() => db.push()).toThrow('Original fsync failure'); }
    finally { sync.mockRestore(); cleanup.mockRestore(); }
    expect(open().users.read('id')).toEqual([1, 2]);
    db.push();
    expect(open().users.read('id')).toEqual([1, 2]);
  }));

  test('first push failure has no partially persisted database', () => inDirectory(directory => {
    const db = open();
    db.users.insert(user(1));
    const mock = spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('Cannot replace head'); });
    try { expect(() => db.push()).toThrow('Cannot replace head'); }
    finally { mock.mockRestore(); }
    expect(fs.existsSync(join(directory, '.eviedb', 'HEAD.json'))).toBe(false);
    expect(db.users.read()).toEqual([]);
    expect(open().users.read()).toEqual([]);
    db.push();
    expect(open().users.read()).toEqual([]);
  }));

  test('unusual table/column names cannot escape the storage directory', () => inDirectory(directory => {
    const definition = { '../rows': { '../id': number({ index: true }), '': string({ index: true }) } };
    const db = open(definition);
    db['../rows'].insert({ '../id': 42, '': 'empty column name' });
    db.push();
    expect(open(definition)['../rows'].filter({ '../id': 42 }).read('')).toEqual(['empty column name']);
    expect(fs.readdirSync(directory)).toEqual(['.eviedb']);
  }));

  test('a new Node process and a new Bun process reopen the same database', () => inDirectory(directory => {
    const entry = pathToFileURL(fileURLToPath(new URL('../dist/index.js', import.meta.url))).href;
    const program = `
      import eviedb, { number, string } from ${JSON.stringify(entry)};
      const database = eviedb.init().definedb({ users: { id: number({ unique: true, index: true }), name: string() } });
      const db = database.db;
      if (process.argv[1] === 'write') { db.users.insert({ id: 1, name: 'Evie' }); db.push(); }
      if (process.argv[1] === 'update') { db.users.filter({ id: 1 }).update({ name: 'New' }); db.push(); }
      console.log(JSON.stringify(db.users.read()));
    `;
    function run(binary, action) {
      const child = spawnSync(binary, ['--input-type=module', '-e', program, action], { cwd: directory, encoding: 'utf8' });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      if (child.status !== 0) throw new Error(child.stderr);
      return JSON.parse(child.stdout);
    }
    expect(run('node', 'write')).toEqual([{ id: 1, name: 'Evie' }]);
    expect(run(process.execPath, 'read')).toEqual([{ id: 1, name: 'Evie' }]);
    expect(run(process.execPath, 'update')).toEqual([{ id: 1, name: 'New' }]);
    expect(run('node', 'read')).toEqual([{ id: 1, name: 'New' }]);
  }));
});

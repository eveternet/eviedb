import { expect, test, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import eviedb, { number, string } from 'eviedb';
import { NodeStorage } from '../dist/node-storage.js';
import { createInitializer } from '../dist/initialize.js';
const schema = { users: { id: number({ unique: true, index: true }), name: string({ index: true }) }, posts: { body: string() } };
function temporary(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eviedb-test-'));
  const old = process.cwd();
  try { process.chdir(dir); run(dir); } finally { process.chdir(old); fs.rmSync(dir, { recursive: true, force: true }); }
}
function open() { return eviedb.init().definedb(schema).db; }
function seeded() { const db = open(); db.users.insert({ id: 1, name: 'Evie' }); db.push(); return db; }
test('default Node/Bun storage persists and reopens the same database', () => temporary(dir => {
  const db = seeded(); db.posts.insert({ body: 'hello' }); db.push();
  const reopened = open(); expect(reopened.users.read()).toEqual([{ id: 1, name: 'Evie' }]); expect(reopened.posts.read('body')).toEqual(['hello']);
  const root = path.join(dir, '.eviedb'); const generation = fs.readFileSync(path.join(root, 'CURRENT'), 'utf8');
  const files = fs.readdirSync(path.join(root, generation));
  expect(files.filter(f => f.startsWith('index-')).length).toBe(2);
  expect(JSON.parse(fs.readFileSync(path.join(root, generation, 'index-1-0.json'), 'utf8'))).toEqual({ '1': [expect.any(String)] });
}));
test('persisted data survives a new process', () => temporary(dir => {
  seeded();
  const modulePath = path.resolve(import.meta.dir, '../dist/index.js');
  const code = `import eviedb, {number,string} from ${JSON.stringify(modulePath)}; const db = eviedb.init().definedb({users:{id:number({unique:true,index:true}),name:string({index:true})},posts:{body:string()}}).db; console.log(JSON.stringify(db.users.read()));`;
  const child = Bun.spawnSync([process.execPath, '--eval', code], { cwd: dir });
  expect(child.exitCode).toBe(0); expect(JSON.parse(child.stdout.toString())).toEqual([{ id: 1, name: 'Evie' }]);
}));
for (let failure = 1; failure <= 6; failure++) test(`filesystem write failure ${failure} leaves all committed files reachable and drops pending work`, () => temporary(dir => {
  const db = seeded(), before = fs.readFileSync(path.join(dir, '.eviedb/CURRENT'), 'utf8');
  db.users.update({ name: 'pending' }); db.posts.insert({ body: 'pending' });
  let count = 0; const original = fs.writeFileSync;
  const mock = spyOn(fs, 'writeFileSync').mockImplementation((...args) => { if (++count === failure) throw new Error('injected write failure'); return original(...args); });
  try { expect(() => db.push()).toThrow('injected'); } finally { mock.mockRestore(); }
  expect(fs.readFileSync(path.join(dir, '.eviedb/CURRENT'), 'utf8')).toBe(before);
  expect(open().users.read('name')).toEqual(['Evie']); expect(open().posts.length).toBe(0);
  expect(db.users.read('name')).toEqual(['Evie']); db.push(); expect(open().posts.length).toBe(0);
}));
test('failed atomic manifest replacement restores the previous snapshot', () => temporary(() => {
  const db = seeded(); db.users.delete(); db.posts.insert({ body: 'pending' });
  const mock = spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('rename failed'); });
  try { expect(() => db.push()).toThrow('rename failed'); } finally { mock.mockRestore(); }
  expect(open().users.length).toBe(1); expect(open().posts.length).toBe(0);
  db.push(); expect(open().users.length).toBe(1);
}));
test('first push failure does not publish any database and can be retried with new mutations', () => temporary(() => {
  const db = open(); db.users.insert({ id: 1, name: 'lost' });
  const mock = spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('rename failed'); });
  try { expect(() => db.push()).toThrow(); } finally { mock.mockRestore(); }
  expect(open().users.length).toBe(0); db.users.insert({ id: 1, name: 'new' }); db.push(); expect(open().users.read('name')).toEqual(['new']);
}));
test('schema is checked before row files are loaded', () => temporary(dir => {
  seeded(); const root = path.join(dir, '.eviedb'), generation = fs.readFileSync(path.join(root, 'CURRENT'), 'utf8');
  fs.writeFileSync(path.join(root, generation, 'table-1.json'), 'not json');
  expect(() => eviedb.init().definedb({ users: { id: string() } })).toThrow('Incompatible');
  const db = open(); expect(() => db.users.read()).toThrow();
}));
test('missing index files and malformed manifests fail instead of silently reinitializing', () => temporary(dir => {
  seeded(); const root = path.join(dir, '.eviedb'), generation = fs.readFileSync(path.join(root, 'CURRENT'), 'utf8');
  fs.unlinkSync(path.join(root, generation, 'index-1-0.json')); expect(() => open().users.read()).toThrow();
  fs.writeFileSync(path.join(root, 'CURRENT'), '../../elsewhere'); expect(() => open()).toThrow('Malformed');
}));
test('storage boundary is synchronous and independent of the public API', () => temporary(() => {
  const storage = new NodeStorage(), db = createInitializer(storage).definedb(schema).db;
  expect(db.push()).toBeUndefined(); expect(open().users.length).toBe(0);
}));

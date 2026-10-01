### To use EvieDB:

```ts
import db from "./db.ts";
```

To read `User` Table:

```ts
const users: User[] = db.users.raw();
```

Reads only see the current persisted database state. Staged changes are not visible until they are finalised with `db.push()`.

Rows returned by reads are detached values. Changing a returned row or array does not change the database.

To filter down `firstname`s in user table:

```ts
const users: Table = db.users.filter({ firstname: "Evie" });
```

Object filters use AND semantics. Every supplied field must match. When a filtered field has an index, EvieDB may use that index to find matching internal row IDs instead of scanning the whole table.

To filter a number that is not equals to, but less than / more than:

```ts
const users: Table = db.users.filter((user) => {
  return user.score > 100;
});
```

-# Note: This _is_ going to be unoptimised in v0 and thats okay. Callback filters scan rows at runtime rather than requiring index/query-planner support.

To get all `firstname`s:

```ts
const firstnames: string[] = db.users.read("firstname");
```

To insert a item:

```ts
db.users.insert({
  firstname: "Evie",
  lastname: "Kabeewie",
  score: 100,
  active: true,
});
```

To update all `active` columns to `true`:

```ts
db.users.update({ active: true });
```

`update()` is a partial replacement. Every property supplied to `update()` replaces that property's current value on each selected row. Properties not supplied are left unchanged.

For optional fields, `undefined` is a valid value and represents the field having no value:

```ts
db.users.update({ score: undefined });
db.users.update({ score: 100 });
```

Required fields cannot be set to `undefined`.

To filter all users with a specific `firstname` to update `active` columns to `true`:

```ts
db.users.filter({ firstname: "Evie" }).update({ active: true });
```

To delete all entries in `User` table:

```ts
db.users.delete();
```

To delete all entries where `active` is `false` in the `User` table:

```ts
db.users.filter({ active: false }).delete();
```

`insert()`, `update()`, `delete()`, and `write()` return nothing.

To finalise all staged edit operations:

```ts
db.push();
```

A failed `push()` should discard all changes from that push rather than leave a partially persisted operation.

### To use EvieDB but _badly_:

To do anything:

```ts
db.write((datab) => {
  // datab is the raw EvieDB representation, including internal row IDs
});
```

`db.write()` exposes EvieDB's raw database representation, including the internal row IDs used by indexes. Those IDs are storage metadata and are not exposed by the normal typed read API.

`db.write()` may add, edit, or delete rows. It may not add or delete tables or schema-defined columns. The database shape defined by the schema stays the same.

Changes made inside one failed `db.write()` are discarded together.

For example, to update users using arbitrary Javascript:

```ts
db.write((datab) => {
  for (const user of datab.users) {
    if (user.score > 100) {
      user.active = true;
    }
  }
});
```

### Type safety:

EvieDB v0 relies on TypeScript for application value type safety. It does not add a second runtime validation layer for values supplied through the typed API.

Values from unknown sources must be narrowed or validated by the application before they can be passed to EvieDB, like any other typed TypeScript API. Using `any` or a type assertion can bypass these guarantees.

Malformed or incompatible persisted data is a storage/decoding error rather than application input validation.

### Runtime storage:

EvieDB's public API is runtime-agnostic. Runtime-specific persistence and the exact storage location/backend used by `eviedb.init()` are implementation details.

v0 only guarantees support for runtimes for which EvieDB provides a storage implementation.

### Types:

```ts
interface db {
  // tables like
  users: Table;
}

interface Table {
  length: number;
  items: User[]; // For Example
  filter: Function;
  delete: Function;
  update: Function;
  read: Function;
  insert: Function;

  // Note: Filter, delete, update and insert do nothing after they have been assigned to a variable. Ideally.
}
```

Read ordering is unspecified.

### Undesigned EvieDB things:

Detailed persistence and recovery behavior beyond avoiding partial successful writes. A WAL or stronger crash recovery may be added later, but is not required for v0.

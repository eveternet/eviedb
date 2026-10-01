### To use EvieDB:

```ts
import db from "./db.ts";
```

To read `User` Table:

```ts
const users: User[] = db.users.read();
```

`read()` is a function and is the normal typed API boundary that actually retrieves row data. Table and filtered-table objects do not contain row data themselves; they expose operations and, for filtered tables, retain selection identity. Calling `read()` retrieves ordinary typed snapshot objects from the current persisted database state. Staged changes are not visible until they are finalised with `db.push()`.

Rows returned by `read()` are ordinary typed TypeScript snapshot objects, not live EvieDB objects. Assigning to their properties only changes the local object and does not stage a database mutation. Database mutations are performed through explicit actions on the relevant table or retained filtered table, such as `.update()` and `.delete()`.

A retained filtered `Table` keeps the internal row IDs selected when `filter()` ran. It does not rerun its filter later if persisted database state changes. Reads through that table return the current persisted values of those selected rows, not the values from when the selection was created. An individual row object already returned by `read()` remains a local snapshot.

Reads skip selected row IDs that no longer exist in persisted state. Mutations through retained tables skip targeted row IDs that no longer exist in the logical/staged state. If no targeted rows remain, the operation is a no-op.

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
  id: 1,
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

### Staged mutations

Mutations operate on the current logical/staged state: the persisted database plus all previously staged changes. They are applied in call order. For example, `insert(); update(); push()` updates the newly inserted row as well as existing rows when the update targets the whole table.

This does not change read visibility. Normal reads, including `filter()`, still see only persisted state until `push()`. A mutation through a filtered table targets its retained row IDs in the current logical/staged state.

Uniqueness is checked immediately when staging a mutation against the current logical/staged state. A failed mutation throws synchronously and stages nothing from that operation; previously staged work remains staged. A bulk update succeeds or fails as one operation, rather than staging changes to only some of its rows.

Calling `insert()` through a filtered table inserts into the underlying table. The new row does not have to match the filter and does not join that table's retained selection.

### Persistence

To finalise all staged edit operations:

```ts
db.push();
```

`db.push()` is synchronous and returns `void`. On success, all staged changes are persisted and become visible to normal reads. If persistence fails, `push()` throws synchronously and discards all changes from that push rather than leaving a partially persisted operation. The previously persisted database state remains unchanged.

`push()` persists mutations that were already accepted during staging; it is not the point at which uniqueness violations are first discovered.

### To use EvieDB but _badly_:

To do anything:

```ts
db.write((datab) => {
  // datab is the raw EvieDB representation, including internal row IDs
});
```

`db.write()` exposes the current logical/staged database in EvieDB's raw representation, including the internal row IDs used by indexes. Those IDs are storage metadata and are not exposed by the normal typed read API.

`db.write()` may add, edit, or delete rows. It may not add or delete tables or schema-defined columns. The database shape defined by the schema stays the same.

Changes made inside one failed `db.write()` are discarded together. `db.write()` may expose and edit internal row IDs and index metadata, but EvieDB still owns their invariants. If the callback leaves the raw representation structurally inconsistent, the write fails rather than persisting inconsistent metadata.

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
  filter: Function;
  delete: Function;
  update: Function;
  read: Function;
  insert: Function;

  // Table objects are dataless operation interfaces.\n  // Filtered tables retain their selected row identities when assigned to variables.\n  // Row data is only retrieved when read() is called.
}
```

Read ordering is unspecified.

### Undesigned EvieDB things:

Detailed persistence and recovery behavior beyond avoiding partial successful writes. A WAL or stronger crash recovery may be added later, but is not required for v0.

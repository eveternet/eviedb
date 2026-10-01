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

Object filters use AND semantics. Every supplied field must match.

To filter a number that is not equals to, but less than / more than:

```ts
const users: Table = db.users.filter((user) => {
  return user.score > 100;
});
```

-# Note: This _is_ going to be unoptimised in v0 and thats okay. This is just best for DX at the moment.

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
  // datab is raw JSON-shaped data containing every table and every row
});
```

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

### Undesigned EvieDB things:

Indexes. They weird.

The exact runtime validation behavior for values supplied through Javascript or `any`.

The exact merge/removal semantics of `update()`, including explicitly supplied `undefined`.

Detailed persistence and recovery behavior beyond avoiding partial successful writes.

Which runtimes/platform storage APIs v0 supports.

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

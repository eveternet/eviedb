### Schema Design:

```ts
// import like stuff idk
const database = eviedb.init();

database.definedb({
  users: {
    id: number({
      unique: true,
      // required: true,
      // default: true, also required js means notnull not null is a stupid name
      index: true,
    }),
    firstname: string(),
    lastname: string(),
    score: number({
      required: false,
    }),
    active: boolean(),
  },
});

export default database.db;
```

`required` defaults to `true`. A required property must exist and may not be `null` or `undefined`.

`required: false` allows the property to be `undefined`. It can later be assigned a value, or an existing value can be replaced with `undefined`.

`unique: true` means duplicate values cause the operation to fail.

EvieDB v0 has no primary-key concept. For EvieDB's current needs, a primary key is just a field that is unique, required, and indexed, so those properties are declared independently instead.

`eviedb.init()` initializes EvieDB without requiring the application to provide a database path. EvieDB owns the location of its storage rather than exposing linking as part of the normal API. The exact runtime-specific storage location/backend is still undesigned.

Database contents are loaded lazily when data is needed.

Changing the declared schema of an existing database is a migration problem and is out of scope for v0.

The schema must propagate into `database.db` so table names, row fields, field types, and optionality are inferred by TypeScript.

Undesigned: How `database.definedb()` propagates the schema into the exported `database.db` TypeScript type.

Undesigned: Index behavior and implementation.

Undesigned: How `eviedb.init()` chooses/accesses persistent storage on each supported runtime.

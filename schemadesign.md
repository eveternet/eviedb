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

`required: false` allows the property to be `undefined`. It can later be assigned a value, or an existing value can be replaced with `undefined`. It does not make `null` valid unless the field type itself explicitly supports `null`.

`unique: true` means duplicate present values cause the operation to fail. Multiple rows may have `undefined` for the same optional unique field; absence is not treated as a duplicate value.

The v0 `number()` scalar accepts finite JavaScript numbers. `NaN`, `Infinity`, and `-Infinity` are unsupported. Finite values such as `-0` remain ordinary JavaScript numbers.

EvieDB v0 has no developer-facing primary-key concept. Internally, EvieDB assigns each row a stable row ID for storage and index references. Internal row IDs are not part of schema-derived application row types and are not exposed through normal reads.

For EvieDB's current public API needs, a primary key is just a field that is unique, required, and indexed, so those properties are declared independently instead.

### Indexes

`index: true` creates and maintains an index for that field.

An index is persisted as a separate JSON file mapping an indexed value to the internal row ID or IDs containing that value. Non-unique indexes may map one value to multiple row IDs. Unique indexes can map a value to only one row because duplicate values fail.

Insert, update, and delete operations keep indexes in sync with table data. Equality object filters can use these mappings to find rows without scanning the whole table. Callback filters scan rows in v0.

The exact JSON layout, internal row-ID generation strategy, and lower-level index implementation are implementation details as long as these semantics are preserved.

Internal row IDs and other raw storage metadata are visible through `db.write()`, which intentionally exposes EvieDB's raw representation, but not through the normal typed API.

### Initialization and storage

`eviedb.init()` initializes EvieDB without requiring the application to provide a database path. EvieDB owns the location of its storage rather than exposing linking as part of the normal API.

Database contents are loaded lazily when data is needed.

EvieDB's public API is runtime-agnostic. Each supported runtime/storage implementation has one EvieDB storage location selected by EvieDB. Calls to `eviedb.init()` in that environment reopen that same persistent database rather than selecting a database by user-provided name or path. The exact runtime-specific path/backend remains an implementation detail. v0 only guarantees support for runtimes for which EvieDB provides a storage implementation.

Changing the declared schema of an existing database is a migration problem and is out of scope for v0. If `init()` is given a schema incompatible with the existing database, initialization fails rather than silently reinterpreting persisted data.

The schema must propagate into `database.db` so table names, row fields, field types, and optionality are inferred by TypeScript.

Undesigned: How `database.definedb()` propagates the schema into the exported `database.db` TypeScript type.

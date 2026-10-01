### Schema Design:

```ts
// import like stuff idk
const database = eviedb.link("./eviedb.eviedb");

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

Undesigned: How database.definedb() propagates the schema into the exported database.db TypeScript type.

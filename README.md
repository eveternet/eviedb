# EvieDB

EvieDB is an experiment in TypeScript-native relational persistence.

> **EvieDB stores and retrieves relational data. TypeScript computes with it.**

Instead of embedding a second language inside a TypeScript application, EvieDB explores what a relational database can look like when JavaScript/TypeScript itself is the programming and query environment.

There is no SQL layer and no planned EvieDB query language. Tables, rows, indexes, and relationships should feel like data structures exposed to TypeScript rather than a separate language hidden behind strings.

A future application might conceptually look like:

```ts
import db from "./db";

for (const user of db.users) {
  if (user.age >= 18) console.log(user.name);
}

const user = db.users.index.id.get(id);
```

The exact API is deliberately **not settled yet**. Examples describe the intended model, not a compatibility promise.

## Status

EvieDB is currently a design experiment and proof-of-concept project. It is not production-ready, and it is not trying to replace PostgreSQL, SQLite, or SQL in general.

The first goal is much smaller: prove that a useful typed relational persistence system can exist naturally inside a TypeScript application without requiring SQL.

See [DESIGN.md](./DESIGN.md), [STORAGE.md](./STORAGE.md), and [V0.md](./V0.md).

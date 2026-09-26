# EvieDB Design

This records decisions that are settled enough to preserve. It is not an API specification.

## Core principle

> **EvieDB stores and retrieves relational data. TypeScript computes with it.**

Another useful description:

> **EvieDB is a persistent relational data structure for TypeScript.**

EvieDB should not implement an operation merely because SQL databases expose that operation as query syntax. If ordinary TypeScript already expresses an operation well, it belongs in TypeScript unless moving it into storage provides a necessary capability.

## JavaScript is the query language

EvieDB does not need an EvieQL, JSON query DSL, or SQL-shaped API. Filtering is an `if`. Iteration is a loop. Transformation is ordinary JavaScript.

```ts
for (const user of db.users) {
  if (user.age >= 18 && isInteresting(user)) {
    doSomething(user);
  }
}
```

The database does not need to understand `isInteresting`. It needs to provide the data efficiently and correctly.

## Public model

The intended model is:

- one obvious application database object, conventionally exported from `db.ts`
- tables accessible conceptually as `db.<table>`
- rows represented as ordinary typed TypeScript objects
- schemas expressed using TypeScript-facing concepts
- indexes exposed as explicit access paths
- relational integrity owned by EvieDB; application computation owned by TypeScript

A project's `db.ts` should eventually contain what is needed to use its database: schema, persistence/connection configuration, and the exported database object. Exact declaration and mutation APIs remain open.

## Types

> **The public type system is TypeScript's type system. The storage type system is EvieDB's problem.**

Applications should think in terms such as `string`, `number`, `bigint`, `boolean`, `null`, `Uint8Array`, `Temporal.*`, and semantic types such as UUID where JavaScript lacks one.

They should not choose `int8`, `float32`, or `varchar(255)` merely because storage uses a physical representation internally. Length is a constraint, not a different kind of string.

## Indexes and access paths

Indexes are real database structures maintained by EvieDB. EvieDB builds and persists them, keeps them consistent with writes, and performs lookup/traversal efficiently.

The developer chooses the access path.

```ts
for (const user of db.users) {
  // explicit full-table scan
}

const user = db.users.index.id.get(42);

for (const user of db.users.index.age.between(18, 30)) {
  // explicit indexed range traversal
}
```

This does not mean the application implements the index. EvieDB exposes it as a first-class data-access interface rather than hiding it behind an automatic query planner.

## Relationships without query-language joins

Relational data still has relationships without a `JOIN` keyword.

```ts
for (const post of db.posts) {
  const author = db.users.index.id.get(post.authorId);
  console.log(author.name, post.title);
}
```

A reverse relationship can likewise use an index:

```ts
const user = db.users.index.id.get(42);
for (const post of db.posts.index.authorId.getAll(user.id)) {
  console.log(post.title);
}
```

These may be joins algorithmically. EvieDB simply does not require a separate join language construct. Foreign-key-like constraints may still be useful because referential integrity is a database responsibility.

The same principle applies to operations such as SQL `UNION`: if normal TypeScript collection primitives solve the application problem, EvieDB need not duplicate them.

## Local and future remote execution

Embedded EvieDB runs inside the application's process.

> **Local EvieDB trusts your TypeScript because it is your process. Remote EvieDB trusts only EvieDB operations.**

Remote operation is not required for the initial proof of concept. If it eventually exists, the server should expose constrained data-access capabilities: table reads/streams, indexed key and range reads, writes, and perhaps transaction boundaries.

It should **not** execute arbitrary JavaScript supplied by clients.

Remote execution creates a deliberate bandwidth tradeoff versus databases that compute close to their data. Batching, streaming, caching, prefetching, and multi-key index reads can improve data access without moving arbitrary application computation onto the server.

> **Optimize data access, not application computation.**

## Missing features

A missing SQL feature is not automatically a missing EvieDB feature.

Before adding a database primitive, ask whether normal TypeScript already expresses it cleanly and whether moving it into EvieDB provides a necessary persistence, integrity, durability, or efficient-access capability.

"Databases usually have this syntax" is not sufficient reason.

## Non-goals

EvieDB is not currently trying to provide SQL compatibility, a new query language, PostgreSQL compatibility, every programming language, automatic query planning, arbitrary server-side application code, a complete analytical engine, production readiness, or feature parity with mature databases.

## Open design questions

Still intentionally unfrozen: exact schema syntax; sync/async table iteration; mutation API; directly mutable persisted rows; compound indexes; defaults/nullability/uniqueness syntax; schema evolution; transactions and concurrency; remote protocol; UUID and Temporal runtime representation.

Examples must not accidentally turn these questions into compatibility requirements.

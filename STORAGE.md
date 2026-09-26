# EvieDB Storage

Physical storage is an implementation detail and may change substantially.

> **Storage preserves values. The schema gives those values meaning.**

For the first implementation, deliberately boring and inspectable storage is more valuable than inventing a binary database format before the database model works.

## v0: JSON is allowed to be embarrassing

The initial implementation may persist the database as a directory containing JSON files for tables, metadata, and indexes.

```text
my-database/
├── schema.json
├── users.json
├── posts.json
└── indexes/
    ├── users.id.json
    └── posts.authorId.json
```

This layout is illustrative, not specified. JSON is an implementation choice, **not part of EvieDB's public API**.

## String-encoded values

A deliberately simple v0 representation may encode stored scalar values as strings.

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "age": "18",
    "active": "true",
    "createdAt": "2026-09-26T10:30:00Z"
  }
]
```

Those strings do not define application types. The schema does.

```text
WRITE: TypeScript value -> schema codec -> storage encoding -> persistence
READ:  persistence -> storage encoding -> schema codec -> TypeScript value
```

Everything-as-string is not proposed because strings are efficient. It makes the separation between physical storage and semantic type explicit.

## Responsibilities

Storage persists and retrieves encoded values and index structures and provides whatever durability guarantees EvieDB promises.

The schema/codec layer interprets stored values, validates application values, encodes/decodes them, and applies canonical representations.

The index layer builds and maintains indexes, compares keys according to semantic type, and performs efficient key/range traversal.

## Canonical encoding matters

String storage does not imply string comparison is universally correct. Lexicographic ordering puts `"10"` before `"2"`. Equivalent numeric values also cannot acquire accidentally different index semantics.

Codecs therefore need canonical representations and/or type-aware comparison. This eventually needs definitions for `bigint`, unusual number values if supported, binary data, UUIDs, Temporal values, and unambiguous strings.

The public contract is about TypeScript values, not whichever encoding v0 uses.

## Index persistence

Indexes are database state, not application-maintained caches. EvieDB keeps them consistent as records are inserted, updated, and deleted.

The first implementation does not need a sophisticated B-tree solely to look respectable. A simpler representation is acceptable while proving semantics if it can later be replaced cleanly.

## Durability questions

Before v0 claims useful durability, behavior must be explicit for interrupted writes, atomic replacement, simultaneous writes, multi-process opening, and malformed or partially written storage.

A straightforward starting strategy may use temporary files followed by atomic replacement where the platform permits it. The exact mechanism is not yet specified.

## Future formats

JSON should be replaceable by binary records, pages, persistent trees, a WAL, a single database file, or something else if the project earns that complexity.

Changing the physical format should not require ordinary application code to change.

### To use EvieDB:

```ts
import { db } from "./db.ts";
```

To read `User` Table:

```ts
const users: User[] = db.user.raw();
```

To filter down `firstname`s in user table:

```ts
const user: Table = db.user.filter({ firstname: "Evie" });
```

To filter a number that is not equals to, but less than / more than:

```ts
const user: Table = db.user.filter((user) => {
  return user.score > 100;
});
```

-# Note: This _is_ going to be unoptimised in v0 and thats okay. This is just best for DX at the moment.

To get all `firstname`s:

```ts
const firstnames: string[] = db.user.read("firstname");
```

To update all `active` columns to `true`:

```ts
db.user.update({ active: True });
```

To filter all users with a specific `firstname` to update `active` columns to `true`:

```ts
db.user.filter({ firstname: "Evie" }).update({ active: true });
```

To delete all entries in `User` table:

```ts
db.user.delete();
```

To delete all entries where `active` is `false` in the `User` table:

```ts
db.user.filter({ active: false }).delete();
```

### To use EvieDB but _badly_:

To do anything:

```ts
db.write((datab) => {
  // anything you like where datab is a raw json object containing all the data
});
```

For example, to get the data of a user in users:

```ts
let myUser: User;
db.write((datab) => {
  for (user in datab.users) {
    if (user.name === "Evie") {
      myUser = user;
      break;
    }
  }
});
```

### Undesigned EvieDB things:

Indexes. They weird.

Using .filter() in a way that is not just equals to.
Rejected ideas:

```ts
db.users.filter({
  columnName: "score",
  operator: "=",
  value: "100",
});
```

Reasons: so not javascripty

Current idea:

```ts
db.users.filter((user) => {
  return user.score === 100;
});
```

Pros: Javascript
Cons: Fucks with any possible index implementation. Maybe. Actually maybe not. I don't know.

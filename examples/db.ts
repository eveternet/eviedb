import eviedb, { number, string, boolean } from "../src/index.js";
import type { Initialization } from "../src/index.js";

// An explicit handle annotation enables TypeScript's assertion-method narrowing.
const database: Initialization = eviedb.init();
database.definedb({
  users: {
    id: number({ unique: true, index: true }),
    firstname: string({ index: true }),
    lastname: string(),
    score: number({ required: false }),
    active: boolean(),
  },
  posts: {
    title: string(),
    authorId: number({ index: true }),
  },
});

export default database.db;

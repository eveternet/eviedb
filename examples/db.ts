import eviedb, { number, string, boolean } from "../src/index.js";

// Chaining definedb() infers the schema without annotating the handle.
const database = eviedb.init().definedb({
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

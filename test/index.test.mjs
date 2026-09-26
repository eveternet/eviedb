import { expect, test } from 'bun:test';

import * as eviedb from 'eviedb';

test('the package entry point can be imported', () => {
  expect(Object.keys(eviedb)).toEqual([]);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import * as eviedb from 'eviedb';

test('the package entry point can be imported', () => {
  assert.deepEqual(Object.keys(eviedb), []);
});

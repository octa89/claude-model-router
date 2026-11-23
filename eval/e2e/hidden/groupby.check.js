import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBy } from '../src/collections.js';

test('groupBy follows its doc comment', () => {
  assert.deepEqual(groupBy([1, 2, 3], (n) => n % 2), { 1: [1, 3], 0: [2] });
  assert.deepEqual(groupBy([], (n) => n), {});
  const people = [
    { name: 'Ana', team: 'red' },
    { name: 'Bo', team: 'blue' },
    { name: 'Cy', team: 'red' },
  ];
  assert.deepEqual(groupBy(people, (p) => p.team), {
    red: [people[0], people[2]],
    blue: [people[1]],
  });
  assert.deepEqual(Object.keys(groupBy([true, false, true], (b) => b)), ['true', 'false']);
});

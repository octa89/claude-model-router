import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate } from '../src/money.js';

const sum = (parts) => parts.reduce((a, b) => a + b, 0);

test('even split with a leftover cent', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(1, [1, 1, 1, 1]), [1, 0, 0, 0]);
});

test('leftover cents go to the largest remainders, ties to the earlier part', () => {
  assert.deepEqual(allocate(10, [1, 2]), [3, 7]);
  assert.deepEqual(allocate(5, [3, 7]), [2, 3]);
  assert.deepEqual(allocate(7, [1, 2, 4]), [1, 2, 4]);
  assert.deepEqual(allocate(11, [3, 3, 4]), [3, 3, 5]);
  assert.deepEqual(allocate(12, [3, 3, 4]), [4, 3, 5]);
});

test('zero ratios and decimal ratios', () => {
  assert.deepEqual(allocate(10, [0, 1]), [0, 10]);
  assert.deepEqual(allocate(100, [0.2, 0.3, 0.5]), [20, 30, 50]);
  assert.deepEqual(allocate(1000, [0.1, 0.2, 0.7]), [100, 200, 700]);
});

test('negative totals', () => {
  assert.deepEqual(allocate(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.deepEqual(allocate(-5, [3, 7]), [-2, -3]);
});

test('the parts always add up', () => {
  for (const total of [0, 1, 99, 1234, 99999]) {
    assert.equal(sum(allocate(total, [0.15, 0.35, 0.5])), total);
    assert.equal(sum(allocate(total, [1, 1, 1, 1, 1, 1, 1])), total);
  }
});

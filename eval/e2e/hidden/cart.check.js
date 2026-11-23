import test from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.js';

const items = [
  { price: 5000, qty: 2 },
  { price: 2500, qty: 1 },
];
const ten = { code: 'TEN', percent: 10, minSubtotal: 0 };
const twenty = { code: 'TWENTY', percent: 20, minSubtotal: 20000 };
const five = { code: 'FIVE', percent: 5, minSubtotal: 0 };

test('no promotion', () => {
  assert.deepEqual(cartTotal(items), { subtotal: 12500, discount: 0, total: 12500 });
});

test('only the single best promotion applies', () => {
  assert.deepEqual(cartTotal(items, [ten, five]), { subtotal: 12500, discount: 1250, total: 11250 });
  assert.deepEqual(cartTotal(items, [five, ten]), { subtotal: 12500, discount: 1250, total: 11250 });
});

test('a promotion below its minimum subtotal does not count', () => {
  assert.deepEqual(cartTotal(items, [twenty, five]), { subtotal: 12500, discount: 625, total: 11875 });
});

test('the best promotion is picked when the bigger percent qualifies', () => {
  const big = [{ price: 10000, qty: 3 }];
  assert.deepEqual(cartTotal(big, [ten, twenty]), { subtotal: 30000, discount: 6000, total: 24000 });
});

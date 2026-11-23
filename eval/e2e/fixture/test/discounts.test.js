import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscount } from '../src/discounts.js';

test('applies the percent when the subtotal is high enough', () => {
  assert.equal(applyDiscount(10000, { code: 'TEN', percent: 10, minSubtotal: 5000 }), 1000);
  assert.equal(applyDiscount(4000, { code: 'TEN', percent: 10, minSubtotal: 5000 }), 0);
});

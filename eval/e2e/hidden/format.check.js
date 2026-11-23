import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice } from '../src/format.js';

test('formatPrice follows its doc comment', () => {
  assert.equal(formatPrice(1999), '$19.99');
  assert.equal(formatPrice(0), '$0.00');
  assert.equal(formatPrice(5), '$0.05');
  assert.equal(formatPrice(1999.6), '$20.00');
  assert.equal(formatPrice(1999.4), '$19.99');
  assert.equal(formatPrice(-250), '-$2.50');
  assert.equal(formatPrice(-1), '-$0.01');
  assert.equal(formatPrice(123456), '$1234.56');
});

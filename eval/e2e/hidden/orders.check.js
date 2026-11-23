import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('orders.json holds the valid orders in file order', () => {
  const orders = JSON.parse(readFileSync(new URL('../data/orders.json', import.meta.url), 'utf8'));
  assert.deepEqual(orders, [
    { id: 1001, customer: 'Ana Ruiz', total: 19.99 },
    { id: 1002, customer: 'Bo Li', total: 5 },
    { id: 1004, customer: 'Dee Park', total: 120.5 },
  ]);
});

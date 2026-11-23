import test from 'node:test';
import assert from 'node:assert/strict';
import { LruCache } from '../src/lru.js';

test('never holds more than its limit', () => {
  const c = new LruCache(2);
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  assert.equal(c.size, 2);
  assert.equal(c.get('a'), undefined);
  assert.equal(c.get('b'), 2);
  assert.equal(c.get('c'), 3);
});

test('get counts as a use', () => {
  const c = new LruCache(2);
  c.set('a', 1);
  c.set('b', 2);
  c.get('a');
  c.set('c', 3);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('b'), undefined);
});

test('replacing a value counts as a use and does not grow the cache', () => {
  const c = new LruCache(2);
  c.set('a', 1);
  c.set('b', 2);
  c.set('a', 10);
  assert.equal(c.size, 2);
  c.set('c', 3);
  assert.equal(c.get('a'), 10);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.size, 2);
});

test('delete reports whether the key was there and keeps size right', () => {
  const c = new LruCache(3);
  c.set('a', 1);
  assert.equal(c.delete('missing'), false);
  assert.equal(c.size, 1);
  assert.equal(c.delete('a'), true);
  assert.equal(c.size, 0);
  c.set('x', 1);
  c.set('y', 2);
  c.set('z', 3);
  assert.equal(c.size, 3);
  assert.equal(c.get('x'), 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { freeSlots } from '../src/schedule.js';

const DAY = [540, 1020]; // 09:00 to 17:00

test('an empty calendar leaves the whole day', () => {
  assert.deepEqual(freeSlots([], ...DAY, 30), [[540, 1020]]);
});

test('unsorted, overlapping and nested blocks merge', () => {
  const busy = [[700, 760], [600, 650], [620, 640], [640, 700]];
  assert.deepEqual(freeSlots(busy, ...DAY, 1), [[540, 600], [760, 1020]]);
});

test('touching blocks leave no gap', () => {
  assert.deepEqual(freeSlots([[600, 660], [660, 720]], ...DAY, 1), [[540, 600], [720, 1020]]);
});

test('blocks reaching outside the day are clipped', () => {
  assert.deepEqual(freeSlots([[480, 570], [1000, 1100]], ...DAY, 1), [[570, 1000]]);
  assert.deepEqual(freeSlots([[0, 2000]], ...DAY, 1), []);
  assert.deepEqual(freeSlots([[100, 200], [1100, 1200]], ...DAY, 1), [[540, 1020]]);
});

test('gaps shorter than minLength are dropped; exactly minLength is kept', () => {
  const busy = [[560, 600], [620, 700], [730, 1020]];
  assert.deepEqual(freeSlots(busy, ...DAY, 30), [[700, 730]]);
  assert.deepEqual(freeSlots(busy, ...DAY, 20), [[540, 560], [600, 620], [700, 730]]);
});

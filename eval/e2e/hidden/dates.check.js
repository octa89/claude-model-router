import test from 'node:test';
import assert from 'node:assert/strict';
import { addBusinessDays } from '../src/dates.js';

// 2026-11-20 is a Friday; 2026-11-26 is Thanksgiving.
const thanksgiving = ['2026-11-26'];

test('forwards over a weekend', () => {
  assert.equal(addBusinessDays('2026-11-20', 1), '2026-11-23');
  assert.equal(addBusinessDays('2026-11-20', 5), '2026-11-27');
  assert.equal(addBusinessDays('2026-11-21', 1), '2026-11-23');
  assert.equal(addBusinessDays('2026-11-22', 1), '2026-11-23');
});

test('zero keeps a business day and moves a weekend or holiday forward', () => {
  assert.equal(addBusinessDays('2026-11-20', 0), '2026-11-20');
  assert.equal(addBusinessDays('2026-11-21', 0), '2026-11-23');
  assert.equal(addBusinessDays('2026-11-26', 0, thanksgiving), '2026-11-27');
});

test('backwards', () => {
  assert.equal(addBusinessDays('2026-11-23', -1), '2026-11-20');
  assert.equal(addBusinessDays('2026-11-22', -1), '2026-11-20');
  assert.equal(addBusinessDays('2026-11-30', -3, thanksgiving), '2026-11-24');
});

test('holidays and the turn of the year', () => {
  assert.equal(addBusinessDays('2026-11-25', 1, thanksgiving), '2026-11-27');
  assert.equal(addBusinessDays('2026-12-31', 2, ['2027-01-01']), '2027-01-05');
  assert.equal(addBusinessDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addBusinessDays('2026-01-01', 260), '2026-12-31');
});

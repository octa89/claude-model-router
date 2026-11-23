import test from 'node:test';
import assert from 'node:assert/strict';
import { satisfies } from '../src/semver.js';

const yes = (v, r) => assert.equal(satisfies(v, r), true, `${v} should satisfy "${r}"`);
const no = (v, r) => assert.equal(satisfies(v, r), false, `${v} should not satisfy "${r}"`);

test('comparators', () => {
  yes('1.2.3', '1.2.3');
  no('1.2.4', '=1.2.3');
  yes('1.5.0', '>=1.2.3 <2.0.0');
  no('2.0.0', '>=1.2.3 <2.0.0');
  yes('1.2.3', '>= 1.2.3');
  yes('1.10.0', '>1.9.0');
  no('1.2.3', '<1.2.3');
  yes('1.2.3', '<=1.2.3');
});

test('caret', () => {
  yes('1.9.9', '^1.2.3');
  no('2.0.0', '^1.2.3');
  no('1.2.2', '^1.2.3');
  yes('0.2.9', '^0.2.3');
  no('0.3.0', '^0.2.3');
  yes('0.0.3', '^0.0.3');
  no('0.0.4', '^0.0.3');
  yes('1.2.0', '^1.2');
  yes('0.2.5', '^0.2');
  no('0.3.0', '^0.2');
});

test('tilde', () => {
  yes('1.2.9', '~1.2.3');
  no('1.3.0', '~1.2.3');
  yes('1.2.0', '~1.2');
  yes('1.9.0', '~1');
  no('2.0.0', '~1');
});

test('x-ranges', () => {
  yes('1.4.2', '1.x');
  no('2.0.0', '1.x');
  yes('3.1.4', '*');
  yes('1.2.7', '1.2');
  no('1.3.0', '1.2');
  yes('5.0.0', '5');
  yes('1.2.0', '1.2.x');
});

test('hyphen ranges and alternatives', () => {
  yes('2.0.0', '1.2.3 - 2.3.4');
  yes('1.2.3', '1.2.3 - 2.3.4');
  no('2.3.5', '1.2.3 - 2.3.4');
  yes('3.0.0', '^1.0.0 || ^3.0.0');
  no('2.5.0', '^1.0.0 || ^3.0.0');
  yes('0.1.0', '<0.2.0 || >=5.0.0');
});

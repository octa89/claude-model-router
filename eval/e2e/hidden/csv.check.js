import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';

test('rows and fields', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv(''), []);
});

test('empty fields', () => {
  assert.deepEqual(parseCsv(',,'), [['', '', '']]);
  assert.deepEqual(parseCsv('a,\n,b'), [['a', ''], ['', 'b']]);
  assert.deepEqual(parseCsv('"",x'), [['', 'x']]);
});

test('quoted fields', () => {
  assert.deepEqual(parseCsv('"x, y",z'), [['x, y', 'z']]);
  assert.deepEqual(parseCsv('"he said ""hi""",2'), [['he said "hi"', '2']]);
  assert.deepEqual(parseCsv('"line1\nline2",b'), [['line1\nline2', 'b']]);
  assert.deepEqual(parseCsv('a,"b\r\nc"\r\nd,e'), [['a', 'b\r\nc'], ['d', 'e']]);
  assert.deepEqual(parseCsv('"a","b"\n"c","d"\n'), [['a', 'b'], ['c', 'd']]);
});

test('an unclosed quote is an error', () => {
  assert.throws(() => parseCsv('"a'), { message: 'Unclosed quote' });
  assert.throws(() => parseCsv('x,"y\nz'), { message: 'Unclosed quote' });
});

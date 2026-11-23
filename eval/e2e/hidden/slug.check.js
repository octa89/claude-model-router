import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slug.js';

test('slugify follows its doc comment', () => {
  assert.equal(slugify('  Héllo, Wörld!! 2026 '), 'hello-world-2026');
  assert.equal(slugify('Already-a-slug'), 'already-a-slug');
  assert.equal(slugify('Crème brûlée & Café'), 'creme-brulee-cafe');
  assert.equal(slugify('---Leading and trailing---'), 'leading-and-trailing');
  assert.equal(slugify('a__b..c'), 'a-b-c');
  assert.equal(slugify('ÀÉÎÕÜ ñ ç'), 'aeiou-n-c');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify(''), '');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { cost, family, suggest, summarize } from './report.mjs';

const decision = (key, over = {}) => ({
  key,
  model: 'sonnet',
  effort: 'low',
  source: 'classifier',
  category: 'search_read',
  difficulty: 'easy',
  ...over,
});

test('cost uses the model family and all four token kinds', () => {
  assert.equal(family('claude-opus-5-5'), 'opus');
  assert.equal(family('mystery'), null);
  const usd = cost({ model: 'claude-sonnet-5-5', tokens: { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 } });
  assert.equal(usd.toFixed(2), (2 + 10 + 0.1 + 2.5).toFixed(2));
  assert.equal(cost({ model: 'mystery', tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }), null);
});

test('suggestions need enough ratings, then raise or lower', () => {
  assert.match(suggest({ right: 1, stronger: 0, cheaper: 0 }), /need 2 more ratings/);
  assert.equal(suggest({ right: 2, stronger: 1, cheaper: 0 }), 'raise one step');
  assert.equal(suggest({ right: 1, stronger: 0, cheaper: 2 }), 'lower one step');
  assert.equal(suggest({ right: 3, stronger: 0, cheaper: 1 }), 'keep');
});

test('summarize joins decisions, outcomes and ratings by brief key', () => {
  const decisions = [decision('a'), decision('b'), decision('c', { model: 'opus', effort: 'medium', source: 'fallback' })];
  const outcomes = [
    { key: 'a', model: 'claude-sonnet-5-5', durationMs: 60000, tokens: { input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { key: 'zzz', model: 'claude-sonnet-5-5', durationMs: 1, tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
  ];
  const ratings = [
    { key: 'a', rating: 'cheaper' },
    { key: 'a', rating: 'right' },
    { key: 'b', rating: 'stronger' },
  ];
  const rows = summarize(decisions, outcomes, ratings);
  const search = rows.find((r) => r.cell === 'search_read / easy');
  assert.equal(search.decisions, 2);
  assert.equal(search.runs, 1, 'the outcome with no decision is ignored');
  assert.equal(search.cost.toFixed(2), '2.00');
  assert.equal(search.right, 1, 'the latest rating per brief counts');
  assert.equal(search.cheaper, 0);
  assert.equal(search.stronger, 1);
  const unsure = rows.find((r) => r.cell.startsWith('safe default'));
  assert.equal(unsure.chosen, 'opus medium');
});

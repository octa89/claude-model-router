import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyse, quantile, routingGap } from './classifier.mjs';
import { CATEGORIES, DIFFICULTIES } from '../router.mjs';

const task = (over = {}) => ({ id: 't', category: 'search_read', difficulty: 'easy', risk: 'low', text: 'x', ...over });
const result = (over = {}) => ({ category: 'search_read', difficulty: 'easy', risk: 'low', riskProbability: 0.01, confidence: 0.9, ...over });

test('the labelled set uses only the router\'s names', async () => {
  const { tasks } = JSON.parse(await readFile(new URL('./classifier-set.json', import.meta.url), 'utf8'));
  assert.ok(tasks.length >= 60);
  const ids = new Set();
  for (const t of tasks) {
    assert.ok(Object.hasOwn(CATEGORIES, t.category), t.id);
    assert.ok(DIFFICULTIES.includes(t.difficulty), t.id);
    assert.ok(['low', 'high'].includes(t.risk), t.id);
    assert.ok(!ids.has(t.id), `duplicate ${t.id}`);
    ids.add(t.id);
  }
  assert.ok(tasks.filter((t) => t.risk === 'high').length >= 5, 'enough risky tasks to measure recall');
});

test('routingGap says whether the router went cheaper or dearer than the hand labels', () => {
  assert.equal(routingGap(task(), result()).kind, 'same');
  assert.equal(routingGap(task({ category: 'deep_reasoning', difficulty: 'hard' }), result()).kind, 'under');
  assert.equal(routingGap(task(), result({ category: 'deep_reasoning', difficulty: 'hard' })).kind, 'over');
  assert.equal(routingGap(task(), result({ difficulty: 'hard' })).kind, 'effort');
  assert.equal(routingGap(task({ risk: 'high' }), result()).kind, 'under', 'missing the risk sends it too low');
});

test('analyse counts accuracy, risk recall, stability and latency', () => {
  const tasks = [task({ id: 'a' }), task({ id: 'b', category: 'coding_hard', risk: 'high' })];
  const runs = [
    { id: 'a', repeat: 0, ms: 100, result: result() },
    { id: 'a', repeat: 1, ms: 300, result: result() },
    { id: 'b', repeat: 0, ms: 200, result: result({ category: 'coding_hard', riskProbability: 0.35 }) },
    { id: 'b', repeat: 1, ms: 400, result: result({ category: 'coding_routine', riskProbability: 0.5 }) },
    { id: 'c', repeat: 0, ms: 50, error: 'timeout' },
  ];
  const a = analyse(tasks, runs);
  assert.equal(a.failed, 1);
  assert.equal(a.category, 2);
  assert.equal(a.scored, 2);
  assert.equal(a.stable, 1);
  assert.equal(a.stableOf, 2);
  assert.equal(a.risk.find((r) => r.threshold === 0.3).recall, 1);
  assert.equal(a.risk.find((r) => r.threshold === 0.4).recall, 0);
  assert.equal(a.riskyLowest, 0.35);
  assert.equal(a.latency.max, 400);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 3);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareWorkdir, randomPicks, runCheck, shuffled, summarize } from './run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { tasks } = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'));

// The checks must fail on the untouched project and pass on a correct answer,
// or the evaluation measures nothing.
for (const task of tasks.filter((t) => t.check.tests)) {
  test(`${task.id}: hidden tests fail before the fix and pass on the reference answer`, async () => {
    const before = prepareWorkdir();
    const after = prepareWorkdir();
    try {
      assert.equal((await runCheck(task, before, '')).passed, false, 'fails on the untouched fixture');
      cpSync(join(HERE, 'reference'), after, { recursive: true });
      assert.equal((await runCheck(task, after, '')).passed, true, 'passes on the reference answer');
    } finally {
      rmSync(before, { recursive: true, force: true });
      rmSync(after, { recursive: true, force: true });
    }
  });
}

test('answer checks accept the right answer and reject wrong ones', async () => {
  const find = tasks.find((t) => t.id === 't1-find');
  assert.equal((await runCheck(find, null, 'PATH=src/discounts.js')).passed, true);
  assert.equal((await runCheck(find, null, 'PATH=./src/discounts.js')).passed, true);
  assert.equal((await runCheck(find, null, 'PATH=src/cart.js')).passed, false);
  const review = tasks.find((t) => t.id === 't8-review');
  assert.equal((await runCheck(review, null, 'LINE=6 Nothing stops refunding more than the order total.')).passed, true);
  assert.equal((await runCheck(review, null, 'LINE=3 amount check')).passed, false);
  assert.equal((await runCheck(review, null, 'LINE=60')).passed, false);
});

test('the random setup reuses the router picks in another order', () => {
  const picks = { a: { model: 'sonnet' }, b: { model: 'opus' }, c: { model: 'fable' }, d: { model: 'sonnet' } };
  const random = randomPicks(picks);
  assert.deepEqual(Object.keys(random), Object.keys(picks));
  assert.deepEqual(
    Object.values(random).map((p) => p.model).sort(),
    Object.values(picks).map((p) => p.model).sort(),
  );
  assert.deepEqual(shuffled([1, 2, 3, 4, 5]), shuffled([1, 2, 3, 4, 5]), 'the same every time');
});

test('summarize gives pass rate and cost per solved task per setup', () => {
  const rows = [
    { config: 'baseline', passed: true, costUsd: 0.4, wallMs: 60000 },
    { config: 'baseline', passed: false, costUsd: 0.2, wallMs: 120000 },
    { config: 'router', passed: true, costUsd: 0.1, wallMs: 30000 },
  ];
  const s = summarize(rows);
  assert.equal(s.baseline.passRate, 0.5);
  assert.equal(s.baseline.costPerSolved.toFixed(2), '0.60');
  assert.equal(s.router.costPerSolved.toFixed(2), '0.10');
});

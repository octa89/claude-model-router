#!/usr/bin/env node
// Level 1 evaluation: is the classifier labelling tasks correctly, honestly
// and fast enough?
//
// Sends every hand-labelled task in classifier-set.json to the classifier
// (Bison 1 by default) a few times and reports:
//   - accuracy on category, difficulty and risk, and the most common confusions;
//   - calibration: when it says 80% sure, how often it is right;
//   - risk recall at each threshold (missing a risky task matters most);
//   - what the router would then choose: same model as the hand labels,
//     a cheaper one (under-routed) or a dearer one (over-routed);
//   - stability across repeats, and latency of the classifier and the hook.
//
// Usage: node eval/classifier.mjs [--repeats 2] [--concurrency 6]
// Needs OPENROUTER_API_KEY. Cost: about $0.00002 per call.

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIN_CONFIDENCE, MODELS, RISK_THRESHOLD, classify, decide } from '../router.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};

export const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '-');
export const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

/** Compare where the router sends a task from Bison's labels and from the hand labels. */
export function routingGap(task, predicted) {
  const ideal = decide({ category: task.category, difficulty: task.difficulty, risk: task.risk, confidence: 1 });
  const actual = decide(predicted);
  const gap = MODELS[actual.model].rank - MODELS[ideal.model].rank;
  return {
    ideal: `${ideal.model} ${ideal.effort}`,
    actual: `${actual.model} ${actual.effort}`,
    kind: gap < 0 ? 'under' : gap > 0 ? 'over' : actual.effort === ideal.effort ? 'same' : 'effort',
  };
}

/** All the level 1 numbers from the runs. */
export function analyse(tasks, runs) {
  const first = runs.filter((r) => r.repeat === 0 && r.result);
  const ok = runs.filter((r) => r.result);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = { calls: runs.length, failed: runs.filter((r) => r.error).length };

  out.category = first.filter((r) => r.result.category === byId.get(r.id).category).length;
  out.difficulty = first.filter((r) => r.result.difficulty === byId.get(r.id).difficulty).length;
  out.difficultyFar = first.filter((r) => {
    const want = byId.get(r.id).difficulty;
    return (want === 'easy' && r.result.difficulty === 'hard') || (want === 'hard' && r.result.difficulty === 'easy');
  }).length;
  out.scored = first.length;

  const confusions = new Map();
  for (const r of first) {
    const want = byId.get(r.id).category;
    if (r.result.category !== want) {
      const pair = `${want} -> ${r.result.category}`;
      confusions.set(pair, (confusions.get(pair) ?? 0) + 1);
    }
  }
  out.confusions = [...confusions].sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Calibration of the category probability, in bands of 0.1.
  out.calibration = [];
  for (let low = 0; low < 1; low += 0.1) {
    const band = first.filter((r) => r.result.confidence !== null && r.result.confidence >= low && r.result.confidence < low + 0.1 + 1e-9);
    if (band.length) {
      const right = band.filter((r) => r.result.category === byId.get(r.id).category).length;
      out.calibration.push({ band: `${low.toFixed(1)}-${(low + 0.1).toFixed(1)}`, n: band.length, accuracy: right / band.length });
    }
  }

  // Confidence cut-off: how many fall back to the safe default, and how
  // accurate the ones kept are, at each cut-off.
  out.cutoffs = [0.3, 0.4, 0.5, 0.6, 0.7].map((cut) => {
    const kept = first.filter((r) => (r.result.confidence ?? 1) >= cut);
    const right = kept.filter((r) => r.result.category === byId.get(r.id).category).length;
    return { cut, fallback: (first.length - kept.length) / (first.length || 1), keptAccuracy: kept.length ? right / kept.length : null };
  });

  // Risk at several thresholds: recall on the risky tasks matters most.
  const risky = first.filter((r) => byId.get(r.id).risk === 'high');
  const safe = first.filter((r) => byId.get(r.id).risk !== 'high');
  out.risk = [0.2, 0.3, 0.4, 0.5, 0.6].map((threshold) => ({
    threshold,
    recall: risky.length ? risky.filter((r) => r.result.riskProbability >= threshold).length / risky.length : null,
    falseAlarms: safe.length ? safe.filter((r) => r.result.riskProbability >= threshold).length / safe.length : null,
  }));
  out.riskyLowest = risky.length ? Math.min(...risky.map((r) => r.result.riskProbability)) : null;
  out.safeHighest = safe.length ? Math.max(...safe.map((r) => r.result.riskProbability)) : null;

  // Where the router ends up, against where the hand labels would send it.
  out.routing = { same: 0, effort: 0, under: 0, over: 0, underTasks: [] };
  for (const r of first) {
    const gap = routingGap(byId.get(r.id), r.result);
    out.routing[gap.kind] += 1;
    if (gap.kind === 'under') out.routing.underTasks.push(`${r.id}: ${gap.ideal} -> ${gap.actual}`);
  }

  // Stability: the same answer on every repeat.
  const repeats = new Map();
  for (const r of ok) {
    const sig = `${r.result.category}|${r.result.difficulty}|${r.result.risk}`;
    repeats.set(r.id, (repeats.get(r.id) ?? new Set()).add(sig));
  }
  const multi = [...repeats.values()];
  out.stable = multi.filter((s) => s.size === 1).length;
  out.stableOf = multi.length;

  const ms = ok.map((r) => r.ms);
  out.latency = { p50: quantile(ms, 0.5), p95: quantile(ms, 0.95), max: ms.length ? Math.max(...ms) : null };
  return out;
}

async function pool(items, size, work) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const item = items[next++];
        results.push(await work(item));
      }
    }),
  );
  return results;
}

/** Time the hook end to end, as Claude Code runs it: node start-up plus one classifier call. */
function timeHook() {
  const event = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    session_id: 'eval',
    cwd: ROOT,
    tool_input: { prompt: 'List the files in the src folder.', subagent_type: 'Explore' },
  });
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(ROOT, 'hook.mjs')], {
      // The eval's own calls are not logged as routing decisions.
      env: { ...process.env, ROUTER_LOG: 'off' },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.on('close', () => resolve(Date.now() - started));
    child.stdin.end(event);
  });
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Set OPENROUTER_API_KEY first.');
    process.exit(1);
  }
  const repeats = arg('--repeats', 2);
  const concurrency = arg('--concurrency', 6);
  const { tasks } = JSON.parse(await readFile(join(HERE, 'classifier-set.json'), 'utf8'));
  const classifierModel = process.env.ROUTER_CLASSIFIER_MODEL || 'baseten/bison-1';

  console.log(`Classifying ${tasks.length} tasks x ${repeats} with ${classifierModel}...`);
  const jobs = tasks.flatMap((t) => Array.from({ length: repeats }, (_, repeat) => ({ ...t, repeat })));
  const runs = await pool(jobs, concurrency, async (job) => {
    const started = Date.now();
    try {
      const result = await classify(job.text, { apiKey, classifierModel, timeoutMs: 20000 });
      return { id: job.id, repeat: job.repeat, ms: Date.now() - started, result };
    } catch (err) {
      return { id: job.id, repeat: job.repeat, ms: Date.now() - started, error: err.message };
    }
  });

  const hookMs = [];
  for (let i = 0; i < 5; i += 1) hookMs.push(await timeHook());

  const a = analyse(tasks, runs);
  const pct = (x) => (x === null ? '-' : `${Math.round(x * 100)}%`);

  console.log(`\nCalls: ${a.calls}, failed: ${a.failed}`);
  console.log(`Category right: ${a.category}/${a.scored} (${percent(a.category, a.scored)})`);
  console.log(`Difficulty right: ${a.difficulty}/${a.scored} (${percent(a.difficulty, a.scored)}); easy<->hard swaps: ${a.difficultyFar}`);
  console.log('Most common category mix-ups:');
  for (const [pair, n] of a.confusions) console.log(`  ${pair}: ${n}`);

  console.log('\nCalibration (stated confidence -> how often right):');
  for (const c of a.calibration) console.log(`  ${c.band}: ${pct(c.accuracy)} right over ${c.n} tasks`);
  console.log(`Confidence cut-off (now ${MIN_CONFIDENCE}): fallback rate and accuracy of the rest`);
  for (const c of a.cutoffs) console.log(`  ${c.cut}: ${pct(c.fallback)} fall back, ${pct(c.keptAccuracy)} right among the rest`);

  console.log(`\nRisk (now ${RISK_THRESHOLD}): risky tasks caught, and safe tasks flagged by mistake`);
  for (const r of a.risk) console.log(`  ${r.threshold}: ${pct(r.recall)} caught, ${pct(r.falseAlarms)} false alarms`);
  console.log(`  Lowest score on a risky task: ${a.riskyLowest?.toFixed(2)}; highest on a safe one: ${a.safeHighest?.toFixed(2)}`);

  console.log('\nWhere the router sends each task, against the hand labels:');
  console.log(`  same model and effort: ${a.routing.same}, same model other effort: ${a.routing.effort}`);
  console.log(`  dearer model (over-routed): ${a.routing.over}, cheaper model (under-routed): ${a.routing.under}`);
  for (const t of a.routing.underTasks) console.log(`    under: ${t}`);

  console.log(`\nStable across ${repeats} repeats: ${a.stable}/${a.stableOf}`);
  console.log(`Classifier latency: p50 ${a.latency.p50} ms, p95 ${a.latency.p95} ms, max ${a.latency.max} ms`);
  console.log(`Hook end to end (node start-up + one call): median ${quantile(hookMs, 0.5)} ms over 5 runs`);

  const results = join(HERE, 'results');
  await mkdir(results, { recursive: true });
  const file = join(results, `classifier-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify({ classifierModel, repeats, analysis: a, hookMs, runs }, null, 2));
  console.log(`\nFull results: ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

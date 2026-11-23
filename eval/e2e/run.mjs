#!/usr/bin/env node
// Level 2 evaluation: does routing beat Anthropic's default on real work?
//
// Runs every task in tasks.json with headless Claude Code (`claude -p`), once
// per setup, each in a fresh copy of fixture/, then checks the result with
// hidden tests or an answer pattern. Setups:
//   baseline  Opus 5.5 at medium: Anthropic's recommended starting point
//   router    the model and effort the router picks for the task
//   fable     Fable 5.2 at high: the quality ceiling
//   random    the router's own choices, shuffled between tasks: same model
//             mix, no judgement. If the router can't beat this, its choices
//             add nothing.
//
// Usage:
//   node eval/e2e/run.mjs --dry-run              show the plan and the router's picks; spends nothing
//   node eval/e2e/run.mjs --budget-usd 10        run it; stops starting runs once the total passes the budget
//   node eval/e2e/run.mjs --report <file.jsonl>  print the report for an earlier run
// Options: --configs baseline,router,fable,random  --tasks t1-find,t5-cart
//          --repeats 1  --concurrency 2  --max-run-usd 2  --keep (keep work folders)
//
// Runs use your Claude Code sign-in; the cost shown is Claude Code's own
// estimate. The router's subagent hook is turned off inside these runs.

import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MODELS, route } from '../../router.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, '..', 'runs');

export const FIXED = {
  baseline: { model: 'opus', effort: 'medium' },
  fable: { model: 'fable', effort: 'high' },
};

const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const flag = (name) => process.argv.includes(name);

/** A deterministic shuffle, so a dry run and the real run assign the same random picks. */
export function shuffled(list, seed = 7) {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The random setup: each task gets another task's router pick. */
export function randomPicks(routerPicks, seed) {
  const ids = Object.keys(routerPicks);
  const picks = shuffled(ids.map((id) => routerPicks[id]), seed);
  return Object.fromEntries(ids.map((id, i) => [id, picks[i]]));
}

/** A fresh copy of the fixture to run one task in. */
export function prepareWorkdir(fixture = join(HERE, 'fixture')) {
  const dir = mkdtempSync(join(tmpdir(), 'router-e2e-'));
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

function runProcess(command, args, { cwd, env, timeoutMs, input }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${err.message}`, spawnError: err });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input ?? '');
  });
}

/** Checks a finished run: hidden tests copied in now, or the answer pattern. */
export async function runCheck(task, workdir, answer) {
  if (task.check.answer) {
    return { passed: new RegExp(task.check.answer).test(answer ?? ''), detail: 'answer pattern' };
  }
  const hidden = join(workdir, '.hidden');
  mkdirSync(hidden, { recursive: true });
  cpSync(join(HERE, 'hidden', task.check.tests), join(hidden, task.check.tests));
  // Without NODE_TEST_CONTEXT: when this runs inside a test, Node would put the
  // check in child mode, where it exits 0 whatever the result.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const ran = await runProcess(process.execPath, ['--test', join(hidden, task.check.tests)], {
    cwd: workdir,
    env,
    timeoutMs: 60000,
  });
  return { passed: ran.code === 0, detail: ran.code === 0 ? 'hidden tests pass' : 'hidden tests fail' };
}

async function runClaude(task, pick, workdir, maxRunUsd) {
  const args = [
    '-p', task.prompt,
    '--model', MODELS[pick.model].id,
    '--effort', pick.effort,
    '--output-format', 'json',
    '--permission-mode', 'acceptEdits',
    '--permission-prompts', 'none',
    '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(node *)',
    '--max-budget-usd', String(maxRunUsd),
    '--no-session-persistence',
    '--setting-sources', 'project',
    '--strict-mcp-config',
  ];
  const env = { ...process.env, ROUTER_DISABLE: '1' };
  const started = Date.now();
  let ran = await runProcess('claude', args, { cwd: workdir, env, timeoutMs: 20 * 60000 });
  if (ran.spawnError && process.platform === 'win32') {
    // An npm-installed claude on Windows is a .cmd shim, which needs a shell.
    ran = await runProcess('cmd.exe', ['/d', '/s', '/c', 'claude', ...args], { cwd: workdir, env, timeoutMs: 20 * 60000 });
  }
  const wallMs = Date.now() - started;
  let json = null;
  try {
    json = JSON.parse(ran.stdout.trim().split('\n').pop());
  } catch {
    // Not JSON: reported as an error below.
  }
  return {
    wallMs,
    exitCode: ran.code,
    costUsd: typeof json?.total_cost_usd === 'number' ? json.total_cost_usd : null,
    turns: json?.num_turns ?? null,
    isError: json ? Boolean(json.is_error) : true,
    subtype: json?.subtype ?? null,
    answer: typeof json?.result === 'string' ? json.result : null,
    stderr: json ? undefined : ran.stderr.slice(0, 500),
  };
}

/** Per setup: pass rate, cost per solved task, time; plus the head-to-head verdicts. */
export function summarize(rows) {
  const configs = [...new Set(rows.map((r) => r.config))];
  const byConfig = Object.fromEntries(
    configs.map((config) => {
      const mine = rows.filter((r) => r.config === config);
      const passed = mine.filter((r) => r.passed).length;
      const cost = mine.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      const minutes = mine.map((r) => r.wallMs / 60000).sort((a, b) => a - b);
      return [
        config,
        {
          runs: mine.length,
          passed,
          passRate: mine.length ? passed / mine.length : 0,
          cost,
          costPerSolved: passed ? cost / passed : null,
          medianMinutes: minutes.length ? minutes[Math.floor(minutes.length / 2)] : null,
        },
      ];
    }),
  );
  return byConfig;
}

function printReport(rows) {
  const s = summarize(rows);
  const pad = (v, w) => String(v).slice(0, w).padEnd(w);
  const usd = (v) => (v === null ? '-' : `$${v.toFixed(3)}`);
  console.log(pad('setup', 10), pad('passed', 9), pad('pass rate', 10), pad('total cost', 11), pad('per solved', 11), 'median min');
  for (const [config, r] of Object.entries(s)) {
    console.log(
      pad(config, 10), pad(`${r.passed}/${r.runs}`, 9), pad(`${Math.round(r.passRate * 100)}%`, 10),
      pad(usd(r.cost), 11), pad(usd(r.costPerSolved), 11), r.medianMinutes?.toFixed(1) ?? '-',
    );
  }

  console.log('\nPer task (model effort: pass/fail):');
  const tasks = [...new Set(rows.map((r) => r.task))];
  for (const task of tasks) {
    const cells = rows
      .filter((r) => r.task === task)
      .map((r) => `${r.config}=${r.model} ${r.effort}:${r.passed ? 'pass' : 'FAIL'}`);
    console.log(`  ${pad(task, 12)} ${cells.join('  ')}`);
  }

  const verdict = (a, b) => {
    if (!s[a] || !s[b]) return;
    const passDiff = Math.round((s[a].passRate - s[b].passRate) * 100);
    const costRatio = s[b].cost ? s[a].cost / s[b].cost : null;
    console.log(
      `  ${a} vs ${b}: pass rate ${passDiff >= 0 ? '+' : ''}${passDiff} points, cost ${costRatio === null ? '-' : `${Math.round(costRatio * 100)}%`} of ${b}`,
    );
  };
  console.log('\nHead to head:');
  verdict('router', 'baseline');
  verdict('router', 'random');
  verdict('router', 'fable');
  verdict('baseline', 'fable');
  console.log('\nWith few tasks and one repeat, a difference of one or two tasks is noise. Add tasks and repeats before acting on it.');
}

async function main() {
  const reportFile = option('--report', null);
  if (reportFile) {
    printReport(readFileSync(reportFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
    return;
  }

  const configs = option('--configs', 'baseline,router,fable,random').split(',');
  const only = option('--tasks', null)?.split(',');
  const repeats = Number(option('--repeats', '1'));
  const concurrency = Number(option('--concurrency', '2'));
  const budget = Number(option('--budget-usd', '10'));
  const maxRunUsd = Number(option('--max-run-usd', '2'));
  const isDryRun = flag('--dry-run');
  const keep = flag('--keep');

  const { tasks: all } = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'));
  const tasks = only ? all.filter((t) => only.includes(t.id)) : all;

  // The router's picks for every task (one cheap classifier call each).
  const routerPicks = {};
  if (configs.includes('router') || configs.includes('random')) {
    if (!process.env.OPENROUTER_API_KEY) {
      console.error('Set OPENROUTER_API_KEY first: the router and random setups need the classifier.');
      process.exit(1);
    }
    for (const t of tasks) {
      const r = await route(t.prompt, { timeoutMs: 20000 });
      routerPicks[t.id] = { model: r.model, effort: r.effort, why: r.source === 'classifier' ? `${r.category}/${r.difficulty}` : 'safe default' };
    }
  }
  const randoms = randomPicks(routerPicks);
  const pickFor = (config, id) => FIXED[config] ?? (config === 'router' ? routerPicks[id] : randoms[id]);

  const jobs = [];
  for (let rep = 0; rep < repeats; rep += 1) {
    for (const t of tasks) for (const config of configs) jobs.push({ task: t, config, rep, pick: pickFor(config, t.id) });
  }

  console.log(`${tasks.length} tasks x ${configs.length} setups x ${repeats} repeat(s) = ${jobs.length} runs`);
  for (const t of tasks) {
    const line = configs.map((c) => `${c}=${pickFor(c, t.id).model} ${pickFor(c, t.id).effort}`).join('  ');
    console.log(`  ${t.id.padEnd(12)} ${line}${routerPicks[t.id] ? `   (router: ${routerPicks[t.id].why}; task is ${t.kind})` : ''}`);
  }
  if (isDryRun) {
    console.log(`\nDry run: nothing was run. Each run is capped at $${maxRunUsd}; the whole run stops starting new runs past $${budget}.`);
    return;
  }

  mkdirSync(RUNS, { recursive: true });
  const out = join(RUNS, `e2e-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  let spent = 0;
  let next = 0;
  const rows = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) {
        if (spent >= budget) return;
        const job = jobs[next++];
        const workdir = prepareWorkdir();
        try {
          const ran = await runClaude(job.task, job.pick, workdir, maxRunUsd);
          const check = await runCheck(job.task, workdir, ran.answer);
          spent += ran.costUsd ?? 0;
          const row = {
            time: new Date().toISOString(),
            task: job.task.id,
            config: job.config,
            rep: job.rep,
            model: job.pick.model,
            effort: job.pick.effort,
            passed: check.passed && !ran.isError,
            check: check.detail,
            costUsd: ran.costUsd,
            wallMs: ran.wallMs,
            turns: ran.turns,
            isError: ran.isError,
            subtype: ran.subtype,
            ...(ran.stderr ? { stderr: ran.stderr } : {}),
          };
          rows.push(row);
          appendFileSync(out, `${JSON.stringify(row)}\n`);
          console.log(`${row.passed ? 'pass' : 'FAIL'}  ${job.task.id} ${job.config} (${job.pick.model} ${job.pick.effort})  $${(ran.costUsd ?? 0).toFixed(3)}  ${(ran.wallMs / 1000).toFixed(0)}s  total $${spent.toFixed(2)}`);
        } finally {
          if (!keep) rmSync(workdir, { recursive: true, force: true });
        }
      }
    }),
  );

  if (spent >= budget) console.log(`\nStopped starting runs: the budget of $${budget} was reached.`);
  console.log(`\nResults: ${out}\n`);
  printReport(rows);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

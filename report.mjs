#!/usr/bin/env node
// Tuning report: joins the router's decisions (router.log) with what each
// subagent then used (tuning/outcomes-*.jsonl) and your ratings
// (tuning/ratings-*.jsonl), and suggests which cells of the routing table to
// raise or lower.
//
// Usage: node report.mjs [--days N]     only decisions from the last N days

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// USD per million tokens: input, output, cache read, cache write (5-minute).
// From Anthropic's published prices; update them here when they change.
export const PRICES = {
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  sonnet: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  fable: { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
};

// Below this many ratings a cell gets no suggestion.
export const MIN_RATINGS = 3;

export const family = (model = '') => Object.keys(PRICES).find((name) => model.toLowerCase().includes(name)) ?? null;

/** Estimated USD for one outcome's tokens, or null when the model is unknown. */
export function cost({ model, tokens }) {
  const price = PRICES[family(model)];
  if (!price || !tokens) return null;
  return (
    (tokens.input * price.input +
      tokens.output * price.output +
      tokens.cacheRead * price.cacheRead +
      tokens.cacheWrite * price.cacheWrite) /
    1e6
  );
}

/** One row per routing-table cell, with what was used and how it was rated. */
export function summarize(decisions, outcomes, ratings) {
  const keyed = decisions.filter((d) => d.key);
  // The first (routed) decision for each brief: ratings and retries count against it.
  const byKey = new Map();
  for (const d of keyed) if (!byKey.has(d.key)) byKey.set(d.key, d);
  // An outcome joins the decision for its brief that ran on the same model family.
  const decisionFor = (o) => {
    const same = keyed.filter((d) => d.key === o.key);
    return same.find((d) => family(d.model) === family(o.model)) ?? same[0];
  };
  const cells = new Map();
  const cellOf = (d) => {
    const name = d.source === 'classifier' ? `${d.category} / ${d.difficulty}` : 'safe default (classifier unsure)';
    const id = `${name} -> ${d.model} ${d.effort}`;
    if (!cells.has(id)) {
      cells.set(id, { cell: name, chosen: `${d.model} ${d.effort}`, decisions: 0, runs: 0, cost: 0, costed: 0, ms: 0, right: 0, stronger: 0, cheaper: 0, retried: 0 });
    }
    return cells.get(id);
  };

  // A retry (the same brief again on a stronger model) counts against the
  // original choice as "needed a stronger model", not as a decision of its own.
  for (const d of decisions) {
    if (d.retryOf && d.key && byKey.get(d.key) !== d) cellOf(byKey.get(d.key)).retried += 1;
    else cellOf(d).decisions += 1;
  }

  for (const o of outcomes) {
    if (o.type === 'main-turn') continue;
    const d = decisionFor(o);
    if (!d) continue;
    // A retry's run is charged to the first choice: it is part of what that
    // choice really cost to finish the task.
    const isRetry = Boolean(d.retryOf) && byKey.get(d.key) !== d;
    const row = cellOf(isRetry ? byKey.get(d.key) : d);
    if (!isRetry) row.runs += 1;
    row.ms += o.durationMs ?? 0;
    const usd = cost(o);
    if (usd !== null) {
      row.cost += usd;
      row.costed += 1;
    }
  }

  // The latest rating per brief counts.
  const latest = new Map();
  for (const r of ratings) latest.set(r.key, r.rating);
  for (const [key, rating] of latest) {
    const d = byKey.get(key);
    if (d && ['right', 'stronger', 'cheaper'].includes(rating)) cellOf(d)[rating] += 1;
  }

  return [...cells.values()]
    .map((row) => ({ ...row, suggestion: suggest(row) }))
    .sort((a, b) => b.decisions - a.decisions);
}

/**
 * Raise when a third of the signals say "needed stronger" (a rating, or a
 * retry on a stronger model); lower when half the ratings say "could be cheaper".
 */
export function suggest({ right, stronger, cheaper, retried = 0 }) {
  const up = stronger + retried;
  const rated = right + up + cheaper;
  if (rated < MIN_RATINGS) return `need ${MIN_RATINGS - rated} more rating${MIN_RATINGS - rated === 1 ? '' : 's'}`;
  if (up / rated >= 1 / 3) return 'raise one step';
  if (cheaper / rated >= 1 / 2) return 'lower one step';
  return 'keep';
}

async function readJsonLines(path) {
  try {
    return (await readFile(path, 'utf8'))
      .split('\n')
      .filter((line) => line.trim().startsWith('{'))
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

async function readTuning(kind) {
  let names = [];
  try {
    names = await readdir(join(ROOT, 'tuning'));
  } catch {
    return [];
  }
  const files = names.filter((n) => n.startsWith(`${kind}-`) && n.endsWith('.jsonl'));
  return (await Promise.all(files.map((n) => readJsonLines(join(ROOT, 'tuning', n))))).flat();
}

/** Per session: the main session's turns and the subagents', with their models and cost. */
export function bySession(decisions, outcomes) {
  const sessions = new Map();
  const of = (id, project) => {
    if (!sessions.has(id)) sessions.set(id, { session: id, project: project ?? '-', decisions: 0, retries: 0, unsure: 0, mainTurns: 0, mainCost: 0, subTurns: 0, subCost: 0, models: new Set(), first: null, last: null });
    const s = sessions.get(id);
    if (project && s.project === '-') s.project = project;
    return s;
  };
  const seen = (s, time) => {
    if (!s.first || time < s.first) s.first = time;
    if (!s.last || time > s.last) s.last = time;
  };
  for (const d of decisions) {
    if (!d.session) continue;
    const s = of(d.session, d.project);
    s.decisions += 1;
    if (d.retryOf) s.retries += 1;
    if (d.source !== 'classifier') s.unsure += 1;
    seen(s, d.time);
  }
  for (const o of outcomes) {
    if (!o.session) continue;
    const s = of(o.session, o.project);
    const usd = cost(o) ?? 0;
    if (o.type === 'main-turn') {
      s.mainTurns += 1;
      s.mainCost += usd;
    } else {
      s.subTurns += 1;
      s.subCost += usd;
    }
    if (o.model) s.models.add(family(o.model) ?? o.model);
    seen(s, o.time);
  }
  return [...sessions.values()].sort((a, b) => String(b.last).localeCompare(String(a.last)));
}

async function main() {
  const option = (name) => {
    const at = process.argv.indexOf(name);
    return at > 0 ? process.argv[at + 1] : null;
  };
  const days = option('--days');
  const since = days ? Date.now() - Number(days) * 86400000 : 0;
  const recent = (entry) => !since || Date.parse(entry.time) >= since;
  const project = option('--project');
  const inProject = (entry) => !project || String(entry.project ?? '').toLowerCase() === project.toLowerCase();

  const decisions = (await readJsonLines(join(ROOT, 'router.log'))).filter(
    (d) => typeof d.model === 'string' && recent(d) && inProject(d),
  );
  const sessionIds = new Set(decisions.map((d) => d.session).filter(Boolean));
  // Outcomes carry their project; older lines are matched by session instead.
  const outcomes = (await readTuning('outcomes')).filter(
    (o) => recent(o) && (o.project ? inProject(o) : !project || sessionIds.has(o.session)),
  );
  const ratings = (await readTuning('ratings')).filter((r) => recent(r) && (!project || sessionIds.has(r.session)));
  const rows = summarize(decisions, outcomes, ratings);
  if (project) console.log(`Project: ${project}\n`);

  const pad = (v, w) => String(v).slice(0, w).padEnd(w);
  const money = (v) => `$${v.toFixed(v < 0.1 ? 4 : 2)}`;
  console.log(
    pad('cell', 34), pad('chosen', 14), pad('tasks', 6), pad('avg cost', 9), pad('avg min', 8),
    pad('right', 6), pad('stronger', 9), pad('cheaper', 8), pad('retried', 8), 'suggestion',
  );
  for (const r of rows) {
    console.log(
      pad(r.cell, 34),
      pad(r.chosen, 14),
      pad(r.decisions, 6),
      pad(r.costed ? money(r.cost / r.costed) : '-', 9),
      pad(r.runs ? (r.ms / r.runs / 60000).toFixed(1) : '-', 8),
      pad(r.right, 6),
      pad(r.stronger, 9),
      pad(r.cheaper, 8),
      pad(r.retried, 8),
      r.suggestion,
    );
  }

  const sessions = bySession(decisions, outcomes);
  if (sessions.length) {
    console.log('\nBy session (newest first):');
    console.log(pad('session', 10), pad('project', 18), pad('routed', 7), pad('retries', 8), pad('unsure', 7), pad('main cost', 10), pad('subagent cost', 14), 'models');
    for (const s of sessions) {
      console.log(
        pad(s.session.slice(0, 8), 10), pad(s.project, 18), pad(s.decisions, 7), pad(s.retries, 8), pad(s.unsure, 7),
        pad(s.mainTurns ? money(s.mainCost) : '-', 10), pad(s.subTurns ? money(s.subCost) : '-', 14), [...s.models].join(', ') || '-',
      );
    }
  }

  const subTurns = outcomes.filter((o) => o.type !== 'main-turn').length;
  const total = rows.reduce((sum, r) => sum + r.cost, 0);
  const rated = rows.reduce((sum, r) => sum + r.right + r.stronger + r.cheaper, 0);
  const retried = rows.reduce((sum, r) => sum + r.retried, 0);
  const unsure = rows.filter((r) => r.cell.startsWith('safe default')).reduce((sum, r) => sum + r.decisions, 0);
  const routed = rows.reduce((sum, r) => sum + r.decisions, 0);
  console.log(
    `\n${routed} routed, ${retried} retried on a stronger model, ${subTurns} finished subagent turns, ${rated} rated.` +
      ` Estimated subagent cost: ${money(total)}.` +
      (routed ? ` Classifier unsure: ${Math.round((unsure / routed) * 100)}% of decisions.` : ''),
  );
  console.log('Costs are estimates from token counts and list prices. Rate subagents with the buttons under their rows.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

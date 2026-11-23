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
  const byKey = new Map(decisions.filter((d) => d.key).map((d) => [d.key, d]));
  const cells = new Map();
  const cellOf = (d) => {
    const name = d.source === 'classifier' ? `${d.category} / ${d.difficulty}` : 'safe default (Bison unsure)';
    const id = `${name} -> ${d.model} ${d.effort}`;
    if (!cells.has(id)) {
      cells.set(id, { cell: name, chosen: `${d.model} ${d.effort}`, decisions: 0, runs: 0, cost: 0, costed: 0, ms: 0, right: 0, stronger: 0, cheaper: 0 });
    }
    return cells.get(id);
  };

  for (const d of decisions) cellOf(d).decisions += 1;

  for (const o of outcomes) {
    const d = byKey.get(o.key);
    if (!d) continue;
    const row = cellOf(d);
    row.runs += 1;
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

/** Raise when a third of ratings say "needed stronger"; lower when half say "could be cheaper". */
export function suggest({ right, stronger, cheaper }) {
  const rated = right + stronger + cheaper;
  if (rated < MIN_RATINGS) return `need ${MIN_RATINGS - rated} more rating${MIN_RATINGS - rated === 1 ? '' : 's'}`;
  if (stronger / rated >= 1 / 3) return 'raise one step';
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

async function main() {
  const daysAt = process.argv.indexOf('--days');
  const since = daysAt > 0 ? Date.now() - Number(process.argv[daysAt + 1]) * 86400000 : 0;
  const recent = (entry) => !since || Date.parse(entry.time) >= since;

  const decisions = (await readJsonLines(join(ROOT, 'router.log'))).filter((d) => typeof d.model === 'string' && recent(d));
  const outcomes = (await readTuning('outcomes')).filter(recent);
  const ratings = (await readTuning('ratings')).filter(recent);
  const rows = summarize(decisions, outcomes, ratings);

  const pad = (v, w) => String(v).slice(0, w).padEnd(w);
  const money = (v) => `$${v.toFixed(v < 0.1 ? 4 : 2)}`;
  console.log(
    pad('cell', 34), pad('chosen', 14), pad('tasks', 6), pad('avg cost', 9), pad('avg min', 8),
    pad('right', 6), pad('stronger', 9), pad('cheaper', 8), 'suggestion',
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
      r.suggestion,
    );
  }

  const total = rows.reduce((sum, r) => sum + r.cost, 0);
  const rated = rows.reduce((sum, r) => sum + r.right + r.stronger + r.cheaper, 0);
  const unsure = rows.filter((r) => r.cell.startsWith('safe default')).reduce((sum, r) => sum + r.decisions, 0);
  console.log(
    `\n${decisions.length} decisions, ${outcomes.length} finished subagent turns, ${rated} rated.` +
      ` Estimated subagent cost: ${money(total)}.` +
      (decisions.length ? ` Bison unsure: ${Math.round((unsure / decisions.length) * 100)}% of decisions.` : ''),
  );
  console.log('Costs are estimates from token counts and list prices. Rate subagents with the buttons under their rows.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

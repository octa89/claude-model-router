#!/usr/bin/env node
// Claude Code hook for the model router.
//
// Runs before a subagent is started (PreToolUse on the Agent tool). It sends the
// subagent's brief to the router and fills in the subagent's model and effort.
//
// Rules it keeps:
//   - A model or effort the session already chose for the subagent is left alone.
//   - Any problem (no key, network, bad reply) never blocks the subagent: the
//     router's safe default (Sonnet at high) is used instead.
//   - Each decision is logged to router.log next to this file. The brief's text
//     is not logged.
//
// Turn it off for one session or project by setting ROUTER_DISABLE=1.

import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EFFORTS, FABLE_SUBAGENT_TYPES, MODELS, route } from './router.mjs';

const LOG = join(dirname(fileURLToPath(import.meta.url)), 'router.log');
const SUBAGENT_TOOLS = ['Agent', 'Task'];
// Per attempt. With one retry the worst case (5 + 0.8 + 5 seconds) stays well
// inside the hook's 15-second limit in settings.
const CLASSIFY_TIMEOUT_MS = 5000;

// The app may have started before the key was saved, so its environment can lack
// it. On Windows, read the saved user variable directly. The value is never printed.
function savedUserVariable(name) {
  if (process.platform !== 'win32') return undefined;
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    return out.match(new RegExp(`${name}\\s+REG_(?:EXPAND_)?SZ\\s+(\\S+)`))?.[1];
  } catch {
    return undefined;
  }
}

/**
 * A short key for a brief: 32-bit FNV-1a of its text, in hex. The status mod
 * computes the same key to match a subagent's row to its log line, so the
 * brief's text never needs to be logged. Keep it the same as the mod's `briefKey`.
 */
export function briefKey(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// The effort for a model the session picked itself, without an effort.
const DEFAULT_EFFORT = { haiku: 'low', sonnet: 'medium', opus: 'medium', fable: 'high' };
const familyOf = (model) => Object.keys(MODELS).find((name) => String(model).toLowerCase().includes(name)) ?? null;

/** The router's last decision for the same brief, if the log has one. */
async function previousDecision(file, key) {
  if (!file) return null;
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  const lines = text.trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].includes(key)) continue;
    try {
      const d = JSON.parse(lines[i]);
      if (d.key === key && typeof d.model === 'string') return d;
    } catch {
      // A cut line: skip it.
    }
  }
  return null;
}

async function log(file, entry) {
  if (!file) return;
  try {
    await appendFile(file, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    // Logging is best effort.
  }
}

/** Decide what the hook should print for one event. Returns null to stay out of the way. */
export async function handle(event, { logFile = LOG, ...routeOpts } = {}) {
  if (event?.hook_event_name !== 'PreToolUse' || !SUBAGENT_TOOLS.includes(event.tool_name)) return null;
  const input = event.tool_input ?? {};
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) return null;
  // A fork always runs on its parent's model, so there is nothing to choose.
  if (input.subagent_type === 'fork') return null;
  // An explicit choice by the session wins.
  if (input.model && input.effort) return null;

  const brief = [
    input.subagent_type ? `Subagent type: ${input.subagent_type}` : '',
    input.description ? `Summary: ${input.description}` : '',
    input.prompt,
  ]
    .filter(Boolean)
    .join('\n');

  // Planning and review subagents always run on Fable 5.2.
  const isPlanOrReview = FABLE_SUBAGENT_TYPES.test(input.subagent_type ?? '');
  const startedAt = Date.now();
  const choice = await route(brief, {
    timeoutMs: CLASSIFY_TIMEOUT_MS,
    ...(isPlanOrReview ? { minModel: 'fable' } : {}),
    ...routeOpts,
  });
  const model = input.model || choice.model;
  const pickedFamily = familyOf(input.model);
  // A model the session picked, without an effort: the higher of the router's
  // effort and that model's own starting effort, so a retry on Opus of a task
  // rated easy still gets medium, and a task rated hard keeps its high.
  const higher = (a, b) => (EFFORTS.indexOf(a) >= EFFORTS.indexOf(b) ? a : b);
  const effort =
    input.effort ||
    (pickedFamily && pickedFamily !== choice.model ? higher(choice.effort, DEFAULT_EFFORT[pickedFamily]) : choice.effort);

  // The same brief again on a stronger model: a retry after a failure. The
  // tuning report counts these as "needed a stronger model".
  const key = briefKey(input.prompt);
  const earlier = await previousDecision(logFile, key);
  const earlierFamily = familyOf(earlier?.model);
  const finalFamily = familyOf(model);
  const retryOf =
    earlierFamily && finalFamily && MODELS[finalFamily].rank > MODELS[earlierFamily].rank
      ? `${earlier.model} ${earlier.effort}`
      : null;

  await log(logFile, {
    // Which session and project folder started the subagent.
    session: typeof event.session_id === 'string' ? event.session_id : null,
    project: typeof event.cwd === 'string' ? basename(event.cwd) || event.cwd : null,
    key,
    subagentType: input.subagent_type ?? null,
    // The Agent call's own short title (3-5 words), to judge the choice later.
    // The brief itself is never logged.
    description: typeof input.description === 'string' ? input.description.slice(0, 80) : null,
    model,
    effort,
    ...(input.model ? { modelPickedBySession: true } : {}),
    ...(retryOf ? { retryOf } : {}),
    source: choice.source,
    category: choice.category,
    difficulty: choice.difficulty,
    confidence: choice.confidence,
    riskProbability: choice.riskProbability ?? null,
    // How long the decision took, classifier call included.
    ms: Date.now() - startedAt,
    // Which classifier answered; the main one's error when the backup did.
    classifier: choice.classifierModel,
    ...(choice.backupUsed ? { primaryError: String(choice.primaryError).slice(0, 120) } : {}),
    ...(choice.classifierError ? { error: choice.classifierError } : {}),
  });

  // One line shown to the user in the session each time a subagent is routed.
  const why =
    choice.source === 'classifier'
      ? `${choice.category}, ${choice.difficulty}` +
        (typeof choice.confidence === 'number' ? `, ${Math.round(choice.confidence * 100)}% sure` : '') +
        (choice.risk === 'high' ? ', high risk' : '')
      : 'safe default, Bison gave no clear answer';

  return {
    systemMessage: `Model router: ${model} at ${effort} effort (${why})`,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: { ...input, model, effort },
    },
  };
}

async function main() {
  if (process.env.ROUTER_DISABLE === '1') return;
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const event = JSON.parse(raw.replace(/^\uFEFF/, ''));
  process.env.OPENROUTER_API_KEY ||= savedUserVariable('OPENROUTER_API_KEY') ?? '';
  // Optional: a separate OpenRouter key for the backup classifier.
  process.env.ROUTER_BACKUP_API_KEY ||= savedUserVariable('ROUTER_BACKUP_API_KEY') ?? '';
  // ROUTER_LOG=off: decide without logging (the evaluations use this).
  const output = await handle(event, process.env.ROUTER_LOG === 'off' ? { logFile: null } : {});
  if (output) process.stdout.write(JSON.stringify(output));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Never fail the tool call because of the router.
  main().catch(async (err) => {
    await log(LOG, { error: `hook failed: ${err.message}` });
  });
}

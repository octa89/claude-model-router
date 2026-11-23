#!/usr/bin/env node
// Claude Code hook for the model router.
//
// Runs before a subagent is started (PreToolUse on the Agent tool). It sends the
// subagent's brief to the router and fills in the subagent's model and effort.
//
// Rules it keeps:
//   - A model or effort the session already chose for the subagent is left alone.
//   - Any problem (no key, network, bad reply) never blocks the subagent: the
//     router's safe default (Opus at medium) is used instead.
//   - Each decision is logged to router.log next to this file. The brief's text
//     is not logged.
//
// Turn it off for one session or project by setting ROUTER_DISABLE=1.

import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FABLE_SUBAGENT_TYPES, route } from './router.mjs';

const LOG = join(dirname(fileURLToPath(import.meta.url)), 'router.log');
const SUBAGENT_TOOLS = ['Agent', 'Task'];
const CLASSIFY_TIMEOUT_MS = 6000;

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
  const choice = await route(brief, {
    timeoutMs: CLASSIFY_TIMEOUT_MS,
    ...(isPlanOrReview ? { minModel: 'fable' } : {}),
    ...routeOpts,
  });
  const model = input.model || choice.model;
  const effort = input.effort || choice.effort;

  await log(logFile, {
    // Which session and project folder started the subagent.
    session: typeof event.session_id === 'string' ? event.session_id : null,
    project: typeof event.cwd === 'string' ? basename(event.cwd) || event.cwd : null,
    key: briefKey(input.prompt),
    subagentType: input.subagent_type ?? null,
    model,
    effort,
    source: choice.source,
    category: choice.category,
    difficulty: choice.difficulty,
    confidence: choice.confidence,
    riskProbability: choice.riskProbability ?? null,
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
  const output = await handle(event);
  if (output) process.stdout.write(JSON.stringify(output));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Never fail the tool call because of the router.
  main().catch(async (err) => {
    await log(LOG, { error: `hook failed: ${err.message}` });
  });
}

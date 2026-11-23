#!/usr/bin/env node
// Installs the model router into Claude Code for your user, from this folder:
//   1. adds the router's PreToolUse hook to your Claude Code user settings
//      (a backup of the file is saved next to it first), and
//   2. installs the router-status mod from ./status-mod.
//
// Usage:
//   node install.mjs              install, or point an earlier install here
//   node install.mjs --dry-run    show what would change, change nothing
//   node install.mjs --uninstall  remove the hook and the mod
//
// Keep this folder where it is: the hook runs from it and writes router.log here.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOOK = join(ROOT, 'hook.mjs').replace(/\\/g, '/');
const MOD = join(ROOT, 'status-mod');
const CONFIG = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const SETTINGS = join(CONFIG, 'settings.json');
const PLUGIN = 'router-status@claude-model-router';

const args = new Set(process.argv.slice(2));
const isDryRun = args.has('--dry-run');
const isUninstall = args.has('--uninstall');

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`Node 20 or newer is needed (found ${process.versions.node}).`);
  process.exit(1);
}

/** True for a hook entry that runs this router, wherever it was installed from. */
const STATUS_MESSAGE = 'Choosing a model for the subagent';
const isRouterHook = (hook) =>
  hook?.type === 'command' &&
  (hook.statusMessage === STATUS_MESSAGE ||
    [hook.command, ...(hook.args ?? [])].some((part) => /router/i.test(part ?? '') && /hook\.mjs/.test(part ?? '')));

/** The settings with the router's hook added (or moved here), or removed. */
export function updateSettings(settings, { hookPath = HOOK, remove = false } = {}) {
  const next = structuredClone(settings);
  next.hooks ??= {};
  const groups = (next.hooks.PreToolUse ?? [])
    .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((hook) => !isRouterHook(hook)) }))
    .filter((group) => group.hooks.length > 0);

  if (!remove) {
    groups.push({
      matcher: 'Agent',
      hooks: [
        {
          type: 'command',
          command: 'node',
          args: [hookPath],
          timeout: 15,
          statusMessage: STATUS_MESSAGE,
        },
      ],
    });
  }

  if (groups.length > 0) next.hooks.PreToolUse = groups;
  else delete next.hooks.PreToolUse;
  if (Object.keys(next.hooks).length === 0) delete next.hooks;
  return next;
}

function claude(...cliArgs) {
  console.log(`> claude ${cliArgs.join(' ')}`);
  if (isDryRun) return true;
  const run = spawnSync('claude', cliArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
  return run.status === 0;
}

function main() {
  const settings = existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, 'utf8')) : {};
  const updated = updateSettings(settings, { remove: isUninstall });

  if (isDryRun) {
    console.log(`Would write ${SETTINGS}, PreToolUse becomes:`);
    console.log(JSON.stringify(updated.hooks?.PreToolUse ?? [], null, 2));
  } else {
    if (existsSync(SETTINGS)) {
      const backup = `${SETTINGS}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      copyFileSync(SETTINGS, backup);
      console.log(`Backed up your settings to ${backup}`);
    }
    writeFileSync(SETTINGS, `${JSON.stringify(updated, null, 2)}\n`);
    console.log(`${isUninstall ? 'Removed the router hook from' : 'Added the router hook to'} ${SETTINGS}`);
  }

  if (isUninstall) {
    claude('plugin', 'uninstall', PLUGIN);
    claude('plugin', 'marketplace', 'remove', 'claude-model-router');
    console.log('\nDone. Start a new session for the change to apply.');
    return;
  }

  const added = claude('plugin', 'marketplace', 'add', MOD);
  const installed = added && claude('plugin', 'install', PLUGIN, '--scope', 'user');
  if (!installed) {
    console.log('\nThe status mod did not install. The router still works; see the README to install the mod by hand.');
  }

  const hasKey = Boolean(process.env.OPENROUTER_API_KEY);
  console.log('\nDone. Start a new Claude Code session to use it.');
  if (!hasKey) {
    console.log('Next: save your OpenRouter key as the OPENROUTER_API_KEY environment variable');
    console.log(process.platform === 'win32' ? '  (on Windows: run set-key.ps1 in this folder).' : '  (for example in your shell profile).');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

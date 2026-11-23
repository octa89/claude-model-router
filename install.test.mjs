import test from 'node:test';
import assert from 'node:assert/strict';
import { updateSettings } from './install.mjs';

const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] };
const oldRouter = {
  matcher: 'Agent',
  hooks: [{ type: 'command', command: 'node', args: ['C:/old/place/model-router/hook.mjs'], timeout: 15 }],
};

test('adds the hook and keeps everything else in the settings', () => {
  const settings = { model: 'opus', permissions: { allow: ['Read'] }, hooks: { SessionStart: [other], PreToolUse: [other] } };
  const out = updateSettings(settings, { hookPath: '/x/claude-model-router/hook.mjs' });
  assert.equal(out.model, 'opus');
  assert.deepEqual(out.permissions, settings.permissions);
  assert.deepEqual(out.hooks.SessionStart, [other]);
  assert.equal(out.hooks.PreToolUse.length, 2);
  assert.deepEqual(out.hooks.PreToolUse[0], other);
  assert.equal(out.hooks.PreToolUse[1].matcher, 'Agent');
  assert.deepEqual(out.hooks.PreToolUse[1].hooks[0].args, ['/x/claude-model-router/hook.mjs']);
  assert.notEqual(out, settings, 'the input is not changed');
  assert.equal(settings.hooks.PreToolUse.length, 1);
});

test('running it again replaces an earlier install instead of adding a second hook', () => {
  const once = updateSettings({ hooks: { PreToolUse: [oldRouter] } }, { hookPath: '/new/hook.mjs' });
  const twice = updateSettings(once, { hookPath: '/new/hook.mjs' });
  assert.equal(twice.hooks.PreToolUse.length, 1);
  assert.deepEqual(twice.hooks.PreToolUse[0].hooks[0].args, ['/new/hook.mjs']);
});

test('uninstall removes only the router hook', () => {
  const out = updateSettings({ hooks: { PreToolUse: [other, oldRouter] } }, { remove: true });
  assert.deepEqual(out.hooks.PreToolUse, [other]);
  const empty = updateSettings({ hooks: { PreToolUse: [oldRouter] } }, { remove: true });
  assert.equal(empty.hooks, undefined);
});

test('works on empty settings', () => {
  const out = updateSettings({}, { hookPath: '/h/hook.mjs' });
  assert.equal(out.hooks.PreToolUse.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './hook.mjs';

const reply = (category, difficulty = 'normal', risk = 0.02) => ({
  answers: {
    category: { type: 'choice', choice: category, probabilities: { [category]: 0.9 } },
    difficulty: { type: 'choice', choice: difficulty },
    high_risk: { type: 'noul', noul: risk },
  },
});

const fakeFetch = (body, status = 200) => {
  const f = async (url, init) => {
    f.calls.push(JSON.parse(init.body));
    return { ok: status === 200, status, text: async () => JSON.stringify(body) };
  };
  f.calls = [];
  return f;
};

const event = (tool_input, over = {}) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_input,
  ...over,
});

const opts = (fetchImpl) => ({ apiKey: 'k', fetchImpl, logFile: null });

test('fills in model and effort and keeps every other field', async () => {
  const f = fakeFetch(reply('search_read', 'easy'));
  const input = { description: 'Find old imports', prompt: 'List files importing the old logger', subagent_type: 'Explore' };
  const out = await handle(event(input), opts(f));
  assert.deepEqual(out.hookSpecificOutput, {
    hookEventName: 'PreToolUse',
    updatedInput: { ...input, model: 'sonnet', effort: 'low' },
  });
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, 'does not change permissions');
  assert.match(f.calls[0].state.task, /Subagent type: Explore/);
  assert.match(f.calls[0].state.task, /List files importing the old logger/);
});

test('a model the session already chose is kept; only effort is filled in', async () => {
  const f = fakeFetch(reply('deep_reasoning', 'hard'));
  const out = await handle(event({ prompt: 'Design the system', model: 'sonnet' }), opts(f));
  assert.equal(out.hookSpecificOutput.updatedInput.model, 'sonnet');
  assert.equal(out.hookSpecificOutput.updatedInput.effort, 'high');
});

test('stays out of the way when model and effort are both set, for forks, and for other tools', async () => {
  const f = fakeFetch(reply('chat_simple'));
  assert.equal(await handle(event({ prompt: 'x', model: 'opus', effort: 'low' }), opts(f)), null);
  assert.equal(await handle(event({ prompt: 'x', subagent_type: 'fork' }), opts(f)), null);
  assert.equal(await handle(event({ prompt: 'x' }, { tool_name: 'Bash' }), opts(f)), null);
  assert.equal(await handle(event({ prompt: 'x' }, { hook_event_name: 'PostToolUse' }), opts(f)), null);
  assert.equal(await handle(event({ prompt: '   ' }), opts(f)), null);
  assert.equal(await handle(event({}), opts(f)), null);
  assert.equal(f.calls.length, 0, 'nothing was sent to the classifier');
});

test('also handles the older tool name Task', async () => {
  const out = await handle(event({ prompt: 'Add a unit test' }, { tool_name: 'Task' }), opts(fakeFetch(reply('coding_routine'))));
  assert.equal(out.hookSpecificOutput.updatedInput.model, 'sonnet');
});

test('a classifier failure still returns the safe default, Opus at medium', async () => {
  const out = await handle(event({ prompt: 'Anything at all' }), opts(fakeFetch({ error: 'down' }, 500)));
  assert.equal(out.hookSpecificOutput.updatedInput.model, 'opus');
  assert.equal(out.hookSpecificOutput.updatedInput.effort, 'medium');
});

test('a risky brief is raised to Opus', async () => {
  const out = await handle(event({ prompt: 'Delete old rows in prod' }), opts(fakeFetch(reply('coding_routine', 'easy', 0.95))));
  assert.equal(out.hookSpecificOutput.updatedInput.model, 'opus');
});

test('shows the user a one-line banner with the choice', async () => {
  const routed = await handle(event({ prompt: 'List files' }), opts(fakeFetch(reply('search_read', 'easy'))));
  assert.equal(routed.systemMessage, 'Model router: sonnet at low effort (search_read, easy, 90% sure)');
  const risky = await handle(event({ prompt: 'Delete rows' }), opts(fakeFetch(reply('coding_routine', 'easy', 0.95))));
  assert.match(risky.systemMessage, /opus at medium effort .*high risk/);
  const failed = await handle(event({ prompt: 'Anything' }), opts(fakeFetch({}, 500)));
  assert.equal(failed.systemMessage, 'Model router: opus at medium effort (safe default, Bison gave no clear answer)');
});

test('the brief key is 32-bit FNV-1a in hex, the same one the status mod computes', async () => {
  const { briefKey } = await import('./hook.mjs');
  assert.equal(briefKey(''), '811c9dc5');
  assert.equal(briefKey('a'), 'e40c292c');
  assert.equal(briefKey('foobar'), 'bf9cf968');
});

test('the log line names the session and the project folder', async () => {
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const logFile = join(await mkdtemp(join(tmpdir(), 'hook-log-')), 'router.log');
  await handle(
    event({ prompt: 'List files' }, { session_id: 'sess-123', cwd: String.raw`C:\Users\me\Projects\my-app` }),
    { apiKey: 'k', fetchImpl: fakeFetch(reply('search_read', 'easy')), logFile },
  );
  const line = JSON.parse((await readFile(logFile, 'utf8')).trim());
  assert.equal(line.session, 'sess-123');
  assert.equal(line.project, 'my-app');
  assert.equal(line.prompt, undefined, 'the brief is not logged');
});

test('Plan and review subagent types always get Fable, even for an easy brief', async () => {
  for (const subagent_type of ['Plan', 'code-reviewer', 'verifier']) {
    const out = await handle(event({ prompt: 'Look at this', subagent_type }), opts(fakeFetch(reply('search_read', 'easy'))));
    assert.equal(out.hookSpecificOutput.updatedInput.model, 'fable', subagent_type);
    assert.equal(out.hookSpecificOutput.updatedInput.effort, 'medium', subagent_type);
  }
  const explore = await handle(event({ prompt: 'Look at this', subagent_type: 'Explore' }), opts(fakeFetch(reply('search_read', 'easy'))));
  assert.equal(explore.hookSpecificOutput.updatedInput.model, 'sonnet');
});

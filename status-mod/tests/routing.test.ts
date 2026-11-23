import { expect, test } from 'claude-code/testing'

const ROUTER_REPLY = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    updatedInput: { prompt: 'Fix the sync bug\n\n# Finishing work\nKeep going.', model: 'fable', effort: 'medium' },
  },
}

const SPAWN = {
  tool_use_id: 'toolu_1',
  prompt: 'Fix the sync bug',
  description: 'Fix sync bug',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
} as const

test('a subagent gets the router model and brief at spawn, and its effort on each request', async ($, on) => {
  const ran: string[][] = []
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: JSON.stringify(ROUTER_REPLY), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  let spawned: { model?: string; prompt: string } | undefined
  on('agent.spawn', (_, e) => {
    spawned = { model: e.model, prompt: e.prompt }
    return { model: 'claude-fable-5-2', agentId: 'agent-1' }
  })

  const efforts: unknown[] = []
  on('turn.step', async function* (_, e) {
    efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  await $.agent.spawn(SPAWN)

  expect(ran[0]?.[0]).toBe('node')
  expect(ran[0]?.[1]?.endsWith('hook.mjs')).toBe(true)
  expect(spawned?.model).toBe('fable')
  expect(spawned?.prompt.includes('# Finishing work')).toBe(true)

  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-fable-5-2', messageCount: 1, agentId: 'agent-1' })) {
    // Drain the stream.
  }
  // The main session's requests are left alone.
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
    // Drain the stream.
  }

  expect(efforts).toEqual(['medium', undefined])
})

test('a fork is not routed', async ($, on) => {
  let calls = 0
  on('process.run', () => {
    calls += 1
    return { value: { exitCode: 0, stdout: JSON.stringify(ROUTER_REPLY), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('agent.spawn', (_, e) => ({ model: e.parentModel, agentId: 'fork-1' }))

  await $.agent.spawn({ ...SPAWN, subagentType: 'fork', fork: true })

  expect(calls).toBe(0)
})

test('a router failure starts the subagent as asked', async ($, on) => {
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false } }))

  let spawned: { model?: string; prompt: string } | undefined
  on('agent.spawn', (_, e) => {
    spawned = { model: e.model, prompt: e.prompt }
    return { model: 'claude-opus-5-5', agentId: 'agent-2' }
  })

  await $.agent.spawn(SPAWN)

  expect(spawned).toEqual({ model: undefined, prompt: 'Fix the sync bug' })
})

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const WORKTREE = 'C:/repo/.git/worktrees/t02\nC:/repo/.git\n'
const MAIN_CHECKOUT = 'C:/repo/.git\nC:/repo/.git\n'
const SONNET_REPLY = JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { prompt: 'x', model: 'sonnet', effort: 'high' } },
})

const stepModels = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) => {
  const seen: { model: string; effort: unknown }[] = []
  on('turn.step', async function* (_, e) {
    seen.push({ model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return seen
}

test('a session in a git worktree is a worker: routed once from its first task', async ($, on) => {
  const routerCalls: string[] = []
  on('process.run', (_, e) => {
    if (e.argv[0] === 'git') return ok(WORKTREE)
    routerCalls.push(e.argv[1] ?? '')
    return ok(SONNET_REPLY)
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const seen = await stepModels($, on)

  await $.turn.start({ text: 'Build task T02 environments', turnId: 't1' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
    // Drain.
  }
  await $.turn.start({ text: 'Continue', turnId: 't2' })
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-opus-5-5', messageCount: 3 })) {
    // Drain.
  }

  expect(routerCalls.length).toBe(1)
  expect(seen).toEqual([
    { model: 'sonnet', effort: 'high' },
    { model: 'sonnet', effort: 'high' },
  ])
})

test('a session you start in the main checkout stays the coordinator', async ($, on) => {
  let routerCalls = 0
  on('process.run', (_, e) => {
    if (e.argv[0] === 'git') return ok(MAIN_CHECKOUT)
    routerCalls += 1
    return ok(SONNET_REPLY)
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const seen = await stepModels($, on)

  await $.turn.start({ text: 'Plan the next release', turnId: 't1' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
    // Drain.
  }

  expect(routerCalls).toBe(0)
  expect(seen).toEqual([{ model: 'claude-opus-5-5', effort: undefined }])
})

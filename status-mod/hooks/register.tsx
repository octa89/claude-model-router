import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Labels } from '../types'

// The router's hook writes router.log next to hook.mjs, one folder above this
// mod. So the mod must be installed from that folder (a directory
// marketplace), as install.mjs does.
function logPath($: EngineInterface): string {
  return `${$.plugin.root}/../router.log`
}
const TAIL_BYTES = 32768
const NOTHING_YET = 'no subagent yet'
const RISK_THRESHOLD = 0.4

// What the router decided, by the key of the subagent brief it judged.
// Rewritten whole from the log at each refresh, so it needs no shape tag.
const labels = atom({ plugin: 'router-status', key: 'labels' } as const, {})

/**
 * The key the router logs for a brief: 32-bit FNV-1a of its text, in hex.
 * Must stay the same as `briefKey` in the router's hook.mjs.
 */
export const briefKey = (text: string): string => {
  let hash = 0x811c9dc5

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Reads the end of the router's log: the latest choice, and a label per brief. */
export const parse = (tail: string): { latest: string; byKey: Labels } => {
  const byKey: Labels = {}
  let latest = NOTHING_YET

  for (const line of tail.split('\n')) {
    if (!line.trim().startsWith('{')) {
      continue
    }

    try {
      const decision = JSON.parse(line)

      if (typeof decision.model !== 'string') {
        continue
      }

      const model = decision.model.charAt(0).toUpperCase() + decision.model.slice(1)
      // Kept short on purpose: the status line is cut after about 35 characters.
      latest = `${model} · ${decision.effort} effort`

      const sure =
        typeof decision.confidence === 'number'
          ? `, ${Math.round(decision.confidence * 100)}% sure`
          : ''
      const risk =
        typeof decision.riskProbability === 'number' &&
        decision.riskProbability >= RISK_THRESHOLD
          ? ', high risk'
          : ''
      const why =
        decision.source === 'classifier'
          ? `${decision.category}, ${decision.difficulty}${sure}${risk}`
          : 'safe default, Bison gave no clear answer'

      if (typeof decision.key === 'string') {
        byKey[decision.key] = `${latest} · ${why}`
      }
    } catch {
      // A half-written or cut line: skip it.
    }
  }

  return { latest, byKey }
}

// The main session's model while plan mode is on.
const PLAN_MODEL = 'claude-fable-5-2'
const isFable = (model: string): boolean => /fable/i.test(model)

/** The status line: the last subagent choice, and Fable for the main session in plan mode. */
export const statusLine = (isPlanning: boolean, lastSubagent: string): string =>
  isPlanning ? `Plan mode: Fable · ${lastSubagent}` : lastSubagent

export const register: Register = on => {
  // Whether the main session is in plan mode, as the engine's plan-mode
  // reminders say. Starts off; a reload resets it until the next reminder.
  let isPlanning = false
  // The last subagent choice, so the status line can go back to it.
  let lastSubagent = NOTHING_YET

  // While plan mode is on, each request of the main session carries one of these.
  on('prompt.attachment', { type: ['plan_mode', 'plan_mode_reentry'] }, ($, e, next) => {
    if (e.agentId === undefined && !isPlanning) {
      isPlanning = true
      $.ui.status(statusLine(isPlanning, lastSubagent))
    }

    return next(e)
  })

  // Made once when plan mode ends.
  on('prompt.attachment', { type: 'plan_mode_exit' }, ($, e, next) => {
    if (e.agentId === undefined && isPlanning) {
      isPlanning = false
      $.ui.status(statusLine(isPlanning, lastSubagent))
    }

    return next(e)
  })

  // The main session plans on Fable 5.2; once plan mode ends it is back on its own model.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && isPlanning && !isFable(e.model)) {
      return yield* next({ ...e, model: PLAN_MODEL })
    }

    return yield* next(e)
  })

  on('session.start', async ($, e, next) => {
    try {
      const { size } = await $.fs.stat(logPath($))
      const offset = Math.max(0, size - TAIL_BYTES)
      const { latest, byKey } = parse(await $.fs.read(logPath($), { offset, length: TAIL_BYTES }))
      lastSubagent = latest
      await update($, labels, () => byKey)
    } catch {
      lastSubagent = NOTHING_YET
    }

    $.ui.status(statusLine(isPlanning, lastSubagent))

    return next(e)
  })

  // The router decides while the call is on its way down, so read its log after.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)

    try {
      const { size } = await $.fs.stat(logPath($))
      const offset = Math.max(0, size - TAIL_BYTES)
      const { latest, byKey } = parse(await $.fs.read(logPath($), { offset, length: TAIL_BYTES }))
      lastSubagent = latest
      await update($, labels, () => byKey)
      $.ui.status(statusLine(isPlanning, lastSubagent))
    } catch {
      // No log yet: keep what is shown.
    }

    return ran
    // This mod only reports. If it fails, the subagent call goes ahead untouched.
  }).catch(($, e, next) => next(e))

  // Under each subagent's row: what the router made of its brief.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== 'Agent') {
      return next(e)
    }

    const input = e.props.input as { prompt?: unknown } | null
    const prompt = typeof input?.prompt === 'string' ? input.prompt : ''
    const label = (await read($, labels))[briefKey(prompt)]

    if (label === undefined) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Text dimColor>Model router: {label}</Text>
      </Box>
    )
  })
}

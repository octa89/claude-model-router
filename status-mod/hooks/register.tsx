import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentKeys, Labels, MainRoute, Rating, Ratings } from '../types'

// The router (hook.mjs) sits one folder above this mod and writes router.log
// there. So the mod must be installed from that folder (a directory
// marketplace), as install.mjs does.
function logPath($: EngineInterface): string {
  return `${$.plugin.root}/../router.log`
}
function routerPath($: EngineInterface): string {
  return `${$.plugin.root}/../hook.mjs`
}

// Outcomes and ratings go in one file per session, next to the router's log,
// so sessions running at the same time never write the same file.
async function sessionFile($: EngineInterface, kind: 'outcomes' | 'ratings'): Promise<string> {
  return `${$.plugin.root}/../tuning/${kind}-${await $.session.id()}.jsonl`
}

// The main session's entry in the map of tracked turns.
const MAIN = 'main'

/** The project folder's name, as the router's hook logs it. */
async function projectName($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
}

// Standing instruction for a session that can start subagents. The main
// session is the coordinator (Opus 5.5); the router gives each subagent its
// model: Sonnet 5.5 for small jobs, Fable 5.2 for deep work, Opus for
// planning and review. Measured: a Sonnet run that failed passed on Opus;
// Anthropic found "run cheap, re-run failures higher" holds the pass rate for
// about 40% less.
const RETRY_RULE = [
  "Model router: you are the coordinator. Subagents are routed to a model and effort automatically (Sonnet 5.5 for small jobs, Fable 5.2 for deep work, Opus 5.5 for planning and review), so leave the Agent call's model and effort unset.",
  'Run builds and other long tasks as subagents with the Agent tool (in their own worktree when they change code), not as separate sessions, so they are routed too.',
  'When a subagent that ran on Sonnet or Haiku fails a check you can see (tests or build fail, a checker rejects it, or its result is plainly wrong or incomplete), start it once more with the same brief and model "opus" on the Agent call. Retry once only; for a failure on Opus or Fable, handle it as you normally would.',
].join(' ')

async function appendLine($: EngineInterface, path: string, entry: object): Promise<void> {
  let text = ''

  try {
    text = await $.fs.read(path)
  } catch {
    // A new file.
  }

  await $.fs.write(path, `${text}${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`)
}

const RATING_TEXT: Record<Rating, string> = {
  right: 'right model',
  stronger: 'needed a stronger model',
  cheaper: 'a cheaper model would do',
}

// What one subagent has used so far, for its outcome line.
type Run = {
  key: string
  subagentType: string
  model: string
  steps: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}
const TAIL_BYTES = 32768
const NOTHING_YET = 'no subagent yet'
const RISK_THRESHOLD = 0.4

// What the router decided, by the key of the subagent brief it judged.
// Rewritten whole from the log at each refresh, so it needs no shape tag.
const labels = atom({ plugin: 'router-status', key: 'labels' } as const, {})
// Ratings given in this session, so a rated row shows its rating.
const ratings = atom({ plugin: 'router-status', key: 'ratings' } as const, {} as Ratings)
// A subagent's first brief, so its follow-up turns (each message sent to it
// starts it again) are joined to the router's original decision. Kept in the
// session's state so a reload of the add-on keeps it.
const agentKeys = atom({ plugin: 'router-status', key: 'agentKeys' } as const, {} as AgentKeys)
// The main session's role and, for a worker, its model and effort. Kept in
// the session's state so a reload keeps the decision (and the prompt cache).
const mainRoute = atom({ plugin: 'router-status', key: 'mainRoute' } as const, { role: 'undecided' } as MainRoute)

// Where a task given by another session comes from.
const PEER_ORIGINS = ['peer', 'peer-send-message', 'coordinator', 'projects-relay']

/** Whether the session's folder is a linked git worktree (not the main checkout). */
async function isLinkedWorktree($: EngineInterface): Promise<boolean> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], {
      timeoutMs: 5000,
    })
    const [gitDir, commonDir] = stdout.trim().split(/\r?\n/).map(line => line.trim().replace(/\\/g, '/'))
    return exitCode === 0 && gitDir !== undefined && commonDir !== undefined && gitDir !== commonDir
  } catch {
    return false
  }
}

/** The router's choice for a brief, by running hook.mjs; null when it gives none. */
async function askRouter(
  $: EngineInterface,
  input: { prompt: string; description: string; subagent_type: string; model?: string },
  cwd: string | null,
): Promise<{ model: string; effort: string; prompt?: string } | null> {
  const event = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    session_id: await $.session.id().catch(() => null),
    cwd,
    tool_input: input,
  }
  const { exitCode, stdout } = await $.process.run(['node', routerPath($)], {
    stdin: JSON.stringify(event),
    timeoutMs: 15000,
  })
  return exitCode === 0 ? readDecision(stdout) : null
}

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

/**
 * Reads the end of the router's log: a label per brief, and the latest choice
 * made for this session. The log is shared by every session, so the status
 * line only counts lines carrying this session's id.
 */
export const parse = (tail: string, sessionId: string): { latest: string; byKey: Labels } => {
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
      const choice = `${model} · ${decision.effort} effort`

      if (decision.session === sessionId) {
        latest = choice
      }

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
        byKey[decision.key] = `${choice} · ${why}`
      }
    } catch {
      // A half-written or cut line: skip it.
    }
  }

  return { latest, byKey }
}

// What the router asked for, waiting to be tied to the subagent's own id.
type Pending = { description: string; subagentType: string; effort: string }

/** What the router's reply asks for: model, effort and the brief to run. */
export const readDecision = (
  stdout: string,
): { model: string; effort: string; prompt?: string } | null => {
  try {
    const input = JSON.parse(stdout)?.hookSpecificOutput?.updatedInput

    if (typeof input?.model !== 'string' || typeof input?.effort !== 'string') {
      return null
    }

    return {
      model: input.model,
      effort: input.effort,
      ...(typeof input.prompt === 'string' ? { prompt: input.prompt } : {}),
    }
  } catch {
    return null
  }
}

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

/**
 * Reads the end of the router's log into the labels under each subagent row,
 * and answers the latest choice made for this session.
 */
async function refreshLabels($: EngineInterface): Promise<string> {
  const { size } = await $.fs.stat(logPath($))
  const offset = Math.max(0, size - TAIL_BYTES)
  const tail = await $.fs.read(logPath($), { offset, length: TAIL_BYTES })
  const { latest, byKey } = parse(tail, await $.session.id())
  await update($, labels, () => byKey)
  return latest
}

export const register: Register = on => {
  // The last subagent choice, for the status line.
  let lastSubagent = NOTHING_YET
  // The effort the router chose, by subagent id, and choices whose subagent
  // has no id yet (its first request can come before the spawn answers).
  const efforts = new Map<string, string>()
  const pending: Pending[] = []


  // Turns being tracked for their outcome line: subagents by agent id, and
  // the main session as MAIN.
  const runs = new Map<string, Run>()

  // The retry rule, for a prompt that can start subagents.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    if (!e.tools.includes('Agent')) {
      return composed
    }

    return {
      sections: [...composed.sections, { id: 'router-status:retry', text: RETRY_RULE, scope: 'session' as const }],
    }
  })

  // Remember which brief each subagent was started with, to join its outcome
  // to the router's decision.
  // The router: before a subagent starts, ask hook.mjs (classifier and
  // rules) for its model, effort and brief. Done here rather than in a
  // PreToolUse hook, so the Agent call reaches auto mode unchanged and is
  // never sent back. Forks, resumed subagents and workflow agents keep
  // what they have.
  on('agent.spawn', async ($, e, next) => {
    let spawn = e
    let entry: Pending | null = null

    if (!e.fork && e.resume === undefined && e.workflow === undefined) {
      try {
        const decision = await askRouter(
          $,
          {
            prompt: e.prompt,
            description: e.description,
            subagent_type: e.subagentType,
            ...(e.model !== undefined ? { model: e.model } : {}),
          },
          e.cwd ?? (await $.session.cwd().catch(() => null)),
        )

        if (decision !== null) {
          spawn = { ...e, model: decision.model, prompt: decision.prompt ?? e.prompt }
          entry = { description: e.description, subagentType: e.subagentType, effort: decision.effort }
          pending.push(entry)
          try {
            lastSubagent = await refreshLabels($)
          } catch {
            // No log yet.
          }
          lastSubagent = `${capital(decision.model)} · ${decision.effort} effort`
          $.ui.status(lastSubagent)
        }
      } catch {
        // No router answer: the subagent starts as asked.
      }
    }

    const started = await next(spawn)
    const agentId = started.agentId

    if (entry !== null) {
      const at = pending.indexOf(entry)
      if (at >= 0) pending.splice(at, 1)
      if (agentId !== undefined) efforts.set(agentId, entry.effort)
    }

    if (agentId !== undefined) {
      // A message sent to a running subagent starts it again with that
      // message as its prompt: keep the key of its first brief.
      const known = (await read($, agentKeys))[agentId]
      const key = known ?? briefKey(e.prompt)

      if (known === undefined) {
        await update($, agentKeys, k => ({ ...k, [agentId]: key }))
      }

      runs.set(agentId, {
        key,
        subagentType: e.subagentType,
        model: started.model,
        steps: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      })
    }

    return started
    // This mod only watches. If it fails, the subagent starts untouched.
  }).catch(($, e, next) => next(e))

  // Each model request: a routed subagent runs at the router's effort, and a
  // tracked subagent's tokens are added up.
  // The main session. Sessions you start yourself are coordinators and keep
  // their own model (Opus). A worker session (in a git worktree, or given
  // its task by another session, as a desktop linked session is) is routed
  // once, from its first task, for its whole life: one model keeps the
  // prompt cache.
  let firstOrigin: string | undefined

  on('prompt.submit', ($, e, next) => {
    if (firstOrigin === undefined && !e.isMeta) {
      firstOrigin = e.origin.kind
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && e.text.trim() !== '' && (await read($, mainRoute)).role === 'undecided') {
      try {
        const isWorker =
          (firstOrigin !== undefined && PEER_ORIGINS.includes(firstOrigin)) || (await isLinkedWorktree($))
        let route: MainRoute = { role: 'coordinator' }

        if (isWorker) {
          const decision = await askRouter(
            $,
            { prompt: e.text, description: 'Main session task', subagent_type: 'main-session' },
            await $.session.cwd().catch(() => null),
          )

          if (decision !== null) {
            route = { role: 'worker', model: decision.model, effort: decision.effort }
            $.ui.status(`This session: ${capital(decision.model)} · ${decision.effort} effort`)
          }
        }

        await update($, mainRoute, () => route)
      } catch {
        // Undecided: the session keeps its own model, and the next turn asks again.
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    let effort = e.agentId !== undefined ? efforts.get(e.agentId) : undefined

    if (e.agentId !== undefined && effort === undefined && pending.length > 0) {
      const info = (await $.agent.list()).find(a => a.id === e.agentId)
      const at = pending.findIndex(p => p.description === info?.description && p.subagentType === info?.type)

      const found = pending[at]

      if (found !== undefined) {
        effort = found.effort
        efforts.set(e.agentId, effort)
        pending.splice(at, 1)
      }
    }

    // A worker main session runs on the model and effort chosen at its start.
    const main = e.agentId === undefined ? await read($, mainRoute) : undefined
    const model = main?.role === 'worker' ? main.model : e.model

    if (main?.role === 'worker') {
      effort = main.effort
    }

    const step =
      (effort !== undefined && e.effort !== effort) || model !== e.model
        ? { ...e, model, ...(effort !== undefined ? { effort: effort as typeof e.effort } : {}) }
        : e
    const result = yield* next(step)
    const id = e.agentId ?? MAIN

    // The main session is tracked too, so a session's whole cost is in the log.
    if (id === MAIN && !runs.has(MAIN)) {
      runs.set(MAIN, { key: '', subagentType: 'main', model: step.model, steps: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    }

    const run = runs.get(id)

    if (run !== undefined && result?.usage) {
      run.steps += 1
      run.model = result.usage.model
      run.input += result.usage.input_tokens
      run.output += result.usage.output_tokens
      run.cacheRead += result.usage.cache_read_input_tokens
      run.cacheWrite += result.usage.cache_creation_input_tokens
    }

    return result
  })

  // A turn ended, the main session's or a subagent's: write its line, then
  // count afresh for the next turn.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const id = e.agentId ?? MAIN
    const run = runs.get(id)

    if (run !== undefined && run.steps > 0) {
      try {
        await appendLine($, await sessionFile($, 'outcomes'), {
          type: id === MAIN ? 'main-turn' : 'outcome',
          session: await $.session.id(),
          project: await projectName($),
          ...(id === MAIN ? {} : { agentId: e.agentId }),
          key: run.key,
          subagentType: run.subagentType,
          model: run.model,
          reason: e.reason,
          durationMs: e.durationMs,
          steps: run.steps,
          tokens: { input: run.input, output: run.output, cacheRead: run.cacheRead, cacheWrite: run.cacheWrite },
        })
      } catch {
        // Logging is best effort.
      }

      runs.set(id, { ...run, steps: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    }

    return result
  })

  on('session.start', async ($, e, next) => {
    try {
      lastSubagent = await refreshLabels($)
    } catch {
      lastSubagent = NOTHING_YET
    }

    $.ui.status(lastSubagent)

    return next(e)
  })

  // The router decides while the call is on its way down, so read its log after.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)

    try {
      lastSubagent = await refreshLabels($)
      $.ui.status(lastSubagent)
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
    const key = briefKey(prompt)
    const label = (await read($, labels))[key]

    if (label === undefined) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const rated = (await read($, ratings))[key]

    const rate = async (rating: Rating) => {
      await update($, ratings, r => ({ ...r, [key]: rating }))
      await appendLine($, await sessionFile($, 'ratings'), {
        type: 'rating',
        session: await $.session.id(),
        key,
        rating,
      })
    }

    // Rate once the subagent has finished; a running or failed one is not rated.
    const isRateable = !e.props.isRunning && !e.props.isErrored && !e.props.isInterrupted

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Text dimColor>Model router: {label}</Text>
        {rated !== undefined ? (
          <Text dimColor>Your rating: {RATING_TEXT[rated]}</Text>
        ) : isRateable ? (
          <Box flexDirection="row">
            <Text dimColor>Rate this choice: </Text>
            <Button key="right" label="Right model" onPress={() => rate('right')} />
            <Button key="stronger" label="Needed stronger" onPress={() => rate('stronger')} />
            <Button key="cheaper" label="Could be cheaper" onPress={() => rate('cheaper')} />
          </Box>
        ) : null}
      </Box>
    )
  })
}

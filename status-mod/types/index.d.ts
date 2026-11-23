/** What the router decided, as one line of text, by the key of the brief it judged. */
export type Labels = Record<string, string>

/** How you rated the router's choice for a subagent, by the key of its brief. */
export type Rating = 'right' | 'stronger' | 'cheaper'
export type Ratings = Record<string, Rating>

/** The key of the brief each subagent was first started with, by agent id. */
export type AgentKeys = Record<string, string>

/**
 * The main session's role, decided once at its first task. A worker (a
 * session in a git worktree, or one another session gave its task) runs on
 * the model and effort the router chose; a coordinator keeps its own model.
 */
export type MainRoute =
  | { role: 'undecided' }
  | { role: 'coordinator' }
  | { role: 'worker'; model: string; effort: string }

declare module 'claude-code' {
  interface PluginState {
    'router-status': { labels: Labels; ratings: Ratings; agentKeys: AgentKeys; mainRoute: MainRoute }
  }
}

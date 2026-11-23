/** What the router decided, as one line of text, by the key of the brief it judged. */
export type Labels = Record<string, string>

/** How you rated the router's choice for a subagent, by the key of its brief. */
export type Rating = 'right' | 'stronger' | 'cheaper'
export type Ratings = Record<string, Rating>

/** The key of the brief each subagent was first started with, by agent id. */
export type AgentKeys = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'router-status': { labels: Labels; ratings: Ratings; agentKeys: AgentKeys }
  }
}

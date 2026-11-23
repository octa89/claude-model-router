/** What the router decided, as one line of text, by the key of the brief it judged. */
export type Labels = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'router-status': { labels: Labels }
  }
}

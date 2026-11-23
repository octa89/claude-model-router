# claude-model-router

Picks a Claude model and effort level for each subagent that Claude Code starts, so routine work runs on a cheaper model and planning, hard work and reviews get a stronger one.

A small decision model, **Bison 1** (`baseten/bison-1`, through [OpenRouter's Decisions API](https://openrouter.ai/baseten/bison-1)), reads each subagent's brief and answers three typed questions in about a third of a second:

- **category:** which of ten kinds of work it is, with a probability for each;
- **difficulty:** easy, normal or hard;
- **high risk:** the probability that the task could cause damage that is hard to undo.

Fixed rules then turn those answers into a model and an effort level. The rules follow Anthropic's published guidance on choosing models and effort.

## Policy

**Fable 5.2 plans and reviews; the work itself goes to Opus 5.5 or lower.**

| Task | Easy | Normal | Hard |
|---|---|---|---|
| Label, extract, reformat | Sonnet low | Sonnet low | Sonnet medium |
| Simple chat | Sonnet low | Sonnet low | Sonnet medium |
| Search and read | Sonnet low | Sonnet low | Sonnet medium |
| Routine coding | Sonnet medium | Sonnet medium | Sonnet high |
| Hard coding | Sonnet high | Opus medium | Opus high |
| Research and analysis | Sonnet medium | Opus medium | Opus high |
| Long unattended work | Opus medium | Opus high | Opus high |
| Deep reasoning, design (planning) | Fable medium | Fable high | Fable high |
| Orchestrating other agents (planning) | Fable medium | Fable medium | Fable high |
| Review and verification | Fable medium | Fable high | Fable high |

Safety nets:

- **Unsure or unavailable classifier.** If Bison fails, no key is set, or the chosen category has a probability under 0.5, the subagent gets Opus at medium. Subagents are never blocked.
- **Risky work.** A risk probability of 0.4 or more means at least Opus at medium.
- **Fixed subagent types.** Subagents of type `Plan`, and any type with "review", "verif" or "audit" in its name, always get Fable.
- **The session's own choice wins.** A model and effort the session already set for a subagent are left alone.
- **Effort ceiling.** `xhigh` and `max` are never chosen by the rules.

Edit `ROUTES` in [router.mjs](router.mjs) to change the table.

## What you see

The `router-status` add-on for Claude Code shows the router's choices:

- **Status line** under the prompt box: the last choice, such as `Sonnet · low effort`.
- **Under each subagent's row:** `Model router: Sonnet · low effort · search_read, easy, 86% sure`.
- **Plan mode:** while the main session is in plan mode, its requests go to Fable 5.2 and the status line starts with `Plan mode: Fable`. When plan mode ends, the session goes back to its own model.

## Tuning the table

The router keeps a decision log you can tune the table from:

1. **Decisions.** `router.log` holds what the router chose for each subagent, and why.
2. **Outcomes.** When a subagent finishes, the add-on records its model, tokens, number of requests and time in `tuning/outcomes-<session>.jsonl`.
3. **Ratings.** Under each finished subagent's row there are three buttons: **Right model**, **Needed stronger**, **Could be cheaper**. Your answer goes to `tuning/ratings-<session>.jsonl`.

Then run:

```
node report.mjs            # everything so far
node report.mjs --days 7   # the last week
```

It shows one row per cell of the routing table: how many tasks it got, the average estimated cost and time, how you rated them, and a suggestion. Once a cell has 3 ratings, it suggests **raise one step** when a third say "needed stronger", and **lower one step** when half say "could be cheaper". Change the cell in `ROUTES` in [router.mjs](router.mjs) and keep rating.

Costs are estimates from token counts and the list prices in `report.mjs`. The brief's text is never stored. Both files stay on your machine and are ignored by git.

## Install

Needs Claude Code, Node 20 or newer, and an [OpenRouter](https://openrouter.ai) API key. Tested on Windows.

1. Clone the repository somewhere it can stay. The hook runs from this folder and writes its log here.

   ```
   git clone https://github.com/octa89/claude-model-router.git
   cd claude-model-router
   ```

2. Run the installer. It backs up your Claude Code user settings, adds the router's hook to them, and installs the status add-on. `--dry-run` shows the changes without making them.

   ```
   node install.mjs
   ```

3. Save your OpenRouter key as the `OPENROUTER_API_KEY` environment variable. On Windows, run `set-key.ps1`: it asks for the key with hidden typing, saves it, and runs one live test.

4. Start a new Claude Code session.

To remove it: `node install.mjs --uninstall`.

## Use

It runs by itself. To try the router by hand:

```
node router.mjs "Refactor the billing module across 6 files"
node router.mjs --image screenshot.png "Fix the problem shown here"
node router.mjs --escalate sonnet:high        # next step after a failed attempt
node recent.mjs                               # latest decisions as a table
node scenarios.mjs                            # 15 sample tasks through the live router
node --test                                   # tests, no network
```

Settings, all optional, as environment variables:

| Variable | Effect |
|---|---|
| `ROUTER_DISABLE=1` | Turns the router off, for example in one project's `.claude/settings.json` `env` block. |
| `ROUTER_CLASSIFIER_MODEL` | Another decision model in place of Bison 1. It must be served by `/api/alpha/decisions`. |
| `ROUTER_ALLOW_HAIKU=1` | Lets Haiku 5.5 take simple labelling and extraction work. |
| `ROUTER_AUDIO_CLASSIFIER_MODEL` | A decision model that accepts audio (Bison 1 reads text and images only), such as `cloudflare/clef-omni`. |

## Things to know

- **What leaves your machine.** Each subagent's brief is sent to OpenRouter and to Baseten, which hosts Bison 1. Your own prompts are not sent. Turn the router off in projects whose content must not leave.
- **Cost.** Bison 1 costs $0.10 per million input tokens and nothing for output; a decision costs about $0.00002.
- **Auto mode.** Auto mode does not run a tool call that a hook changed after its check. So in auto mode each subagent start shows one blocked row, then runs with the router's choice. Other permission modes don't have this.
- **Log.** `router.log` holds one line per decision: time, session id, project folder name, model, effort, category and probabilities. The brief's text is not logged. The file is ignored by git.
- **Alpha API.** OpenRouter's Decisions API is in alpha, so its format may change.
- **Switching models** restarts the prompt cache, so the first request after a switch costs more.

## Files

| File | What it is |
|---|---|
| `router.mjs` | The classifier call and the routing rules. Also a command-line tool. |
| `hook.mjs` | The Claude Code `PreToolUse` hook that routes each subagent. |
| `status-mod/` | The `router-status` add-on: status line, row labels, plan-mode switch. |
| `install.mjs` | Installer and uninstaller. |
| `recent.mjs` | Prints the latest decisions. |
| `report.mjs` | Tuning report: cost, time and ratings per routing-table cell. |
| `scenarios.mjs` | Runs sample tasks through the live router. |
| `set-key.ps1` | Saves your OpenRouter key on Windows and runs a live test. |
| `*.test.mjs` | Tests. |

## License

MIT

# claude-model-router

Picks a Claude model and effort level for each subagent that Claude Code starts. The main session is the coordinator on Opus 5.5; small jobs go to Sonnet 5.5, deep work to Fable 5.2, and planning and reviews stay on Opus.

The routing runs inside the `router-status` mod, at the moment a subagent starts (its `agent.spawn` hook sets the model and brief, its `turn.step` hook sets the effort of each of the subagent's requests). It does not use a PreToolUse hook: a hook that rewrites the Agent call makes auto mode send the call back once. Sessions are routed too, in every Claude Code app (terminal, desktop, IDE), because the mod loads wherever your user plugins do:

- **Coordinator sessions**, the ones you start yourself in a project's main folder, keep your default model (Opus 5.5).
- **Worker sessions**, ones opened in a git worktree or given their task by another session (a desktop linked session, say), are routed once from their first task: the router picks their model and effort for the whole session, so the prompt cache holds. The status line shows `This session: Sonnet · high effort`.

A small decision model, **Bison 1** (`baseten/bison-1`, through [OpenRouter's Decisions API](https://openrouter.ai/baseten/bison-1)), reads each subagent's brief and answers three typed questions in about a third of a second:

- **category:** which of ten kinds of work it is, with a probability for each;
- **difficulty:** easy, normal or hard;
- **high risk:** the probability that the task could cause damage that is hard to undo.

Fixed rules then turn those answers into a model and an effort level. The rules follow Anthropic's published guidance on choosing models and effort.

## Policy

**Opus 5.5 coordinates (main session, planning, reviews); Sonnet 5.5 does the small and everyday jobs; Fable 5.2 does the deep work.** Effort levels follow each model's guide: Sonnet low for chat and search and medium for coding; Opus medium (its default, which beats Opus 5 at high); Fable high for hard work.

| Task | Easy | Normal | Hard |
|---|---|---|---|
| Label, extract, reformat | Sonnet low | Sonnet low | Sonnet medium |
| Simple chat | Sonnet low | Sonnet low | Sonnet medium |
| Search and read | Sonnet low | Sonnet low | Sonnet medium |
| Routine coding | Sonnet medium | Sonnet medium | Sonnet high |
| Hard coding | Sonnet high | Fable medium | Fable high |
| Research and analysis | Sonnet medium | Sonnet high | Fable high |
| Long unattended work | Sonnet medium | Sonnet high | Fable high |
| Deep reasoning, design | Fable medium | Fable high | Fable high |
| Orchestrating other agents | Opus medium | Opus medium | Opus high |
| Review and verification | Opus medium | Opus high | Opus high |

A Fable brief below high effort gets a short "finish the whole task" section added: the Fable 5.2 guide says it stops early more often at low and medium.

Safety nets:

- **Unsure or unavailable classifier.** If Bison fails, no key is set, or the chosen category has a probability under 0.5, the subagent gets Sonnet at high; if it fails, it is retried once on Opus. Subagents are never blocked.
- **Risky work.** A risk probability of 0.4 or more means at least Opus at medium.
- **Fixed routes by type.** `Explore`, `web-fetch`, `claude-code-guide`, `statusline-setup`, `caveman:cavecrew-investigator` and `codex:codex-rescue` always get Sonnet at low, without asking the classifier: they only read, or relay Codex's work.
- **Fixed subagent types.** Subagents of type `Plan`, and any type with "review", "verif" or "audit" in its name, always get Opus, the coordinator.
- **The session's own choice wins.** A model and effort the session already set for a subagent are left alone.
- **Effort ceiling.** `xhigh` and `max` are never chosen by the rules.

Edit `ROUTES` in [router.mjs](router.mjs) to change the table.

## What you see

The `router-status` add-on for Claude Code shows the router's choices:

- **Status line** under the prompt box: the last choice, such as `Sonnet · low effort`.
- **Under each subagent's row:** `Model router: Sonnet · low effort · search_read, easy, 86% sure`.

## Tuning the table

The router keeps a decision log you can tune the table from:

1. **Decisions.** `router.log` holds what the router chose for each subagent, and why.
2. **Outcomes.** When a subagent finishes, the add-on records its model, tokens, number of requests and time in `tuning/outcomes-<session>.jsonl`.
3. **Ratings.** Under each finished subagent's row there are three buttons: **Right model**, **Needed stronger**, **Could be cheaper**. Your answer goes to `tuning/ratings-<session>.jsonl`.

4. **Retries.** Sessions are told to re-run a subagent that ran on Sonnet or Haiku once on Opus when it fails a check they can see (tests, build, a plainly wrong result). The hook logs that second call as a retry, and the report counts it as "needed stronger" without you rating anything; the retry's cost is charged to the first choice.
5. **The main session.** The add-on also logs each main-session turn (model, tokens, time), so a session's whole cost shows, not only its subagents'. Each line names its session and project folder, and decision lines carry the Agent call's short title.

Then run:

```
node report.mjs                         # everything so far
node report.mjs --days 7                # the last week
node report.mjs --project MagmaStudio   # one project folder, with a per-session breakdown
node recent.mjs 30 --project MagmaStudio
```

It shows one row per cell of the routing table: how many tasks it got, the average estimated cost and time, how you rated them, and a suggestion. Once a cell has 3 ratings, it suggests **raise one step** when a third say "needed stronger", and **lower one step** when half say "could be cheaper". Change the cell in `ROUTES` in [router.mjs](router.mjs) and keep rating.

Costs are estimates from token counts and the list prices in `report.mjs`. The brief's text is never stored. Both files stay on your machine and are ignored by git.

## Evaluating the router

Two evaluations live in `eval/`. Their results go to `eval/results/` and `eval/runs/`, which git ignores.

**Level 1: is the classifier right, honest and fast?** `eval/classifier-set.json` holds 66 hand-labelled task briefs. This sends each to the classifier twice (about $0.003 in all) and reports accuracy, the most common mix-ups, calibration, risk recall at several thresholds, where the router then sends each task compared with the labels, stability, and latency:

```
node eval/classifier.mjs
```

**Level 2: does routing beat Anthropic's default on real work?** `eval/e2e/` holds a small project with bugs and unfinished functions, eight tasks, and hidden checks the model never sees. Each task runs in a fresh copy of the project with headless Claude Code under four setups:

| Setup | Model |
|---|---|
| `baseline` | Opus 5.5 at medium, Anthropic's recommended starting point |
| `router` | the router's pick for the task |
| `fable` | Fable 5.2 at high, the quality ceiling |
| `random` | the router's own picks shuffled between tasks: same mix, no judgement |

```
node eval/e2e/run.mjs --dry-run           # the plan and the router's picks; spends nothing
node eval/e2e/run.mjs --budget-usd 15     # run it; stops starting runs past the budget
node eval/e2e/run.mjs --report <file>     # report an earlier run again
```

It reports pass rate, cost per solved task and time for each setup, and the router against the others. The router earns its place only if it matches the baseline's pass rate for less money, and beats `random`. Eight tasks is a start: add tasks from your own work to `tasks.json` (with a hidden check in `hidden/` and, ideally, a correct answer in `reference/`), and use `--repeats` before acting on small differences. `node --test` checks that every hidden check fails on the untouched project and passes on the reference answer.

## Install

Needs Claude Code, Node 20 or newer, and an [OpenRouter](https://openrouter.ai) API key. Tested on Windows.

1. Clone the repository somewhere it can stay. The mod runs the router (hook.mjs) from this folder and writes its log here.

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
| `ROUTER_BACKUP_CLASSIFIER` | The classifier asked when the main one fails (rate limit, server error, timeout). Default `typesafe/jev-1.14`, which runs on a different host; `off` turns the backup off. |
| `ROUTER_BACKUP_API_KEY` | Optional second OpenRouter key for the backup, to keep its spend apart. Without it the backup uses `OPENROUTER_API_KEY`. |
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
| `hook.mjs` | The router the mod runs before each subagent starts (it reads a PreToolUse-shaped event on stdin and prints the choice). |
| `status-mod/` | The `router-status` add-on: status line, row labels, plan-mode switch. |
| `install.mjs` | Installer and uninstaller. |
| `recent.mjs` | Prints the latest decisions. |
| `report.mjs` | Tuning report: cost, time and ratings per routing-table cell. |
| `scenarios.mjs` | Runs sample tasks through the live router. |
| `set-key.ps1` | Saves your OpenRouter key on Windows and runs a live test. |
| `*.test.mjs` | Tests. |

## License

MIT

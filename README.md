# classify-plugin

A Claude Code plugin (works with the Claude Code plugin format; opencode also loads it) that
classifies every line sent to the LLM — human prompts and agent tool input/output — into
configurable categories via [TypeSafe AI Jev](https://docs.typesafe.ai), and keeps persistent
per-category counts in SQLite.

Each classification stores: source (human/agent), category, probability, confidence,
noise score, token counts (input/output/cached) and cost, timestamp, project, session,
hook event and tool — plus a top-2 record for uncertain rows.

## Getting Started

1. **Install the plugin.** Pick one:

   **From npm** (published as [`classify-plugin`](https://www.npmjs.com/package/classify-plugin)):
   add this to `~/.claude/settings.json`:
   ```json
   {
     "extraKnownMarketplaces": {
       "classify-plugin": {
         "source": { "source": "npm", "package": "classify-plugin" }
       }
     },
     "enabledPlugins": {
       "classify@classify-plugin": true
     }
   }
   ```

   **From GitHub:** `claude plugin marketplace add jexp/classify-plugin` then enable `classify@classify-plugin`.

   **From a local checkout:** `claude plugin add /path/to/classify-plugin`.
   On first enable, Claude Code asks for the plugin's configuration (or edit it later in `/config`):
   - **Provider** — `typesafe` (default), `openrouter`, or `vercel` (AI Gateway)
   - **API key** — stored securely in the macOS Keychain, never in settings files
   - **Categories** — one entry per line, format `name|short description` (empty = built-in defaults)
   - **Confidence threshold / Top-2 gap** — the 'uncertain' rules (defaults 0.5 / 0.05)
2. Alternatively just export the provider key yourself and skip the UI:
   `TYPESAFE_API_KEY` (or `OPENROUTER_API_KEY` / `AI_GATEWAY_API_KEY`).
3. **Use it.** Every prompt you type and every tool call the agent makes is now classified in
   the background (never blocking) and written to `~/.classify-plugin/classify.db`.
4. **Look at your numbers:**
   ```bash
   node scripts/stats.js                              # all projects, 1/7/30/90-day windows
   node scripts/stats.js --project my-app             # one project
   node scripts/stats.js --metric tokens              # size the pyramid by token spend, not counts
   node scripts/stats.js --list-projects              # what has data
   ```
   or from inside a session: `/classify-stats`, `/classify-stats --project my-app --metric tokens`.
5. **Backfill history** — classify the Claude Code session logs you already have:
   ```bash
   node scripts/backfill.js ~/code/my-app --dry-run --limit 20   # peek first
   node scripts/backfill.js ~/code/my-app                        # classify everything (safe to re-run)
   ```
   or `/classify-backfill ~/code/my-app`.
6. Configure further at any time: `/classify-config` shows the effective config; a JSON file at
   `~/.classify-plugin/config.json` or `<project>/.claude/classify.config.json` overrides defaults
   (UI settings win over both).

### Example: `/classify-stats` output

```
Classify stats (all projects) - 2026-09-24
Metric: tokens | Total rows: 7d=139 | Total tokens: 7d=93.7k

-- last 7 days (tokens) --
feature_work                             █ 1.4k |  34k ████████████████████████   30%
bugfix                                   █ 1.1k |  25k ██████████████████         30%
testing                                  █  750 |  22k ███████████████            30%
planning                                 █ 1.6k | 6.4k █████                      26%
question                                 █  900 | 1.6k █                          25%
                                        < human | agent >

-- token sum per window (h/a = human/agent) --
category                1d      7d     30d     90d   noise
----------------------------------------------------------
bugfix                 1/2    7/19    7/31    7/31     30%
feature_work           2/3    9/24    9/42    9/42     22%
planning               2/1    11/7    11/8    11/8     26%
testing                1/2    5/15    5/27    5/27     30%
...
``` 

Human activity grows to the left, agent activity to the right — the age-pyramid view of where
your interactions actually go, plus noise averages per category.

## Setup

1. `npm install` (installs `@typesafe-ai/sdk`; needs Node ≥ 22.5)
2. Provide an API key via environment variable (never written to plugin files):
   - **typesafe** (default): `TYPESAFE_API_KEY`
   - **openrouter**: `OPENROUTER_API_KEY` (routes Jev through OpenRouter, billed there)
   - **vercel** (AI Gateway): `AI_GATEWAY_API_KEY` (billed through the gateway)
3. Optional config at `~/.classify-plugin/config.json` or `<project>/.claude/classify.config.json`:

```json
{
  "provider": "typesafe",
  "model": "jev-latest",
  "confidenceThreshold": 0.5,
  "top2Gap": 0.05,
  "dbPath": "~/.classify-plugin/classify.db",
  "categories": {
    "planning": "Breaking down work, proposing steps or approaches",
    "feature_work": "Implementing new functionality",
    "bugfix": "Fixing a concrete defect",
    "debugging": "Investigating causes of errors",
    "triage": "Reviewing issues/PRs to decide priority or next action",
    "refactoring": "Restructuring code without changing behavior",
    "testing": "Writing or running tests",
    "documentation": "Writing or updating docs",
    "code_review": "Reviewing a diff or PR",
    "exploration": "Searching/reading to understand, no change made",
    "configuration": "Tooling, build, CI, dependency, environment setup",
    "question": "Asking or answering a factual question",
    "discussion": "Non-task conversation and chatter"
  }
}
```

## How it works

- **Hooks** (`hooks/hooks.json`): `UserPromptSubmit` (human), `PreToolUse`/`PostToolUse`
  (agent tool calls), `SessionStart`, `SubagentStop`. The hook entry writes the payload to a
  queue dir (`~/.classify-plugin/queue`) and spawns a detached worker — the hook itself never
  blocks the agent. The worker makes **one** Jev `systemOne` call per line with two questions:
  - `choice` over your categories (returns per-category probabilities + confidence)
  - `score` for the noise level (how much of the text is verbal noise, 0–100)
- **Uncertainty**: if confidence < 0.5 or the top-2 probability gap < 0.05, the row is recorded
  as category `uncertain` with `details` containing the reason and the top-2 candidates
  (`category2`/`probability2` are real columns, so analytics can re-bucket without JSON parsing).
- Failures are recorded as category `error` (with the message) — nothing is silently lost.

## Commands

- `/classify-stats [--project <name>]` — counts for the last 1/7/30/90 days as an
  age-pyramid chart (human left, agent right, centered on a vertical axis) sized by counts or token sums, plus a table per window.
  Also runnable directly: `node scripts/stats.js --list-projects`
- `/classify-backfill <project> [--limit N] [--dry-run]` — parse existing Claude Code
  session logs (`~/.claude/projects/<slug>/*.jsonl`) for a project and classify them.
  Deduplicated by line id — safe to re-run.
- `/classify-config` — show the effective configuration.

## Storage

SQLite at `~/.classify-plugin/classify.db` (configurable). Schema is analytics-first:
composite index on `(category, source, ts)` and `(project, ts)`, ISO-8601 UTC timestamps,
CHECK constraints on dimensions, partial unique index for backfill dedup.

## Tests

```bash
npm test
```

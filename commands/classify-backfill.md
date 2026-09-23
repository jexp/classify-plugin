---
description: Backfill classification data from existing Claude Code session logs for a project
argument-hint: <project-path-or-slug> [--limit N] [--dry-run]
---

Backfill session-log classifications for the current project (or the project the user named):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/backfill.js" $ARGUMENTS
```

If the user gave no argument, pass the current working directory path.
For a first look, suggest `--dry-run --limit 20`. Re-runs are safe (duplicates are skipped via line ids).
Report the number of items processed and any errors verbatim.

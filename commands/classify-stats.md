---
description: Render classification statistics (1/7/30/90 days, human vs agent pyramid + table)
argument-hint: [--project <name>] [--days 1,7,30,90]
---

Run the classify-plugin stats renderer and show its output verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/stats.js" $ARGUMENTS
```

If the user didn't pass a project filter, run it without arguments (all projects).
Optionally also run `node "${CLAUDE_PLUGIN_ROOT}/scripts/stats.js" --list-projects` first
so the user can see which projects have data. Present the output in a code block.

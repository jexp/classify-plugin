---
description: Show the effective classify-plugin configuration (provider, model, categories, thresholds, db path)
---

Show the effective configuration:

```bash
node -e "import('${CLAUDE_PLUGIN_ROOT}/src/config.js').then(m => { const c = m.loadConfig(); const creds = m.providerCredentials(c); console.log(JSON.stringify({...c, apiKeyPresent: !!creds.apiKey, baseURL: creds.baseURL}, null, 2)); })"
```

Present the result in a code block and explain:
- Config lookup order: `$CLAUDE_CLASSIFY_CONFIG` → `<project>/.claude/classify.config.json` → `~/.classify-plugin/config.json` → defaults
- Which env var provides the API key for the configured provider
- How to change categories (edit the categories object in the config file)

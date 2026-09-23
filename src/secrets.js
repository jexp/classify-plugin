import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Read a sensitive plugin option from Claude Code's own credential store, so
 * slash-command scripts (which do NOT get CLAUDE_PLUGIN_OPTION_* env vars like
 * hook processes do) can still use the Keychain-backed api_key.
 *
 * Store locations:
 *  - macOS: Keychain item "Claude Code-credentials" -> JSON blob with
 *    pluginSecrets["<plugin>@<marketplace>"][<key>]
 *  - other platforms / keychain rejection: ~/.claude/.credentials.json (same shape)
 */

const SECRET_ID = 'classify@classify-plugin'; // override: CLAUDE_CLASSIFY_SECRET_ID

function fromBlob(blob, key) {
  try {
    const secrets = JSON.parse(blob)?.pluginSecrets;
    if (!secrets) return null;
    const id = process.env.CLAUDE_CLASSIFY_SECRET_ID ?? SECRET_ID;
    return secrets[id]?.[key]
      // tolerate renamed marketplaces: any entry whose name contains 'classify'
      ?? Object.entries(secrets).find(([n]) => n.includes('classify'))?.[1]?.[key]
      ?? null;
  } catch {
    return null;
  }
}

export function readPluginSecret(key = 'api_key') {
  // 1. hook-process env var (documented mechanism)
  const envVal = process.env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`];
  if (envVal) return envVal;

  // 2. credentials file (non-macOS, or keychain fallback)
  try {
    const v = fromBlob(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'), key);
    if (v) return v;
  } catch { /* not present */ }

  // 3. macOS Keychain
  if (process.platform === 'darwin') {
    try {
      const blob = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
      return fromBlob(blob, key);
    } catch { /* item missing or locked */ }
  }
  return null;
}

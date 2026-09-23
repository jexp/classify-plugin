#!/usr/bin/env node
/**
 * Keeps the version in sync across the three places it must match:
 *   package.json (source of truth, bumped by `npm version`)
 *   .claude-plugin/plugin.json          (what `claude plugin update` compares)
 *   .claude-plugin/marketplace.json     (plugin entry version)
 * Run by npm's `version` lifecycle script, so `npm version patch` updates all three
 * inside the version commit.
 */
import fs from 'node:fs';

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const targets = ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'];

for (const t of targets) {
  const j = JSON.parse(fs.readFileSync(t, 'utf8'));
  if (j.name === 'classify') j.version = version;                    // plugin.json
  if (Array.isArray(j.plugins)) j.plugins = j.plugins.map((p) => ({ ...p, version })); // marketplace.json
  fs.writeFileSync(t, JSON.stringify(j, null, 2) + '\n');
  console.log(`${t} -> ${version}`);
}

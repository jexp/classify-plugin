#!/usr/bin/env node
/**
 * One-command release: npm run release [patch|minor|major]
 *   1. npm version <level> (bumps package.json, syncs plugin/marketplace versions, commits + tags)
 *   2. git push --follow-tags
 *   3. gh release create v<version> --generate-notes   (triggers the publish workflow -> staged npm release)
 * Afterwards: approve the staged release on npmjs.com (or `npm stage approve <id> --otp <code>`).
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';

const level = ['patch', 'minor', 'major'].includes(process.argv[2]) ? process.argv[2] : 'patch';

execSync(`npm version ${level} -m "release v%s"`, { stdio: 'inherit' });
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

execSync('git push --follow-tags', { stdio: 'inherit' });
execFileSync('gh', ['release', 'create', `v${version}`, '--generate-notes'], { stdio: 'inherit' });
console.log(`\nv${version} released. Watch CI: gh run watch; then approve the staged release on npmjs.com.`);

#!/usr/bin/env node
/**
 * Hook entry point. Reads the hook payload from stdin, writes it to the queue
 * directory, and spawns a detached worker that performs the API call + DB
 * insert. Exits immediately so the hook never blocks the agent.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const QUEUE_DIR = path.join(os.homedir(), '.classify-plugin', 'queue');

async function main() {
  const raw = await new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => resolve(buf), 3000).unref?.();
  });

  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }
  if (!payload || typeof payload !== 'object') process.exit(0);

  fs.mkdirSync(QUEUE_DIR, { recursive: true });
  const file = path.join(QUEUE_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(file, JSON.stringify(payload));

  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'worker.js')], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  process.exit(0);
}

main().catch(() => process.exit(0));

#!/usr/bin/env node
/**
 * Detached queue worker: processes every pending hook payload (classify via
 * Jev, insert into SQLite), then releases the lock. A lock older than 10 min
 * is considered stale (crashed worker) and is taken over.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { openDb, insertRecord } from '../src/store.js';
import { classifyText } from '../src/classify.js';
import { payloadToRecord, estimateTokens, preview } from '../src/events.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const QUEUE_DIR = path.join(os.homedir(), '.classify-plugin', 'queue');
const LOCK = path.join(QUEUE_DIR, '.lock');
const LOCK_STALE_MS = 10 * 60 * 1000;

function acquireLock() {
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true; } catch {}
  try {
    const stat = fs.statSync(LOCK);
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) { fs.rmSync(LOCK); return acquireLock(); }
  } catch { return acquireLock(); }
  return false;
}

async function main() {
  if (!acquireLock()) process.exit(0);
  try {
    const cfg = loadConfig();
    const db = openDb(cfg.dbPath);
    const files = fs.readdirSync(QUEUE_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();

    for (const f of files) {
      const file = path.join(QUEUE_DIR, f);
      let payload;
      try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fs.rmSync(file); continue; }

      const rec = payloadToRecord(payload);
      if (rec && rec.text && rec.text.trim()) {
        try {
          const r = await classifyText(rec.text, rec, { cfg });
          insertRecord(db, {
            ...rec,
            category: r.category,
            probability: r.probability,
            category2: r.category2,
            probability2: r.probability2,
            confidence: r.confidence,
            noise: r.noise,
            details: JSON.stringify(r.details),
            text_len: rec.text.length,
            tokens_in: r.usage.input_tokens ?? estimateTokens(rec.text),
            tokens_out: r.usage.output_tokens ?? null,
            tokens_cached: r.usage.cached_tokens ?? r.usage.cache_read_input_tokens ?? null,
            cost: r.usage.cost ?? null,
            tokens_estimated: r.usage.input_tokens ? 0 : 1,
            text_preview: preview(rec.text),
          });
        } catch (e) {
          // keep the record with category 'error' so nothing is silently lost
          insertRecord(db, {
            ...rec,
            category: 'error',
            details: JSON.stringify({ error: String(e?.message ?? e) }),
            text_len: rec.text.length,
            tokens_in: estimateTokens(rec.text),
            tokens_estimated: 1,
            text_preview: preview(rec.text),
          });
        }
      }
      fs.rmSync(file);
    }
  } catch { /* never propagate: worker is detached */ } finally {
    try { fs.rmSync(LOCK); } catch {}
  }
}

main();

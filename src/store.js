import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- canonical ISO-8601 UTC (T/Z, ms)
  project TEXT,
  session_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('human','agent')),
  hook_event TEXT NOT NULL,
  tool TEXT,
  category TEXT NOT NULL,         -- chosen category, or 'uncertain' / 'error'
  probability REAL,               -- probability of the top category
  category2 TEXT,                 -- second-ranked category (for uncertain-row analytics)
  probability2 REAL,
  confidence REAL,
  noise REAL CHECK (noise IS NULL OR (noise >= 0 AND noise <= 1)),
  details TEXT,                   -- JSON: full probabilities, noise levels, uncertain reason
  text_len INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  tokens_cached INTEGER,
  cost REAL,
  tokens_estimated INTEGER NOT NULL DEFAULT 0 CHECK (tokens_estimated IN (0,1)),
  line_id TEXT,                   -- backfill dedup key (session uuid + line index)
  text_preview TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_classifications_line_id ON classifications(line_id) WHERE line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_classifications_ts ON classifications(ts);
CREATE INDEX IF NOT EXISTS idx_classifications_cat_src_ts ON classifications(category, source, ts);
CREATE INDEX IF NOT EXISTS idx_classifications_project_ts ON classifications(project, ts);
CREATE INDEX IF NOT EXISTS idx_classifications_session ON classifications(session_id);
`;

/** Canonical ISO-8601 UTC cutoff for a window of N days (matches the ts column format). */
export function isoCutoff(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return db;
}

export function insertRecord(db, r) {
  try {
    db.prepare(`INSERT INTO classifications
      (ts, project, session_id, source, hook_event, tool, category, probability, category2, probability2,
       confidence, noise, details, text_len, tokens_in, tokens_out, tokens_cached, cost, tokens_estimated,
       line_id, text_preview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        r.ts ?? new Date().toISOString(),
        r.project ?? null,
        r.session_id ?? null,
        r.source,
        r.hook_event,
        r.tool ?? null,
        r.category,
        r.probability ?? null,
        r.category2 ?? null,
        r.probability2 ?? null,
        r.confidence ?? null,
        r.noise ?? null,
        r.details ?? null,
        r.text_len ?? null,
        r.tokens_in ?? null,
        r.tokens_out ?? null,
        r.tokens_cached ?? null,
        r.cost ?? null,
        r.tokens_estimated ? 1 : 0,
        r.line_id ?? null,
        r.text_preview ?? null,
      );
    return true;
  } catch (e) {
    // 2067 = SQLITE_CONSTRAINT; a duplicate line_id (backfill re-run) is not an error
    if (e.code === 'ERR_SQLITE_ERROR' && (e.errcode === 2067 || e.errcode === 19)) return false;
    throw e;
  }
}

const WINDOWS = { 1: 1, 7: 7, 30: 30, 90: 90 };

/** Aggregate counts per category × source × window, optionally filtered by project. */
export function statsByCategory(db, { days = [1, 7, 30, 90], project } = {}) {
  const projClause = project ? 'AND project = ?' : '';
  const out = {};
  for (const d of days) {
    const rows = db.prepare(`
      SELECT category, source,
             COUNT(*) AS n,
             SUM(COALESCE(tokens_in,0)+COALESCE(tokens_out,0)) AS tokens,
             AVG(noise) AS avg_noise,
             AVG(confidence) AS avg_confidence
      FROM classifications
      WHERE ts >= ? ${projClause}
      GROUP BY category, source`).all(isoCutoff(d), ...(project ? [project] : []));
    out[d] = rows;
  }
  return out;
}

export function knownProjects(db) {
  return db.prepare('SELECT DISTINCT project FROM classifications WHERE project IS NOT NULL').all().map((r) => r.project);
}

export function totalCount(db, { days, project } = {}) {
  const projClause = project ? 'AND project = ?' : '';
  return db.prepare(`SELECT COUNT(*) AS n FROM classifications WHERE ts >= ? ${projClause}`)
    .get(isoCutoff(days ?? 1), ...(project ? [project] : [])).n;
}

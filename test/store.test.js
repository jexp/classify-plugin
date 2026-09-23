import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, insertRecord, statsByCategory, totalCount, knownProjects } from '../src/store.js';

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classify-test-'));
  return { db: openDb(path.join(dir, 't.db')), dir };
}

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

test('insert + aggregate across windows, sources and projects', () => {
  const { db, dir } = tmpDb();
  const rec = (over) => insertRecord(db, {
    ts: iso(0), project: 'p1', session_id: 's1', source: 'human', hook_event: 'UserPromptSubmit',
    category: 'bugfix', probability: 0.9, confidence: 0.8, noise: 0.2, text_len: 100,
    tokens_in: 10, tokens_out: 2, ...over,
  });

  rec({});
  rec({ ts: iso(3), source: 'agent', hook_event: 'PreToolUse', tool: 'Bash', category: 'testing', tokens_in: 5 });
  rec({ ts: iso(40), project: 'p2', category: 'documentation' });
  rec({ category: 'uncertain', category2: 'testing', probability2: 0.44, noise: null });

  const stats = statsByCategory(db, { days: [1, 7, 30, 90] });
  assert.equal(stats[1].find((r) => r.category === 'bugfix' && r.source === 'human').n, 1);
  assert.equal(stats[1].find((r) => r.category === 'uncertain' && r.source === 'human').n, 1);
  assert.equal(stats[7].find((r) => r.category === 'testing' && r.source === 'agent').n, 1);
  assert.equal(stats[30].find((r) => r.category === 'documentation')?.n, undefined); // 40d old, outside 30d
  assert.equal(stats[90].find((r) => r.category === 'documentation').n, 1);

  assert.equal(totalCount(db, { days: 1 }), 2); // now + uncertain; 3d and 40d rows are outside
  assert.equal(totalCount(db, { days: 90, project: 'p2' }), 1);
  assert.deepEqual(knownProjects(db).sort(), ['p1', 'p2']);

  // noise average excludes nulls
  const bug = stats[1].find((r) => r.category === 'bugfix');
  assert.ok(Math.abs(bug.avg_noise - 0.2) < 1e-9);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('line_id dedup: second insert with same line_id is skipped', () => {
  const { db, dir } = tmpDb();
  const base = { ts: iso(0), source: 'human', hook_event: 'UserPromptSubmit', category: 'planning', line_id: 's1:u1:0' };
  assert.equal(insertRecord(db, base), true);
  assert.equal(insertRecord(db, { ...base, category: 'bugfix' }), false); // rejected by unique index
  assert.equal(totalCount(db, { days: 1 }), 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CHECK constraints reject invalid source', () => {
  const { db, dir } = tmpDb();
  assert.throws(() => insertRecord(db, { ts: iso(0), source: 'robot', hook_event: 'X', category: 'planning' }));
  fs.rmSync(dir, { recursive: true, force: true });
});

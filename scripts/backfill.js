#!/usr/bin/env node
/**
 * Backfill: parse existing Claude Code session logs (~/.claude/projects/<slug>/*.jsonl)
 * for a project and classify each human prompt / assistant message / tool call,
 * inserting into SQLite. Dedup via line_id = "<sessionId>:<uuid>:<idx>" so re-runs are safe.
 *
 * Usage: node backfill.js <project-path-or-slug> [--limit N] [--dry-run] [--db <path>]
 *   <project> can be the cwd-based slug (e.g. "-Users-mh-d-llm-classify-plugin") or a real path.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../src/config.js';
import { openDb, insertRecord } from '../src/store.js';
import { classifyText } from '../src/classify.js';
import { estimateTokens, preview } from '../src/events.js';

const LOG_ROOT = path.join(os.homedir(), '.claude', 'projects');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--db') args.db = argv[++i];
    else args.project = argv[i];
  }
  return args;
}

function slugFor(dir) {
  return String(dir).replace(/[/_.]/g, (c) => (c === '/' ? '-' : c === '.' ? '-D' : '-'));
}

function resolveLogDir(project) {
  if (fs.existsSync(project) && fs.statSync(project).isDirectory()) {
    return { dir: path.join(LOG_ROOT, slugFor(path.resolve(project))), project: path.basename(path.resolve(project)) };
  }
  const dir = path.join(LOG_ROOT, project);
  if (fs.existsSync(dir)) return { dir, project: project.split('-D-').pop() ?? project };
  // fuzzy match
  const cands = fs.readdirSync(LOG_ROOT).filter((d) => d.includes(project));
  if (cands.length === 1) return { dir: path.join(LOG_ROOT, cands[0]), project: project };
  throw new Error(`No session log dir found for '${project}'. Candidates: ${cands.join(', ') || 'none'}. Run with --help.`);
}

/** Extract classifiable items from one session-log JSONL file. */
export function* parseSessionLog(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const sessionId = e.sessionId ?? path.basename(filePath, '.jsonl');
    const lineId = `${sessionId}:${e.uuid ?? i}:${i}`;
    const ts = typeof e.timestamp === 'string' ? e.timestamp : new Date().toISOString();

    if (e.type === 'user' && e.message) {
      const content = e.message.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
          : '';
      // skip tool results surfaced as user messages and meta entries
      const isToolResult = Array.isArray(content) && content.some((c) => c.type === 'tool_result');
      if (text.trim() && !isToolResult && !e.isMeta) {
        yield { source: 'human', hook_event: 'UserPromptSubmit', text, ts, lineId, sessionId };
      }
    } else if (e.type === 'assistant' && e.message?.content) {
      const parts = e.message.content;
      const texts = Array.isArray(parts) ? parts.filter((p) => p.type === 'text').map((p) => p.text) : [];
      const tools = Array.isArray(parts) ? parts.filter((p) => p.type === 'tool_use') : [];
      const text = texts.join('\n');
      if (text.trim()) {
        yield { source: 'agent', hook_event: 'AssistantMessage', text, ts, lineId, sessionId };
      }
      for (const t of tools) {
        yield {
          source: 'agent', hook_event: 'PreToolUse', tool: t.name,
          text: `${t.name}: ${JSON.stringify(t.input ?? {}).slice(0, 4000)}`,
          ts, lineId: `${lineId}:${t.name}`, sessionId,
        };
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.project) {
    console.log('Usage: node backfill.js <project-path-or-slug> [--limit N] [--dry-run] [--db <path>]');
    process.exit(2);
  }
  const { dir, project } = resolveLogDir(args.project);
  const cfg = loadConfig();
  const db = openDb(args.db ?? cfg.dbPath);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  console.log(`Backfilling ${files.length} session log(s) from ${dir} (project: ${project})${args.dryRun ? ' — DRY RUN' : ''}`);

  let n = 0;
  outer:
  for (const f of files) {
    for (const item of parseSessionLog(path.join(dir, f))) {
      if (args.limit && n >= args.limit) break outer;
      n++;
      if (args.dryRun) {
        console.log(`[dry] ${item.ts} ${item.source} ${item.hook_event}${item.tool ? `(${item.tool})` : ''}: ${preview(item.text, 80)}`);
        continue;
      }
      try {
        const r = await classifyText(item.text, item, { cfg });
        const ok = insertRecord(db, {
          ...item,
          project,
          session_id: item.sessionId,
          category: r.category,
          probability: r.probability,
          category2: r.category2,
          probability2: r.probability2,
          confidence: r.confidence,
          noise: r.noise,
          details: JSON.stringify(r.details),
          text_len: item.text.length,
          tokens_in: r.usage.input_tokens ?? estimateTokens(item.text),
          tokens_out: r.usage.output_tokens ?? null,
          cost: r.usage.cost ?? null,
          tokens_estimated: r.usage.input_tokens ? 0 : 1,
          line_id: item.lineId,
          text_preview: preview(item.text),
        });
        process.stdout.write(`\r${n} processed (${ok ? 'inserted' : 'dup'})   `);
      } catch (e) {
        console.error(`\nFailed on ${item.lineId}: ${e.message}`);
      }
    }
  }
  console.log(`\nDone: ${n} items${args.dryRun ? ' (dry run, nothing written)' : ''}.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

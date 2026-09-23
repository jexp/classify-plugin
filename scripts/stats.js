#!/usr/bin/env node
/**
 * Render classification statistics for 1/7/30/90-day windows:
 * an age-pyramid chart (human left, agent right) per window plus a summary table.
 *
 * Usage: node stats.js [--project <name>] [--days 1,7,30,90] [--metric count|tokens]
 *                      [--db <path>] [--list-projects]
 */
import { loadConfig } from '../src/config.js';
import { openDb, statsByCategory, knownProjects, totalCount } from '../src/store.js';

const CAT_WIDTH = 18;
const HALF_WIDTH = 24;
const COUNT_WIDTH = 4; // fits up to 4 digits; larger values are abbreviated

/** Compact number, always <= 4 chars: 999 -> '999', 1234 -> '1.2k', 67200 -> '67k', 1600000 -> '1.6M'. */
function fmt(n) {
  n = n ?? 0;
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + 'k';   // 1.0k .. 9.9k
  if (n < 1000000) return Math.round(n / 1000) + 'k';  // 10k .. 999k
  if (n < 100000000) return (n / 1000000).toFixed(1) + 'M'; // 1.0M .. 99.9M
  return Math.round(n / 1000000) + 'M';
}

function bar(n, max, width, ch = '█') {
  if (!max) return '';
  const len = Math.round((n / max) * width);
  return ch.repeat(len);
}

function pad(s, n) { return String(s).padEnd(n); }
function padStart(s, n) { return String(s).padStart(n); }

function parseArgs(argv) {
  const args = { days: [1, 7, 30, 90], metric: 'count' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--project') args.project = argv[++i];
    else if (argv[i] === '--days') args.days = argv[++i].split(',').map(Number);
    else if (argv[i] === '--metric') args.metric = argv[++i];
    else if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--list-projects') args.listProjects = true;
  }
  if (!['count', 'tokens'].includes(args.metric)) {
    console.error(`Unknown metric '${args.metric}' (expected count or tokens)`);
    process.exit(2);
  }
  return args;
}

function renderPyramid(title, rows, metric) {
  // True age-pyramid layout: central axis, human bar grows right-aligned toward
  // the axis from the left, agent bar grows left-aligned away from it to the right.
  const val = (r) => (metric === 'tokens' ? r.tokens : r[metric === 'tokens' ? 'tokens' : 'count']);
  const max = Math.max(1, ...rows.flatMap((r) => [val(r.human), val(r.agent)]));
  const lines = ['', `-- ${title} --`];
  for (const r of rows) {
    lines.push(
      pad(r.category, CAT_WIDTH) +
      padStart(bar(val(r.human), max, HALF_WIDTH), HALF_WIDTH) + ' ' + padStart(fmt(val(r.human)), COUNT_WIDTH) +
      ' | ' +
      padStart(fmt(val(r.agent)), COUNT_WIDTH) + ' ' + pad(bar(val(r.agent), max, HALF_WIDTH), HALF_WIDTH) +
      '  ' + padStart(r.avg_noise != null ? `${Math.round(r.avg_noise * 100)}%` : '-', 4),
    );
  }
  // centered legend under the pyramid, aligned with the row axis
  lines.push(
    pad('', CAT_WIDTH) +
    padStart('< human', HALF_WIDTH + COUNT_WIDTH + 1) + ' | ' +
    pad('agent >', HALF_WIDTH + COUNT_WIDTH + 1),
  );
  return lines.join('\n');
}

function renderTable(days, byCat, metric) {
  const categories = [...new Set(days.flatMap((d) => byCat[d].map((r) => r.category)))].sort();
  const head = `${pad('category', CAT_WIDTH)}${days.map((d) => padStart(`${d}d`, 8)).join('')}   ${pad('noise', 5)}`;
  const lines = ['', `-- ${metric === 'tokens' ? 'token sum' : 'counts'} per window (h/a = human/agent) --`, head, '-'.repeat(head.length)];
  const noiseAvg = {};
  for (const d of days) for (const r of byCat[d]) {
    noiseAvg[r.category] ??= { sum: 0, n: 0 };
    if (r.avg_noise != null) { noiseAvg[r.category].sum += r.avg_noise * r.n; noiseAvg[r.category].n += r.n; }
  }
  for (const cat of categories) {
    const cells = days.map((d) => {
      const h = byCat[d].find((r) => r.category === cat && r.source === 'human');
      const a = byCat[d].find((r) => r.category === cat && r.source === 'agent');
      const hv = h ? (metric === 'tokens' ? h.tokens : h.n) : 0;
      const av = a ? (metric === 'tokens' ? a.tokens : a.n) : 0;
      return padStart(`${fmt(hv)}/${fmt(av)}`, 8);
    }).join('');
    const na = noiseAvg[cat]?.n ? `${Math.round((noiseAvg[cat].sum / noiseAvg[cat].n) * 100)}%` : '-';
    lines.push(`${pad(cat, CAT_WIDTH)}${cells}   ${padStart(na, 5)}`);
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  const cfg = loadConfig();
  const db = openDb(args.db ?? cfg.dbPath);

  if (args.listProjects) {
    console.log('Projects with data:');
    for (const p of knownProjects(db)) console.log(`  ${p}  (${totalCount(db, { days: 90, project: p })} rows in 90d)`);
    return;
  }

  const byCat = statsByCategory(db, { days: args.days, project: args.project });
  const total = Object.fromEntries(args.days.map((d) => [d, totalCount(db, { days: d, project: args.project })]));
  const tokTotal = Object.fromEntries(args.days.map((d) => [
    d, byCat[d].reduce((s, r) => s + (r.tokens ?? 0), 0),
  ]));

  const header = `Classify stats${args.project ? ` - project: ${args.project}` : ' (all projects)'} - ${new Date().toISOString().slice(0, 10)}`
    + `\nMetric: ${args.metric} | Total rows: ${args.days.map((d) => `${d}d=${fmt(total[d])}`).join('  ')}`
    + ` | Total tokens: ${args.days.map((d) => `${d}d=${fmt(tokTotal[d])}`).join('  ')}`;

  // pyramids per window
  for (const d of args.days) {
    const cats = {};
    for (const r of byCat[d]) {
      cats[r.category] ??= { category: r.category, human: { count: 0, tokens: 0 }, agent: { count: 0, tokens: 0 }, noiseSum: 0, noiseN: 0 };
      cats[r.category][r.source].count += r.n;
      cats[r.category][r.source].tokens += r.tokens ?? 0;
      if (r.avg_noise != null) { cats[r.category].noiseSum += r.avg_noise * r.n; cats[r.category].noiseN += r.n; }
    }
    const rows = Object.values(cats)
      .map((c) => ({
        category: c.category,
        human: { count: c.human.count, tokens: c.human.tokens },
        agent: { count: c.agent.count, tokens: c.agent.tokens },
        avg_noise: c.noiseN ? c.noiseSum / c.noiseN : null,
      }))
      .sort((a, b) => (b.human.count + b.agent.count) - (a.human.count + a.agent.count));
    if (rows.length) console.log(renderPyramid(`last ${d} day${d > 1 ? 's' : ''}${args.metric === 'tokens' ? ' (tokens)' : ''}`, rows, args.metric));
  }

  console.log(renderTable(args.days, byCat, args.metric));
  console.log(header);
}

main();

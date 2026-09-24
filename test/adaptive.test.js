import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, adaptiveClassify } from '../src/adaptive.js';
import { DEFAULTS } from '../src/config.js';

const cfg = { ...DEFAULTS };

test('chunkText: short text is one chunk; long text splits at whitespace', () => {
  assert.deepEqual(chunkText('short', 200), ['short']);
  assert.equal(chunkText('', 200).length, 0);
  const long = ('word '.repeat(400)).trim(); // 2000 chars
  const parts = chunkText(long, 200);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= 810); // ~800 chars + slack
  assert.equal(parts.join(' ').replace(/\s+/g, ' ').trim(), long);
});

const answer = (probs, noise = 0.2, tokens = 100) => ({
  category: Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0],
  probability: Math.max(...Object.values(probs)),
  noise,
  details: { probabilities: probs, confidence: 0.8 },
  usage: { input_tokens: tokens, output_tokens: 5 },
});

const classifyLog = (results) => {
  const calls = [];
  return {
    calls,
    classify: async (chunk) => { calls.push(chunk); return results[calls.length - 1]; },
  };
};

test('adaptive: decisive first chunk stops after one call', async () => {
  const { classify, calls } = classifyLog([
    answer({ bugfix: 0.92, testing: 0.05 }),
  ]);
  const r = await adaptiveClassify('x'.repeat(5000), {}, { cfg, classify });
  assert.equal(calls.length, 1);
  assert.equal(r.category, 'bugfix');
  assert.equal(r.details.chunks, 1);
  assert.ok(r.details.adaptive);
  assert.equal(r.usage.input_tokens, 100);
});

test('adaptive: ambiguous chunks extend until the running mean is decisive', async () => {
  const { classify, calls } = classifyLog([
    answer({ bugfix: 0.45, testing: 0.40 }),  // mean .45/.40 — not decisive (< 0.5)
    answer({ bugfix: 0.9, testing: 0.05 }),   // mean .675/.225 — decisive
  ]);
  const r = await adaptiveClassify('x'.repeat(5000), {}, { cfg, classify });
  assert.equal(calls.length, 2);
  assert.equal(r.category, 'bugfix');
  assert.ok(Math.abs(r.probability - 0.675) < 1e-9);
  assert.ok(Math.abs(r.noise - 0.2) < 1e-9);
  assert.equal(r.usage.chunks, 2);
});

test('adaptive: top-2 gap rule on aggregated probabilities yields uncertain', async () => {
  const { classify } = classifyLog(
    Array.from({ length: 10 }, () => answer({ bugfix: 0.48, testing: 0.46 })),
  );
  const r = await adaptiveClassify('x'.repeat(5000), {}, { cfg, classify });
  assert.equal(r.category, 'uncertain'); // gap 0.02 < 0.05, confidence 0.48 < 0.5
  assert.ok(r.details.uncertain_reason.includes('gap'));
});

test('adaptive: capped at adaptiveMaxChunks when never decisive', async () => {
  const results = Array.from({ length: 30 }, () => answer({ bugfix: 0.4, testing: 0.35 }));
  const { classify, calls } = classifyLog(results);
  const r = await adaptiveClassify('x'.repeat(50000), {}, { cfg: { ...cfg, adaptiveMaxChunks: 4 }, classify });
  assert.equal(calls.length, 4);
  assert.equal(r.details.chunks, 4);
});

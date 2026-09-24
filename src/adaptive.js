import { evaluateAnswer } from './classify.js';

/**
 * Adaptive multi-chunk classification — port of watfile's MultiChunkClassifier
 * (adaptive mode). Classify chunk 1; while the argmax of the RUNNING-MEAN
 * category probabilities is below cfg.adaptiveThreshold, extend by one chunk
 * (each chunk classified exactly once — incremental, no re-work) and
 * re-aggregate. Decisive texts stop after 1 call, ambiguous ones gather
 * evidence, capped at cfg.adaptiveMaxChunks.
 *
 * confidence = winner's aggregated mean probability (honest: disagreement
 * between chunks lowers it). The final verdict runs through evaluateAnswer,
 * so the usual uncertain rule (top-2 gap) applies to the AGGREGATED
 * probabilities. Noise is the mean over the classified chunks.
 */

/** Split text into ~chunkTokens-token chunks (chars/4 proxy), breaking at whitespace. */
export function chunkText(text, chunkTokens = 200) {
  const maxChars = Math.max(40, chunkTokens * 4);
  const clean = String(text ?? '').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks = [];
  let start = 0;
  while (start < clean.length && chunks.length < 100) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      const ws = clean.lastIndexOf(' ', end);
      if (ws > start + maxChars / 2) end = ws; // don't waste more than half the budget
    }
    const c = clean.slice(start, end).trim();
    if (c) chunks.push(c);
    start = end;
  }
  return chunks;
}

/**
 * @param text     full text
 * @param meta     {source, hook_event, tool}
 * @param {{cfg, classify: (chunk: string, meta: object) => Promise<object>}} opts
 *   `classify` is a single-shot classifier (classifyText with a resolved client);
 *   its result carries details.probabilities, noise, usage.
 */
export async function adaptiveClassify(text, meta, { cfg, classify }) {
  const parts = chunkText(text, cfg.chunkTokens);
  const max = Math.min(parts.length, cfg.adaptiveMaxChunks);
  if (max === 0) throw new Error('adaptiveClassify: empty text');

  const sums = {};
  let noiseSum = 0, noiseN = 0, n = 0, result = null;
  const usage = { input_tokens: 0, output_tokens: 0, cost: 0 };

  while (n < max) {
    const r = await classify(parts[n], meta);
    n++;
    for (const [c, p] of Object.entries(r.details?.probabilities ?? {})) sums[c] = (sums[c] ?? 0) + p;
    if (r.noise != null) { noiseSum += r.noise; noiseN++; }
    if (r.usage) {
      usage.input_tokens += r.usage.input_tokens ?? 0;
      usage.output_tokens += r.usage.output_tokens ?? 0;
      usage.cost += r.usage.cost ?? 0;
    }

    const probabilities = {};
    for (const [c, s] of Object.entries(sums)) probabilities[c] = s / n;
    const winner = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
    const nLevels = Array.isArray(cfg.noiseLevels) ? cfg.noiseLevels.length : 5;
    result = evaluateAnswer(
      { choice: winner[0], probabilities, confidence: winner[1] },
      { score: noiseN ? (noiseSum / noiseN) * (nLevels - 1) : 0 },
      cfg,
    );
    if (winner[1] >= cfg.adaptiveThreshold) break; // decisive — stop early
  }

  result.details = { ...result.details, adaptive: true, chunks: n };
  result.usage = { ...usage, chunks: n };
  return result;
}

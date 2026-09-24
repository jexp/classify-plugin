import { TypeSafeClient } from '@typesafe-ai/sdk';
import { loadConfig, providerCredentials } from './config.js';
import { adaptiveClassify, chunkText } from './adaptive.js';
import { ensureLayaServer } from './laya.js';

/**
 * Classify one line of LLM-bound text with a single Jev systemOne call:
 *  - Choice question over the configured categories
 *  - Score question for the noise level (0..100 → 0..1)
 *
 * Uncertainty rule (per user spec): if confidence < confidenceThreshold OR the
 * gap between the top-2 category probabilities < top2Gap, the recorded category
 * is 'uncertain' and details carries the reason plus the top-2 candidates.
 *
 * Returns { category, probability, confidence, noise, details, usage }.
 */
export function evaluateAnswer(catAnswer, noiseAnswer, cfg) {
  const probs = catAnswer.probabilities ?? {};
  const ranked = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  const chosen = catAnswer.choice ?? ranked[0]?.[0] ?? 'uncertain';
  const confidence = catAnswer.confidence ?? 0;
  const top = ranked[0]?.[1] ?? catAnswer.probability ?? 0;
  const second = ranked[1];
  const gap = second ? top - second[1] : Infinity;

  const reasons = [];
  if (confidence < cfg.confidenceThreshold) reasons.push(`confidence ${confidence.toFixed(2)} < ${cfg.confidenceThreshold}`);
  if (second && gap < cfg.top2Gap) reasons.push(`top-2 gap ${gap.toFixed(3)} < ${cfg.top2Gap} (${chosen} ${top.toFixed(2)} vs ${second[0]} ${second[1].toFixed(2)})`);

  const uncertain = reasons.length > 0;
  const details = {
    probabilities: probs,
    confidence,
    top2: ranked.slice(0, 2).map(([name, p]) => ({ category: name, probability: p })),
    noise_levels: noiseAnswer?.probabilities ?? undefined,
    ...(uncertain ? { uncertain_reason: reasons.join('; ') } : {}),
  };

  const nLevels = Array.isArray(cfg.noiseLevels) ? cfg.noiseLevels.length : Object.keys(cfg.noiseLevels ?? {}).length;
  return {
    category: uncertain ? 'uncertain' : chosen,
    probability: top,
    category2: second?.[0] ?? null,
    probability2: second?.[1] ?? null,
    confidence,
    noise: noiseAnswer && nLevels > 1 ? noiseAnswer.score / (nLevels - 1) : null,
    details,
  };
}

/** Build the systemOne request for a text; exported for tests. */
export function buildRequest(text, meta, cfg) {
  const criteria = {};
  for (const [name, desc] of Object.entries(cfg.categories)) criteria[name] = desc ?? null;
  // Jev score criteria must be a list indexed by score from zero; accept a
  // numeric-keyed object from user configs and normalize it.
  const levels = Array.isArray(cfg.noiseLevels)
    ? cfg.noiseLevels
    : Object.entries(cfg.noiseLevels).sort((a, b) => Number(a[0]) - Number(b[0])).map(([, v]) => v);
  return {
    model: cfg.model,
    state: {
      origin: `interaction between a developer and an AI coding agent (${meta.source} side, event: ${meta.hook_event}${meta.tool ? `, tool: ${meta.tool}` : ''})`,
      text: String(text).slice(0, cfg.maxTextChars),
    },
    questions: {
      category: {
        type: 'choice',
        instructions: 'Which category best describes the primary purpose of this interaction?',
        criteria,
      },
      noise: {
        type: 'score',
        instructions: 'How much of this text is verbal noise that does not contribute to completing the task?',
        criteria: levels,
      },
    },
  };
}

export async function classifyText(text, meta = {}, { cfg, client } = {}) {
  const config = cfg ?? loadConfig();

  // adaptive multi-chunk mode: laya's context is 512-1024 tokens total, and any
  // provider silently loses the tail beyond maxTextChars — extend chunk-by-chunk
  // (watfile-style incremental window) instead of truncating
  const useAdaptive = config.adaptive !== false
    && (config.provider === 'laya' || String(text ?? '').length > config.maxTextChars)
    && chunkText(text, config.chunkTokens).length > 1;
  if (useAdaptive) {
    return adaptiveClassify(text, meta, { cfg: config, classify: (chunk, m) => classifyOnce(chunk, m, config, client) });
  }
  return classifyOnce(text, meta, config, client);
}

async function classifyOnce(text, meta, config, client) {
  let c = client;
  if (!c) { // real call: resolve credentials (env -> hook env var -> keychain/credentials file)
    if (config.provider === 'laya') {
      await ensureLayaServer(config); // auto-start local laya.serve if needed
    }
    const { apiKey, baseURL } = providerCredentials(config);
    if (!apiKey) {
      throw new Error(`No API key for provider '${config.provider}'. Set one of the env vars: ` +
        `${config.provider === 'typesafe' ? 'TYPESAFE_API_KEY' : config.provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'AI_GATEWAY_API_KEY'}`);
    }
    c = new TypeSafeClient({ apiKey, baseURL });
  }

  const res = await c.systemOne(buildRequest(text, meta, config));
  const cat = res.answers.category;
  const noise = res.answers.noise;
  const result = evaluateAnswer(cat, noise, config);
  result.usage = res.usage ?? {};
  return result;
}

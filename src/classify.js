import { TypeSafeClient } from '@typesafe-ai/sdk';
import { loadConfig, providerCredentials } from './config.js';

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

  return {
    category: uncertain ? 'uncertain' : chosen,
    probability: top,
    category2: second?.[0] ?? null,
    probability2: second?.[1] ?? null,
    confidence,
    noise: noiseAnswer ? noiseAnswer.score / 100 : null,
    details,
  };
}

/** Build the systemOne request for a text; exported for tests. */
export function buildRequest(text, meta, cfg) {
  const criteria = {};
  for (const [name, desc] of Object.entries(cfg.categories)) criteria[name] = desc ?? null;
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
        criteria: cfg.noiseLevels,
      },
    },
  };
}

export async function classifyText(text, meta = {}, { cfg, client } = {}) {
  const config = cfg ?? loadConfig();
  const { apiKey, baseURL } = providerCredentials(config);
  if (!apiKey) {
    throw new Error(`No API key for provider '${config.provider}'. Set one of the env vars: ` +
      `${config.provider === 'typesafe' ? 'TYPESAFE_API_KEY' : config.provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'AI_GATEWAY_API_KEY'}`);
  }
  const c = client ?? new TypeSafeClient({ apiKey, baseURL });

  const res = await c.systemOne(buildRequest(text, meta, config));
  const cat = res.answers.category;
  const noise = res.answers.noise;
  const result = evaluateAnswer(cat, noise, config);
  result.usage = res.usage ?? {};
  return result;
}

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readPluginSecret } from './secrets.js';

export const DEFAULT_CATEGORIES = {
  planning: 'Breaking down work, proposing steps or approaches, designing a solution before implementation',
  feature_work: 'Implementing new functionality, adding capabilities, extending behavior',
  bugfix: 'Fixing a concrete defect, error, or failing behavior',
  debugging: 'Investigating causes of errors, exploring state to find what is wrong',
  triage: 'Reviewing issues/PRs/bugs to decide priority, ownership, or next action',
  refactoring: 'Restructuring existing code without changing behavior',
  testing: 'Writing or running tests, verifying behavior, fixing test failures',
  documentation: 'Writing or updating docs, README, comments, changelogs',
  code_review: 'Reviewing a diff or PR for correctness and quality',
  exploration: 'Searching/reading codebase or docs to understand or research, no change made',
  configuration: 'Setup of tools, build, CI, dependencies, environment, plugin/config work',
  question: 'Asking or answering a factual or conceptual question, learning',
  discussion: 'General conversation, feedback, opinions, non-task chatter',
};

export const DEFAULTS = {
  provider: 'typesafe',
  model: 'jev-latest',
  categories: DEFAULT_CATEGORIES,
  confidenceThreshold: 0.5,
  top2Gap: 0.05,
  dbPath: '~/.classify-plugin/classify.db',
  maxTextChars: 6000,
  // pyramid bar glyph; U+2588 is East-Asian-ambiguous width and looks misaligned in
  // terminals that render ambiguous glyphs as 2 cells — set "#" (or "=") there
  barChar: '█',
  // adaptive multi-chunk classification (port of watfile MultiChunkClassifier):
  // extend chunk-by-chunk while the winner's mean probability is below the threshold
  adaptiveThreshold: 0.5,
  adaptiveMaxChunks: 10,
  chunkTokens: 200,
  // local laya.serve (same /v1/systemone wire protocol as hosted Jev)
  layaHost: '127.0.0.1',
  layaPort: 8080,
  layaPython: 'python3',
  // Jev score criteria: a list of descriptions indexed by score from zero
  noiseLevels: [
    'None — all of the text directly advances the task',
    'Slight — mostly on-task, small amounts of filler/pleasantries/repetition',
    'Moderate — half is filler, restatement, boilerplate, or off-task',
    'Heavy — most is filler, apologies, redundant output, or chatter',
    'Overwhelming — almost entirely verbal noise not contributing to task completion',
  ],
};

// provider → { envVar(s) for API key, default baseURL, default model }
export const PROVIDERS = {
  typesafe: {
    apiKeyEnv: ['TYPESAFE_API_KEY'],
    baseURL: null, // SDK default (https://api.typesafe.ai)
    defaultModel: 'jev-latest',
  },
  openrouter: {
    apiKeyEnv: ['OPENROUTER_API_KEY'],
    baseURL: 'https://openrouter.ai/api',
    defaultModel: 'jev-latest',
  },
  vercel: {
    apiKeyEnv: ['AI_GATEWAY_API_KEY', 'VERCEL_AI_GATEWAY_API_KEY'],
    baseURL: 'https://ai-gateway.vercel.sh/typesafe',
    defaultModel: 'typesafe-ai/jev',
  },
  laya: {
    // local laya.serve — same POST /v1/systemone wire protocol as hosted Jev,
    // so the TypeSafe client works unchanged, just repointed
    apiKeyEnv: [],
    baseURL: null, // derived from layaHost/layaPort at call time
    defaultModel: 'multilingual', // english | multilingual | typed-decisions
  },
};

export function expandHome(p) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

/**
 * Values configured in the Claude Code plugin UI (/config) are exported to hook
 * processes as CLAUDE_PLUGIN_OPTION_<KEY>. Parse the flat UI fields into config:
 *  - categories: array of 'name|description' entries (or a JSON object string)
 *  - numbers arrive as strings and are coerced
 */
export function pluginOptions(env = process.env) {
  const get = (key) => env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`];
  const out = {};

  const provider = get('provider');
  if (provider) out.provider = provider;

  const apiKey = get('api_key'); // sensitive field → Keychain-backed, exported to hooks
  if (apiKey) out._pluginApiKey = apiKey;

  const model = get('model');
  if (model) out.model = model;

  const cats = get('categories');
  if (cats) {
    let parsed;
    try { parsed = JSON.parse(cats); } catch { parsed = Array.isArray(cats) ? cats : [cats]; }
    if (Array.isArray(parsed)) {
      const map = {};
      for (const entry of parsed) {
        const s = String(entry).trim();
        if (!s) continue;
        const i = s.indexOf('|');
        if (i > 0) map[s.slice(0, i).trim()] = s.slice(i + 1).trim();
        else map[s.trim()] = DEFAULT_CATEGORIES[s.trim()] ?? null; // bare name: keep default description
      }
      if (Object.keys(map).length) out.categories = map;
    } else if (parsed && typeof parsed === 'object') {
      out.categories = parsed;
    }
  }

  const conf = get('confidence_threshold');
  if (conf != null && conf !== '') out.confidenceThreshold = Number(conf);
  const gap = get('top2_gap');
  if (gap != null && gap !== '') out.top2Gap = Number(gap);
  const dbPath = get('db_path');
  if (dbPath) out.dbPath = dbPath;

  // local laya.serve settings
  const lh = get('laya_host'); if (lh) out.layaHost = lh;
  const lp = get('laya_port'); if (lp != null && lp !== '') out.layaPort = Number(lp);
  const lpy = get('laya_python'); if (lpy) out.layaPython = lpy;

  // adaptive multi-chunk settings
  const at = get('adaptive_threshold'); if (at != null && at !== '') out.adaptiveThreshold = Number(at);
  const amc = get('adaptive_max_chunks'); if (amc != null && amc !== '') out.adaptiveMaxChunks = Number(amc);
  const ct = get('chunk_tokens'); if (ct != null && ct !== '') out.chunkTokens = Number(ct);

  return out;
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v)
      ? deepMerge(base[k] ?? {}, v)
      : v;
  }
  return out;
}

/**
 * Config lookup order (later wins):
 *  1. built-in defaults
 *  2. <project>/.claude/classify.config.json
 *  3. ~/.classify-plugin/config.json
 *  4. $CLAUDE_CLASSIFY_CONFIG (explicit path, highest file priority)
 *  5. plugin UI options (CLAUDE_PLUGIN_OPTION_* env vars from /config)
 * API keys are NEVER read from config files — only from environment variables
 * or the Keychain-backed sensitive plugin option.
 */
export function loadConfig(projectDir = process.cwd()) {
  const candidates = [
    path.join(projectDir, '.claude', 'classify.config.json'),
    path.join(os.homedir(), '.classify-plugin', 'config.json'),
    process.env.CLAUDE_CLASSIFY_CONFIG,
  ].filter(Boolean);

  let userCfg = {};
  for (const c of candidates) {
    try {
      userCfg = JSON.parse(fs.readFileSync(c, 'utf8'));
      break;
    } catch { /* try next */ }
  }
  if (process.env.CLAUDE_CLASSIFY_CONFIG) {
    try { userCfg = JSON.parse(fs.readFileSync(process.env.CLAUDE_CLASSIFY_CONFIG, 'utf8')); } catch { /* ignore */ }
  }

  const opts = pluginOptions();
  const pluginApiKey = opts._pluginApiKey;
  delete opts._pluginApiKey;
  const cfg = deepMerge(deepMerge(DEFAULTS, userCfg), opts);
  if (pluginApiKey) cfg._pluginApiKey = pluginApiKey;
  const prov = PROVIDERS[cfg.provider];
  if (!prov) throw new Error(`Unknown provider '${cfg.provider}' (expected one of ${Object.keys(PROVIDERS).join(', ')})`);
  if (!userCfg.model) cfg.model = prov.defaultModel;
  cfg.dbPath = expandHome(cfg.dbPath);
  return cfg;
}

/** Resolve API key + baseURL for the configured provider from env vars only. */
export function providerCredentials(cfg) {
  if (cfg.provider === 'laya') {
    return {
      apiKey: process.env.LAYA_API_KEY || 'laya-local', // laya.serve only checks when LAYA_API_KEY is set server-side
      baseURL: `http://${process.env.LAYA_HOST || cfg.layaHost || '127.0.0.1'}:${process.env.LAYA_PORT || cfg.layaPort || 8080}`,
    };
  }
  const prov = PROVIDERS[cfg.provider];
  const apiKey = prov.apiKeyEnv.map((v) => process.env[v]).find(Boolean)
    ?? cfg._pluginApiKey            // hook-process env var (CLAUDE_PLUGIN_OPTION_API_KEY)
    ?? readPluginSecret('api_key'); // Keychain / .credentials.json (for slash-command scripts)
  const baseURL = process.env.TYPESAFE_BASE_URL || prov.baseURL || undefined;
  return { apiKey, baseURL };
}

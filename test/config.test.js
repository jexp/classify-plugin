import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pluginOptions, loadConfig, providerCredentials } from '../src/config.js';

test('pluginOptions parses UI env vars', () => {
  const o = pluginOptions({
    CLAUDE_PLUGIN_OPTION_PROVIDER: 'openrouter',
    CLAUDE_PLUGIN_OPTION_API_KEY: 'sk-x',
    CLAUDE_PLUGIN_OPTION_MODEL: 'jev-1.13',
    CLAUDE_PLUGIN_OPTION_CATEGORIES: '["bugfix|fixing defects","question"]',
    CLAUDE_PLUGIN_OPTION_CONFIDENCE_THRESHOLD: '0.6',
    CLAUDE_PLUGIN_OPTION_TOP2_GAP: '0.07',
  });
  assert.equal(o.provider, 'openrouter');
  assert.equal(o._pluginApiKey, 'sk-x');
  assert.equal(o.model, 'jev-1.13');
  assert.deepEqual(o.categories, { bugfix: 'fixing defects', question: 'Asking or answering a factual or conceptual question, learning' });
  assert.equal(o.confidenceThreshold, 0.6);
  assert.equal(o.top2Gap, 0.07);
});

test('pluginOptions handles pipe-free single string and empty env', () => {
  assert.deepEqual(pluginOptions({}), {});
  const o = pluginOptions({ CLAUDE_PLUGIN_OPTION_CATEGORIES: 'bugfix|fixing defects' });
  assert.deepEqual(o.categories, { bugfix: 'fixing defects' });
});

test('loadConfig: UI options override file config, api key flows through', async () => {
  process.env.CLAUDE_PLUGIN_OPTION_PROVIDER = 'vercel';
  process.env.CLAUDE_PLUGIN_OPTION_API_KEY = 'vgw-1';
  try {
    const cfg = loadConfig('/nonexistent');
    assert.equal(cfg.provider, 'vercel');
    assert.equal(cfg.model, 'typesafe-ai/jev'); // provider default applies
    const creds = providerCredentials(cfg);
    assert.equal(creds.apiKey, 'vgw-1');
    assert.equal(creds.baseURL, 'https://ai-gateway.vercel.sh/typesafe');
  } finally {
    delete process.env.CLAUDE_PLUGIN_OPTION_PROVIDER;
    delete process.env.CLAUDE_PLUGIN_OPTION_API_KEY;
  }
});

test('provider laya: local baseURL from host/port, no API key needed', async () => {
  const { providerCredentials, loadConfig } = await import('../src/config.js');
  const cfg = loadConfig('/nonexistent');
  cfg.provider = 'laya';
  const saved = { ...process.env };
  delete process.env.LAYA_HOST; delete process.env.LAYA_PORT; delete process.env.LAYA_API_KEY;
  try {
    let c = providerCredentials(cfg);
    assert.equal(c.baseURL, 'http://127.0.0.1:8080');
    assert.equal(c.apiKey, 'laya-local');
    process.env.LAYA_PORT = '9099';
    cfg.layaHost = 'localhost'; cfg.layaPort = 1234;
    c = providerCredentials(cfg);
    assert.equal(c.baseURL, 'http://localhost:9099'); // env wins
  } finally {
    Object.entries(saved).filter(([k]) => k.startsWith('LAYA_')).forEach(([k, v]) => process.env[k] = v);
  }
});

test('pluginOptions parses laya + adaptive fields', () => {
  const o = pluginOptions({
    CLAUDE_PLUGIN_OPTION_PROVIDER: 'laya',
    CLAUDE_PLUGIN_OPTION_LAYA_PORT: '9099',
    CLAUDE_PLUGIN_OPTION_LAYA_PYTHON: '/Users/mh/d/llm/watfile/.venv/bin/python',
    CLAUDE_PLUGIN_OPTION_ADAPTIVE_THRESHOLD: '0.6',
    CLAUDE_PLUGIN_OPTION_ADAPTIVE_MAX_CHUNKS: '6',
    CLAUDE_PLUGIN_OPTION_CHUNK_TOKENS: '150',
  });
  assert.equal(o.provider, 'laya');
  assert.equal(o.layaPort, 9099);
  assert.equal(o.layaPython, '/Users/mh/d/llm/watfile/.venv/bin/python');
  assert.equal(o.adaptiveThreshold, 0.6);
  assert.equal(o.adaptiveMaxChunks, 6);
  assert.equal(o.chunkTokens, 150);
});

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

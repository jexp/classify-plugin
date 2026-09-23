import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAnswer, buildRequest, classifyText } from '../src/classify.js';
import { DEFAULTS } from '../src/config.js';

const cfg = { ...DEFAULTS };

test('confident answer keeps the chosen category', () => {
  const r = evaluateAnswer(
    { choice: 'bugfix', probabilities: { bugfix: 0.9, debugging: 0.07 }, confidence: 0.85 },
    { score: 25, probabilities: {} },
    cfg,
  );
  assert.equal(r.category, 'bugfix');
  assert.equal(r.probability, 0.9);
  assert.equal(r.category2, 'debugging');
  assert.equal(r.noise, 0.25);
  assert.ok(!r.details.uncertain_reason);
});

test('low confidence -> uncertain with details', () => {
  const r = evaluateAnswer(
    { choice: 'planning', probabilities: { planning: 0.8, feature_work: 0.1 }, confidence: 0.3 },
    { score: 0 },
    cfg,
  );
  assert.equal(r.category, 'uncertain');
  assert.ok(r.details.uncertain_reason.includes('confidence'));
  assert.deepEqual(r.details.top2.map((t) => t.category), ['planning', 'feature_work']);
});

test('top-2 gap < 0.05 -> uncertain with details', () => {
  const r = evaluateAnswer(
    { choice: 'testing', probabilities: { testing: 0.48, bugfix: 0.45 }, confidence: 0.9 },
    { score: 50 },
    cfg,
  );
  assert.equal(r.category, 'uncertain');
  assert.ok(r.details.uncertain_reason.includes('gap'));
});

test('buildRequest uses configured categories as criteria', () => {
  const req = buildRequest('fix the failing test', { source: 'human', hook_event: 'UserPromptSubmit' }, cfg);
  assert.equal(req.questions.category.type, 'choice');
  assert.deepEqual(Object.keys(req.questions.category.criteria), Object.keys(cfg.categories));
  assert.equal(req.questions.noise.type, 'score');
  assert.ok(req.state.text.includes('fix the failing test'));
});

test('classifyText surfaces missing API key clearly', async () => {
  const saved = { ...process.env };
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_BASE_URL;
  try {
    await assert.rejects(
      classifyText('hello', { source: 'human', hook_event: 'UserPromptSubmit' }, { cfg: { ...cfg, provider: 'typesafe' } }),
      /TYPESAFE_API_KEY/,
    );
  } finally {
    process.env.TYPESAFE_API_KEY = saved.TYPESAFE_API_KEY;
    process.env.TYPESAFE_BASE_URL = saved.TYPESAFE_BASE_URL;
  }
});

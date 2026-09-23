import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAnswer, buildRequest, classifyText } from '../src/classify.js';
import { DEFAULTS } from '../src/config.js';

const cfg = { ...DEFAULTS };

test('confident answer keeps the chosen category', () => {
  const r = evaluateAnswer(
    { choice: 'bugfix', probabilities: { bugfix: 0.9, debugging: 0.07 }, confidence: 0.85 },
    { score: 1, probabilities: {} }, // 5 noise levels -> 1/4 = 0.25
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
    { score: 2 },
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

test('classifyText with stub client classifies and maps usage', async () => {
  const client = {
    systemOne: async (req) => {
      assert.equal(req.questions.category.type, 'choice');
      assert.ok(Array.isArray(req.questions.noise.criteria)); // score criteria as zero-indexed list
      return {
        answers: {
          category: { choice: 'bugfix', probabilities: { bugfix: 0.9, debugging: 0.07 }, confidence: 0.85 },
          noise: { score: 1 },
        },
        usage: { input_tokens: 123, output_tokens: 4 },
      };
    },
  };
  const r = await classifyText('fix the failing test', { source: 'human', hook_event: 'UserPromptSubmit' }, { cfg, client });
  assert.equal(r.category, 'bugfix');
  assert.equal(r.noise, 0.25);
  assert.equal(r.usage.input_tokens, 123);
});


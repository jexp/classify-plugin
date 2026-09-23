import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSessionLog } from '../scripts/backfill.js';

function writeLog(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-test-'));
  const f = path.join(dir, 'session.jsonl');
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n'));
  return f;
}

test('parses human prompts, assistant text and tool_use; skips tool results and meta', () => {
  const f = writeLog([
    { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2026-09-20T10:00:00.000Z', message: { content: 'please fix the login bug' } },
    { type: 'user', uuid: 'u2', sessionId: 's1', isMeta: true, message: { content: 'meta entry' } },
    { type: 'user', uuid: 'u3', sessionId: 's1', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', uuid: 'u4', sessionId: 's1', timestamp: '2026-09-20T10:00:05.000Z', message: { content: [
      { type: 'text', text: 'I will fix it now.' },
      { type: 'tool_use', name: 'Edit', input: { file_path: '/x.js', new_string: 'a' } },
    ] } },
    { type: 'summary', summary: 'ignored' },
  ]);

  const items = [...parseSessionLog(f)];
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i) => [i.source, i.hook_event, i.tool]),
    [['human', 'UserPromptSubmit', undefined], ['agent', 'AssistantMessage', undefined], ['agent', 'PreToolUse', 'Edit']],
  );
  assert.equal(items[0].text, 'please fix the login bug');
  assert.equal(items[0].lineId, 's1:u1:0');
  assert.equal(items[2].lineId, 's1:u4:3:Edit');
  assert.ok(items[2].text.startsWith('Edit:'));
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

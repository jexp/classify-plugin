/** Map a Claude Code hook payload to a classification record (pre-API-call). */

export function estimateTokens(text) {
  return Math.max(1, Math.round(String(text ?? '').length / 4));
}

export function pickText(obj, depth = 0) {
  if (obj == null || depth > 2) return '';
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map((o) => pickText(o, depth + 1)).join('\n');
  if (typeof obj === 'object') {
    return Object.entries(obj).map(([k, v]) => `${k}: ${pickText(v, depth + 1)}`).join('\n');
  }
  return String(obj);
}

export function preview(text, n = 120) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 3) + '...' : s;
}

export function projectFromCwd(cwd) {
  if (!cwd) return null;
  const parts = String(cwd).split('/').filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

/**
 * Returns a record {source, hook_event, tool, text, project, session_id, ts}
 * or null if the event carries nothing worth classifying.
 */
export function payloadToRecord(payload) {
  const event = payload.hook_event_name ?? payload.hook_event ?? 'unknown';
  const base = {
    hook_event: event,
    session_id: payload.session_id ?? null,
    project: projectFromCwd(payload.cwd),
    ts: new Date().toISOString(),
  };

  switch (event) {
    case 'UserPromptSubmit':
      return { ...base, source: 'human', text: payload.prompt ?? '' };
    case 'PreToolUse':
      return { ...base, source: 'agent', tool: payload.tool_name ?? null, text: pickText(payload.tool_input) };
    case 'PostToolUse':
      return { ...base, source: 'agent', tool: payload.tool_name ?? null, text: pickText(payload.tool_response) };
    case 'SessionStart':
      return { ...base, source: 'agent', tool: null, text: `session start (${payload.source ?? 'unknown'}): ${payload.transcript_path ?? ''}` };
    case 'SubagentStop':
      return { ...base, source: 'agent', tool: 'subagent', text: pickText(payload.result ?? payload.last_message) };
    default:
      return null;
  }
}

/**
 * Storyloom's log: what it did, what failed and why, in the writer's browser.
 * Pure helpers; index.js stores the list (localStorage) and shows it in the Extensions menu.
 */
export const LOG_MAX = 500;
export const LOG_LEVELS = Object.freeze(['error', 'warn', 'info', 'debug']);

/** Never keep secrets: API keys, bearer tokens, passwords and key-like query parameters. */
export function redact(text) {
  return String(text ?? '')
    .replace(/\b(sk|pk|rk|xai|gsk|key|api)[-_][A-Za-z0-9_-]{12,}/gi, '[key removed]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [key removed]')
    .replace(/("?(?:api[_-]?key|authorization|password|proxy_password|secret|token)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi, '$1[removed]')
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[removed]');
}

/** Add an entry and keep the newest `max`. Detail is shortened unless `full` is set (debug mode). */
export function addEntry(list, {level = 'info', area = '', message = '', detail = ''}, {now = new Date(), max = LOG_MAX, full = false} = {}) {
  const clip = s => { const t = redact(s); return full || t.length <= 2000 ? t : `${t.slice(0, 2000)}… (${t.length.toLocaleString('en-US')} characters; turn on “Keep full prompts and replies” to keep all of it)`; };
  const entry = {at: now.toISOString(), level: LOG_LEVELS.includes(level) ? level : 'info', area: String(area), message: redact(message)};
  if (detail) entry.detail = clip(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 1));
  const next = [...(Array.isArray(list) ? list : []), entry];
  return next.slice(-max);
}

/** Which entries a filter shows: errors only, errors and warnings, or everything. */
export function filterEntries(list, show = 'all') {
  const keep = show === 'error' ? ['error'] : show === 'warn' ? ['error', 'warn'] : LOG_LEVELS;
  return (list || []).filter(e => keep.includes(e.level));
}

/** Plain text for Copy / Download. */
export function logText(list) {
  return (list || []).map(e => `[${e.at}] ${e.level.toUpperCase()}${e.area ? ` ${e.area}` : ''}: ${e.message}${e.detail ? `\n    ${e.detail.replace(/\n/g, '\n    ')}` : ''}`).join('\n');
}

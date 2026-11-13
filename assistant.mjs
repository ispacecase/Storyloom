/**
 * Storyloom Assistant: a chat about SillyTavern and the writer's setup.
 * It reads a snapshot of the live setup plus retrieved SillyTavern docs, and may propose
 * lorebook changes as ACTION blocks. Nothing changes until the writer clicks Apply.
 */
import {P} from './prompt-texts.mjs';

export const POSITIONS = Object.freeze({before: 0, after: 1, 'an-top': 2, 'an-bottom': 3, depth: 4, 'em-top': 5, 'em-bottom': 6, outlet: 7});
const POSITION_NAMES = Object.fromEntries(Object.entries(POSITIONS).map(([k, v]) => [v, k]));
export const ROLES = Object.freeze({system: 0, user: 1, assistant: 2});
const ROLE_NAMES = ['system', 'user', 'assistant'];

const ACTION_FORMAT = `When — and only when — the writer wants a lorebook change, propose it as one block per change, after your reply:
=== ACTION: add-entry | edit-entry | set-placement
BOOK: exact lorebook name
TITLE: exact entry title (for edit-entry and set-placement, an entry that exists)
KEYS: keyword, keyword            (add-entry / edit-entry; optional for edit)
STRATEGY: always | keyword | off  (optional; vectors also apply when Vector Storage is on for all entries)
POSITION: before | after | an-top | an-bottom | depth | em-top | em-bottom | outlet   (optional)
DEPTH: number                     (only with POSITION: depth)
ROLE: system | user | assistant   (only with POSITION: depth)
RECURSION: yes | no               (no = other entries cannot trigger this one)
ORDER: number                     (optional priority; higher goes first)
CONTENT:
the complete entry text (add-entry; for edit-entry only if the text changes)
=== END
The writer sees each block as a card with an Apply button; nothing changes until they click it. Never claim you changed anything yourself. Never propose changes to presets, character cards or settings — explain where the writer can change those instead. Never put documentation text into a story lorebook.`;

export function assistantSystem() {
  return `${P('assistant')}\n\nYou are given (1) a snapshot of the writer's live SillyTavern setup, (2) excerpts from the official SillyTavern documentation chosen for this question, and (3) the conversation so far. Base answers about how SillyTavern works on the documentation excerpts and name the page you used, like (Docs: Usage › worldinfo). If the excerpts don't cover something, say so rather than guessing. Base answers about the writer's setup on the snapshot.\n\n${ACTION_FORMAT}`;
}

const strategyOf = e => e.disable ? 'off' : e.constant ? 'always' : e.vectorized ? 'vector' : 'keyword';
const words = s => (String(s || '').match(/\S+/g) || []).length;

/** Compact description of one lorebook entry's placement. */
export function describeEntry(e) {
  const pos = POSITION_NAMES[e.position] ?? String(e.position);
  const where = pos === 'depth' ? `depth ${e.depth ?? 4} as ${ROLE_NAMES[e.role ?? 0]}` : pos === 'outlet' ? `outlet “${e.outletName || ''}”` : pos;
  const flags = [e.excludeRecursion && 'not triggered by other entries', e.preventRecursion && 'does not trigger others', e.sticky && `sticky ${e.sticky}`, e.cooldown && `cooldown ${e.cooldown}`, e.delay && `delay ${e.delay}`].filter(Boolean).join(', ');
  return `“${e.comment || '(untitled)'}” — ${strategyOf(e)}, ${where}, order ${e.order ?? 100}, ${words(e.content)} words, keys: ${(e.key || []).slice(0, 8).join(', ') || 'none'}${flags ? `; ${flags}` : ''}`;
}

/** Plain-text snapshot of the setup. `s` is gathered by the extension; this only formats it. */
export function formatSnapshot(s) {
  const lines = [];
  lines.push(`Character: ${s.character?.name || '(none)'}${s.character?.description ? ` — description (${words(s.character.description)} words): ${s.character.description.slice(0, 600)}` : ''}`);
  if (s.character?.lorebook) lines.push(`Character's own lorebook: ${s.character.lorebook}`);
  lines.push(`Chat lorebook: ${s.chatLorebook || '(none)'}; global lorebooks: ${(s.globalLorebooks || []).join(', ') || '(none)'}; all lorebooks: ${(s.allLorebooks || []).join(', ')}`);
  if (s.worldInfo) lines.push(`Lorebook scanning: scan depth ${s.worldInfo.depth} messages, budget ${s.worldInfo.budget}% of context, recursive ${s.worldInfo.recursive ? 'on' : 'off'}, case-sensitive ${s.worldInfo.caseSensitive ? 'on' : 'off'}, whole words ${s.worldInfo.wholeWords ? 'on' : 'off'}`);
  if (s.vectors) lines.push(`Vector Storage: source ${s.vectors.source || 'none'}; for lorebooks ${s.vectors.enabled_world_info ? 'on' : 'off'}${s.vectors.enabled_for_all ? ' (all entries)' : ''}, max ${s.vectors.max_entries} entries, threshold ${s.vectors.score_threshold}; for chats ${s.vectors.enabled_chats ? 'on' : 'off'}`);
  if (s.prompts?.length) lines.push(`Prompt order (chat completion): ${s.prompts.map(p => `${p.enabled ? '' : '[off] '}${p.name}`).join(' → ')}`);
  for (const p of s.prompts || []) if (p.content && p.enabled) lines.push(`${p.name} text: ${p.content.slice(0, 1200)}`);
  if (s.authorsNote) lines.push(`Author's Note: ${s.authorsNote.text ? `${words(s.authorsNote.text)} words` : 'empty'}, position ${s.authorsNote.position}, depth ${s.authorsNote.depth}, role ${s.authorsNote.role}`);
  if (s.connection) lines.push(`Main connection: ${s.connection}`);
  if (s.novel) lines.push(`Storyloom project: ${s.novel}`);
  if (s.entries?.length) {
    lines.push(`Entries in the chat lorebook “${s.chatLorebook}”:`);
    for (const e of s.entries) lines.push(`- ${describeEntry(e)}`);
  }
  for (const e of s.entryTexts || []) lines.push(`Full text of “${e.comment}”:\n${e.content}`);
  return lines.join('\n');
}

const FIELD = /^\s*([A-Z]+)\s*:\s*(.*)$/;
/** Split a reply into the text to show and the proposed actions. Malformed blocks become notes, not actions. */
export function parseActions(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const reply = [], actions = [], problems = [];
  let cur = null, inContent = false;
  const finish = () => {
    if (!cur) return;
    cur.content = inContent ? cur.contentLines.join('\n').trim() : undefined;
    delete cur.contentLines;
    try { actions.push(normalizeAction(cur)); } catch (e) { problems.push(e.message); }
    cur = null; inContent = false;
  };
  for (const line of lines) {
    const start = line.match(/^[\s*_#>]*=+\s*ACTION\s*:\s*([a-z-]+)/i);
    if (start) { finish(); cur = {type: start[1].toLowerCase(), contentLines: []}; continue; }
    if (cur && /^[\s*_#>]*=+\s*END\b/i.test(line)) { finish(); continue; }
    if (!cur) { reply.push(line); continue; }
    if (inContent) { cur.contentLines.push(line); continue; }
    const f = line.match(FIELD);
    if (f && f[1] === 'CONTENT') { inContent = true; if (f[2].trim()) cur.contentLines.push(f[2]); continue; }
    if (f) cur[f[1].toLowerCase()] = f[2].trim();
  }
  finish();
  return {reply: reply.join('\n').trim(), actions, problems};
}

function normalizeAction(a) {
  const types = ['add-entry', 'edit-entry', 'set-placement'];
  if (!types.includes(a.type)) throw Error(`Unknown action “${a.type}”.`);
  if (!a.book) throw Error(`A ${a.type} card is missing BOOK.`);
  if (!a.title) throw Error(`A ${a.type} card is missing TITLE.`);
  if (a.type === 'add-entry' && !a.content) throw Error(`“${a.title}”: add-entry needs CONTENT.`);
  const out = {type: a.type, book: a.book, title: a.title};
  if (a.keys !== undefined) out.keys = a.keys.split(',').map(k => k.trim()).filter(Boolean);
  if (a.content !== undefined) out.content = a.content;
  if (a.strategy) { if (!['always', 'keyword', 'off'].includes(a.strategy.toLowerCase())) throw Error(`“${a.title}”: STRATEGY must be always, keyword or off.`); out.strategy = a.strategy.toLowerCase(); }
  if (a.position) { const p = a.position.toLowerCase(); if (!(p in POSITIONS)) throw Error(`“${a.title}”: unknown POSITION “${a.position}”.`); out.position = p; }
  if (a.depth !== undefined && a.depth !== '') { const d = Number(a.depth); if (!Number.isInteger(d) || d < 0 || d > 1000) throw Error(`“${a.title}”: DEPTH must be a whole number.`); out.depth = d; }
  if (a.role) { const r = a.role.toLowerCase(); if (!(r in ROLES)) throw Error(`“${a.title}”: ROLE must be system, user or assistant.`); out.role = r; }
  if (a.recursion) out.recursion = /^y/i.test(a.recursion);
  if (a.order !== undefined && a.order !== '') { const o = Number(a.order); if (!Number.isFinite(o)) throw Error(`“${a.title}”: ORDER must be a number.`); out.order = o; }
  return out;
}

/** Human-readable summary of what Apply will do. */
export function describeAction(a) {
  const parts = [];
  if (a.strategy) parts.push(a.strategy === 'always' ? 'always on' : a.strategy === 'off' ? 'switched off' : 'triggered by keywords');
  if (a.position) parts.push(a.position === 'depth' ? `placed at depth ${a.depth ?? 4}${a.role ? ` as ${a.role}` : ''}` : `placed: ${a.position}`);
  if (a.recursion !== undefined) parts.push(a.recursion ? 'can be triggered by other entries' : 'not triggered by other entries');
  if (a.order !== undefined) parts.push(`priority ${a.order}`);
  if (a.keys) parts.push(`keys: ${a.keys.join(', ') || 'none'}`);
  const verb = a.type === 'add-entry' ? 'Add entry' : a.type === 'edit-entry' ? 'Edit entry' : 'Change placement of';
  return `${verb} “${a.title}” in “${a.book}”${parts.length ? ` — ${parts.join('; ')}` : ''}${a.content && a.type !== 'add-entry' ? ' — new text' : ''}`;
}

/** Apply one action to a copy of a lorebook. `create(book)` adds and returns a new entry. Returns {book, uid}. */
export function applyAction(source, a, create) {
  const book = structuredClone(source);
  const matches = Object.values(book.entries || {}).filter(e => String(e.comment || '').trim().toLocaleLowerCase() === a.title.trim().toLocaleLowerCase());
  let entry;
  if (a.type === 'add-entry') {
    if (matches.length) throw Error(`“${a.book}” already has an entry called “${a.title}”. Ask for an edit instead.`);
    entry = create(book);
    if (!entry) throw Error('Could not create the entry.');
    entry.comment = a.title.trim();
  } else {
    if (matches.length !== 1) throw Error(matches.length ? `“${a.book}” has more than one “${a.title}”.` : `“${a.book}” has no entry called “${a.title}”.`);
    entry = matches[0];
  }
  if (a.content !== undefined) entry.content = a.content;
  if (a.keys) entry.key = a.keys;
  if (a.strategy) { entry.disable = a.strategy === 'off'; entry.constant = a.strategy === 'always'; }
  if (a.position) entry.position = POSITIONS[a.position];
  if (a.depth !== undefined) entry.depth = a.depth;
  if (a.role) entry.role = ROLES[a.role];
  if (a.recursion !== undefined) entry.excludeRecursion = !a.recursion;
  if (a.order !== undefined) entry.order = a.order;
  return {book, uid: entry.uid};
}

/** Older turns get folded into a running summary once the conversation is long. */
export function needsCompaction(messages, keep = 16, limit = 30) {
  return (messages || []).length > limit ? messages.length - keep : 0;
}
export function compactionPrompt(previousSummary, oldMessages) {
  return `Update the running summary of a conversation between a writer and their SillyTavern assistant. Keep decisions, preferences, facts about their setup and story, open questions, and what was changed. Drop small talk. At most 300 words.\n\nCurrent summary:\n${previousSummary || '(none)'}\n\nMessages to fold in:\n${oldMessages.map(m => `${m.role === 'user' ? 'Writer' : 'Assistant'}: ${m.content}`).join('\n\n')}\n\nReply with only the new summary.`;
}

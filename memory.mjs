/**
 * Chapter memory: text Storyloom injects into the main chat's prompt itself (not via lorebook scanning),
 * with a placement the writer chooses. Stored as switched-off lorebook entries so it travels with the book.
 */
import {P} from './prompt-texts.mjs';

export const MEMORY_ITEMS = Object.freeze([
  {key: 'sofar', title: 'Storyloom Memory — Story So Far', label: 'Story so far',
    hint: 'Everything that has already happened and is settled: events, what characters know, where things are, promises made. Keeps the AI from repeating or contradicting earlier chapters.',
    header: 'STORY SO FAR (already happened and settled — do not repeat these events or contradict them):',
    place: {where: 'chat-start', depth: 0, role: 'system'}},
  {key: 'previously', title: 'Storyloom Memory — Previously', label: 'Previously',
    hint: 'A summary of the last chapter, so a fresh chat knows exactly where things left off.',
    header: 'PREVIOUSLY (summary of the last chapter):',
    place: {where: 'chat-start', depth: 0, role: 'system'}},
  {key: 'chapter', title: 'Current Chapter', label: 'This chapter',
    hint: 'The plan for the chapter you are on, from the outline, with its target length and a line for each later chapter. Updated automatically when you change chapter.',
    header: 'THIS {UNIT} — what you are writing now:',
    place: {where: 'chat-depth', depth: 3, role: 'system'}},
  {key: 'outline', title: null, label: 'Whole outline', fromOutline: true,
    hint: 'The full outline, so the AI knows where the whole story is going. The instruction around it tells the AI it is for orientation and not to write ahead. Edit the outline itself in the lorebook.',
    header: 'FULL OUTLINE — for orientation only. You are writing {Unit} {chapter}. Use this to know where the story is heading, to set up what later {units} need, and to avoid using up their events early. Never write past the end of {Unit} {chapter}.',
    place: {where: 'system-end', depth: 0, role: 'system'}},
]);
/** Fill {chapter}, {unit}, {Unit}, {units} in an instruction. */
export function fillHeader(header, {chapter = 1, unit = 'Chapter'} = {}) {
  return String(header || '').replace(/\{chapter\}/g, String(chapter)).replace(/\{Unit\}/g, unit).replace(/\{UNIT\}/g, unit.toUpperCase()).replace(/\{units\}/g, unit.toLowerCase() + 's').replace(/\{unit\}/g, unit.toLowerCase());
}
/** Text sent for an outline entry: without Storyloom's own "(Storyloom: …)" note line. */
export const outlineBody = text => String(text || '').replace(/^\(Storyloom:[^\n]*\)\n?/, '').trim();
export const WHERE = Object.freeze({
  off: 'Off — not sent',
  top: 'Top of the prompt (before everything)',
  'system-end': 'End of the system prompt',
  'chat-start': 'Start of the chat (before the first message)',
  'chat-depth': 'Inside the chat, N messages from the end',
});
/** SillyTavern extension_prompt_types: IN_PROMPT 0, IN_CHAT 1, BEFORE_PROMPT 2. Chat-start uses a depth beyond any chapter chat. */
export const CHAT_START_DEPTH = 500;
const ROLE = {system: 0, user: 1, assistant: 2};

export function memoryKey(item) { return `storyloom_memory_${item.key}`; }

/** Arguments for setExtensionPrompt(key, value, position, depth, scan, role). */
export function injection(item, text, place = item.place, vars = {}) {
  const body = String(text || '').trim();
  const where = place?.where in WHERE ? place.where : item.place.where;
  if (!body || where === 'off') return {value: '', position: 0, depth: 0, role: 0};
  const header = fillHeader(place?.header ?? item.header, vars).trim();
  const value = header ? `${header}\n${body}` : body;
  const role = ROLE[place?.role] ?? 0;
  if (where === 'top') return {value, position: 2, depth: 0, role};
  if (where === 'system-end') return {value, position: 0, depth: 0, role};
  if (where === 'chat-start') return {value, position: 1, depth: CHAT_START_DEPTH, role};
  const depth = Math.max(0, Math.min(CHAT_START_DEPTH, Number.isInteger(Number(place?.depth)) ? Number(place.depth) : item.place.depth));
  return {value, position: 1, depth, role};
}

/** Main-chat messages as a transcript, newest kept when too long. */
export function transcriptOf(chat, maxChars = 60000) {
  const lines = (chat || []).filter(m => m && !m.is_system && String(m.mes || '').trim()).map(m => `${m.is_user ? 'USER' : (m.name || 'STORY')}: ${String(m.mes).trim()}`);
  let text = lines.join('\n\n');
  if (text.length > maxChars) text = '…(earlier part of this chapter omitted)…\n\n' + text.slice(-maxChars);
  return {text, messages: lines.length};
}

export const summaryTitle = (unit, n) => `Storyloom Memory — ${unit} ${n} Summary`;

/** What the model is asked when a chapter ends. */
export function chapterEndInstruction({unit = 'Chapter', number, transcript, storySoFar = '', castTitles = []}) {
  const u = unit.toLowerCase();
  return `${unit} ${number} is finished. Below is everything written in its chat.
${P('chapterEnd')}
Return these entry blocks:
1. "${summaryTitle(unit, number)}" — what happened in this ${u}.
2. "${MEMORY_ITEMS[0].title}" — the complete updated story-so-far ledger: everything from the current version below, plus what this ${u} settled. Keep it as a list grouped by ${u}; never drop earlier items.
3. Only if this ${u} changed a character's situation (injury, relationship, knowledge, location, possessions): a block with that character's exact entry title containing ONLY their current state as short lines — not the rest of their profile; the extension adds it to their existing entry. Existing character entries: ${castTitles.join(', ') || 'none'}.
Do not invent anything that did not happen in the transcript.

Current story-so-far ledger:
${storySoFar || '(empty — this is the first ' + u + ')'}

${unit} ${number} transcript:
${transcript}`;
}

/** Put a character's new CURRENT STATE into their existing entry, replacing an older one; the rest stays untouched. */
export function mergeCurrentState(existing, update) {
  const state = String(update || '').replace(/^\s*[*_#]*\s*CURRENT STATE\s*[*_]*\s*:?\s*\n?/i, '').trim();
  const body = String(existing || '').replace(/\s+$/, '');
  if (!state) return body;
  const section = `CURRENT STATE:\n${state}`;
  const start = body.search(/^[ \t*_#]*CURRENT STATE[ \t*_]*:?[ \t]*$/im);
  if (start < 0) return `${body}\n\n${section}`;
  const rest = body.slice(start).split('\n').slice(1);
  const next = rest.findIndex(line => /^[ \t*_#]*[A-Z][A-Z &/'-]{2,40}:/.test(line));
  const after = next < 0 ? '' : '\n\n' + rest.slice(next).join('\n').trim();
  return `${body.slice(0, start).replace(/\s+$/, '')}\n\n${section}${after}`;
}

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
/**
 * The chat as text. With prose: true, only the story's own messages, without speaker labels —
 * what a reader would see on the page (used by lint, so line numbers match the prose and labels are not read as names).
 */
export function transcriptOf(chat, maxChars = 60000, {prose = false} = {}) {
  const lines = (chat || []).filter(m => m && !m.is_system && String(m.mes || '').trim() && !(prose && m.is_user))
    .map(m => prose ? String(m.mes).trim() : `${m.is_user ? 'USER' : (m.name || 'STORY')}: ${String(m.mes).trim()}`);
  let text = lines.join('\n\n');
  if (text.length > maxChars) text = '…(earlier part of this chapter omitted)…\n\n' + text.slice(-maxChars);
  return {text, messages: lines.length};
}

/** The sealed note for a chapter. Re-sealing replaces only that chapter's note. */
export const summaryTitle = (unit, n) => `Storyloom Memory — ${unit} ${n} Seal`;
export const SEAL_SECTIONS = Object.freeze(['SUMMARY', 'WHAT CHANGED', 'WHAT THE NARRATOR NOW KNOWS', 'MUST NOT DRIFT', 'OPEN THREADS', 'CONTRADICTION']);

/** What the model is asked when a chapter ends: a seal note (writer's format), the ledger, and character states. */
export function chapterEndInstruction({unit = 'Chapter', number, transcript, storySoFar = '', castTitles = [], sealedNotes = '', focus = 'the focus character', narrator = 'the narrator', title = ''}) {
  const u = unit.toLowerCase();
  return `${unit} ${number}${title ? ` — ${title}` : ''} is finished. Below is everything written in its chat. Seal it.
${P('chapterEnd')}
Return these entry blocks:
1. "${summaryTitle(unit, number)}" — the seal note, exactly these headings and limits:
${unit.toUpperCase()} ${number} — ${title || 'its own title'} (when it happens, e.g. Day 1, evening)
SUMMARY: the ${u}'s shape in two sentences, ending where the page ends. 60 words max.
WHAT CHANGED: what is new in ${focus} against the previous seal — deltas only. 90 words max.
WHAT THE NARRATOR NOW KNOWS: ${narrator}'s knowledge, and where that reading was wrong, in the page's terms. 60 words max.
MUST NOT DRIFT: page-specific facts a later ${u} could contradict or must carry — times, standing instructions, promises, objects left somewhere in a state, who was told what, holes opened. Exact wording; only these. 100 words max.
OPEN THREADS: bullets, eight max, twelve words each.
CONTRADICTION: none — or one line, only if this page conflicts with an earlier sealed note.
Do not include: the sequence of events (that is SUMMARY); traits or places the character and place entries already fix, unless this ${u} changed them; dialogue beyond a six-word handle, and only for lines a later scene turns on (a standing instruction, a promise, a lie); a body inventory; anything interpreted rather than read; anything already in an earlier seal unless this ${u} moved it.
Only what is on the page. If the page fights an earlier seal, record the page's version and flag it under CONTRADICTION — never silently choose, never repair canon.
2. "${MEMORY_ITEMS[0].title}" — the complete updated story-so-far ledger: everything from the current version below, plus what this ${u} settled. Keep it as a list grouped by ${u}; never drop earlier items.
3. Only if this ${u} changed a character's situation (injury, relationship, knowledge, location, possessions): a block with that character's exact entry title containing ONLY their current state as short lines — not the rest of their profile; the extension adds it to their existing entry. Existing character entries: ${castTitles.join(', ') || 'none'}.
In your reply, report briefly: the word count of the ${u}, when it happens, the open threads, any contradiction, then one line — the first thing the next drafting pass needs.

Earlier sealed notes:
${sealedNotes || '(none — this is the first sealed ' + u + ')'}

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

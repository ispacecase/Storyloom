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
    hint: 'How the last chapter ended: where things stand (time, weather, where everyone is and how they are, who knows what, things left in a state, promises), everything that happened, a summary, and its last page word for word — so the next chapter carries straight on.',
    header: 'PREVIOUSLY — how the last {unit} ended. Everything under WHERE THINGS STAND is still true when this {unit} begins, unless the story shows time passing or it changing. LAST PAGE is its final words: carry on from there, never repeat it.',
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
export function chapterEndInstruction({unit = 'Chapter', number, transcript, storySoFar = '', castTitles = [], sealedNotes = '', focus = 'the focus character', narrator = 'the narrator', title = '', roleplay = false, player = ''}) {
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
WHERE THINGS STAND: the state of the story at the last line, so the next ${u} begins in the same world. One short line each, starting with a lower-case label, e.g. "- when: …":
- when: day, time of day, how much time the ${u} covered
- conditions: weather, light, temperature, season, sounds — anything in the air or the surroundings
- each person on or near the page: where they are, what they are doing, what shape they are in (hurt, tired, wet, drunk, dressed for…)
- between people: who is angry, hurt, owed, avoiding, unresolved
- knowledge: who knows what, who was told what, who is lying or hiding something
- places and things left in a state: doors, vehicles, letters, food, weapons, money — anything a later page could pick up
- promises, plans, appointments and standing instructions
${roleplay ? `- the player's character${player ? ` (${player})` : ''}: where they are, their condition, what they carry, what they know, what they've promised or decided — the USER lines are what the player made them do and say
` : ''}WHAT HAPPENED: every significant moment of the ${u} in order, one line each — what was done, said, decided, discovered, noticed or went wrong${roleplay ? ', by the player\'s character as well as everyone else' : ''}. Anything a later page could refer back to belongs here.
For WHERE THINGS STAND and WHAT HAPPENED: if in doubt, include it. A missing fact gets contradicted later; an extra line costs nothing. Only what is on the page.
CONTRADICTION: none — or one line, only if this page conflicts with an earlier sealed note.
Do not include: the sequence of events in SUMMARY (it goes under WHAT HAPPENED); traits or places the character and place entries already fix, unless this ${u} changed them; dialogue beyond a six-word handle, and only for lines a later scene turns on (a standing instruction, a promise, a lie); a body inventory; anything interpreted rather than read; anything already in an earlier seal unless this ${u} moved it.
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

/**
 * How much fits in one narrator reply, from the preset's Max Response Length (tokens). A chapter's word total
 * is reached across many replies; without this the narrator tries to write the whole chapter at once and the
 * response limit cuts it off mid-sentence. ~0.6 words per token leaves room for formatting and short thinking.
 */
export function replyWords(maxTokens) {
  const t = Number(maxTokens) || 0;
  if (t <= 0) return 0;
  return Math.min(1500, Math.max(50, Math.floor(t * 0.6 / 50) * 50)); // a passage, not a chapter; thinking shares the limit
}
export function replyLengthNote(maxTokens, unit = 'Chapter', target = 0) {
  const u = unit.toLowerCase(), want = Math.round(Number(target) || 0);
  if (want > 0) return `REPLY LENGTH: aim for about ${want} words in this reply — a full passage of the ${u}, not the whole ${u}, and not much shorter than that. Finish your last sentence. The ${u}'s full length comes from many replies.`;
  const w = replyWords(maxTokens);
  if (!w) return '';
  return `REPLY LENGTH: this reply has room for about ${w} words, no more. Write one passage of the ${u} that fits in that — not the whole ${u} — and finish your last sentence before you reach it. The ${u}'s full length comes from many replies.`;
}
/** Tokens a reply of `words` needs, with room for thinking: ~1.35 tokens a word plus `thinking` tokens. */
export const tokensFor = (words, thinking = 1500) => Math.ceil((Number(words) || 0) * 135 / 100) + thinking;

/** The last page of a chapter, word for word: its final paragraphs, at least ~150 words (at most 3 paragraphs / ~450 words). */
export function lastPage(text, {min = 150, max = 450} = {}) {
  const paras = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  const out = [];
  let words = 0;
  for (let i = paras.length - 1; i >= 0 && out.length < 3; i--) {
    const w = (paras[i].match(/\S+/g) || []).length;
    if (out.length && words + w > max) break;
    out.unshift(paras[i]); words += w;
    if (words >= min) break;
  }
  if (words > max && out.length === 1) { const all = out[0].split(/\s+/); return '…' + all.slice(-max).join(' '); }
  return out.join('\n\n');
}

/** A section under an UPPER-CASE heading ("WHERE THINGS STAND:", "LAST PAGE (…):"), up to the next upper-case heading. Lower-case labels inside ("- when: …") stay in. */
export function capsSection(text, label) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const head = new RegExp(`^[\\s*_#-]*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^:\\n]{0,80}:\\s*(.*)$`);
  const start = lines.findIndex(l => head.test(l));
  if (start < 0) return '';
  const out = [lines[start].match(head)[1]];
  for (const l of lines.slice(start + 1)) {
    if (/^[\s*_#]*[A-Z][A-Z &/'’-]{2,40}(?:\s*\([^)\n]*\))?\s*:/.test(l)) break;
    out.push(l);
  }
  return out.join('\n').trim();
}

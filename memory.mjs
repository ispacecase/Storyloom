/**
 * Chapter memory: text Storyloom injects into the main chat's prompt itself (not via lorebook scanning),
 * with a placement the writer chooses. Stored as switched-off lorebook entries so it travels with the book.
 */
import {P} from './prompt-texts.mjs';

export const MEMORY_ITEMS = Object.freeze([
  {key: 'sofar', title: 'Storyloom Memory — Story So Far', label: 'Story so far',
    hint: 'Everything that has already happened and is settled: events, what characters know, where things are, promises made. Keeps the AI from repeating or contradicting earlier chapters.',
    header: 'STORY SO FAR — reference: what has already happened in this book, settled. Never retell it or contradict it.',
    place: {where: 'chat-start', depth: 0, role: 'system'}},
  {key: 'previously', title: 'Storyloom Memory — Previously', label: 'Previously',
    hint: 'How the last chapter ended: where things stand (time, weather, where everyone is and how they are, who knows what, things left in a state, promises), everything that happened, a summary, and its last page word for word — so the next chapter carries straight on.',
    header: 'PREVIOUSLY — how the last {unit} ended. WHERE THINGS STAND is still true when this {unit} begins, unless the story shows time passing or something changing it. LAST PAGE is the {unit}\'s final words: carry straight on from them and never repeat them.',
    place: {where: 'chat-start', depth: 0, role: 'user'}},
  {key: 'session', title: 'Storyloom Memory — Earlier This Session', label: 'Earlier this chapter',
    hint: 'A running record of this chapter or session so far, written every so often while you write, so a long chapter doesn’t forget its start. Cleared when you Seal (the seal note takes over).',
    header: 'EARLIER IN THIS {UNIT} — what has happened so far in the {unit} you are writing (the latest text follows; keep all of this true):',
    place: {where: 'chat-start', depth: 0, role: 'user'}},
  {key: 'scene', title: 'Storyloom Memory — Scene Now', label: 'Scene now',
    hint: 'Where, when, who’s here and in what shape, the weather and light, what’s in hand — refreshed every few replies so the next one stays consistent.',
    header: 'SCENE NOW — how things stand at this moment. It is the newest record: for the present moment it overrides STORY SO FAR and PREVIOUSLY. Keep to it unless the story changes it.',
    place: {where: 'chat-depth', depth: 1, role: 'user'}},
  {key: 'chapter', title: 'Current Chapter', label: 'This chapter',
    hint: 'The plan for the chapter you are on, from the outline, with its target length and a line for each later chapter. Updated automatically when you change chapter.',
    header: 'THIS {UNIT} — the plan for the {unit} you are writing now:',
    place: {where: 'chat-depth', depth: 1, role: 'user'}},
  {key: 'outline', title: null, label: 'Whole outline', fromOutline: true,
    hint: 'The full outline, including how the book ends. Off by default: models foreshadow and spoil what they can see, and This chapter already lists what comes later so it isn’t used up early. Turn it on if you want the AI to see the whole plan.',
    header: 'FULL OUTLINE — for orientation only. You are writing {Unit} {chapter}. It is here so you know where the story is heading and don\'t use up later {units}\' events; never hint at or foreshadow them, and never write past the end of {Unit} {chapter}.',
    place: {where: 'off', depth: 0, role: 'system'}},
  {key: 'premise', title: null, label: 'The book', fromSummary: true,
    hint: 'The book’s foundation — title, genre, setting, premise, who’s in it — as the narrator gets it: without the plot milestones, arcs and ending, because models foreshadow and spoil what they can see. Edit the foundation itself in the lorebook.',
    header: 'BOOK REFERENCE — the book\'s foundation (canon):',
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
export function transcriptOf(chat, maxChars = 60000, {prose = false, userName = ''} = {}) {
  const lines = (chat || []).filter(m => m && !m.is_system && String(m.mes || '').trim() && !(prose && m.is_user))
    .map(m => prose ? String(m.mes).trim() : `${m.is_user ? (userName || 'USER') : (m.name || 'STORY')}: ${String(m.mes).trim()}`);
  let text = lines.join('\n\n');
  if (text.length > maxChars) text = '…(earlier part of this chapter omitted)…\n\n' + text.slice(-maxChars);
  return {text, messages: lines.length};
}

/** The sealed note for a chapter. Re-sealing replaces only that chapter's note. */
export const summaryTitle = (unit, n) => `Storyloom Memory — ${unit} ${n} Seal`;
export const SEAL_SECTIONS = Object.freeze(['SUMMARY', 'WHAT CHANGED', 'WHAT THE NARRATOR NOW KNOWS', 'MUST NOT DRIFT', 'OPEN THREADS', 'CONTRADICTION']);

/** What the model is asked when a chapter ends: a seal note (writer's format), the ledger, and character states. */
export function chapterEndInstruction({unit = 'Chapter', number, transcript, storySoFar = '', castTitles = [], sealedNotes = '', focus = 'the focus character', narrator = 'the narrator', title = '', roleplay = false, player = '', rules = '', castNames = []}) {
  const u = unit.toLowerCase();
  return `${unit} ${number}${title ? ` — ${title}` : ''} is finished. Below is everything written in its chat. Seal it.
What you write is read by another language model at the start of the next ${u}, which has not seen this one: it is the only way that model knows where things stand, so write plain, specific statements it can use — names, times, places, objects, numbers — never style, never "in this ${u}" commentary.
Summaries written by language models fail in known ways: they drop specifics, over-weight the ending, merge or confuse people, turn guesses into facts and drop negations ("doesn't know", "isn't sure"). Cover the whole ${u} in order; state only what the page states; if you must include something the page only implies, mark it "(inferred)"; keep every "doesn't" and "isn't sure" exactly. A mistake on the page is recorded as a mistake, never smoothed into canon.
${P('chapterEnd')}
Return these entry blocks:
1. "${summaryTitle(unit, number)}" — the seal note, exactly these headings and limits:
${unit.toUpperCase()} ${number} — ${title || 'its own title'} (when it happens, e.g. Day 1, evening)
SUMMARY: the ${u}'s shape in two sentences, ending where the page ends. 60 words max.
WHAT CHANGED: what is new in ${focus} against the previous seal — deltas only. 90 words max.
WHAT THE NARRATOR NOW KNOWS: what ${narrator} knows, believes and suspects at the last line, and anything they believe that is wrong — as plain facts about them (e.g. "knows the ring is gone; believes X took it; doesn't know why"), never comments about the narration. 60 words max.
MUST NOT DRIFT: page-specific facts a later ${u} could contradict or must carry — times, standing instructions, promises, objects left somewhere in a state, who was told what, holes opened, and how anything that will come back looks (what kind of vehicle someone drives, an object's material, colour and size) — each checked against the page before you write it. Exact wording; only these. 100 words max.
OPEN THREADS: bullets, eight max, twelve words each.
WHERE THINGS STAND: the state of the story at the last line, so the next ${u} begins in the same world. One short line each, starting with a lower-case label, e.g. "- when: …":
- when: day, time of day, how much time the ${u} covered
- conditions: weather, light, temperature, season, sounds — anything in the air or the surroundings
- each person on or near the page: where they are, what they are doing, what shape they are in (hurt, tired, wet, drunk, dressed for…)
- between people: who is angry, hurt, owed, avoiding, unresolved
- knowledge: who knows what, who was told what, who is lying or hiding something
- places and things left in a state: doors, vehicles, letters, food, weapons, money — anything a later page could pick up
- how things look: what the page said about anything that may come back — the kind of vehicle, an object's material, colour, size and condition, a room, what people wear — because a later page will describe it again
- promises, plans, appointments and standing instructions
${roleplay ? `- the player's character${player ? ` (${player})` : ''}: where they are, their condition, what they carry, what they know, what they've promised or decided — the ${player ? `${player}:` : 'USER'} lines are what the player made them do and say
` : ''}WHAT HAPPENED: every significant moment of the ${u} in order, one line each — what was done, said, decided, discovered, noticed or went wrong${roleplay ? ', by the player\'s character as well as everyone else' : ''}. Anything a later page could refer back to belongs here.
For WHERE THINGS STAND and WHAT HAPPENED: if in doubt, include it. A missing fact gets contradicted later; an extra line costs nothing. Only what is on the page.
CONTRADICTION: none — or one line each for anything on the page that conflicts with an earlier sealed note, with the book's facts, or with the author's rules — including a named person on the page who isn't in the book${castNames.length ? ` (the book's people: ${castNames.join(', ')})` : ''}. Record what the page says and flag it; never quietly make it canon.${rules ? `
THE AUTHOR'S RULES (check the page against them): ${rules}` : ''}
Do not include: the sequence of events in SUMMARY (it goes under WHAT HAPPENED); traits or places the character and place entries already fix, unless this ${u} changed them; dialogue beyond a six-word handle, and only for lines a later scene turns on (a standing instruction, a promise, a lie); a body inventory; anything interpreted rather than read; anything already in an earlier seal unless this ${u} moved it.
Only what is on the page. If the page fights an earlier seal, record the page's version and flag it under CONTRADICTION — never silently choose, never repair canon.
2. "${MEMORY_ITEMS[0].title}" — the complete updated story-so-far ledger. ${unit}s after the next one see this ledger, not this seal, so it is the only lasting record of this ${u}. Keep everything from the current version below, and add under a heading for this ${u}: what happened, one line per event; what is done and finished (a room searched, a job completed, a question answered — so no later ${u} does it again); and every specific the page fixed — numbers, prices, counts, dates, names, who was told what, and how things look (the kind of vehicle, an object's material, colour and size) — copying the MUST NOT DRIFT facts, so no later ${u} gives a different one. Never drop or shorten earlier items.
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
export function replyWords(maxTokens, thinkingSeen = 0) {
  const t = Number(maxTokens) || 0;
  if (t <= 0) return 0;
  // What the writer's own Max Response Length fits: room kept for thinking (a quarter, at most 1,500 tokens — or as much as this
  // narrator has actually spent thinking lately, which was 9,500 tokens on one test chapter), ~1.35 tokens a word.
  const thinking = Math.max(Math.min(1500, Math.round(t / 4)), Math.round(Number(thinkingSeen) || 0));
  return Math.max(100, Math.floor((t - thinking) * 100 / 135 / 100) * 100);
}
export function replyLengthNote(maxTokens, unit = 'Chapter', target = 0, {roleplay = false, passages = false, number = 0, planned = 0, written = 0, beats = []} = {}) {
  const u = unit.toLowerCase(), U = unit.toUpperCase(), want = Math.round(Number(target) || 0), which = number ? `${unit} ${number}` : `this ${u}`;
  const authorWins = `If the author's latest message asks for something else — a different length, or only part of the ${u} — do what the author asks.`;
  if (passages && !roleplay) { // optional: the chapter over several replies
    const w = want || replyWords(maxTokens), plan = Number(planned) || 0, done = Number(written) || 0;
    if (!w) return '';
    // Pace by the plan's events: a passage told to "cover the next stretch" runs through the whole plan; one told which events it has doesn't.
    const per = plan && beats.length >= 2 ? Math.max(1, Math.round(beats.length * w / plan)) : 0;
    const where = per
      ? ` The ${u} is planned at about ${plan} words and has about ${done} so far. Its planned events, in order:\n${beats.map((b, i) => `${i + 1}. ${b}`).join('\n')}\nThis passage is about ${w} of those ${plan} words, so it covers about ${per === 1 ? 'one of these events' : `${per} of these events`}: the next ${per === 1 ? 'one' : per} the text hasn't reached yet, written out as live scene, moment by moment — what is said and done, not a summary. Stop there: the events after ${per === 1 ? 'it' : 'them'} are for later passages.`
      : plan ? ` The ${u} is planned at about ${plan} words and has about ${done} so far, so this passage is part of it, not all of it: cover only the next stretch of the plan, at full scene pace — don't rush through the rest of the plan to reach its ending.` : ` The ${u} is built over several replies: cover only the next stretch of its plan, at full scene pace.`;
    const near = plan && done + w >= plan * 0.8;
    const end = near ? ` If this passage reaches the ending the ${u}'s plan describes, finish the prose, then add one last line on its own: [END OF ${U}]. Otherwise leave that line out. If the text above has already reached that ending, the ${u} is finished: write nothing else but the line [END OF ${U}].` : ` The ${u} isn't near its end yet: don't end it in this passage and don't add any end-of-${u} line.`;
    return `WHAT TO WRITE NOW: the next passage of ${which}, ${want ? `about ${w} words` : `up to about ${w} words (what fits in this reply)`}.${where} Carry straight on from where the text stops without repeating it, and finish your last sentence.${end} If the author's latest message asks for a different length, do what the author asks.`;
  }
  if (roleplay) { // a reply is one turn of the game, not a whole session
    const w = want || replyWords(maxTokens);
    return w ? `WHAT TO WRITE NOW: answer the player's turn — ${want ? `about ${w} words` : `up to about ${w} words`}. Show how the world and everyone in it respond, move the scene a step, and stop where it's their move. Finish your last sentence. If the player asks for a different length, follow the player.` : '';
  }
  const room = replyWords(maxTokens);
  if (!want && !room) return '';
  const end = `When you reach the ending this ${u}'s plan describes, finish the prose, then add one last line on its own: [END OF ${U}]. Only then — never before the planned ending; if you stop before it, leave that line out.`;
  const plan = Number(planned) || 0, fits = want && plan && want < plan;
  if (written > 0) {
    const left = plan ? Math.max(0, plan - written) : 0, w = left ? Math.min(left, room || left) : room;
    return `WHAT TO WRITE NOW: carry on ${which} from exactly where the text stops — don't repeat or restate its last lines — through to the ending its plan describes${w ? `, up to about ${w} more words` : ''}. Never move the story past that ending or into a later ${u}'s events. If the text has already reached the ending this ${u}'s plan describes, the ${u} is finished: write nothing else but the line [END OF ${U}]. ${end} ${authorWins}`;
  }
  const w = want || room;
  if (fits) return `WHAT TO WRITE NOW: ${which}, as much of it as fits in this reply — about ${w} words (the ${u} is planned at ${plan}). Write it scene by scene from where the story stands; stop at the end of a scene and finish your last sentence. ${end} ${authorWins}`;
  const floor = want ? Math.round(w * 0.85 / 100) * 100 : 0;
  return `WHAT TO WRITE NOW: ${which} — the whole ${u}, in this reply, about ${w} words${want ? `, its planned length (at least ${floor})` : ' (what fits in this reply)'}, from where the story stands through to the ending its plan describes. Language models usually stop at about two-thirds of the length they're asked for; you have room for all of it. Reach the length by writing each planned beat as a full scene — the arrival, what is said and done, written out rather than summarised, what it costs, the turn — never by adding events the plan doesn't have. Plan the scenes so the last gets as much room as the first, and if you reach the plan's last beat well short of the length, slow that last scene down and write it moment by moment before you end. ${end} ${authorWins}`;
}
/** A chapter plan's events in order, one per sentence or bullet (from its Events section if it has one) — for pacing a chapter written bit by bit. */
export function planBeats(planText) {
  const t = String(planText || '').replace(/\r\n?/g, '\n');
  const ev = t.match(/^[\s*_-]*Events[\s*_]*:[ \t]*([\s\S]*?)(?=^[\s*_-]*[A-Z][A-Za-z ,&'’-]{2,40}:|^Later [a-z]+s —|^This is the last |(?![\s\S]))/m);
  const body = ev ? ev[1] : '';
  if (!body.trim()) return [];
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const items = lines.length > 1 && lines.every(l => /^([-*•]|\d+[.)])\s/.test(l))
    ? lines.map(l => l.replace(/^([-*•]|\d+[.)])\s+/, ''))
    : body.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z“"])/);
  return items.map(x => x.trim()).filter(x => x.split(/\s+/).length >= 5).slice(0, 12);
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

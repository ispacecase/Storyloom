/**
 * The chapter team, modelled on how a publisher handles a manuscript:
 * Checker (copyeditor + continuity) → Editor marks up → Reader (beta reader) reacts → writer approves notes →
 * Editor revises → Seal signs off and writes the seal note.
 * Each role has a JOB (locked: the reply format the pipeline reads) and a PERSONALITY (editable by the writer).
 */
import {paragraphs, quote} from './lint.mjs';

export const ROLES = Object.freeze({
  checker: {label: 'Checker', step: 'Lint', model: 'copyeditor and continuity checker',
    job: 'Checks grammar, spelling and punctuation, and checks the chapter against the book — character voices, the outline, the timeline, the period, the writer’s rules, point of view and tense. Quotes the exact line and names the rule it breaks. Never rewrites.',
    persona: 'You are the Checker: a meticulous copyeditor and continuity checker. You are literal and exact, and you have no opinions about taste — you do not care whether a sentence is pretty, only whether it is correct and consistent with the book. You never rewrite. When you are not sure something is wrong, you say “possible” instead of guessing.',
    sampling: {temperature: 0.2}},
  editor: {label: 'Editor', step: 'Editor', model: 'line and story editor',
    job: 'Pass 1: marks up the pages with notes pinned to exact passages — what should change and why. Pass 2: revises the chapter, fixing only the notes the writer approved.',
    persona: 'You are the Editor: an experienced line and story editor. You protect the writer’s voice above everything and make the smallest change that fixes a problem. You are firm but respectful and always say why. You never add characters, events or plot, and you never “improve” what is not broken.',
    sampling: {temperature: 0.5}},
  reader: {label: 'Reader', step: 'Reader', model: 'beta reader',
    job: 'Reads the chapter like someone who picked up the book, knowing only what came before. Marks where they got lost, didn’t believe something, got bored, or something didn’t land. Doesn’t fix grammar and doesn’t rewrite.',
    persona: 'You are the Reader: an honest, plain-spoken beta reader who reads a lot. You react as a reader, not a writer — “I didn’t buy that she’d forgive him this fast”, “I lost track of who was talking here”. You are candid but never cruel, and you say what worked as well as what didn’t, briefly.',
    sampling: {temperature: 0.7}},
  seal: {label: 'Seal', step: 'Seal', model: 'archivist',
    job: 'Signs off the finished chapter and writes its seal note: summary, what changed, what the narrator now knows, what must not drift, open threads. Updates Story so far.',
    persona: 'You are Seal, the archivist. You are terse, factual and exact. You record only what is actually on the page, never fix or invent canon, and when something contradicts an earlier chapter you flag it instead of smoothing it over.',
    sampling: {temperature: 0.2}},
});
export const ROLE_KEYS = Object.freeze(Object.keys(ROLES));
/** Steps in order, with the role that does each one. */
export const STEPS = Object.freeze([
  {key: 'lint', role: 'checker', label: 'Lint', hint: 'Checks grammar and the chapter against the book. You tick which findings to act on.'},
  {key: 'markup', role: 'editor', label: 'Editor', hint: 'Marks up the pages: notes on exact passages saying what should change and why. Nothing is rewritten yet.'},
  {key: 'reader', role: 'reader', label: 'Reader', hint: 'Reads it like a reader and marks what doesn’t make sense, drags or doesn’t land.'},
  {key: 'revise', role: 'editor', label: 'Revise', hint: 'You keep or untick the notes; the Editor fixes the ones you kept. You see the changes and accept or discard.'},
  {key: 'seal', role: 'seal', label: 'Seal', hint: 'Signs the chapter off, writes the seal note, updates Story so far, then asks what’s next.'},
]);

/** The writer's role settings merged over the defaults. */
export function roleSettings(stored = {}) {
  return Object.fromEntries(ROLE_KEYS.map(k => {
    const s = stored?.[k] || {};
    return [k, {enabled: s.enabled !== false, profile: s.profile || '', persona: String(s.persona || '').trim() || ROLES[k].persona, edited: !!String(s.persona || '').trim()}];
  }));
}
/** System prompt for a role: personality plus any instruction the writer gave for this chapter only. */
export function roleSystem(key, settings, chapterNote = '') {
  const persona = settings?.[key]?.persona || ROLES[key].persona;
  return chapterNote ? `${persona}\n\nFOR THIS CHAPTER ONLY (the writer’s instruction — it overrides the book-wide voice rules where they differ):\n${chapterNote}` : persona;
}
/** Steps that will run, given which roles are on. Lint and Seal always run (lint has exact checks; seal is the sign-off). */
export const activeSteps = settings => STEPS.filter(s => s.key === 'lint' || s.key === 'seal' || settings?.[s.role]?.enabled !== false);

/** The chapter as numbered paragraphs, with a header before each chat message (part) so a revision can be put back. */
export function numberedParts(parts) {
  let n = 0;
  return parts.map((text, i) => `--- PART ${i + 1} ---\n${paragraphs(text).map(p => `${++n}| ${p.text}`).join('\n')}`).join('\n');
}

const NOTE_LINE = /^\s*[-*•]?\s*(?:\[?(must|suggest|hard|soft)\]?\s*[:,-]?\s*)?line\s*(\d+)\s*:?\s*[“"](.+?)[”"]\s*[—–-]+\s*(.+)$/i;
/** Read notes like: - [must|suggest] line N: "quote" — note. */
export function parseNotes(text, source) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(NOTE_LINE);
    if (m) out.push({source, weight: /must|hard/i.test(m[1] || '') ? 'must' : 'suggest', where: `line ${m[2]}`, quote: m[3].trim(), note: m[4].trim()});
  }
  return out;
}
export const overallLine = text => (String(text || '').match(/^\s*OVERALL\s*:\s*(.+)$/mi) || [])[1]?.trim() || '';

/** Editor pass 1: mark up the pages. */
export function markupInstruction({unit = 'Chapter', number = 1, parts = [], facts = '', findings = []}) {
  const missing = findings.filter(f => f.kind === 'PLAN'); findings = findings.filter(f => f.kind !== 'PLAN');
  return `Mark up ${unit} ${number}. Do not rewrite it — write editing notes pinned to exact passages, the way an editor marks up pages.
${missing.length ? `Still to write (the writer will write these in the chat; do not write them and do not make notes asking for them): ${missing.map(f => `"${f.quote}"`).join('; ')}.\n` : ''}${findings.length ? `The writer approved these findings from the check. Write a note for each one saying how to fix it (they come first):\n${findings.map(f => `- ${f.where || ''} ${f.kind}: "${f.quote}" — ${f.rule}`).join('\n')}\n\nThen add` : 'Write'} any other notes a good line and story editor would make: clarity, pacing, flat or overwritten sentences, dialogue that doesn’t sound like the person, scenes that don’t do their job in the outline. Fewer, better notes beat many small ones. Leave alone what works.
Each line of the chapter is numbered ("12| …"). Write one line per note, exactly like this:
- [must|suggest] line N: "exact quote from that line, under 20 words" — what should change and why, in one or two sentences
Mark it must if it breaks the book or the writer's rules, suggest if it is your judgment.
After the notes write one line: OVERALL: your one-sentence verdict on the ${unit.toLowerCase()}.

THE BOOK'S FACTS
${facts}

${unit.toUpperCase()} ${number}
${numberedParts(parts)}`;
}

/** Reader: only the chapter and what came before — not the plan, so it reacts like a real reader. */
export function readerInstruction({unit = 'Chapter', number = 1, parts = [], storySoFar = '', previously = ''}) {
  return `Read ${unit} ${number} as a reader would. You have not seen the author's plan or notes — only the story so far, below. Mark the places where, as a reader, you got lost or confused, didn't believe something, got bored, couldn't tell who was speaking, or where something should have landed and didn't. Also mark at most two places that really worked.
Do not fix grammar. Do not rewrite. Speak as a reader ("I", "me"), not a writer.
Each line is numbered ("12| …"). Write one line per reaction, exactly like this:
- [must|suggest] line N: "exact quote from that line, under 20 words" — your reaction as a reader
Use must for places that would make you stop reading or lose the thread, suggest for the rest. For a place that worked, start the reaction with "Worked:".
After the reactions write one line: OVERALL: how the ${unit.toLowerCase()} felt to read, in one sentence.

THE STORY SO FAR (what a reader already knows)
${storySoFar || '(this is the beginning of the book)'}
${previously ? `\nLAST ${unit.toUpperCase()}\n${previously}\n` : ''}
${unit.toUpperCase()} ${number}
${numberedParts(parts)}`;
}

/** Editor pass 2: revise, fixing only the approved notes, returning every part. */
export function reviseInstruction({unit = 'Chapter', number = 1, parts = [], facts = '', notes = []}) {
  return `Revise ${unit} ${number}, fixing exactly the notes below and nothing else. Keep everything that no note touches word for word. Keep the writer's voice, point of view and tense. Do not add characters, events or plot. Do not summarise or shorten.
THE APPROVED NOTES
${notes.map(n => `- ${n.where}: "${n.quote}" — ${n.note}`).join('\n')}

Return the whole ${unit.toLowerCase()}, part by part, without line numbers, in exactly this form:
=== PART 1
(the full text of part 1)
=== PART 2
(the full text of part 2)
=== END
There are ${parts.length} part${parts.length === 1 ? '' : 's'}; return all of them, in order, even ones you did not change.

THE BOOK'S FACTS (for reference)
${facts}

${unit.toUpperCase()} ${number} AS WRITTEN
${numberedParts(parts)}`;
}
/** Read the revision back. Returns null unless every part came back. */
export function parseRevision(text, count) {
  const body = String(text || '').replace(/\r\n?/g, '\n');
  const got = [];
  const re = /^===\s*PART\s*(\d+)\s*$\n([\s\S]*?)(?=^===\s*(?:PART\s*\d+|END)\s*$|(?![\s\S]))/gmi;
  for (const m of body.matchAll(re)) got[Number(m[1]) - 1] = m[2].replace(/^\s*\d+\|\s?/gm, '').trim();
  if (got.length !== count) return null;
  for (let i = 0; i < count; i++) if (!got[i]) return null;
  return got;
}

/** Word-level difference for showing what the revision changed. */
export function wordDiff(a, b) {
  const x = String(a).split(/(\s+)/), y = String(b).split(/(\s+)/);
  if (x.length * y.length > 4e6) return [{op: 'del', text: a}, {op: 'add', text: b}];
  const L = Array.from({length: x.length + 1}, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [], push = (op, text) => { const last = out[out.length - 1]; if (last?.op === op) last.text += text; else out.push({op, text}); };
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { push('same', x[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push('del', x[i++]);
    else push('add', y[j++]);
  }
  while (i < x.length) push('del', x[i++]);
  while (j < y.length) push('add', y[j++]);
  return coalesce(out);
}
/** Join changes separated only by spaces or one or two words, so a rewritten phrase reads as old → new instead of interleaved words. */
function coalesce(ops) {
  const small = t => !/\n/.test(t) && (!t.trim() || t.trim().split(/\s+/).length <= 2);
  const out = [];
  for (let i = 0; i < ops.length;) {
    if (ops[i].op === 'same') { out.push(ops[i++]); continue; }
    let del = '', add = '', j = i;
    while (j < ops.length && (ops[j].op !== 'same' || (small(ops[j].text) && ops[j + 1] && ops[j + 1].op !== 'same'))) {
      if (ops[j].op !== 'add') del += ops[j].text;
      if (ops[j].op !== 'del') add += ops[j].text;
      j++;
    }
    if (del) out.push({op: 'del', text: del});
    if (add) out.push({op: 'add', text: add});
    i = j;
  }
  return out;
}

/* ---------- Narrators ---------- */
/** Suggested headings for a narrator's instructions — guidance, not a form. */
export const NARRATOR_TEMPLATE = Object.freeze([
  ['WHO NARRATES', 'Whose story this is told through, and their relationship to the events.'],
  ['POINT OF VIEW', 'First, close third, distant third…; how deep inside their head the narration sits.'],
  ['TENSE', 'Past or present.'],
  ['REGISTER AND VOICE', 'Diction, sentence rhythm, how rough or polished, recurring habits of speech and thought.'],
  ['WHAT THEY KNOW', 'What the narrator knows, doesn’t know, and must not reveal yet at this point in the book.'],
  ['RELIABILITY', 'Whether to trust them, and how any unreliability shows.'],
  ['TONE', 'The emotional temperature of the narration.'],
  ['FORMAT', 'Length per reply, paragraphing, how dialogue is set out.'],
  ['NEVER', 'The writer’s never/don’ts for this narrator.'],
]);
/** Ask for narrator instructions: the template guides, the story decides. */
export function narratorInstruction({unit = 'Chapter', number = 1, wish = '', facts = '', previous = '', template = NARRATOR_TEMPLATE, roleplay = false}) {
  const u = unit.toLowerCase();
  return `Set up the AI that will narrate ${unit} ${number} of this book in the writer's SillyTavern chat. You are not writing the story; you are writing the narrator's instructions. They go into five different places, and each place has one job. Write each part for its place, and never say the same rule twice in different words: when two places disagree, the model follows the one nearer the end.

The writer wants: ${wish || `(no specific wish — work it out from the outline for this ${u})`}

How to write good instructions:
- Plain prose, no markdown, no bullet lists of "never" rules. Say what to do and, in a few words, why: the model follows reasons better than bans.
- Be specific to this book: names, places, what this narrator would and would not notice.
- ${roleplay ? 'The writer plays a character in this chat: the narrator never writes that character\'s words, thoughts or actions.' : 'This is a novel: the narrator writes every character. The writer\'s messages are the author\'s directions, not dialogue in the story.'}

THE FIVE PARTS
1. DESCRIPTION — the narrator's always-present reference card, under 450 words. Use these headings as a guide: use the ones that matter, skip what doesn't apply, add your own where this story needs it:
${template.map(([h, d]) => `   - ${h}: ${d}`).join('\n')}
   End it with SAMPLE OF THE VOICE: a passage of 60 to 100 words in exactly the narrator's voice, point of view and tense, about something ordinary in this world (not an event from the outline). Label it as a style sample only, not text to reuse.
2. MAIN PROMPT — three to five sentences, the narrator's standing role: who it is (one sentence), what the writer's messages are, point of view, tense and voice (with the reason), how long a reply should be and where to stop (a natural beat, not the end of the ${u}), and to follow the description, the lorebook and the ${u} plan it is given.
3. CHARACTER NOTE — one to three short lines that restate point of view, tense and voice. It is repeated near the newest text so the narrator does not drift.
4. POST-HISTORY — two to four short lines read last, just before the narrator writes: the rules most likely to slip (reply length, tense, the one or two habits to avoid in this voice). Positive wording, and nothing that contradicts the main prompt.
5. TEAM NOTES — for this ${u} only, or "none":
   CHECKER NOTE: what the Checker should accept as intended (e.g. "first person, Danny, the rough register is deliberate").
   EDITOR NOTE: what the Editor must preserve (e.g. "keep Danny's roughness; don't polish it into Ruth's voice").

Reply in exactly this form:
=== DESCRIPTION
(part 1)
=== MAIN PROMPT
(part 2)
=== CHARACTER NOTE
(part 3)
=== POST-HISTORY
(part 4)
=== NOTES
CHECKER NOTE: …
EDITOR NOTE: …
=== END
${previous ? `\nTHE CURRENT NARRATOR'S DESCRIPTION (for contrast; keep what fits, drop what doesn't)\n${previous}\n` : ''}
THE BOOK'S FACTS
${facts}`;
}
const section = (s, name, next) => (s.match(new RegExp(`^===\\s*(?:${name})\\s*$\\n([\\s\\S]*?)(?=^===\\s*(?:${next})\\s*$|(?![\\s\\S]))`, 'mi')) || [])[1]?.trim() || '';
export function parseNarrator(text) {
  const s = String(text || '').replace(/\r\n?/g, '\n');
  const after = 'MAIN PROMPT|CHARACTER NOTE|POST-HISTORY|NOTES|END';
  const body = section(s, 'DESCRIPTION|NARRATOR', after);
  const mainPrompt = section(s, 'MAIN PROMPT', 'CHARACTER NOTE|POST-HISTORY|NOTES|END');
  const charNote = section(s, 'CHARACTER NOTE', 'POST-HISTORY|NOTES|END');
  const postHistory = section(s, 'POST-HISTORY', 'NOTES|END');
  const note = label => { const v = (s.match(new RegExp(`^\\s*${label}\\s*NOTE\\s*:\\s*(.+)$`, 'mi')) || [])[1]?.trim() || ''; return /^none\.?$/i.test(v) ? '' : v; };
  return body ? {instructions: body, mainPrompt, charNote, postHistory, checkerNote: note('CHECKER'), editorNote: note('EDITOR')} : null;
}
/** Who narrates, read from instructions text ("WHO NARRATES: Danny…"). */
export function narratorLabel(instructions) {
  const m = String(instructions || '').match(/^\s*WHO NARRATES\s*:\s*(.+)$/mi);
  return m ? quote(m[1], 60) : '';
}
/** Earlier narrators that fit what this chapter needs, best first: name match in the wish or the chapter plan. */
export function suggestNarrators(registry = [], {wish = '', chapterPlan = '', current = ''} = {}) {
  const hay = `${wish}\n${chapterPlan}`.toLocaleLowerCase();
  const score = n => {
    const who = `${n.who || ''} ${n.name || ''}`.toLocaleLowerCase().split(/[^\p{L}]+/u).filter(w => w.length > 2 && !['the', 'and', 'narrator', 'chapter', 'person', 'first', 'third', 'close'].includes(w));
    return who.filter(w => hay.includes(w)).length;
  };
  return registry.filter(n => n.avatar !== current).map(n => ({...n, score: score(n)})).filter(n => n.score > 0).sort((a, b) => b.score - a.score);
}

/** The narrator template as editable text: one "HEADING: what it covers" per line. */
export const narratorTemplateText = (t = NARRATOR_TEMPLATE) => t.map(([h, d]) => `${h}: ${d}`).join('\n');
/** Read an edited narrator template; lines without "HEADING:" are ignored. Empty → the default. */
export function parseNarratorTemplate(text) {
  const rows = String(text || '').split('\n').map(l => l.match(/^\s*[-*]?\s*([A-Z][A-Z0-9 &/'’-]{1,40})\s*:\s*(.*)$/)).filter(Boolean).map(m => [m[1].trim(), m[2].trim()]);
  return rows.length ? rows : NARRATOR_TEMPLATE;
}
/** A default Main Prompt for a narrator when the writer writes the instructions themselves. */
export const defaultMainPrompt = (book = 'this book') => `You are the narrator of ${book}. Write only the story, in prose, following your character description, the lorebook and the current chapter plan. Stop at a natural beat and let the writer continue.`;

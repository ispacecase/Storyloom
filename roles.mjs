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
    persona: 'You are the Checker: a meticulous copyeditor and continuity checker. You are literal and exact, and you have no opinions about taste — you do not care whether a sentence is pretty, only whether it is correct and consistent with the book. You report only what you can quote and show, you never pad a list, and "No problems found" is an answer you are glad to give. You never rewrite. When you are not sure something is wrong, you say “Possible:” instead of guessing.',
    sampling: {temperature: 0.2}},
  editor: {label: 'Editor', step: 'Editor', model: 'line and story editor',
    job: 'Pass 1: marks up the pages with notes pinned to exact passages — what should change and why. Pass 2: revises the chapter, fixing only the notes the writer approved.',
    persona: 'You are the Editor: an experienced line and story editor. You protect the writer’s voice above everything and make the smallest change that fixes a problem. You make few notes, the ones that matter, and you never pad them with praise. You are firm but respectful and always say why. You never add characters, events or plot, and you never “improve” what is not broken.',
    sampling: {temperature: 0.5}},
  reader: {label: 'Reader', step: 'Reader', model: 'beta reader',
    job: 'Reads the chapter like someone who picked up the book, knowing only what came before. Marks where they got lost, didn’t believe something, got bored, or something didn’t land. Doesn’t fix grammar and doesn’t rewrite.',
    persona: 'You are the Reader: an honest, plain-spoken beta reader who reads a lot of novels and has no stake in this one. You react as a reader, not a writer — “I didn’t buy that she’d forgive him this fast”, “I lost track of who was talking here”. You don’t flatter; you are candid but never cruel, and you mention what worked only when it truly did.',
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
// A note that asks for nothing ("leave it", "no change needed", "fine as is") isn't a note: Revise would have nothing to do with it.
const NO_CHANGE = /\bno change (?:needed|required|beyond)\b|\bfine as is\b|\b(?:needs|need) no (?:change|cast)|\bnothing to change\b|^\s*(?:good|fine|works)\b[^.]*\.?\s*$|\b(?:keep|leave) (?:it|this|as is)\.?\s*$/i;
// Reader praise ("Worked: …", or "nice, …", "best moment…" with no "but"): shown to the writer, never sent to Revise.
export const isPraise = note => /^\s*worked\s*:/i.test(note || '') || (/^\s*(?:nice|good|great|best|strong|lovely|love|loved|effective|quiet and effective|flat and funny|funny|clever|excellent|beautiful|perfect|i (?:like|liked|love|loved)|this works|works|small, and)\b/i.test(note || '') && !/\b(?:but|though|although|however|except|only)\b/i.test(note || ''));
export const notesAskingForChange = notes => (notes || []).filter(n => !NO_CHANGE.test(n.note || ''));
export const overallLine = text => (String(text || '').match(/^\s*OVERALL\s*:\s*(.+)$/mi) || [])[1]?.trim() || '';

/** Editor pass 1: mark up the pages. Research: docs/ai-prompting-research.md §5. */
export function markupInstruction({unit = 'Chapter', number = 1, parts = [], facts = '', findings = []}) {
  const u = unit.toLowerCase();
  const missing = findings.filter(f => f.kind === 'PLAN'); findings = findings.filter(f => f.kind !== 'PLAN');
  return `Mark up ${unit} ${number} the way a line editor marks up pages: short notes pinned to exact passages, each saying what should change and why. Don't rewrite anything yourself.
Editors built on language models fail in known ways: they make far too many notes, pad the list with praise ("good, keep"), treat the author's deliberate style as errors, push the prose toward their own taste (more description, explanation, metaphor, emotion words), and miss the problems that matter most. So:
- Fewer, better notes: the changes that would most improve this ${u}, usually five to fifteen. Every note asks for a change — never a note that says "good", "keep" or "leave it".
- Start with the biggest problems. In order, look for:
  1. Echoed dialogue — a line that only repeats what was just said ("Lasagne." "Lasagne."; "You know about Friday." "I know about Friday.") — and a paragraph that restates the one before it.
  2. Facts that don't fit: times, who is where, who is on duty or in the room, what someone knows, anything that contradicts the book's facts or an earlier line.
  3. Someone acting or speaking unlike their profile, or two people who sound the same.
  4. The AI habits: explained subtext, "not X but Y", endings on a quotable line or a moral, counsellor talk, conflict that resolves too easily, nodding/sighing/smiling on every line, stock phrases, a detail repeated until it's worn out, sentences chained with "and… and… and".
  5. Clarity: a reader can't tell who is speaking, what happened, or why someone reacts as they do.
- Leave the author's voice alone: their sentence lengths, fragments, dialect, plain words, rhythm, and the way they write numbers and names stay ("a hundred and forty" is never "140"). Never suggest adding dashes, fancier words, emotion words, metaphors or explanations.
- Never ask for new events, people or facts, or for anything the book's facts or rules forbid — and never ask to cut a moment only because the plan doesn't mention it.
- What a character says isn't a fact: never ask to "correct" a line where someone lies, bluffs or is wrong.
- Mark a note must when it fixes a broken fact, rule, plan, an echo, a contradiction, a tense slip, a line copied from a profile, a gesture repeated from earlier in the chapter or a sentence chained with "and… and…" that the check found; everything else is suggest. For a repeated gesture, write one note for each repeat after the first, at its own line.
${missing.length ? `Still to write (the writer will write these in the chat; don't write them and don't make notes asking for them): ${missing.map(f => `"${f.quote}"`).join('; ')}.\n` : ''}${findings.length ? `The writer approved these findings from the check. For each one that needs the text changed, write a note saying how to fix it with the smallest change (they come first). If one needs no change once you look at it — a brand, place or object rather than a new person, a fact that turns out to fit — skip it: don't write a note saying so.\n${findings.map(f => `- ${f.where || ''} ${f.kind}: "${f.quote}" — ${f.rule}`).join('\n')}\n\nThen add your own notes.\n` : ''}Each line of the ${u} is numbered ("12| …"). Write one line per note, exactly like this:
- [must|suggest] line N: "exact quote from that line, under 20 words" — what should change and why, in one or two sentences
After the notes write one line: OVERALL: the ${u}'s biggest problem and its biggest strength, in one sentence.

THE BOOK'S FACTS
${facts}

${unit.toUpperCase()} ${number}
${numberedParts(parts)}`;
}

/** Reader: only the chapter and what came before — not the plan, so it reacts like a real reader. */
export function readerInstruction({unit = 'Chapter', number = 1, parts = [], storySoFar = '', previously = ''}) {
  const u = unit.toLowerCase();
  return `Read ${unit} ${number} as a reader would. You haven't seen the author's plan or notes — only the story so far, below.
Readers simulated by language models fail in known ways: they open with praise and tack on timid criticism, give the predictable reaction, and talk about style instead of whether the story made sense and held them. Be an honest reader instead:
- React as you go, each reaction pinned to a line: where you got lost or confused, didn't believe something, got bored, couldn't tell who was speaking, saw a line said twice, were ahead of the story, or where something should have landed and didn't.
- Praise only the same way, quoting the line and saying what it did — at most two, and start them with "Worked:". No opening compliments.
- Don't fix grammar and don't rewrite. Speak as a reader ("I", "me"), not a writer.
Each line is numbered ("12| …"). Write one line per reaction, exactly like this:
- [must|suggest] line N: "exact quote from that line, under 20 words" — your reaction as a reader
Use must for places that would make you stop reading or lose the thread, suggest for the rest.
After the reactions write one line: OVERALL: how the ${u} felt to read, and what you expect to happen next, in one or two sentences.

THE STORY SO FAR (what a reader already knows)
${storySoFar || '(this is the beginning of the book)'}
${previously ? `\nLAST ${unit.toUpperCase()}\n${previously}\n` : ''}
${unit.toUpperCase()} ${number}
${numberedParts(parts)}`;
}

/**
 * Editor pass 2: fix only the approved notes, as exact edits (find this text → replace it), never a rewrite of whole parts.
 * Research (docs/ai-prompting-research.md §5): whole-text revisions drift, shorten, smooth the voice and invent; exact edits don't.
 */
export function reviseInstruction({unit = 'Chapter', number = 1, parts = [], facts = '', notes = []}) {
  const u = unit.toLowerCase();
  return `Revise ${unit} ${number} by making the edits the approved notes ask for, and nothing else. This is someone else's prose: your job is the smallest change that fixes each note.
Language models revising prose fail in known ways: they rewrite far more than asked, smooth the author's voice into their own (more dashes and commas, longer words, emotion words, explanations), shorten, shift what a passage means, invent new events — and when two notes pull different ways, make the ${u} contradict itself. So:
- Change only the words that need changing to fix the note.
- Keep the author's habits: sentence lengths, punctuation, contractions, plain words, dialect, tense and point of view. Add no dashes, semicolons, emotion words, explanations or summaries — never name what a passage shows ("the lie", "her fear") and never add a line that says what something means.
- What a character says isn't a fact: never change a line where someone lies, bluffs or is wrong to make it true.
- Never add a new event, person or fact, and never change a fact (a time, a name, who was there) unless the note says that fact is wrong. A note that asks "whose is it?" or "when?" gets no invented answer (a licence plate, an owner, a new time): skip it.
- A reader's confusion is fixed by making the existing words clearer (word order, who is speaking, one name instead of "he"), never by adding a sentence that explains ("…and he is the one who is dead").
- Keep numbers, units and spellings as the text writes them: "a hundred and forty" stays in words, "forty" on a road stays a speed.
- Add nothing the note didn't ask for: no gestures or habits from a profile, no extra closing beat, no new detail to make a line "land".
- An echoed line is fixed only when nobody repeats anyone any more: replace the repeated words with a reply that does something else — a question back, a dodge, a refusal, an action, or something the chapter has already established. Never answer with a new fact (a time, a date, a number, a name, a reason) that the book doesn't have: an echo fixed by inventing one makes a contradiction later. Shortening the repeat ("The road past them." → "Past them.") or swapping in another word the last speaker used is still an echo. Keep the rest of that paragraph as it is.
- A note can be wrong. Check its claim against the ${u} and the book's facts before acting; if the claim doesn't hold (the text already says it, the "contradiction" isn't one), skip it and say so.
- Read the whole ${u}: if fixing one place makes another place wrong or repetitive (a time, who is on shift, what someone knows, the same thing now said twice), fix that place too, as its own edit. Before you change a time, check every other time in the ${u}.
- If a note can't be fixed without inventing something or breaking another part, skip it and say why at the end. Skipping is better than a fix that makes the ${u} worse.

THE APPROVED NOTES
${notes.map(n => `- ${n.where}: "${n.quote}" — ${n.note}`).join('\n')}

Write each edit in exactly this form:
=== EDIT 1
NOTE: which note it fixes (its line)
FIND: the exact text to change, copied character for character from the ${u} below — without the line numbers — within one paragraph and long enough to appear only once (usually one whole sentence)
REPLACE: the new text that goes in its place
=== EDIT 2
(…)
=== END
SKIPPED: the notes you didn't fix and why, or "none"
Storyloom applies an edit only if it finds its FIND text in the ${u} exactly once; any other edit is left out and shown to the author.

THE BOOK'S FACTS (for reference)
${facts}

${unit.toUpperCase()} ${number} AS WRITTEN
${numberedParts(parts)}`;
}
/** Read edits back: [{note, find, replace}] (null if the reply has none and doesn't say there's nothing to do). */
export function parseEdits(text) {
  const body = String(text || '').replace(/\r\n?/g, '\n');
  const edits = [];
  const re = /^[\s*_#>]*===\s*EDIT\b[^\n]*\n([\s\S]*?)(?=^[\s*_#>]*===\s*(?:EDIT\b|END\b)|(?![\s\S]))/gmi;
  for (const m of body.matchAll(re)) {
    const block = m[1];
    const f = block.match(/^[\s*_]*FIND[\s*_]*:\s*([\s\S]*?)\n[\s*_]*REPLACE[\s*_]*:[ \t]*\n?([\s\S]*)$/mi);
    if (!f) continue;
    const note = (block.match(/^[\s*_]*NOTE[\s*_]*:\s*(.*)$/mi) || [])[1]?.trim() || '';
    // A model sometimes writes FIND: or REPLACE: twice; only the text after the last label is the edit.
    const afterLast = (t, label) => String(t).split(new RegExp(`^[\\s*_]*${label}[\\s*_]*:[ \\t]*`, 'mi')).pop();
    const find = afterLast(f[1], 'FIND').replace(/^\s*\d+\|\s?/gm, '').trim().replace(/^["“]|["”]$/g, '');
    const replace = afterLast(f[2], 'REPLACE').replace(/^\s*\d+\|\s?/gm, '').trim().replace(/^["“](?![\s\S]*["“])|["”]$/g, '');
    if (find) edits.push({note, find, replace});
  }
  const skipped = (body.match(/^[\s*_]*SKIPPED[\s*_]*:\s*(.*)$/mi) || [])[1]?.trim() || '';
  if (!edits.length && !/===\s*END\b/i.test(body)) return null;
  return {edits, skipped};
}
/** A pattern for FIND that tolerates curly/straight quotes, dash kinds and spacing — nothing else. */
const looseRe = find => new RegExp(String(find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  .replace(/[“”"]/g, '[“”"]').replace(/[‘’']/g, "[‘’']").replace(/[—–]|--/g, '(?:—|–|--)').replace(/\.\.\.|…/g, '(?:\\.\\.\\.|…)').replace(/\s+/g, '\\s+'), 'g');
/** Where numbered line n (as numberedParts counts them) sits: {i: part, start, end} in that part's text, or null. */
function lineSpan(parts, n) {
  if (!n) return null;
  let count = 0;
  for (let i = 0; i < parts.length; i++) {
    let from = 0;
    for (const p of paragraphs(parts[i])) {
      const start = parts[i].indexOf(p.text, from); from = start + p.text.length;
      if (++count === n) return start < 0 ? null : {i, start, end: start + p.text.length};
    }
  }
  return null;
}
/** Apply edits to the chapter parts: each FIND must occur exactly once across the chapter. Returns {parts, applied, missed}. */
export function applyEdits(parts, edits) {
  const out = parts.map(String), applied = [], missed = [];
  for (const e of edits || []) {
    const re = looseRe(e.find);
    let hits = [];
    out.forEach((t, i) => { for (const m of t.matchAll(re)) hits.push({i, index: m.index, len: m[0].length}); });
    // A short FIND that occurs more than once ("Sunday night.") is placed by the line its note names, when that line holds exactly one.
    if (hits.length > 1) { const span = lineSpan(out, Number((String(e.note).match(/\bline\s*(\d+)/i) || [])[1])); if (span) { const inLine = hits.filter(h => h.i === span.i && h.index >= span.start && h.index < span.end); if (inLine.length === 1) hits = inLine; } }
    if (hits.length !== 1) { missed.push({...e, why: hits.length ? `found ${hits.length} times` : 'not found in the chapter'}); continue; }
    const h = hits[0], t = out[h.i];
    let rep = String(e.replace);
    // Use the chapter's own quote style (models often answer curly quotes with straight ones, or the reverse).
    const curlyText = /[“”]/.test(t), straightText = /"/.test(t);
    if (curlyText && !straightText && /"/.test(rep)) { let open = true; rep = rep.replace(/"/g, () => (open = !open) ? '”' : '“'); }
    if (straightText && !curlyText && /[“”]/.test(rep)) rep = rep.replace(/[“”]/g, '"');
    // The model often copies FIND without the quote mark that opens or closes it, then puts one in the replacement: don't double it.
    const before = t.slice(0, h.index), after = t.slice(h.index + h.len);
    if (/[“"‘]$/.test(before) && /^[“"‘]/.test(rep)) rep = rep.slice(1);
    if (/^[”"’]/.test(after) && /[”"’]$/.test(rep) && !/^[”"’]/.test(t.slice(h.index + h.len - 1))) rep = rep.slice(0, -1);
    const next = before + rep + after;
    // Never leave a paragraph with a quotation opened and not closed.
    const para = (txt, at) => { const a = txt.lastIndexOf('\n\n', at) + 1, b = txt.indexOf('\n\n', at); return txt.slice(a, b < 0 ? undefined : b); };
    const balanced = q => (q.match(/“/g) || []).length === (q.match(/”/g) || []).length && (q.match(/"/g) || []).length % 2 === 0;
    if (balanced(para(t, h.index)) && !balanced(para(next, h.index))) { missed.push({...e, why: 'would break the quotation marks', replace: rep}); continue; }
    // An edit that throws away most of a passage when its note didn't ask for a cut loses the writer's text (a test chapter lost a whole
    // line of dialogue to a three-word "fix" for an echo): leave it out and show it.
    const wc = x => (String(x).match(/[\p{L}\p{N}']+/gu) || []).length, fw = wc(e.find), rw = wc(rep);
    if (fw >= 12 && rw < fw * 0.5 && !/\b(cut|remove|delete|drop|trim|shorten|tighten|condense|lose|too long|overwritten|redundant)\b/i.test(e.note || '')) { missed.push({...e, why: `would cut ${fw - rw} of its ${fw} words though the note didn’t ask for a cut`, replace: rep}); continue; }
    out[h.i] = next;
    applied.push(e);
  }
  return {parts: out, applied, missed};
}
/**
 * Read the revision back. `originals` is the chapter's parts (or just their count). Returns null unless every part
 * came back whole: UNCHANGED means the original; a changed part that is much shorter than the original, or that
 * stops mid-sentence, means the reply was cut off. Without === END the last part must look finished and full-length.
 */
export function parseRevision(text, originals) {
  const orig = Array.isArray(originals) ? originals : null, count = orig ? orig.length : Number(originals);
  const body = String(text || '').replace(/\r\n?/g, '\n');
  const got = [];
  const re = /^[\s*_#>]*===\s*PART\s*(\d+)[\s*_]*$\n([\s\S]*?)(?=^[\s*_#>]*===\s*(?:PART\s*\d+|END)[\s*_]*$|(?![\s\S]))/gmi;
  for (const m of body.matchAll(re)) got[Number(m[1]) - 1] = m[2].replace(/^\s*\d+\|\s?/gm, '').trim();
  if (got.length !== count) return null;
  const ended = /^[\s*_#>]*===\s*END[\s*_]*$/mi.test(body);
  for (let i = 0; i < count; i++) {
    if (!got[i]) return null;
    if (/^\(?unchanged\)?\.?$/i.test(got[i])) { if (!orig) return null; got[i] = orig[i]; continue; }
    if (!orig) continue;
    const before = String(orig[i] || ''), ratio = got[i].length / Math.max(1, before.length);
    if (ratio < 0.6) return null;
    if (cutOff(got[i]) && !cutOff(before)) return null;
    if (i === count - 1 && !ended && ratio < 0.9) return null;
  }
  return got;
}
/** Stops mid-sentence: an open quote or no closing punctuation. */
function cutOff(t) {
  t = String(t || '').trim().replace(/[*_~`]+$/, '');
  if (!t) return false;
  const last = t.split(/\n\s*\n/).pop();
  if ((last.match(/“/g) || []).length > (last.match(/”/g) || []).length || (last.match(/"/g) || []).length % 2) return true;
  return !/[.!?…”"’')\]—–-]$/.test(t);
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

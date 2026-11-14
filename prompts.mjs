import {NOVEL, requiredOf} from './templates.mjs';
import {REPLY_FORMAT} from './operations.mjs';
import {P} from './prompt-texts.mjs';
/** Locked mechanics: how saving works and what the summary entry must keep. */
const STORAGE = 'The extension, not you, performs storage in the current project’s selected lorebook. To create an entry, return an update with a new descriptive title, complete content and useful trigger keywords. To update one, reuse its exact existing title and provide the complete revised content while preserving established facts and unrelated details. Never delete a whole entry; to drop a heading or detail, return the entry without it. The extension checks, saves and reports the result; do not invent file paths or claim a save outside this process.';
const summaryRule = t => {
  const req = requiredOf(t.summary, true), opt = t.summary.fields.filter(f => !req.includes(f));
  return `The story summary entry is titled “${t.summary.title}”. It must keep ${req.join(', ')} and its consistency instruction; its other headings (${opt.join(', ')}) are suggestions to use where they fit. There is only ever one summary entry: update “${t.summary.title}” rather than starting a second summary under another name. (This is only about the summary; other new entries are covered below.)`;
};
/** Locked: how changes after the plan exists must be made. */
const EDITING_RULES = t => `Change only what the writer's request needs. Return only the entries that actually change — an entry the change doesn't touch is not returned at all — and don't re-plan, polish or rewrite anything else. Keep your thinking short: work out what the change touches, then write just that. Carry the change through everything it does touch, in one reply: the ${t.outline.title}, the planning entries (scale, chapter or word counts, cast), the ${t.summary.title}, character entries, and anything else that would otherwise contradict it. Changing a count means changing it everywhere it appears.
For the ${t.outline.title}, return only the ${t.unit.toLowerCase()}s you change or add — each with its full heading (“${t.unit} N — Title”) and all its lines — and leave the others out; Storyloom keeps every ${t.unit.toLowerCase()} you don't return exactly as it is. To remove a ${t.unit.toLowerCase()}, write a line “REMOVE ${t.unit} N” in the outline update. When ${t.unit.toLowerCase()}s are added or removed, renumber by returning the moved ${t.unit.toLowerCase()}s under their new numbers.`;
const base = t => `${P('persona')} ${STORAGE} ${summaryRule(t)} ${P('newEntries')} ${REPLY_FORMAT}`;
export function planningSystem(mode,t=NOVEL) {
  const BASE=base(t);
  if(mode==='background') return `${BASE}\n${P('background')}`;
  if(mode==='simple') return `${BASE}\n${P('simple')}`;
  if(mode==='deep') return `${BASE}\n${P('deep')} During the interview, the extension saves interview notes; any new entry for something the writer stated is held for the writer's approval. Never claim you saved your own proposals.`;
  return `${BASE}\n${P('ongoing')}\n${EDITING_RULES(t)}`;
}

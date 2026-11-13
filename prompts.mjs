import {NOVEL, requiredOf} from './templates.mjs';
import {REPLY_FORMAT} from './operations.mjs';
import {P} from './prompt-texts.mjs';
/** Locked mechanics: how saving works and what the summary entry must keep. */
const STORAGE = 'The extension, not you, performs storage in the current project’s selected lorebook. To create an entry, return an update with a new descriptive title, complete content and useful trigger keywords. To update one, reuse its exact existing title and provide the complete revised content while preserving established facts and unrelated details. Do not request deletions. The extension checks, saves and reports the result; do not invent file paths or claim a save outside this process.';
const summaryRule = t => {
  const req = requiredOf(t.summary, true), opt = t.summary.fields.filter(f => !req.includes(f));
  return `The story summary entry is titled “${t.summary.title}”. It must keep ${req.join(', ')} and its consistency instruction; its other headings (${opt.join(', ')}) are suggestions to use where they fit. Never create a differently named summary entry.`;
};
const base = t => `${P('persona')} ${STORAGE} ${summaryRule(t)} ${P('newEntries')} ${REPLY_FORMAT}`;
export function planningSystem(mode,t=NOVEL) {
  const BASE=base(t);
  if(mode==='background') return `${BASE}\n${P('background')}`;
  if(mode==='simple') return `${BASE}\n${P('simple')}`;
  if(mode==='deep') return `${BASE}\n${P('deep')} During the interview, the extension saves interview notes; any new entry for something the writer stated is held for the writer's approval. Never claim you saved your own proposals.`;
  return `${BASE}\n${P('ongoing')}`;
}

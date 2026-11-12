import {validFoundation} from './template.mjs';
function escapeStringControls(text) {
  let quoted=false, escaped=false, out='';
  for(const ch of text) {
    if(quoted && !escaped && ch.charCodeAt(0)<32) {out+=JSON.stringify(ch).slice(1,-1);continue;}
    out+=ch;
    if(escaped) {escaped=false;continue;}
    if(quoted && ch==='\\') {escaped=true;continue;}
    if(ch==='"') quoted=!quoted;
  }
  return out;
}
export function parseAssistant(text, {allowProse=false} = {}) {
  const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let result;
  try { result = JSON.parse(escapeStringControls(clean)); }
  catch (error) {
    const marker=clean.lastIndexOf('{"reply"');
    if(marker>0) {
      try {return parseAssistant(clean.slice(marker),{allowProse:false});} catch {}
    }
    if (!allowProse || !clean || clean.length>30000 || /^[\[{]/.test(clean)) throw error;
    result={reply:clean,updates:[]};
  }
  if (typeof result.reply !== 'string' || !result.reply.trim() || result.reply.length > 30000 || !Array.isArray(result.updates) || result.updates.length > 20) throw new Error('Invalid assistant response');
  for (const [i,u] of result.updates.entries()) {
    if (!u || typeof u !== 'object' || typeof u.title !== 'string' || !u.title.trim() || u.title.length>200) throw Error(`Entry ${i+1} has an invalid title.`);
    if (typeof u.content !== 'string' || !u.content.trim() || u.content.length>100000) throw Error(`Entry “${u.title}” has invalid or missing content.`);
    if (u.keys == null) u.keys=[u.title.trim()];
    if (typeof u.keys==='string') u.keys=u.keys.split(',').map(x=>x.trim()).filter(Boolean);
    if (!Array.isArray(u.keys) || u.keys.length>50 || !u.keys.every(k=>typeof k==='string' && k.length<=200)) throw Error(`Entry “${u.title}” has invalid keywords.`);
  }
  return result;
}
export function planWrites(book, updates) {
  if (!book?.entries || typeof book.entries !== 'object') throw new Error('Invalid lorebook');
  const seen = new Set();
  return updates.map(u => {
    const name = u.title.trim().toLocaleLowerCase();
    if (name === 'novel foundation' && !validFoundation(u.content)) throw Error('The Novel Foundation update is missing required headings or the consistency instruction.');
    if (seen.has(name)) throw new Error('Duplicate update title');
    seen.add(name);
    const found = Object.values(book.entries).filter(e => String(e.comment || '').trim().toLocaleLowerCase() === name);
    if (found.length > 1) throw new Error('Ambiguous entry title: ' + u.title);
    return { uid: found[0]?.uid ?? null, prior: found[0] ? structuredClone(found[0]) : null, update: u };
  });
}
export function syncDecision(base, book, note) {
  if (book === note) return 'same';
  if (book === base) return 'note';
  if (note === base) return 'book';
  return 'conflict';
}
const START = '<!-- Novel Architect -->';
const END = '<!-- /Novel Architect -->';
export function readDirective(note) {
  note = String(note ?? '');
  const start = note.indexOf(START), end = note.indexOf(END);
  if (start < 0 && end < 0) return null;
  if (start < 0 || end < start || note.indexOf(START, start + START.length) !== -1 || note.indexOf(END, end + END.length) !== -1) throw new Error('Invalid Novel Architect directive markers');
  return note.slice(start + START.length, end).trim();
}
export function replaceDirective(note, directive) {
  note = String(note ?? '');
  const old = readDirective(note);
  const block = `${START}\n${directive}\n${END}`;
  if (old === null) return note.trimEnd() ? `${note.trimEnd()}\n\n${block}` : block;
  return note.slice(0, note.indexOf(START)) + block + note.slice(note.indexOf(END) + END.length);
}

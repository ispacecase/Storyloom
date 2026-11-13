import {normalizeFoundation, validFoundation} from './template.mjs';
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
function embeddedResponse(text) {
  const start=text.search(/\{\s*"reply"\s*:/);
  if(start<0)return null;
  let depth=0,quoted=false,escaped=false;
  for(let i=start;i<text.length;i++) {
    const ch=text[i];
    if(escaped){escaped=false;continue;}
    if(quoted && ch==='\\'){escaped=true;continue;}
    if(ch==='"'){quoted=!quoted;continue;}
    if(quoted)continue;
    if(ch==='{')depth++;
    if(ch==='}' && --depth===0)return text.slice(start,i+1);
  }
  return null;
}

/** How the model is asked to answer: plain text blocks, which models write far more reliably than JSON. */
export const REPLY_FORMAT = `Answer in plain text, never JSON. First write your conversational reply to the writer. Then, for each lorebook entry to create or update, write one block exactly like this:
=== ENTRY: exact entry title
KEYS: keyword, keyword, keyword
the complete entry content, on as many lines as it needs
=== END
Write no blocks when no entry should change. Write each block's content as normal text; nothing needs escaping. Put nothing after the last === END.`;
const BLOCK_START = /^[\s*_#>]*=+\s*ENTRY\s*:\s*(.*?)[\s*_=]*$/i;
const BLOCK_END = /^[\s*_#>]*=+\s*END[\s*_=]*$/i;
/** Entry blocks → {reply, updates}; null when the text has no blocks. Throws when the last block is cut off. */
export function parseBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  if (!lines.some(l => BLOCK_START.test(l))) return null;
  const reply = [], updates = [];
  let current = null;
  for (const line of lines) {
    const start = line.match(BLOCK_START);
    if (start) {
      if (current) throw Error(`The entry “${current.title}” has no === END line; the reply was cut off or malformed.`);
      current = {title: start[1].replace(/[*_]+$/,'').trim(), lines: [], keys: null};
      continue;
    }
    if (current && BLOCK_END.test(line)) {
      const content = current.lines.join('\n').replace(/^\s*\n|\n\s*$/g, '').replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
      updates.push({title: current.title, content, keys: current.keys ?? [current.title]});
      current = null;
      continue;
    }
    if (current) {
      const keys = current.lines.length === 0 && current.keys === null && line.match(/^\s*\**KEYS?\**\s*:\s*(.*)$/i);
      if (keys) current.keys = keys[1].split(',').map(k => k.replace(/^[\s"'`*]+|[\s"'`*]+$/g, '')).filter(Boolean);
      else current.lines.push(line);
      continue;
    }
    reply.push(line);
  }
  if (current) throw Error(`Unterminated entry block “${current.title}”: the reply was cut off before === END.`);
  const replyText = reply.join('\n').replace(/^\s*\**REPLY\**\s*:\s*/i, '').trim();
  return {reply: replyText || 'Done.', updates};
}
/** The same updates written back as entry blocks (used when asking the model to correct its own answer). */
export function toBlocks(updates) {
  return (updates || []).map(u => `=== ENTRY: ${u.title}\nKEYS: ${(u.keys || []).join(', ')}\n${u.content}\n=== END`).join('\n\n');
}
export function parseAssistant(text, {allowProse=false} = {}) {
  const clean = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let result;
  const blocks = parseBlocks(clean);
  if (blocks) result = blocks;
  else try { result = JSON.parse(escapeStringControls(clean)); }
  catch (error) {
    const candidate=embeddedResponse(clean);
    if(candidate && candidate!==clean) {
      try {return parseAssistant(candidate,{allowProse});} catch {}
    }
    if (!allowProse || !clean || clean.length > 30000 || /^[\[{]/.test(clean)) throw error;
    return {reply:clean,updates:[]};
  }
  if (typeof result?.reply !== 'string' || !result.reply.trim() || result.reply.length > 30000) throw Error('Invalid assistant response');
  try {
    if(!Array.isArray(result.updates) || result.updates.length > 20)throw Error('Invalid lorebook updates');
    for (const [i,u] of result.updates.entries()) {
      if (!u || typeof u !== 'object' || typeof u.title !== 'string' || !u.title.trim() || u.title.length>200) throw Error(`Entry ${i+1} has an invalid title.`);
      if (typeof u.content !== 'string' || !u.content.trim() || u.content.length>100000) throw Error(`Entry “${u.title}” has invalid or missing content.`);
      if (u.keys == null) u.keys=[u.title.trim()];
      if (typeof u.keys==='string') u.keys=u.keys.split(',').map(x=>x.trim()).filter(Boolean);
      if (!Array.isArray(u.keys) || u.keys.length>50 || !u.keys.every(k=>typeof k==='string' && k.length<=200)) throw Error(`Entry “${u.title}” has invalid keywords.`);
    }
  } catch(error) {
    if(!allowProse)throw error;
    return {reply:result.reply,updates:[],ignoredUpdates:true};
  }
  return result;
}
export function planWrites(book, updates, summary = {title:'Novel Foundation', fields:undefined}) {
  const summaryName = summary.title.toLocaleLowerCase();
  if (!book?.entries || typeof book.entries !== 'object') throw new Error('Invalid lorebook');
  const seen = new Set();
  return updates.map(u => {
    const name = u.title.trim().toLocaleLowerCase();
    if (seen.has(name)) throw new Error('Duplicate update title');
    seen.add(name);
    const found = Object.values(book.entries).filter(e => String(e.comment || '').trim().toLocaleLowerCase() === name);
    if (found.length > 1) throw new Error('Ambiguous entry title: ' + u.title);
    if (name === summaryName && !validFoundation(u.content, summary.fields)) {
      const content = normalizeFoundation(u.content, found[0]?.content, summary.fields);
      if (!validFoundation(content, summary.fields)) throw Error('Storyloom could not read the proposed story foundation. Your existing lorebook is intact. Try sending your message again.');
      u = {...u, content};
    }
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

/**
 * Arrange a planned book so the main chat sees the right things:
 * always-on story summary, voice and current chapter; characters and places by name;
 * planning-only entries (full outline, scale, cast list) switched off.
 * Pure: mutates and returns a clone. `create(book)` must add and return a new entry.
 */
import {NOVEL} from './templates.mjs';
export const CURRENT_CHAPTER='Current Chapter';
const ORDER={foundation:100,voice:95,chapter:90,character:80,place:70};

const GENERIC=new Set(['mother','father','mum','mom','dad','mama','papa','brother','sister','son','daughter','aunt','uncle','niece','nephew','cousin','wife','husband','partner','grandmother','grandfather','grandma','grandpa','granddaughter','grandson','girl','boy','man','woman','child','kid','baby','dog','cat','horse','vet','doctor','nurse','teacher','boss','friend','stranger','lad','lass','curator','priest','king','queen','guard','captain']);

/** Unit headings in an outline: "Chapter 3 — Title" (or Session, Part…). */
export function chapterList(outline,unit='Chapter') {
  const text=String(outline||'');
  const heads=[...text.matchAll(new RegExp(`^\\s*(?:#{1,6}\\s*)?[*_]*${unit}\\s+(\\d+)\\s*[-—–:]\\s*([^\\n*_]+)[*_]*\\s*$`,'gmi'))];
  return heads.map((h,i)=>({number:Number(h[1]),title:h[2].trim(),text:text.slice(h.index,heads[i+1]?.index ?? text.length).trim()}));
}

/** One line saying what a later chapter is about: its title plus the first sentence of its Events line. */
export function gist(chapter) {
  const events=(chapter.text.match(/^[\s*_-]*Events\s*:\s*(.+)$/mi)||[])[1]||'';
  const first=events.replace(/\(AI-suggested\)/gi,'').match(/^.*?[.!?](\s|$)/)?.[0]?.trim()||events.slice(0,160);
  return `${chapter.title}${first?` — ${first}`:''}`;
}
/**
 * What the story chat gets for the current chapter: this chapter's full plan, how long it should run,
 * and a short list of later chapters so it knows where the story is heading and what to leave for later.
 */
export function currentChapterContent(outline,number,unit='Chapter',{wordsPerChapter=''}={}) {
  const chapters=chapterList(outline,unit);
  const index=chapters.findIndex(c=>c.number===number);
  if(index<0)return '';
  const now=chapters[index], later=chapters.slice(index+1);
  const u=unit.toLowerCase();
  const length=String(wordsPerChapter||'').replace(/\(.*?\)/g,'').replace(/^(approximately|approx\.?|about|around|roughly|~)\s*/i,'').trim().replace(/[.;,:]+$/,'');
  const size=length && !/word/i.test(length) ? `${length} words` : length;
  const parts=[`The story is currently in ${unit} ${now.number} of ${chapters.length}. Follow this plan for the ${u}; let scenes unfold naturally rather than rushing through every event.${size?` This ${u} should run about ${size} in total, across all the replies that make it up.`:''}`, now.text];
  parts.push(later.length
    ? `Still to come — do not write any of this yet, and do not use up these events early:\n${later.map(c=>`- ${unit} ${c.number}: ${gist(c)}`).join('\n')}`
    : `This is the final ${u}: bring the story to its ending.`);
  return parts.join('\n\n');
}

/** Keep only distinctive names: drop generic role words and keys two characters share. */
export function cleanCharacterKeys(entries) {
  const characters=entries.filter(e=>/^character\s*[—–-]\s*/i.test(String(e.comment||'')));
  const counts=new Map();
  for(const e of characters)for(const k of new Set((e.key||[]).map(x=>String(x).trim().toLocaleLowerCase())))counts.set(k,(counts.get(k)||0)+1);
  for(const e of characters) {
    const name=String(e.comment).replace(/^character\s*[—–-]\s*/i,'').trim();
    const keep=[name];
    for(const raw of e.key||[]) {
      const key=String(raw).trim(), low=key.toLocaleLowerCase();
      if(!key || keep.some(k=>k.toLocaleLowerCase()===low))continue;
      if(/^(the|a|an|her|his|their|my|our|your)\s/i.test(key) || /'s$|’s$/i.test(key))continue;
      if(GENERIC.has(low) || (counts.get(low)||0)>1)continue;
      keep.push(key);
    }
    e.key=keep;
  }
}

export function layoutBook(source,{chapter=1,create,template=NOVEL,voiceViaNarrator=false}={}) {
  const t=template;
  const book=structuredClone(source);
  const entries=Object.values(book.entries||{});
  const find=title=>entries.find(e=>String(e.comment||'').trim().toLocaleLowerCase()===title.toLocaleLowerCase());
  const set=(entry,props)=>{if(entry)Object.assign(entry,props);};
  const hasProfiles=entries.some(e=>/^character\s*[—–-]/i.test(String(e.comment||'')));
  set(find(t.summary.title),{constant:true,disable:false,order:ORDER.foundation});
  for(const e of t.entries) {
    if(e.show==='always')set(find(e.title),{constant:true,disable:false,order:ORDER.voice});
    else if(e.show==='off')set(find(e.title),{disable:true});
    else set(find(e.title),{constant:false,disable:false,order:ORDER.place,excludeRecursion:true});
  }
  set(find(t.outline.title),{disable:true});
  // With Storyloom's general narrator, the book's point of view, tense and voice reach the story through the narrator's
  // values (one place, chapter overrides possible). The entry stays saved as the record — switched off, with a note.
  const voiceEntry=t.entries.filter(e=>e.show==='always').map(e=>find(e.title)).find(e=>/^[\s*_#-]*(POV|POINT OF VIEW)\s*:/mi.test(String(e?.content||'')));
  if(voiceEntry) {
    voiceEntry.content=String(voiceEntry.content||'').replace(/^\(Storyloom:[^\n]*\)\n?/,'');
    if(voiceViaNarrator){voiceEntry.disable=true;voiceEntry.constant=false;voiceEntry.content=`(Storyloom: kept here as the book’s record and switched off on purpose — the narrator gets these settings through its book settings, so a chapter can change them. Switch it on again any time.)\n${voiceEntry.content}`;}
  }
  if(hasProfiles)set(find(t.cast),{disable:true});
  // Planning-only entries are switched off on purpose; say so inside them, since the editor only shows "disabled".
  const note=(entry,text)=>{if(entry)entry.content=`(Storyloom: ${text})\n${String(entry.content||'').replace(/^\(Storyloom:[^\n]*\)\n?/,'')}`;};
  note(find(t.outline.title),'switched off here on purpose. The Memory tab sends it as “Whole outline”, with an instruction to use it for direction and never write ahead.');
  for(const e of t.entries)if(e.show==='off')note(find(e.title),'planning notes, switched off on purpose — the story chat doesn’t need them.');
  // The cast list is only an index; label it so it isn't mistaken for thin character entries.
  const castEntry=find(t.cast), label='(Cast index for Storyloom — not sent to the story. Full profiles are the “Character — Name” entries.)';
  if(castEntry && !String(castEntry.content||'').startsWith('(Cast index'))castEntry.content=`${label}\n${castEntry.content||''}`;
  // Characters are pulled in when named in the chat (or by vectors), not because an always-on entry mentions them.
  for(const e of entries)if(/^character\s*[—–-]/i.test(String(e.comment||'')))set(e,{constant:false,order:ORDER.character,excludeRecursion:true});
  // Memory entries are sent by Storyloom itself (Memory tab), never by lorebook scanning.
  for(const e of entries)if(/^storyloom memory\s*[—–-]/i.test(String(e.comment||'')))set(e,{disable:true,constant:false});
  cleanCharacterKeys(entries);
  const outline=find(t.outline.title)?.content;
  const scaleEntry=t.entries.map(e=>find(e.title)).find(e=>/WORDS PER/i.test(String(e?.content||'')));
  const wordsPerChapter=(String(scaleEntry?.content||'').match(/^[\s*_-]*WORDS PER [A-Z]+\s*:\s*(.+)$/mi)||[])[1]||'';
  const content=currentChapterContent(outline,chapter,t.unit,{wordsPerChapter});
  if(content) {
    let entry=find(CURRENT_CHAPTER);
    if(!entry) {
      if(typeof create!=='function')throw Error('Cannot add the Current Chapter entry.');
      entry=create(book);
      if(!entry)throw Error('Could not add the Current Chapter entry.');
      entry.comment=CURRENT_CHAPTER;
    }
    // Kept as a record; the Memory tab injects it with the placement the writer chose.
    set(entry,{content,key:[],constant:false,disable:true,order:ORDER.chapter});
  }
  return book;
}

/** Point the writing directive at the chosen chapter (scene restarts at 1). */
export function directiveForChapter(text,chapter) {
  return String(text||'').replace(/^(Chapter:\s*).*$/m,`$1${chapter}`).replace(/^(Scene:\s*).*$/m,'$11');
}

/**
 * Merge an outline edit by chapter: the model may return only the chapters it changes or adds (each with its full
 * "Chapter N — Title" heading and lines); every other chapter is kept as it was. "REMOVE Chapter N" drops one.
 * Text before the first chapter is replaced only when the edit has its own.
 */
export function mergeOutline(oldText, editText, unit = 'Chapter') {
  const body = t => String(t || '').replace(/^\(Storyloom:[^\n]*\)\n?/, '');
  const old = body(oldText), edit = body(editText);
  const oldCh = chapterList(old, unit), newCh = chapterList(edit, unit);
  const removed = new Set([...edit.matchAll(new RegExp(`^\\s*REMOVE\\s+${unit}\\s+(\\d+)\\s*$`, 'gmi'))].map(m => Number(m[1])));
  if (!newCh.length && !removed.size) return edit.trim() ? edit : old;
  const preface = s => { const first = chapterList(s, unit)[0]; return (first ? s.slice(0, s.indexOf(first.text)) : s).replace(new RegExp(`^\\s*REMOVE\\s+${unit}\\s+\\d+\\s*$`, 'gmi'), '').trim(); };
  const byNumber = new Map(oldCh.map(c => [c.number, c.text]));
  for (const c of newCh) byNumber.set(c.number, c.text.replace(new RegExp(`^\\s*REMOVE\\s+${unit}\\s+\\d+\\s*$`, 'gmi'), '').trim());
  for (const n of removed) byNumber.delete(n);
  const head = preface(edit) || preface(old);
  return [head, ...[...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t)].filter(Boolean).join('\n\n');
}

/**
 * The outline as a check against "too early": earlier chapters in brief, then every later chapter — in full while it
 * fits, as a one-line gist after that — so nothing planned for later is missing, however long the outline.
 */
export function laterChapters(outline, current, unit = 'Chapter', budget = 14000) {
  const all = chapterList(outline, unit), earlier = all.filter(c => c.number < current), later = all.filter(c => c.number > current);
  const out = [];
  if (earlier.length) out.push(`EARLIER ${unit.toUpperCase()}S (already written):\n${earlier.map(c => `- ${unit} ${c.number}: ${gist(c)}`).join('\n')}`);
  if (later.length) {
    let used = 0;
    const lines = later.map(c => { const full = c.text.trim(); if (used + full.length <= budget) { used += full.length; return full; } return `${unit} ${c.number} — ${gist(c)}`; });
    out.push(`LATER ${unit.toUpperCase()}S — none of this may happen, be revealed or be known yet in ${unit} ${current}:\n${lines.join('\n\n')}`);
  }
  return out.join('\n\n');
}

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

export function currentChapterContent(outline,number,unit='Chapter') {
  const chapters=chapterList(outline,unit);
  const index=chapters.findIndex(c=>c.number===number);
  if(index<0)return '';
  const now=chapters[index], next=chapters[index+1];
  const u=unit.toLowerCase();
  return `The story is currently in ${unit} ${now.number} of ${chapters.length}. Follow this plan for the ${u}; let scenes unfold naturally rather than rushing through every event.\n\n${now.text}${next?`\n\nComing next (do not start yet): ${unit} ${next.number} — ${next.title}`:`\n\nThis is the final ${u}.`}`;
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

export function layoutBook(source,{chapter=1,create,template=NOVEL}={}) {
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
    else set(find(e.title),{constant:false,disable:false,order:ORDER.place});
  }
  set(find(t.outline.title),{disable:true});
  if(hasProfiles)set(find(t.cast),{disable:true});
  for(const e of entries)if(/^character\s*[—–-]/i.test(String(e.comment||'')))set(e,{constant:false,order:ORDER.character});
  cleanCharacterKeys(entries);
  const outline=find(t.outline.title)?.content;
  const content=currentChapterContent(outline,chapter,t.unit);
  if(content) {
    let entry=find(CURRENT_CHAPTER);
    if(!entry) {
      if(typeof create!=='function')throw Error('Cannot add the Current Chapter entry.');
      entry=create(book);
      if(!entry)throw Error('Could not add the Current Chapter entry.');
      entry.comment=CURRENT_CHAPTER;
    }
    set(entry,{content,key:[],constant:true,disable:false,order:ORDER.chapter});
  }
  return book;
}

/** Point the writing directive at the chosen chapter (scene restarts at 1). */
export function directiveForChapter(text,chapter) {
  return String(text||'').replace(/^(Chapter:\s*).*$/m,`$1${chapter}`).replace(/^(Scene:\s*).*$/m,'$11');
}

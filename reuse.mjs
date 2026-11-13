/** Construct an explicit, exact destination for a character imported from another book. */
export function characterImportRequest(name,reference) {
 const person=String(name||'').trim(), source=String(reference||'').trim();
 if(!person || person.length>100 || /[\r\n]/.test(person))throw Error('Enter one character name.');
 if(!source)throw Error('Choose a reference lorebook first.');
 const title=`Character — ${person}`;
 return {name:person,title,source,request:`Bring ${person} into this novel using the reference lorebook “${source}”. Create or update exactly one entry titled ${title}. Extract that person's established identity, history, personality, relationships, motivations and relevant continuity from the supplied reference, organised under these headings, each on its own line: ROLE IN THE STORY:, BASICS:, APPEARANCE:, BACKGROUND AND HISTORY:, PERSONALITY:, WANTS AND NEEDS:, FLAWS AND FEARS:, RELATIONSHIPS:, VOICE AND MANNERISMS:, ARC THROUGH THE NOVEL:. Write each as full sentences; where the reference says nothing, say so or offer a clearly marked suggestion. Clearly mark uncertainty and proposals; do not invent history or copy the whole plot. This is a novel character, not a chatbot: never use roleplay instructions, chatbot greetings, or user/character placeholders. Preserve any existing complete entry and cite the reference book by name. Return the entry as an entry block.`};
}
export function requiredCharacterUpdate(result,title) {
 const matches=(result?.updates||[]).filter(x=>String(x.title||'').trim().toLocaleLowerCase()===title.toLocaleLowerCase());
 if(matches.length!==1)throw Error(`The model did not provide the requested ${title} entry. Nothing was saved; retry.`);
 return matches[0];
}

/** Select complete, relevant source entries before broader story background. */
export function selectCharacterSource(entries,name,budget=4000) {
 const target=String(name||'').trim().toLocaleLowerCase();
 const candidates=(entries||[]).map((entry,index)=>{
  const title=String(entry.title||'').toLocaleLowerCase();
  const keys=(entry.keys||[]).join(' ').toLocaleLowerCase();
  const content=String(entry.content||'').toLocaleLowerCase();
  const namedTitle=title===target || title===`character — ${target}` || title===`character - ${target}`;
  return {entry,index,score:namedTitle?3:(title.includes(target)||keys.includes(target)?2:(content.includes(target)?1:0))};
 }).filter(x=>target && x.score).sort((a,b)=>b.score-a.score || a.index-b.index);
 if(!candidates.length)throw Error(`No information about “${name}” was found in the reference lorebook.`);
 const selected=[];let used=0;
 for(const {entry} of candidates) {
  const item={title:entry.title,content:String(entry.content||'')};const size=JSON.stringify(item).length+1;
  if(used+size>budget)continue;
  selected.push(item);used+=size;
 }
 if(!selected.length || selected[0].title!==candidates[0].entry.title)throw Error(`The most relevant reference entry for “${name}” is too long to import safely.`);
 return {entries:selected,omitted:entries.length-selected.length,truncated:0,incomplete:[]};
}

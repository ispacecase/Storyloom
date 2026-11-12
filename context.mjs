function words(value) {return [...new Set(String(value||'').toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu)||[])];}
export function selectLore(entries,query,budget=12000) {
 const terms=words(query),ranked=entries.map((entry,index)=>{
  const text=`${entry.title} ${(entry.keys||[]).join(' ')} ${entry.content}`.toLocaleLowerCase();
  return {entry,index,score:(entry.title==='Novel Foundation'?100000:0)+terms.reduce((n,w)=>n+(text.includes(w)?1:0),0)};
 }).sort((a,b)=>b.score-a.score || a.index-b.index);
 const selected=[],incomplete=[];let used=0,truncated=0;
 for(const {entry} of ranked) {
  const overhead=JSON.stringify({title:entry.title,content:''}).length+2, remaining=budget-used-overhead;
  if(remaining<100) {incomplete.push(entry.title);continue;}
  const original=String(entry.content||''); let content=original.slice(0,remaining);
  while(content && JSON.stringify({title:entry.title,content}).length+used+2>budget) content=content.slice(0,Math.floor(content.length*.8));
  if(content.length<original.length){truncated++;incomplete.push(entry.title);}
  const item={title:entry.title,content}; selected.push(item);used+=JSON.stringify(item).length+1;
 }
 return {entries:selected,omitted:entries.length-selected.length,truncated,incomplete};
}
export function recentConversation(messages,budget=12000) {
 const out=[];let used=0;
 for(const m of messages.slice(-24).reverse()) {
  const remaining=budget-used-80;if(remaining<=0)break;
  let content=String(m.content||'').slice(-remaining);
  while(content && JSON.stringify({role:m.role,content}).length+used+2>budget) content=content.slice(-Math.floor(content.length*.8));
  const item={role:m.role,content};out.unshift(item);used+=JSON.stringify(item).length+1;
 }
 return out;
}
export function ensureCompleteUpdates(writes,selection) {
 const incomplete=new Set(selection.incomplete.map(x=>String(x).trim().toLocaleLowerCase()));
 for(const w of writes) if(w.uid!==null && incomplete.has(w.update.title.trim().toLocaleLowerCase())) throw Error(`“${w.update.title}” was not fully included in context; it was not rewritten.`);
}

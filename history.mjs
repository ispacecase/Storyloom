const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function buildChange(before,after) {
 const changes=[];
 for(const key of new Set([...Object.keys(before.entries||{}),...Object.keys(after.entries||{})])) {
  const old=before.entries[key]??null, current=after.entries[key]??null;
  if(!same(old,current)) changes.push({key,before:structuredClone(old),after:structuredClone(current)});
 }
 return changes;
}
export function undoChange(live,changes) {
 for(const x of changes) if(!same(live.entries[x.key]??null,x.after)) throw Error('An entry changed since this update; undo stopped.');
 const result=structuredClone(live);
 for(const x of changes) {if(x.before===null) delete result.entries[x.key]; else result.entries[x.key]=structuredClone(x.before);}
 return result;
}
export function classifyChange(live, changes) {
 const before=changes.every(x=>same(live.entries[x.key]??null,x.before));
 const after=changes.every(x=>same(live.entries[x.key]??null,x.after));
 return after?'after':before?'before':'conflict';
}
export function describeChange(record) {
 const titles=record.changes.map(x=>`${x.before===null?'Added':'Updated'}: ${x.after?.comment || x.before?.comment || 'Untitled'}`).join('; ');
 return `${record.at || ''} ${record.source || 'Storyloom'}${record.reference ? ` (reference available: ${record.reference})` : ''} — ${titles}`.trim();
}

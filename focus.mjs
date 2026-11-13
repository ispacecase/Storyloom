/** When the model bolds every name, retain the explicit writer's focus or the first person. */
export function normalizePeopleFocus(result,answers={},castTitle='People') {
 const entry=result?.updates?.find(x=>String(x.title).trim().toLowerCase()===castTitle.toLowerCase());
 if(!entry || typeof entry.content!=='string')return result;
 const lines=entry.content.split('\n');
 const rows=lines.map((s,i)=>({s,i})).filter(x=>x.s.includes('|') && /^\s*\*\*/.test(x.s));
 if(rows.length<2)return result;
 const user=(answers.people||[]).flatMap(a=>String(a).split('\n')).find(x=>/^\s*\*\*/.test(x));
 const name=user?.replace(/^\s*\*\*/, '').split('|')[0].replace(/\*\*/g,'').trim().toLocaleLowerCase();
 let chosen=name ? rows.find(x=>x.s.replace(/^\s*\*\*/, '').split('|')[0].replace(/\*\*/g,'').trim().toLocaleLowerCase()===name) : rows[0];
 if(!chosen)return result;
 for(const row of rows)if(row.i!==chosen.i)lines[row.i]=row.s.replace(/^(\s*)\*\*/, '$1').replace(/\*\*(?=\s*\|)/,'');
 entry.content=lines.join('\n');return result;
}

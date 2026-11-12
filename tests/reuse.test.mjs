import test from 'node:test';import assert from 'node:assert/strict';import {characterImportRequest,requiredCharacterUpdate} from '../reuse.mjs';
test('imports a named novel character from a selected book',()=>{
 const r=characterImportRequest('Mara','First Novel');assert.equal(r.title,'Character — Mara');assert.match(r.request,/not a chatbot/);assert.match(r.request,/First Novel/);
 assert.equal(requiredCharacterUpdate({updates:[{title:'Character — Mara'}]},r.title).title,r.title);
});
test('requires a source and rejects missing or ambiguous character updates',()=>{
 assert.throws(()=>characterImportRequest('Mara',''),/reference/);
 assert.throws(()=>characterImportRequest('','Book'),/name/);
 assert.throws(()=>requiredCharacterUpdate({updates:[]},'Character — Mara'),/Nothing was saved/);
 assert.throws(()=>requiredCharacterUpdate({updates:[{title:'Character — Mara'},{title:'Character — Mara'}]},'Character — Mara'),/Nothing was saved/);
});

test('prioritizes a complete named profile over a huge foundation',async()=>{
 const {selectCharacterSource}=await import('../reuse.mjs');
 const selection=selectCharacterSource([{title:'Novel Foundation',content:'Mara '+ 'x'.repeat(10000)},{title:'Character — Mara',content:'Mara is a 34-year-old archivist.'}],'Mara',200);
 assert.equal(selection.entries[0].title,'Character — Mara');assert.equal(selection.entries.length,1);
 assert.throws(()=>selectCharacterSource([{title:'Lore',content:'No matching person.'}],'Mara',200),/No information/);
 assert.throws(()=>selectCharacterSource([{title:'Mara',content:'Mara '+ 'x'.repeat(1000)}],'Mara',200),/too long/);
});

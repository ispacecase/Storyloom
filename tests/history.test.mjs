import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChange, undoChange } from '../history.mjs';
test('undo reverts only changed entries and preserves unrelated edits',()=>{
 const before={entries:{1:{uid:1,comment:'A',content:'old'},2:{uid:2,content:'other'}}};
 const after={entries:{1:{uid:1,comment:'A',content:'new'},2:{uid:2,content:'other'},3:{uid:3,content:'added'}}};
 const live=structuredClone(after);live.entries[2].content='edited later';
 const result=undoChange(live,buildChange(before,after));
 assert.equal(result.entries[1].content,'old');assert.equal(result.entries[2].content,'edited later');assert.equal(result.entries[3],undefined);
});
test('undo refuses when a changed entry has since been edited',()=>{
 const before={entries:{1:{uid:1,content:'old'}}};const after={entries:{1:{uid:1,content:'new'}}};
 assert.throws(()=>undoChange({entries:{1:{uid:1,content:'later'}}},buildChange(before,after)),/changed since/i);
});

test('unfinished save is classified from its actual entries', async()=>{
 const { classifyChange }=await import('../history.mjs');
 const before={entries:{1:{uid:1,content:'old'}}},after={entries:{1:{uid:1,content:'new'}}},changes=buildChange(before,after);
 assert.equal(classifyChange(before,changes),'before');assert.equal(classifyChange(after,changes),'after');assert.equal(classifyChange({entries:{1:{uid:1,content:'different'}}},changes),'conflict');
});

test('history describes which entries changed and their origin', async()=>{
 const {describeChange}=await import('../history.mjs');
 const text=describeChange({source:'main chat',reference:'Earlier book',changes:[{before:null,after:{comment:'Lena'}},{before:{comment:'House'},after:{comment:'House'}}]});
 assert.match(text,/main chat/);assert.match(text,/Earlier book/);assert.match(text,/Lena/);assert.match(text,/House/);
});

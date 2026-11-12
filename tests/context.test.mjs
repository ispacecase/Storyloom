import test from 'node:test';import assert from 'node:assert/strict';
import { selectLore, recentConversation } from '../context.mjs';
test('always retains foundation and ranks relevant entries within a budget',()=>{
 const entries=[{title:'Novel Foundation',content:'Foundation',keys:[]},{title:'Mara',content:'Archivist',keys:['Mara']},{title:'Horses',content:'Stable',keys:['horses']}];
 const r=selectLore(entries,'Mara arrives',1200);assert.equal(r.entries[0].title,'Novel Foundation');assert.equal(r.entries[1].title,'Mara');
});
test('large contexts are bounded and omissions are visible',()=>{
 const entries=Array.from({length:10},(_,i)=>({title:'Entry '+i,content:'x'.repeat(5000),keys:[]}));
 const r=selectLore(entries,'',1000);assert.ok(JSON.stringify(r.entries).length<1300);assert.ok(r.omitted>0 || r.truncated>0);
 const messages=recentConversation([{role:'user',content:'y'.repeat(10000)}],500);assert.ok(JSON.stringify(messages).length<700);
});

test('truncated entries are identified so they cannot be overwritten from partial context',()=>{
 const r=selectLore([{title:'Mara',content:'x'.repeat(4000),keys:[]}],'Mara',500);
 assert.deepEqual(r.incomplete,['Mara']);
});

test('escaped text also stays within the request budget',()=>{
 const r=selectLore([{title:'Lines',content:'\n'.repeat(4000),keys:[]}],'',500);
 assert.ok(JSON.stringify(r.entries).length<=502);
});

test('escaped conversation stays bounded',()=>{
 const r=recentConversation([{role:'user',content:'\n'.repeat(4000)}],500);assert.ok(JSON.stringify(r).length<=502);
});

test('existing entries outside full context cannot be rewritten',async()=>{
 const {ensureCompleteUpdates}=await import('../context.mjs');
 assert.throws(()=>ensureCompleteUpdates([{uid:7,update:{title:'Mara'}}],{incomplete:['Mara']}),/too large|not fully/i);
 assert.doesNotThrow(()=>ensureCompleteUpdates([{uid:null,update:{title:'New'}}],{incomplete:['Mara']}));
});

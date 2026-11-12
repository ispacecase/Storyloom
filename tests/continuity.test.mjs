import test from 'node:test';import assert from 'node:assert/strict';
import {queueContinuity, completeContinuity} from '../continuity.mjs';
test('a saved draft keeps continuity pending until its exact job completes',()=>{
 const novel={};queueContinuity(novel,{id:'a',text:'Mara found a key.'});
 assert.equal(novel.pendingContinuity.text,'Mara found a key.');
 assert.throws(()=>queueContinuity(novel,{id:'b',text:'other'}),/pending/i);
 assert.throws(()=>completeContinuity(novel,'b'),/different/i);
 completeContinuity(novel,'a');assert.equal(novel.pendingContinuity,undefined);
});

test('continuity requests ask for a compact scene memory and bounded updates',async()=>{
 const {continuityPrompt}=await import('../continuity.mjs');const p=continuityPrompt('Mara found a key.');
 assert.match(p,/at most four/i);assert.match(p,/scene memory/i);assert.match(p,/Mara found a key/);
});

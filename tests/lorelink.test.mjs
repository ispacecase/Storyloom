import test from 'node:test';import assert from 'node:assert/strict';import {linkState,linkBook} from '../lorelink.mjs';
test('reports selected and actual chat links separately',()=>{
 assert.equal(linkState('Novel A','Novel A'),'linked');assert.equal(linkState('Novel A','Novel B'),'different');assert.equal(linkState('Novel A',''),'unlinked');assert.equal(linkState('',''),'none');
});
test('linking saves the selected book and visibly selects it',async()=>{
 const metadata={};const events=[];await linkBook({metadata,book:'Novel A',save:async()=>events.push('save'),select:async n=>events.push('select '+n),mark:()=>events.push('mark'),confirm:async()=>true});assert.equal(metadata.world_info,'Novel A');assert.deepEqual(events,['save','select Novel A','mark']);
});
test('declining a replacement does not modify the chat or editor',async()=>{
 const metadata={world_info:'Old'};let touched=false;const result=await linkBook({metadata,book:'New',save:async()=>{touched=true},select:async()=>{touched=true},mark:()=>{},confirm:async()=>false});assert.equal(result,false);assert.equal(metadata.world_info,'Old');assert.equal(touched,false);
});
test('a failed save restores in-memory chat metadata',async()=>{
 const metadata={world_info:'Old'};await assert.rejects(()=>linkBook({metadata,book:'New',save:async()=>{throw Error('offline')},select:async()=>{},mark:()=>{},confirm:async()=>true}),/offline/);assert.equal(metadata.world_info,'Old');
});
test('does not attach a book after the user switched chats during confirmation',async()=>{
 const metadata={world_info:'Old'};let current=true;let saved=false;
 await assert.rejects(()=>linkBook({metadata,book:'New',save:async()=>{saved=true},select:async()=>{},mark:()=>{},confirm:async()=>{current=false;return true;},isCurrent:()=>current}),/chat changed/i);
 assert.equal(metadata.world_info,'Old');assert.equal(saved,false);
});

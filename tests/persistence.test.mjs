import test from 'node:test';import assert from 'node:assert/strict';import {saveVerified} from '../persistence.mjs';
test('detects swallowed metadata save failure from readback',async()=>{
 const c={chatId:'chat',characterId:0,characters:[{name:'A',avatar:'a.png'}],chatMetadata:{novelArchitect:{selected:'book'}},saveMetadata:async()=>{},getRequestHeaders:()=>({})};
 await assert.rejects(()=>saveVerified(()=>c,async()=>({ok:true,json:async()=>[{chat_metadata:{novelArchitect:{selected:'old'}}}]})),/not confirmed/i);
});
test('accepts matching group chat metadata',async()=>{
 const c={chatId:'g',groupId:'group',chatMetadata:{novelArchitect:{selected:'book'},note_prompt:'text'},saveMetadata:async()=>{},getRequestHeaders:()=>({})};let endpoint;
 await saveVerified(()=>c,async(url)=>{endpoint=url;return {ok:true,json:async()=>[{chat_metadata:c.chatMetadata}]};});assert.equal(endpoint,'/api/chats/group/get');
});
test('rejects readback after switching chats',async()=>{
 const c={chatId:'a',groupId:'g',chatMetadata:{novelArchitect:{}},saveMetadata:async()=>{},getRequestHeaders:()=>({})};let current=c;
 await assert.rejects(()=>saveVerified(()=>current,async()=>{current={...c,chatId:'b'};return {ok:true,json:async()=>[{chat_metadata:c.chatMetadata}]};}),/chat changed/i);
});

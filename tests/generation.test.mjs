import test from 'node:test';import assert from 'node:assert/strict';
import {generate} from '../generation.mjs';
test('current chat-completion request uses independent service with current model',async()=>{
 let request;const c={mainApi:'openai',chatCompletionSettings:{chat_completion_source:'custom',custom_url:'http://local'},getChatCompletionModel:()=> 'model-a',getPresetManager:()=>({getSelectedPresetName:()=> 'preset-a'}),ChatCompletionService:{processRequest:async(data,opts)=>{request={data,opts};return {content:'reply'};}}};
 assert.equal(await generate(c,'prompt',''), 'reply');assert.equal(request.data.model,'model-a');assert.equal(request.data.chat_completion_source,'custom');assert.equal(request.data.max_tokens,6000);assert.equal(request.opts.presetName,'preset-a');
});
test('separate profile passes the profile and signal',async()=>{
 let args;const c={ConnectionManagerRequestService:{sendRequest:async(...v)=>{args=v;return {content:'ok'}}}};const signal=new AbortController().signal;
 assert.equal(await generate(c,'hi','profile',signal),'ok');assert.equal(args[0],'profile');assert.equal(args[3].signal,signal);
});
test('unsupported or removed profiles remain visible without silently using current connection',async()=>{
 const {profileOptions}=await import('../generation.mjs');
 const svc={isProfileSupported:p=>p.api==='openai'};
 assert.deepEqual(profileOptions([{id:'a',name:'Local',api:'openai'},{id:'b',name:'Horde',api:'horde'}],svc,'b'),[{id:'a',name:'Local'},{id:'b',name:'Horde (unsupported)'}]);
 assert.deepEqual(profileOptions([],svc,'gone'),[{id:'gone',name:'Previously selected profile (unavailable)'}]);
});
test('a selected response budget is used for both connection paths',async()=>{
 let args;const c={ConnectionManagerRequestService:{sendRequest:async(...v)=>{args=v;return {content:'ok'}}}};
 await generate(c,'hi','profile',undefined,4096);assert.equal(args[2],4096);
});

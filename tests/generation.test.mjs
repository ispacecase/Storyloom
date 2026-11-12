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

test('Storyloom sends its own system prompt separately from the story input',async()=>{
 let request;const c={mainApi:'openai',chatCompletionSettings:{chat_completion_source:'custom'},getChatCompletionModel:()=> 'model',getPresetManager:()=>({getSelectedPresetName:()=> 'preset'}),ChatCompletionService:{processRequest:async(d)=>{request=d;return {content:'ok'}}}};
 await generate(c,'Writer input','',undefined,6000,'Independent Storyloom instructions');
 assert.deepEqual(request.messages,[{role:'system',content:'Independent Storyloom instructions'},{role:'user',content:'Writer input'}]);
});
test('other current API types receive Storyloom system instructions separately',async()=>{
 let call;const c={mainApi:'novel',generateRaw:async x=>{call=x;return 'ok'}};
 await generate(c,'Writer input','',undefined,6000,'Independent instructions');assert.equal(call.systemPrompt,'Independent instructions');assert.equal(call.prompt,'Writer input');
});

test('a separately chosen provider sends its own model and saved key without changing the main API',async()=>{
 let request;const c={mainApi:'novel',ChatCompletionService:{processRequest:async d=>{request=d;return {content:'ok'}}}};
 const direct={provider:'openrouter',model:'vendor/model',keyId:'saved-key'};
 assert.equal(await generate(c,'idea','__direct__',undefined,2048,'Own system',direct),'ok');
 assert.equal(request.chat_completion_source,'openrouter');assert.equal(request.model,'vendor/model');assert.equal(request.secret_id,'saved-key');assert.equal(c.mainApi,'novel');assert.equal(request.messages[0].role,'system');
});
test('a no-key custom endpoint cannot inherit the main chat custom API key',async()=>{
 let request;const c={ChatCompletionService:{processRequest:async d=>{request=d;return {content:'ok'}}}};
 await generate(c,'idea','__direct__',undefined,2048,'Own system',{provider:'custom',model:'local',url:'http://127.0.0.1:1234/v1',keyId:''});
 assert.equal(JSON.parse(request.custom_include_headers).Authorization,'');
});
test('a custom connection can use a session-only key without saving it',async()=>{
 let request;const c={ChatCompletionService:{processRequest:async d=>{request=d;return {content:'ok'}}}};const direct={provider:'custom',model:'m',url:'https://example.test/v1',keyId:'',sessionKey:'temporary-key'};
 await generate(c,'idea','__direct__',undefined,2048,'Own system',direct);assert.equal(JSON.parse(request.custom_include_headers).Authorization,'Bearer temporary-key');assert.equal(request.secret_id,undefined);
});
test('provider URL cannot contain embedded credentials',async()=>{
 const c={ChatCompletionService:{processRequest:async()=>({content:'ok'})}};
 await assert.rejects(()=>generate(c,'idea','__direct__',undefined,2048,'Own system',{provider:'custom',model:'m',url:'https://user:password@example.test',keyId:''}),/without embedded credentials/i);
});

import test from 'node:test';import assert from 'node:assert/strict';import {PROVIDERS,readKeyOptions,readModels} from '../providers.mjs';
test('offers more than OpenAI, including OpenRouter and custom providers',()=>{
 const ids=PROVIDERS.map(x=>x.id);for(const id of ['openai','openrouter','claude','makersuite','custom'])assert.ok(ids.includes(id));
});
test('saved credential options expose labels and identifiers, not values',async()=>{
 const fetcher=async()=>({ok:true,json:async()=>({api_key_openrouter:[{id:'1',label:'Personal',value:'masked',active:true}]})});
 assert.deepEqual(await readKeyOptions(fetcher,{},'openrouter'),[{id:'1',label:'Personal'}]);
});
test('model discovery uses selected provider and returns usable IDs',async()=>{
 let request;const fetcher=async(url,args)=>{request={url,body:JSON.parse(args.body)};return {ok:true,json:async()=>({data:[{id:'provider/model'},{id:'provider/model'},{}]})}};
 assert.deepEqual(await readModels(fetcher,{}, {provider:'openrouter',keyId:'1'}),['provider/model']);assert.equal(request.body.chat_completion_source,'openrouter');assert.equal(request.body.secret_id,'1');
});
test('OpenRouter can use a temporary key without changing saved provider keys',async()=>{
 const {directPayload}=await import('../providers.mjs');const p=directPayload({provider:'openrouter',model:'a/b',sessionKey:'temporary'});
 assert.equal(p.chat_completion_source,'custom');assert.equal(p.custom_url,'https://openrouter.ai/api/v1');assert.equal(JSON.parse(p.custom_include_headers).Authorization,'Bearer temporary');
});
test('providers without an explicitly supported temporary-key route reject it',async()=>{
 const {directPayload}=await import('../providers.mjs');assert.throws(()=>directPayload({provider:'claude',model:'model',sessionKey:'x'}),/saved key/i);
});
test('a lost session key never silently falls back to a different credential',async()=>{
 const {directPayload}=await import('../providers.mjs');
 assert.throws(()=>directPayload({provider:'custom',url:'https://example.test/v1',model:'x',sessionRequired:true,keyId:''}),/session key/i);
});

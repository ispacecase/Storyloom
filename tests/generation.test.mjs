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
 let request;const c={mainApi:'openai',chatCompletionSettings:{chat_completion_source:'custom',custom_url:'http://local'},getChatCompletionModel:()=> 'model',getPresetManager:()=>({getSelectedPresetName:()=> 'preset'}),ChatCompletionService:{processRequest:async(d)=>{request=d;return {content:'ok'}}}};
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

test('current custom connection forwards the same custom body and headers', async()=>{
 let sent;
 const c={mainApi:'openai',chatCompletionSettings:{chat_completion_source:'custom',custom_url:'http://local',custom_include_body:'reasoning: false',custom_exclude_body:'top_p',custom_include_headers:'X-Test: yes'},getChatCompletionModel:()=> 'model',getPresetManager:()=>null,ChatCompletionService:{processRequest:async d=>{sent=d;return {content:'ok'};}}};
 await generate(c,'hello','');
 assert.equal(sent.custom_include_body,'reasoning: false');
 assert.equal(sent.custom_exclude_body,'top_p');
 assert.equal(sent.custom_include_headers,'X-Test: yes');
});
test('stopping or timing out releases the caller even if the transport hangs',async()=>{
 const {requestModel}=await import('../generation.mjs');
 const controller=new AbortController();
 const stalled=()=>new Promise(()=>{});
 const pending=requestModel(stalled,controller.signal);
 controller.abort();
 await assert.rejects(pending,/Stopped/);
 await assert.rejects(requestModel(stalled,undefined,5),/too long/);
});

test('empty replies raise a specific error instead of returning nothing', async () => {
  const {replyText} = await import('../generation.mjs');
  assert.equal(replyText({content: 'hi'}), 'hi');
  assert.throws(() => replyText({content: '  '}), e => e.emptyReply && /empty reply/.test(e.message));
  assert.throws(() => replyText({content: '', reasoning: 'thinking about it a lot'}), e => e.emptyReply && /spent its whole reply thinking \(5 words/.test(e.message));
});

test('streaming reports progress and returns the full answer', async () => {
  const {streamOrWait} = await import('../generation.mjs');
  const seen = [];
  const run = async stream => stream ? async function* () {
    yield {text: '', state: {reasoning: 'hmm'}};
    yield {text: 'Hel', state: {reasoning: 'hmm'}};
    yield {text: 'Hello', state: {reasoning: 'hmm'}};
  } : {content: 'unused'};
  assert.equal(await streamOrWait(run, p => seen.push(p.text || p.reasoning)), 'Hello');
  assert.deepEqual(seen, ['hmm', 'Hel', 'Hello']);
});

test('streaming falls back to a normal request when it cannot start', async () => {
  const {streamOrWait} = await import('../generation.mjs');
  const run = async stream => { if (stream) throw Error('no streaming here'); return {content: 'whole reply'}; };
  assert.equal(await streamOrWait(run, () => {}), 'whole reply');
  assert.equal(await streamOrWait(async () => ({content: 'plain'}), null), 'plain');
});

test('a stream that ends with only thinking is an empty reply, not retried as non-stream', async () => {
  const {streamOrWait} = await import('../generation.mjs');
  let calls = 0;
  const run = async stream => { calls++; return async function* () { yield {text: '', state: {reasoning: 'thinking only'}}; }; };
  await assert.rejects(streamOrWait(run, () => {}), e => e.emptyReply && /thinking/.test(e.message));
  assert.equal(calls, 1);
});

test('planning requests override roleplay penalties that cause word salad', async () => {
  let data, override;
  const c = {mainApi: 'openai', chatCompletionSettings: {chat_completion_source: 'custom', custom_url: 'http://local'}, getChatCompletionModel: () => 'm', getPresetManager: () => ({getSelectedPresetName: () => 'p'}), ChatCompletionService: {processRequest: async d => { data = d; return {content: 'ok'}; }}, ConnectionManagerRequestService: {sendRequest: async (id, msgs, max, custom, o) => { override = o; return {content: 'ok'}; }}};
  await generate(c, 'x', '');
  assert.equal(data.frequency_penalty, 0); assert.equal(data.presence_penalty, 0); assert.equal(data.temperature, 0.7);
  await generate(c, 'x', 'profile');
  assert.equal(override.frequency_penalty, 0);
});

test('an answer written inside the thinking is recovered, using the last full draft', async () => {
  const {replyText, answerInThinking} = await import('../generation.mjs');
  const thinking = 'Plan it.\n=== ENTRY: Novel Foundation\nKEYS: a\ndraft one\n=== END\nHmm, redo.\n=== ENTRY: Novel Foundation\nKEYS: a\nfinal one\n=== END\n=== ENTRY: People\nKEYS: b\ncast\n=== END';
  const got = replyText({content: '', reasoning: thinking});
  assert.match(got, /final one/);
  assert.doesNotMatch(got, /draft one/);
  assert.match(got, /People/);
  assert.equal(answerInThinking('just thoughts, no entries'), '');
  assert.throws(() => replyText({content: '', reasoning: 'just thoughts'}), e => e.emptyReply);
});

test('lint findings written inside the thinking are recovered too', async () => {
  const {answerInThinking} = await import('../generation.mjs');
  assert.match(answerInThinking('Let me check.\n- [PERIOD] [hard] line 6: "smartwatch" — not in 1979\nBIGGEST PROBLEM: x'), /^- \[PERIOD\]/);
  assert.equal(answerInThinking('Checked everything. No problems found.'), 'No problems found.');
});

test('answers written inside the thinking are recovered for the chapter team and narrator steps', async () => {
  const {answerInThinking} = await import('../generation.mjs');
  assert.match(answerInThinking('plan...\n=== PART 1\ndraft\n=== END\nbetter:\n=== PART 1\nfinal\n=== END'), /^=== PART 1\nfinal/);
  assert.match(answerInThinking('thinking\n- [must] line 3: "Arthur died" — move it\nOVERALL: ok'), /^- \[must\] line 3/);
  assert.match(answerInThinking('hmm\n- suggest line 2: "x" — y'), /^- suggest line 2/);
  assert.match(answerInThinking('ok\n=== DESCRIPTION\nWHO NARRATES: Danny\n=== END'), /^=== DESCRIPTION/);
  assert.match(answerInThinking('NARRATOR: Danny\nPOINT OF VIEW: First\nTENSE: Past'), /^NARRATOR: Danny/);
  assert.equal(answerInThinking('just rambling about the chapter'), '');
});

test('an unfinished revision draft inside the thinking is not used', async () => {
  const {answerInThinking} = await import('../generation.mjs');
  assert.equal(answerInThinking('plan…\n=== PART 1\nDone part.\n=== END\nmore thought\n=== PART 1\nHalf a draft that never'), '=== PART 1\nDone part.\n=== END');
  assert.notEqual(answerInThinking('=== PART 1\nHalf a draft that never')?.startsWith('=== PART'), true);
});

test('the reasoning effort is added to a custom endpoint’s include body without overriding the writer', async () => {
  const {withIncludeBody} = await import('../generation.mjs');
  assert.equal(withIncludeBody('', 'reasoning_effort', 'low'), 'reasoning_effort: low');
  assert.equal(withIncludeBody('top_k: 20', 'reasoning_effort', 'low'), 'top_k: 20\nreasoning_effort: low');
  assert.equal(withIncludeBody('reasoning_effort: high', 'reasoning_effort', 'low'), 'reasoning_effort: high');
  assert.equal(withIncludeBody('{"top_k":20}', 'reasoning_effort', 'low'), '{"top_k":20,"reasoning_effort":"low"}');
  assert.equal(withIncludeBody('- broken', 'reasoning_effort', 'low'), '- broken\nreasoning_effort: low');
});

test('on a connection profile, a request hook adds to the profile’s own Include Body instead of replacing it', async () => {
  const {generate} = await import('../generation.mjs');
  let sent = null;
  const c = {
    extensionSettings: {connectionManager: {profiles: [{id: 'p1', model: 'deepseek', 'api-url': 'https://api.venice.ai/api/v1', preset: 'Novel'}]}},
    ConnectionManagerRequestService: {validateProfile: () => ({source: 'custom'}), sendRequest: async (id, m, t, opts, override) => { sent = override; return {content: 'ok'}; }},
    getPresetManager: () => ({getCompletionPresetByName: () => ({custom_include_body: 'top_k: 20'})}),
    chatCompletionSettings: {custom_include_body: 'ignored: true'},
    substituteParams: x => x,
  };
  const hook = (payload, conn) => { payload.custom_include_body += '\nreasoning_effort: low'; payload.dials_tag = 't1'; assert.equal(conn.profileId, 'p1'); assert.equal(payload.chat_completion_source, 'custom'); assert.equal(payload.custom_url, 'https://api.venice.ai/api/v1'); };
  const r = await generate(c, 'hi', 'p1', null, 1000, '', null, null, null, hook);
  assert.equal(r, 'ok');
  assert.equal(sent.custom_include_body, 'top_k: 20\nreasoning_effort: low');
  assert.equal(sent.dials_tag, 't1');
  // Without a hook nothing extra is sent.
  await generate(c, 'hi', 'p1', null, 1000);
  assert.equal(sent.custom_include_body, undefined);
  assert.equal(sent.dials_tag, undefined);
});

test('options are merged into an Include Body without overwriting the writer', async () => {
  const {mergeIncludeBody} = await import('../generation.mjs');
  assert.equal(mergeIncludeBody('', {venice_parameters: {disable_thinking: true}}), 'venice_parameters: {"disable_thinking":true}');
  assert.equal(mergeIncludeBody('top_k: 20', {reasoning_effort: 'low'}), 'top_k: 20\nreasoning_effort: low');
  assert.equal(mergeIncludeBody('reasoning_effort: high', {reasoning_effort: 'low'}), 'reasoning_effort: high');
  assert.equal(mergeIncludeBody('{"a":1}', {b: {c: 2}}), '{"a":1,"b":{"c":2}}');
});

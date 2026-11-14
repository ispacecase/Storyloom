import {directPayload} from './providers.mjs';
/** Reply text, or a specific error when the model answered with nothing. */
/**
 * Some reasoning models never close their thinking, so the real answer arrives inside it.
 * Recover the last full set of entry blocks (or the last JSON reply) from the thinking text.
 */
export function answerInThinking(thought) {
  const text=String(thought||'');
  // A chapter revision (=== PART 1 … === END): take the last full attempt.
  // Only an attempt that reached === END counts; an unfinished draft in the thinking would cut the chapter off.
  const parts=[...text.matchAll(/^[\s*_#>]*===\s*PART\s*1\s*$/gim)].filter(m=>/^[\s*_#>]*===\s*END\b/im.test(text.slice(m.index)));
  if(parts.length){const from=text.slice(parts.at(-1).index), end=from.search(/^[\s*_#>]*===\s*END\b.*$/im); return from.slice(0,end).trim()+'\n=== END';}
  // A narrator draft (=== DESCRIPTION / === NARRATOR …).
  const desc=[...text.matchAll(/^[\s*_#>]*===\s*(DESCRIPTION|NARRATOR)\s*$/gim)];
  if(desc.length)return text.slice(desc.at(-1).index).trim();
  const starts=[...text.matchAll(/^[\s*_#>]*=+\s*ENTRY\s*:\s*(.*?)[\s*_=]*$/gim)];
  if(starts.length) {
    const first=starts[0][1].trim().toLocaleLowerCase();
    const restart=starts.filter(m=>m[1].trim().toLocaleLowerCase()===first).at(-1);
    return 'Done.\n\n'+text.slice(restart.index).trim();
  }
  const json=text.lastIndexOf('{"reply"');
  if(json>=0)return text.slice(json).trim();
  // Lint findings ("- [KIND] …") or an explicit all-clear written inside the thinking.
  const lines=[...text.matchAll(/^\s*[-*•]\s*\[[A-Z ]+\].*$/gm)];
  if(lines.length)return text.slice(lines[0].index).trim();
  // Editor / Reader notes ("- [must] line 4: "quote" — note"), from the last list that starts afresh.
  const notes=[...text.matchAll(/^\s*[-*•]\s*(?:\[?(?:must|suggest)\]?\s*[:,-]?\s*)?line\s*\d+\s*:?\s*[“"]/gim)];
  if(notes.length)return text.slice(notes[0].index).trim();
  // Chapter narration settings ("NARRATOR: … / POINT OF VIEW: …").
  const narr=[...text.matchAll(/^\s*NARRATOR\s*:.+$/gim)].filter(m=>/^\s*POINT OF VIEW\s*:/im.test(text.slice(m.index)));
  if(narr.length)return text.slice(narr.at(-1).index).trim();
  const clear=text.lastIndexOf('No problems found');
  return clear>=0 ? 'No problems found.' : '';
}
export function replyText(response) {
  const text=typeof response==='string'?response:response?.content;
  if(String(text||'').trim())return text;
  const thought=String(response?.reasoning||'').trim();
  const recovered=answerInThinking(thought);
  if(recovered){console.warn('Storyloom: the model wrote its answer inside its thinking; using that.');return recovered;}
  const error=Error(thought
    ? `the model spent its whole reply thinking (${thought.split(/\s+/).length} words of reasoning) and wrote no answer`
    : 'the model sent back an empty reply');
  error.emptyReply=true;
  throw error;
}
/**
 * Stream when the caller wants progress: `run(stream)` sends the request.
 * Falls back to a normal request if streaming fails before anything arrives.
 */
export async function streamOrWait(run,onProgress,signal) {
  if(!onProgress)return replyText(await run(false));
  let got=false;
  try {
    const make=await run(true);
    if(typeof make!=='function')return replyText(make);
    let text='',reasoning='';
    for await (const chunk of make()) {
      got=true;
      text=chunk?.text||''; reasoning=chunk?.state?.reasoning||'';
      onProgress({text,reasoning});
    }
    return replyText({content:text,reasoning});
  } catch(error) {
    if(got || signal?.aborted || error?.emptyReply)throw error;
    console.warn('Storyloom: streaming unavailable, waiting for the full reply instead:',error?.message);
    return replyText(await run(false));
  }
}
/**
 * Storyloom's own sampling for planning: roleplay presets often use frequency/presence penalties,
 * which make long structured replies degrade into word salad. The main chat's settings are untouched.
 */
export const PLANNING_SAMPLING=Object.freeze({temperature:0.7,frequency_penalty:0,presence_penalty:0});
/** Add one field to a custom endpoint's “Include body” (YAML or JSON), unless the writer already set it. */
export function withIncludeBody(body,key,value) {
  const t=String(body||'').trim();
  if(!t)return `${key}: ${value}`;
  if(t.startsWith('{')){try{const o=JSON.parse(t); if(!(key in o))o[key]=value; return JSON.stringify(o);}catch{return t;}}
  if(new RegExp(`^\\s*["']?${key}["']?\\s*:`,'m').test(t))return t;
  return `${t}\n${key}: ${value}`;
}
/** Add a set of options to an Include Body (YAML or JSON), never over a field already there. Nested values go in as JSON, which YAML reads too. */
export function mergeIncludeBody(body,options) {
  let t=String(body||'');
  for(const [k,v] of Object.entries(options||{})) {
    if(v===undefined || v===null)continue;
    const trimmed=t.trim();
    if(trimmed.startsWith('{')){try{const o=JSON.parse(trimmed); if(!(k in o))o[k]=v; t=JSON.stringify(o); continue;}catch{return t;}}
    t=withIncludeBody(t,k,typeof v==='string'?v:JSON.stringify(v));
  }
  return t;
}
/** Generate without switching the main connection or mutating its response length. */
/**
 * The Include Body a connection profile's request will carry: SillyTavern builds it inside its own code from the
 * profile's preset (else the current settings), so a caller that adds to it has to start from the same text.
 */
export function profileIncludeBody(c,profileId) {
  const profile=(c.extensionSettings?.connectionManager?.profiles||[]).find(p=>p.id===profileId);
  if(!profile)return {profile:null,source:'',body:''};
  let source=''; try{source=c.ConnectionManagerRequestService.validateProfile(profile)?.source||'';}catch{}
  let preset=null; try{preset=profile.preset?c.getPresetManager('openai')?.getCompletionPresetByName(profile.preset):null;}catch{}
  const raw=preset?.custom_include_body ?? c.chatCompletionSettings?.custom_include_body ?? '';
  return {profile,source,body:c.substituteParams?.(raw||'') ?? (raw||'')};
}
/**
 * `beforeSend(payload, conn)` (optional) sees each request's finished payload just before it is sent and may add to it
 * (Storyloom uses it for Dials). It must leave the rest of the payload alone.
 */
export async function generate(c,prompt,profile,signal,maxTokens=6000,systemPrompt='',direct=null,onProgress=null,sampling=null,beforeSend=null) {
  const SAMPLING={...PLANNING_SAMPLING,...(sampling||{})};
  const hook=(payload,conn)=>{if(beforeSend)try{beforeSend(payload,conn);}catch(e){console.warn('Storyloom: request hook failed; sending unchanged',e);} return payload;};
  if(!Number.isInteger(maxTokens) || maxTokens<256 || maxTokens>16000) throw Error('Response budget must be between 256 and 16000 tokens.');
  const messages=systemPrompt ? [{role:'system',content:systemPrompt},{role:'user',content:prompt}] : [{role:'user',content:prompt}];
  if(profile==='__direct__') {
    const payload=directPayload(direct);
    return streamOrWait(stream=>{const body={stream,messages,max_tokens:maxTokens,...payload,...SAMPLING}; if(body.chat_completion_source==='custom')body.custom_include_body ??= ''; hook(body,{source:body.chat_completion_source,url:body.custom_url,model:body.model}); return c.ChatCompletionService.processRequest(body,{},true,signal);},onProgress,signal);
  }
  if(profile) {
    return streamOrWait(stream=>{
      const override={...SAMPLING};
      if(beforeSend) {
        // SillyTavern fills the profile's Include Body itself, and anything passed here replaces it: so start from the
        // same text, let the hook add to it, and pass the result (plus anything else the hook added) through.
        const {profile:p,source,body}=profileIncludeBody(c,profile);
        if(p) {
          const stub={stream,max_tokens:maxTokens,model:p.model,chat_completion_source:source,custom_url:p['api-url'],...(source==='custom'?{custom_include_body:body}:{})};
          const before=new Set(Object.keys(stub)); hook(stub,{profileId:profile,source,url:p['api-url'],model:p.model});
          if(source==='custom' && stub.custom_include_body!==body)override.custom_include_body=stub.custom_include_body;
          for(const k of Object.keys(stub))if(!before.has(k))override[k]=stub[k];
        }
      }
      return c.ConnectionManagerRequestService.sendRequest(profile,messages,maxTokens,{stream,extractData:true,includePreset:true,signal},override);
    },onProgress,signal);
  }
  if(c.mainApi==='openai' && c.ChatCompletionService && c.getChatCompletionModel) {
    const settings=c.chatCompletionSettings || {};
    const model=c.getChatCompletionModel();
    if(!model || (settings.chat_completion_source==='custom' && !settings.custom_url))throw Error('Choose a model and connect it in SillyTavern, or select a separate connection in Storyloom.');
    const custom=settings.chat_completion_source==='custom' ? Object.fromEntries(
      ['custom_include_body','custom_exclude_body','custom_include_headers'].map(key=>[
        key, c.substituteParams?.(settings[key] || '') ?? settings[key],
      ]),
    ) : {};
    // A custom (OpenAI-compatible) endpoint only gets extra fields through “Include body”; add the reasoning effort there.
    if(SAMPLING.reasoning_effort && settings.chat_completion_source==='custom')custom.custom_include_body=withIncludeBody(custom.custom_include_body,'reasoning_effort',SAMPLING.reasoning_effort);
    const options={presetName:c.getPresetManager('openai')?.getSelectedPresetName()};
    return streamOrWait(stream=>{const body={stream,messages,model,chat_completion_source:settings.chat_completion_source,custom_url:settings.custom_url,reverse_proxy:settings.reverse_proxy,proxy_password:settings.proxy_password,custom_prompt_post_processing:settings.custom_prompt_post_processing,max_tokens:maxTokens,...custom,...SAMPLING}; hook(body,{source:body.chat_completion_source,url:body.custom_url,model}); return c.ChatCompletionService.processRequest(body,options,true,signal);},onProgress,signal);
  }
  // Legacy APIs do not expose an equivalent isolated request service.
  // Respect their configured response length instead of changing shared settings.
  if(signal?.aborted) throw new Error('Stopped');
  return await c.generateRaw({prompt,systemPrompt});
}
export function profileOptions(profiles,service,selected) {
 const supported=[];let selectedFound=false;
 for(const p of profiles||[]) {
  let allowed=false;try {allowed=!!service?.isProfileSupported(p);} catch {}
  if(p.id===selected)selectedFound=true;
  if(allowed || p.id===selected) supported.push({id:p.id,name:p.name+(allowed?'':' (unsupported)')});
 }
 if(selected && !selectedFound) supported.push({id:selected,name:'Previously selected profile (unavailable)'});
 return supported;
}

export async function requestModel(run, signal, timeoutMs=120000) {
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Stopped. Your message is still in the box.'));
  if(signal?.aborted)stop();
  else signal?.addEventListener('abort',stop,{once:true});
  const timer = setTimeout(()=>controller.abort(new Error(`The model took too long to reply (over ${Math.max(1,Math.round(timeoutMs/60000))} min). Try again, or lower the response budget in Settings.`)),timeoutMs);
  let abort;
  try {
    if(controller.signal.aborted)throw controller.signal.reason;
    return await Promise.race([
      new Promise((_,reject)=>{
        abort=()=>reject(controller.signal.reason);
        controller.signal.addEventListener('abort',abort,{once:true});
      }),
      Promise.resolve().then(()=>run(controller.signal)),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort',stop);
    controller.signal.removeEventListener('abort',abort);
  }
}

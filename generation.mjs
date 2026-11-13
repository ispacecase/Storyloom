import {directPayload} from './providers.mjs';
/** Reply text, or a specific error when the model answered with nothing. */
export function replyText(response) {
  const text=typeof response==='string'?response:response?.content;
  if(String(text||'').trim())return text;
  const thought=String(response?.reasoning||'').trim();
  const error=Error(thought
    ? `the model spent its whole reply thinking (${thought.split(/\s+/).length} words of reasoning) and wrote no answer`
    : 'the model sent back an empty reply');
  error.emptyReply=true;
  throw error;
}
/** Generate without switching the main connection or mutating its response length. */
export async function generate(c,prompt,profile,signal,maxTokens=6000,systemPrompt='',direct=null) {
  if(!Number.isInteger(maxTokens) || maxTokens<256 || maxTokens>16000) throw Error('Response budget must be between 256 and 16000 tokens.');
  const messages=systemPrompt ? [{role:'system',content:systemPrompt},{role:'user',content:prompt}] : [{role:'user',content:prompt}];
  if(profile==='__direct__') {
    const payload=directPayload(direct);
    const response=await c.ChatCompletionService.processRequest({stream:false,messages,max_tokens:maxTokens,...payload},{},true,signal);
    return replyText(response);
  }
  if(profile) {
    const response=await c.ConnectionManagerRequestService.sendRequest(profile,messages,maxTokens,{stream:false,extractData:true,includePreset:true,signal});
    return replyText(response);
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
    const options={presetName:c.getPresetManager('openai')?.getSelectedPresetName()};
    const response=await c.ChatCompletionService.processRequest({stream:false,messages,model,chat_completion_source:settings.chat_completion_source,custom_url:settings.custom_url,reverse_proxy:settings.reverse_proxy,proxy_password:settings.proxy_password,custom_prompt_post_processing:settings.custom_prompt_post_processing,max_tokens:maxTokens,...custom},options,true,signal);
    return replyText(response);
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

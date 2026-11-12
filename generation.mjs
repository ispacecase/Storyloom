/** Generate without switching the main connection or mutating its response length. */
export async function generate(c,prompt,profile,signal,maxTokens=6000) {
  if(!Number.isInteger(maxTokens) || maxTokens<256 || maxTokens>16000) throw Error('Response budget must be between 256 and 16000 tokens.');
  if(profile) {
    const response=await c.ConnectionManagerRequestService.sendRequest(profile,[{role:'user',content:prompt}],maxTokens,{stream:false,extractData:true,includePreset:true,signal});
    return response?.content || '';
  }
  if(c.mainApi==='openai' && c.ChatCompletionService && c.getChatCompletionModel) {
    const settings=c.chatCompletionSettings;
    const options={presetName:c.getPresetManager('openai')?.getSelectedPresetName()};
    const response=await c.ChatCompletionService.processRequest({stream:false,messages:[{role:'user',content:prompt}],model:c.getChatCompletionModel(),chat_completion_source:settings.chat_completion_source,custom_url:settings.custom_url,reverse_proxy:settings.reverse_proxy,proxy_password:settings.proxy_password,custom_prompt_post_processing:settings.custom_prompt_post_processing,max_tokens:maxTokens},options,true,signal);
    return response?.content || '';
  }
  // Legacy APIs do not expose an equivalent isolated request service.
  // Respect their configured response length instead of changing shared settings.
  if(signal?.aborted) throw new Error('Stopped');
  return await c.generateRaw({prompt});
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

/** Native SillyTavern chat providers that can be selected independently. */
export const PROVIDERS=Object.freeze([
 {id:'openrouter',name:'OpenRouter',secret:'api_key_openrouter',sessionUrl:'https://openrouter.ai/api/v1'},
 {id:'openai',name:'OpenAI',secret:'api_key_openai',sessionUrl:'https://api.openai.com/v1'},
 {id:'claude',name:'Anthropic / Claude',secret:'api_key_claude'},
 {id:'makersuite',name:'Google AI Studio',secret:'api_key_makersuite'},
 {id:'deepseek',name:'DeepSeek',secret:'api_key_deepseek',sessionUrl:'https://api.deepseek.com/beta'},
 {id:'mistralai',name:'Mistral',secret:'api_key_mistralai',sessionUrl:'https://api.mistral.ai/v1'},
 {id:'groq',name:'Groq',secret:'api_key_groq',sessionUrl:'https://api.groq.com/openai/v1'},
 {id:'xai',name:'xAI / Grok',secret:'api_key_xai',sessionUrl:'https://api.x.ai/v1'},
 {id:'perplexity',name:'Perplexity',secret:'api_key_perplexity',sessionUrl:'https://api.perplexity.ai'},
 {id:'cohere',name:'Cohere',secret:'api_key_cohere'},
 {id:'ai21',name:'AI21',secret:'api_key_ai21'},
 {id:'chutes',name:'Chutes',secret:'api_key_chutes',sessionUrl:'https://llm.chutes.ai/v1'},
 {id:'fireworks',name:'Fireworks AI',secret:'api_key_fireworks',sessionUrl:'https://api.fireworks.ai/inference/v1'},
 {id:'moonshot',name:'Moonshot AI',secret:'api_key_moonshot',sessionUrl:'https://api.moonshot.ai/v1'},
 {id:'aimlapi',name:'AI/ML API',secret:'api_key_aimlapi',sessionUrl:'https://api.aimlapi.com/v1'},
 {id:'electronhub',name:'Electron Hub',secret:'api_key_electronhub'},
 {id:'nanogpt',name:'NanoGPT',secret:'api_key_nanogpt',sessionUrl:'https://nano-gpt.com/api/v1'},
 {id:'cometapi',name:'CometAPI',secret:'api_key_cometapi',sessionUrl:'https://api.cometapi.com/v1'},
 {id:'custom',name:'Venice / local / other OpenAI-compatible',secret:'api_key_custom',custom:true},
]);
export function directPayload(settings) {
 const provider=PROVIDERS.find(x=>x.id===settings?.provider);
 if(!provider)throw Error('Choose an AI provider.');
 const model=String(settings.model||'').trim();if(!model)throw Error('Enter a model name.');
 if(settings.sessionRequired && !settings.sessionKey)throw Error('Re-enter the session key for this connection.');
 const payload={chat_completion_source:provider.id,model};
 if(settings.sessionKey && !provider.custom){
   if(!provider.sessionUrl)throw Error('Use a saved key for this provider in SillyTavern.');
   const key=String(settings.sessionKey);if(/[\r\n]/.test(key))throw Error('Invalid API key.');
   return {chat_completion_source:'custom',model,custom_url:provider.sessionUrl,custom_include_headers:JSON.stringify({Authorization:`Bearer ${key}`})};
 }
 if(provider.custom){
   let url;try{url=new URL(String(settings.url||''));}catch{throw Error('Enter a valid provider URL.');}
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Use an HTTP or HTTPS provider URL without embedded credentials.');
   payload.custom_url=url.toString().replace(/\/$/,'');
   if(settings.sessionKey){
     const key=String(settings.sessionKey);if(/[\r\n]/.test(key))throw Error('Invalid API key.');
     payload.custom_include_headers=JSON.stringify({Authorization:`Bearer ${key}`});
   } else if(settings.keyId)payload.secret_id=settings.keyId;
   else payload.custom_include_headers=JSON.stringify({Authorization:''});
 } else {
   if(!settings.keyId)throw Error('Choose a saved key for this provider in AI connection settings.');
   payload.secret_id=settings.keyId;
 }
 return payload;
}
export async function readKeyOptions(fetcher,headers,providerId) {
 const provider=PROVIDERS.find(x=>x.id===providerId);if(!provider)throw Error('Choose an AI provider.');
 const r=await fetcher('/api/secrets/read',{method:'POST',headers,body:'{}'});
 if(!r.ok)throw Error('Could not load saved keys.');
 const state=await r.json();
 return (Array.isArray(state[provider.secret])?state[provider.secret]:[]).filter(x=>x?.id).map(x=>({id:String(x.id),label:String(x.label || 'Saved key')}));
}
export async function readModels(fetcher,headers,settings) {
 const payload=directPayload({...settings,model:'model-discovery'});
 const r=await fetcher('/api/backends/chat-completions/status',{method:'POST',headers,body:JSON.stringify(payload),cache:'no-cache'});
 if(!r.ok)throw Error('Could not retrieve models. Enter the model name instead.');
 const body=await r.json();
 if(body?.error || !Array.isArray(body?.data))throw Error('This provider did not return a model list. Enter the model name instead.');
 return [...new Set(body.data.map(x=>typeof x==='string'?x:x?.id).filter(x=>typeof x==='string'&&x.trim()))];
}

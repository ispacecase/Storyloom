const keys=['novelArchitect','world_info','note_prompt'];
const fields=metadata=>Object.fromEntries(keys.filter(k=>Object.hasOwn(metadata||{},k)).map(k=>[k,metadata[k]]));
export async function saveVerified(getContext,fetcher=fetch) {
 const c=getContext(),id=c.chatId;
 if(!id)throw Error('No chat is open.');
 const expected=JSON.stringify(fields(c.chatMetadata));
 const character=c.characters?.[c.characterId];
 const endpoint=c.groupId?'/api/chats/group/get':'/api/chats/get';
 if(!c.groupId && !character?.avatar)throw Error('Chat identity is unavailable.');
 const body=c.groupId?{id}:{ch_name:character.name,file_name:id,avatar_url:character.avatar};
 await c.saveMetadata();
 if(getContext().chatId!==id)throw Error('Chat changed during saving; check the original chat.');
 const response=await fetcher(endpoint,{method:'POST',headers:c.getRequestHeaders(),cache:'no-cache',body:JSON.stringify(body)});
 if(!response.ok)throw Error('Chat save could not be confirmed.');
 const data=await response.json();
 if(getContext().chatId!==id)throw Error('Chat changed during save verification.');
 if(!Array.isArray(data) || JSON.stringify(fields(data[0]?.chat_metadata))!==expected)throw Error('Chat save was not confirmed; retry before continuing.');
}

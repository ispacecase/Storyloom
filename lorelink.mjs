export function linkState(book,chatBook) {
 if(!book)return 'none'; if(!chatBook)return 'unlinked'; return book===chatBook?'linked':'different';
}
export async function linkBook({metadata,book,save,select,mark,confirm,isCurrent=()=>true}) {
 if(typeof book!=='string' || !book.trim())throw Error('Choose a lorebook first.');
 const previous=metadata.world_info;
 if(previous && previous!==book && !await confirm(previous,book))return false;
 if(!isCurrent())throw Error('Chat changed; the lorebook was not linked.');
 metadata.world_info=book;
 try {await save();} catch(e) {if(metadata.world_info===book){if(previous)metadata.world_info=previous;else delete metadata.world_info;}throw e;}
 if(!isCurrent())throw Error('Chat changed after linking; return to the original chat.');
 await select(book);mark();return true;
}

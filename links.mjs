/**
 * Linked characters: one character entry kept identical in several lorebooks,
 * plus a shared "link" lorebook that holds the same entry. Edit any copy and
 * Storyloom copies it to the others. `base` is the last content all copies agreed on.
 */
export const linkBookName=(a,b)=>`Shared — ${a} ↔ ${b}`.replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120);

/**
 * Decide what to do given each book's current copy of the entry.
 * contents: {bookName: string|null}  (null = entry missing in that book)
 * Returns {writes:{book:content}, base, conflict:[books]|null, missing:[books]}.
 */
export function planLinkSync(base,contents) {
  const books=Object.keys(contents);
  const missing=books.filter(b=>contents[b]==null);
  const present=books.filter(b=>contents[b]!=null);
  const changed=present.filter(b=>contents[b]!==base);
  const versions=[...new Set(changed.map(b=>contents[b]))];
  if(versions.length>1)return {writes:{},base,conflict:changed,missing};
  const next=versions.length?versions[0]:base;
  const writes={};
  for(const b of present)if(contents[b]!==next)writes[b]=next;
  return {writes,base:next,conflict:null,missing};
}

/** Force one book's copy onto the others (conflict resolution). */
export function resolveLink(contents,winner) {
  if(contents[winner]==null)throw Error(`“${winner}” no longer has this character.`);
  const next=contents[winner], writes={};
  for(const [b,c] of Object.entries(contents))if(c!=null && c!==next)writes[b]=next;
  return {writes,base:next};
}

export function findCharacterEntry(book,title) {
  const want=String(title).trim().toLocaleLowerCase();
  const found=Object.values(book?.entries||{}).filter(e=>String(e.comment||'').trim().toLocaleLowerCase()===want);
  if(found.length>1)throw Error(`More than one “${title}” entry; rename one so Storyloom knows which to sync.`);
  return found[0]||null;
}

/** Links touching a given book. */
export const linksFor=(links,book)=>(links||[]).filter(l=>l.books.includes(book));

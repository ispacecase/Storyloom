import {readDirective, replaceDirective, syncDecision} from './operations.mjs';
export function synchronize({base,book,note}) {
  const extracted = readDirective(note);
  if (extracted === null) return {conflict:true, reason:'Directive block missing from Author’s Note'};
  const decision = syncDecision(base,book,extracted);
  if (decision === 'conflict') return {conflict:true,reason:'Both the lorebook and Author’s Note changed'};
  const value = decision === 'note' ? extracted : book;
  return {conflict:false, book:value, note:replaceDirective(note,value), base:value};
}
export function resolveConflict({book,note},choice) {
  if(choice!=='book' && choice!=='note') throw Error('Choose a directive version.');
  const managed=readDirective(note);
  if(choice==='note' && managed===null) throw Error('The directive markers are missing from the note; restore them first.');
  const value=choice==='book'?book:managed;
  if(!value?.trim()) throw Error('The selected directive is empty.');
  return {book:value,note:replaceDirective(note,value),base:value};
}
export function planInitialLink(note, existing, fallback) {
  note=String(note||'');
  const marked=readDirective(note);
  const unmarkedDirective=marked===null && /^\s*CURRENT WRITING DIRECTIVE\b/i.test(note);
  const noteDirective=marked ?? (unmarkedDirective ? note.trim() : null);
  if(existing && noteDirective!==null && existing.trim()!==noteDirective.trim()) throw Error('The existing lorebook and Author’s Note directives differ.');
  const text=existing || noteDirective || fallback;
  const newNote=unmarkedDirective ? replaceDirective('',text) : replaceDirective(note,text);
  return {book:text,note:newNote};
}

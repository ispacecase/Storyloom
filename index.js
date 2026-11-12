import { createWorldInfoEntry, createNewWorldInfo } from '../../../world-info.js';
import { parseAssistant, planWrites, readDirective, replaceDirective } from './operations.mjs';
import { synchronize, resolveConflict, planInitialLink } from './sync.mjs';
import { createNovel, selectNovel } from './state.mjs';
import { makeWritingPrompt, validateScene, sceneCount } from './writing.mjs';
import { enqueue, nextJob, requiresReview, wasApplied, changedProcessed } from './queue.mjs';
import { foundationTemplate, initialDirective } from './template.mjs';
import { buildChange, undoChange, classifyChange, describeChange } from './history.mjs';
import { generate, profileOptions } from './generation.mjs';
import { queueContinuity, completeContinuity, continuityPrompt } from './continuity.mjs';
import { selectLore, recentConversation, ensureCompleteUpdates } from './context.mjs';
import { saveVerified } from './persistence.mjs';

const KEY = 'novelArchitect';
const context = () => SillyTavern.getContext();
let busy = false;
let syncing = false;
let stopWriting = false;
let writingController = null;
let writingSession = false;
let continuityBusy = false;
let draining = false;
let syncTimer;
const defaults = createNovel();
const instructions = `You are Storyloom, a conversational novel-planning assistant. Ask the writer questions naturally, one or a few at a time. The foundation is title, genre, setting, premise, protagonist, major characters, central conflict, relationship arcs, narrative style, major plot milestones, ending direction. Update the existing Novel Foundation entry by filling in its labeled fields while preserving its headings and consistency instruction. It is a starting point; add other useful entries as separate entries. Treat possibilities as possibilities, not established facts. Preserve existing established facts unless the user explicitly revises them. Return only JSON {"reply":"your conversational response","updates":[{"title":"entry title","content":"complete revised entry text","keys":["activation keyword"]}]}. Include only useful new or changed entries, and preserve established details when revising. Return an empty updates array when nothing should be saved. Never invent established facts.`;

function root() {
  const c=context();
  if (!c.chatId) throw new Error('Open the main story chat first.');
  let value=c.chatMetadata[KEY];
  if (!value) value=c.chatMetadata[KEY]={selected:'',novels:{}};
  if (!value.novels) {
    const old=value, selected=old.book || '';
    value=c.chatMetadata[KEY]={selected,novels:{}};
    Object.defineProperty(value.novels,selected,{value:old,writable:true,enumerable:true,configurable:true});
  }
  return value;
}
function data() { const state=root(); return selectNovel(state,state.selected || ''); }
function changeBook(book) {
  const state=root(), current=selectNovel(state,state.selected || '');
  if (current.directive && current.book !== book) throw Error('This chat already has a linked writing directive. Open a different chat for another novel.');
  return selectNovel(state,book);
}
async function persist() { await saveVerified(context); }
function status(s) { document.getElementById('na-status').textContent = s; }
function showMessages() {
  const target = document.getElementById('na-messages');
  target.replaceChildren();
  if (!data().messages.length) { const p=document.createElement('p'); p.textContent='Architect: Let’s build your novel. What idea would you like to start with?'; target.append(p); }
  for (const msg of data().messages) {
    const p = document.createElement('p');
    p.textContent = `${msg.role === 'user' ? 'You' : 'Architect'}: ${msg.content}`;
    target.append(p);
  }
  target.scrollTop = target.scrollHeight;
}
function options() {
  const c = context(), d = data();
  for (const [id, list, val, blank] of [
    ['na-book', c.getWorldInfoNames(), d.book, 'Choose this novel’s lorebook'],
    ['na-reference', c.getWorldInfoNames().filter(n => n !== d.book), d.reference, 'No linked reference'],
    ['na-profile', profileOptions(c.extensionSettings.connectionManager?.profiles || [],c.ConnectionManagerRequestService,d.profile), d.profile, 'Use current connection'],
  ]) {
    const el = document.getElementById(id); el.replaceChildren(new Option(blank, ''));
    for (const item of list) el.add(new Option(typeof item === 'string' ? item : item.name, typeof item === 'string' ? item : item.id));
    el.value = val || '';
  }
  document.getElementById('na-watch').checked = !!d.watch;
  document.getElementById('na-tokens').value=String(d.responseTokens || 6000);
  if (!d.book) document.getElementById('na-settings').open=true;
  showMessages();
  const list=document.getElementById('na-history'); list.replaceChildren();
  for(const item of [...(d.history||[])].reverse()){const li=document.createElement('li');li.textContent=describeChange(item);list.append(li);}
  if(d.pendingContinuity)status('A saved draft is waiting for a continuity update. Retry it in settings.');
  else if(d.review)status('A previously processed chat message changed. Review your lore, then resume tracking in settings.');
}
async function freshBook(name) {
  const r = await fetch('/api/worldinfo/get', { method:'POST', headers:context().getRequestHeaders(), body:JSON.stringify({name}), cache:'no-store' });
  if (!r.ok) throw new Error('Could not load lorebook: ' + name);
  return await r.json();
}
function synopsis(book) {
  return Object.values(book.entries || {}).map(e => ({title:e.comment, content:e.content, keys:e.key || []})).filter(e => e.title && e.content);
}
async function llm(c,prompt,profile,signal,tokens) { return await generate(c,prompt,profile,signal,tokens); }
async function recoverPending(d) {
  const pending=d.pendingWrite;
  if(!pending) return;
  const book=await freshBook(pending.book);
  if(data()!==d) throw Error('Chat changed; recovery will resume when you return.');
  const state=classifyChange(book,pending.changes);
  if(state==='conflict') throw Error('A previous save was interrupted and its entries changed. Review the book before retrying.');
  if(state==='after') {
    d.history ??= [];
    if(!d.history.some(x=>x.id===pending.id)) d.history.push(pending);
    if(d.history.length>30)d.history.shift();
  }
  delete d.pendingWrite;
  await persist();
}
async function interact(input, fromMain = false, guard = null, jobId = null, sourceKind = null, allowWriting = false) {
  if (busy || syncing || (draining && !jobId) || (continuityBusy && !allowWriting) || (writingSession && !allowWriting)) throw new Error('Novel Architect is already working.');
  const c = context(), d = data(), chatId = c.chatId, bookName = d.book, profile=d.profile, referenceName=d.reference, tokens=Number(d.responseTokens || 6000);
  if (!bookName) throw new Error('Choose this novel’s lorebook first.');
  busy = true;
  try {
    status('Thinking…');
    await recoverPending(d);
    if(context().chatId !== chatId || data() !== d) throw Error('Chat changed; nothing saved.');
    const before = await freshBook(bookName);
    const ref = referenceName ? await freshBook(referenceName) : null;
    if(input.length>30000) throw Error('The message is too long for one request. Split it into smaller parts.');
    const budget=Math.max(4000,Math.min(24000,(Number(c.maxContext)||8192)*2));
    const history=recentConversation(d.messages,Math.floor(budget*.25));
    const query=history.map(x=>x.content).join(' ')+input;
    const current=selectLore(synopsis(before),query,Math.floor(budget*.5));
    const reference=selectLore(ref?synopsis(ref):[],query,Math.floor(budget*.25));
    const prompt = `${instructions}\n\nOnly supplied lore is visible. Some entries may be omitted or shortened; never assume absence means a fact is unknown. Do not rewrite entries whose full content was not supplied.\nCurrent novel entries: ${JSON.stringify(current)}\nReference material from ${referenceName || 'no linked book'} (do not treat as current canon without relevance): ${JSON.stringify(reference)}\nConversation: ${JSON.stringify(history)}\n${fromMain ? 'New main story chat text; record only established developments and do not address the user: ' : 'Writer: '}${input}`;
    if(context().chatId!==chatId || data()!==d || d.profile!==profile || d.reference!==referenceName) throw Error('Chat or novel changed; request stopped.');
    const result = parseAssistant(await llm(c,prompt,profile,undefined,tokens));
    if (context().chatId !== chatId || data().book !== bookName || d.profile!==profile || d.reference!==referenceName) throw new Error('Chat or lorebook changed while generating; nothing saved.');
    if (guard && !guard()) throw Error('The source message changed; nothing was saved.');
    const fresh = await freshBook(bookName);
    if (JSON.stringify(fresh) !== JSON.stringify(before)) throw new Error('Lorebook changed while generating; nothing saved. Please retry.');
    const writes = planWrites(fresh, result.updates);
    ensureCompleteUpdates(writes,current);
    for (const w of writes) {
      const entry = w.uid === null ? createWorldInfoEntry(bookName, fresh) : fresh.entries[w.uid];
      if (!entry) throw new Error('Unable to create entry');
      entry.comment = w.update.title.trim(); entry.content = w.update.content; entry.key = w.update.keys;
    }
    if (writes.length) {
      const record={id:crypto.randomUUID(),book:bookName,changes:buildChange(before,fresh),source:sourceKind || (fromMain?'main chat':'planning conversation'),jobId,reference:referenceName || null,at:new Date().toISOString()};
      d.pendingWrite=record;
      await persist();
      if (context().chatId !== chatId || data().book !== bookName || d.profile!==profile || d.reference!==referenceName) throw Error('Chat or lorebook changed; the update was not saved.');
      const latest = await freshBook(bookName);
      if (JSON.stringify(latest) !== JSON.stringify(before)) throw Error('Lorebook changed before saving; update stopped.');
      if (guard && !guard()) throw Error('The source message changed; nothing was saved.');
      await c.saveWorldInfo(bookName, fresh, true);
      const readback = await freshBook(bookName);
      if (JSON.stringify(readback) !== JSON.stringify(fresh)) throw Error('Save could not be verified; inspect the lorebook before retrying.');
      if(context().chatId!==chatId || data()!==d) throw Error('Chat changed after save; recovery will run when you return.');
      await recoverPending(d);
      if (guard && !guard()) {d.review={reason:'The source message changed during saving.'}; await persist(); throw Error('The source changed during saving. Review or undo the last update before resuming.');}
      if(!document.getElementById('na-panel').hidden) options();
    }
    if (!fromMain) { d.messages.push({role:'user',content:input},{role:'assistant',content:result.reply}); await persist(); showMessages(); }
    status(writes.length ? `Saved ${writes.length} World Info ${writes.length === 1 ? 'entry' : 'entries'}.` : 'No entry changes.');
  } finally { busy = false; queueSync(); if(!draining)scheduleDrain(); }
}
function requireIdle() { if(busy || syncing || draining || writingSession || continuityBusy) throw Error('Wait for the current Storyloom operation to finish.'); }
async function setupNovel() {
 requireIdle(); syncing=true;
 try {await setupFoundation(); await setupDirective();} finally {syncing=false;queueSync();scheduleDrain();}
}
async function setupFoundation() {
  const c=context(), d=data(), chatId=c.chatId, name=d.book;
  if(!name) throw Error('Choose a lorebook first.');
  const book=await freshBook(name);
  const existing=Object.values(book.entries).filter(e=>e.comment==='Novel Foundation');
  if(existing.length>1) throw Error('This book has more than one Novel Foundation entry.');
  if(existing.length) return;
  const before=structuredClone(book), entry=createWorldInfoEntry(name,book);
  if(!entry) throw Error('Could not create foundation.');
  entry.comment='Novel Foundation'; entry.content=foundationTemplate(); entry.constant=true; entry.key=[];
  if(context().chatId!==chatId || data().book!==name || JSON.stringify(await freshBook(name))!==JSON.stringify(before)) throw Error('Chat or lorebook changed; setup stopped.');
  if(context().chatId!==chatId || data().book!==name) throw Error('Chat changed; setup stopped.');
  await c.saveWorldInfo(name,book,true);
  if(JSON.stringify(await freshBook(name))!==JSON.stringify(book)) throw Error('Foundation save could not be verified.');
}
async function setupDirective() {
  const c = context(), d = data(), chatId = c.chatId;
  if (!d.book) throw Error('Choose a lorebook first.');
  const book = await freshBook(d.book);
  const originalBook=structuredClone(book);
  const existing = Object.values(book.entries).filter(e => e.comment === 'Current Writing Directive');
  if (existing.length > 1) throw Error('This book has more than one directive. Resolve the duplicate entries first.');
  const note = document.getElementById('extension_floating_prompt');
  if (!note) throw Error('Author’s Note is unavailable.');
  const originalNote = note.value;
  const plan=planInitialLink(originalNote,existing[0]?.content,initialDirective());
  const text=plan.book, newNote=plan.note;
  const entry = existing[0] || createWorldInfoEntry(d.book, book);
  if (!entry) throw Error('Could not create a directive entry.');
  if (!existing.length) {entry.comment = 'Current Writing Directive'; entry.content = text; entry.key = []; entry.disable = true;}
  if (context().chatId !== chatId) throw Error('Chat changed; nothing saved.');
  if(!existing.length) {
    const latest=await freshBook(d.book);
    if(JSON.stringify(latest)!==JSON.stringify(originalBook)) throw Error('The lorebook changed while setup was running; try again.');
    if(context().chatId!==chatId || note.value!==originalNote) throw Error('Chat or note changed; setup stopped.');
    await c.saveWorldInfo(d.book, book, true);
  }
  if (context().chatId !== chatId || note.value !== originalNote) throw Error('The directive entry was created, but the chat or note changed; the note was not replaced.');
  if (JSON.stringify(await freshBook(d.book)) !== JSON.stringify(book)) throw Error('The directive save could not be verified.');
  d.directive = {uid:entry.uid, base:text, book:d.book};
  note.value = newNote; note.dispatchEvent(new Event('input',{bubbles:true}));
  await persist();
  status('Writing directive linked to Author’s Note.');
}
async function syncDirective() {
  if (syncing || busy || writingSession || draining || continuityBusy) return;
  const c=context(), d=data(), link=d.directive;
  if (!link || link.book !== d.book) return;
  const chatId=c.chatId, note=document.getElementById('extension_floating_prompt');
  if (!note) return;
  syncing=true;
  try {
    const book=await freshBook(link.book), entry=book.entries?.[link.uid];
    if (!entry) throw Error('Linked directive entry is missing.');
    const originalNote=note.value;
    const result=synchronize({base:link.base,book:entry.content,note:originalNote});
    if (result.conflict) throw Error(result.reason + '; sync paused.');
    if (context().chatId !== chatId || data().book !== link.book) throw Error('Chat changed; sync stopped.');
    if (entry.content !== result.book) { const latest=await freshBook(link.book); if(JSON.stringify(latest)!==JSON.stringify(book)) throw Error('Lorebook changed during sync; please retry.'); if(context().chatId!==chatId || note.value!==originalNote) throw Error('Chat or note changed; sync stopped.'); entry.content=result.book; await c.saveWorldInfo(link.book,book,true); if(JSON.stringify(await freshBook(link.book))!==JSON.stringify(book)) throw Error('Lorebook save could not be verified; directive sync paused.'); }
    if(context().chatId!==chatId || note.value!==originalNote) throw Error('Chat or note changed during sync; review both versions.');
    if (note.value !== result.note) {note.value=result.note; note.dispatchEvent(new Event('input',{bubbles:true}));}
    if (link.base !== result.base) {link.base=result.base; await persist();}
  } finally {syncing=false;scheduleDrain();}
}
async function resolveDirective(choice) {
  requireIdle();
  const c=context(), d=data(), link=d.directive, id=c.chatId;
  if(!link || link.book!==d.book) throw Error('Set up the directive first.');
  const note=document.getElementById('extension_floating_prompt');
  if(!note) throw Error('Author’s Note is unavailable.');
  syncing=true;
  try {
    const book=await freshBook(link.book), entry=book.entries?.[link.uid], original=note.value;
    if(!entry)throw Error('The linked directive entry is missing.');
    const result=resolveConflict({book:entry.content,note:original},choice);
    if(context().chatId!==id || data()!==d || note.value!==original)throw Error('Chat or note changed; resolution stopped.');
    if(JSON.stringify(await freshBook(link.book))!==JSON.stringify(book))throw Error('Lorebook changed; resolution stopped.');
    if(entry.content!==result.book) {
      entry.content=result.book; await c.saveWorldInfo(link.book,book,true);
      if(JSON.stringify(await freshBook(link.book))!==JSON.stringify(book))throw Error('Lorebook save could not be verified.');
    }
    if(context().chatId!==id || note.value!==original)throw Error('The note changed during the save; review both versions.');
    if(note.value!==result.note){note.value=result.note;note.dispatchEvent(new Event('input',{bubbles:true}));}
    link.base=result.base; await persist(); status('Writing directive synchronized.');
  } finally {syncing=false;scheduleDrain();}
}
function queueSync() {
  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>syncDirective().catch(e=>status('Directive: '+e.message)),800);
}
async function flushContinuity(allowWriting=false) {
  const d=data(), c=context(), job=d.pendingContinuity;
  if(!job) return;
  if(busy || syncing || draining || continuityBusy || (writingSession && !allowWriting)) throw Error('Wait for the current operation to finish.');
  continuityBusy=true;
  try {
    await recoverPending(d);
    if(context().chatId!==c.chatId || data()!==d) throw Error('Chat changed; continuity remains pending.');
    if(!wasApplied(d.history||[],job.id)) await interact(continuityPrompt(job.text),true,null,job.id,'written draft',true);
    if(context().chatId!==c.chatId || data()!==d) throw Error('Chat changed; continuity remains pending.');
    completeContinuity(d,job.id); await persist();
  } finally {continuityBusy=false;queueSync();scheduleDrain();}
}
function scheduleDrain() { setTimeout(()=>drainMain().catch(e=>status('Main chat: '+e.message)),0); }
async function drainMain() {
  if(busy || draining || writingSession || syncing || continuityBusy) return;
  const c=context(), d=data();
  if(!d.watch || d.review || d.queueError || !d.pending?.length) return;
  const job=nextJob(d.pending,c.chatId); if(!job) return;
  if(c.chat[job.index]?.mes !== job.raw || (job.previous !== undefined && c.chat[job.index-1]?.mes !== job.previous)) {d.review={index:job.index}; await persist(); throw Error('A queued message changed. Review the story and lore before resuming.');}
  draining=true;
  try {
    if(!job.id){job.id=crypto.randomUUID();await persist();}
    await recoverPending(d);
    if(!wasApplied(d.history||[],job.id)) await interact(job.text,true,()=>context().chatId===job.chat && context().chat[job.index]?.mes===job.raw && (job.previous===undefined || context().chat[job.index-1]?.mes===job.previous),job.id);
    if(context().chatId!==job.chat || data()!==d) return;
    d.pending.splice(d.pending.indexOf(job),1); d.processed ??= []; d.processed.push({index:job.index,raw:job.raw,previous:job.previous}); if(d.processed.length>500)d.processed.shift(); await persist();
  } catch(e) {d.queueError=e.message; try{if(data()===d)await persist();}catch{} throw e;} finally {draining=false;queueSync();}
  if(d.pending.length) scheduleDrain();
}
function init() {
  const button = document.createElement('button'); button.className='menu_button'; button.textContent='Storyloom';
  button.addEventListener('click', () => { try { options(); document.getElementById('na-panel').hidden=false; document.querySelector('#extensions-settings-button .drawer-toggle')?.click(); } catch(e) { toastr.warning(e.message); } });
  document.querySelector('#extensions_settings2, #extensions_settings')?.append(button);
  const panel = document.createElement('aside'); panel.id='na-panel'; panel.hidden=true;
  panel.innerHTML=`
    <header class="storyloom-header"><div><strong>Storyloom</strong><small>Novel companion</small></div><button id="na-close" class="menu_button" aria-label="Close Storyloom">Close</button></header>
    <details id="na-settings" class="storyloom-settings"><summary>Novel and connection settings</summary>
      <label>Novel lorebook<select id="na-book"></select></label>
      <div class="storyloom-row"><button id="na-new" class="menu_button">Create lorebook</button><button id="na-attach" class="menu_button">Link to this chat</button></div>
      <button id="na-setup" class="menu_button">Set up foundation and directive</button><div class="storyloom-row"><button id="na-use-book" class="menu_button">Use lorebook directive</button><button id="na-use-note" class="menu_button">Use Author’s Note directive</button></div>
      <label>Linked reference book<select id="na-reference"></select></label>
      <label>Assistant connection<select id="na-profile"></select></label><label>Response budget (tokens)<input id="na-tokens" type="number" min="256" max="16000" step="256" value="6000"></label>
      <label class="storyloom-check"><input id="na-watch" type="checkbox"> Follow the main chat</label>
      <div class="storyloom-row"><button id="na-undo" class="menu_button">Undo last lore update</button><button id="na-retry" class="menu_button">Retry pending updates</button><button id="na-resume" class="menu_button">Resume after reviewing changes</button></div><details><summary>Recent lore updates</summary><ol id="na-history"></ol></details>
    </details>
    <div id="na-messages" role="log" aria-live="polite" aria-label="Storyloom conversation"></div>
    <textarea id="na-input" aria-label="Message Storyloom" placeholder="Talk about your novel…"></textarea>
    <div class="storyloom-row"><button id="na-send" class="menu_button">Send</button><button id="na-write" class="menu_button">Write</button><button id="na-stop" class="menu_button">Stop</button></div>
    <div class="storyloom-row"><label class="storyloom-count">Writing segments <input id="na-count" type="number" min="1" max="10" value="1"></label><button id="na-download" class="menu_button">Download draft</button></div>
    <div id="na-status" role="status" aria-live="polite"></div>`;
  document.body.append(panel);
  panel.querySelector('#na-close').onclick=()=>panel.hidden=true;
  panel.querySelector('#na-retry').onclick=async()=>{try{await flushContinuity(); const d=data(); delete d.queueError; await persist(); status('Pending updates ready to retry.');scheduleDrain();}catch(e){status('Continuity: '+e.message)}};
  for(const [id,choice] of [['na-use-book','book'],['na-use-note','note']]) panel.querySelector('#'+id).onclick=async()=>{try{if(await context().Popup.show.confirm('Resolve directive difference?', 'Use the selected version for both the lorebook and Author’s Note?'))await resolveDirective(choice);}catch(e){status(e.message)}};
  panel.querySelector('#na-resume').onclick=async()=>{try{const d=data(); if(!d.review){status('Tracking is not paused.');return;} if(!await context().Popup.show.confirm('Resume tracking?', 'Confirm that you reviewed the changed chat and affected lore. Stale queued updates will be discarded.'))return; const c=context(); d.pending=(d.pending||[]).filter(j=>c.chat[j.index]?.mes===j.raw && (j.previous===undefined || c.chat[j.index-1]?.mes===j.previous)); delete d.review; d.processed=[]; await persist(); status('Tracking resumed.'); scheduleDrain();}catch(e){status(e.message)}};
  panel.querySelector('#na-undo').onclick=async()=>{let ownsLock=false;try {
    requireIdle(); syncing=true; ownsLock=true;
    const c=context(), d=data(); await recoverPending(d); const history=d.history?.at(-1);
    if (!history || history.book!==d.book) throw Error('No saved entry change to undo for this book.');
    const current=await freshBook(history.book), reverted=undoChange(current,history.changes);
    if(context().chatId!==c.chatId || data()!==d) throw Error('Chat changed; undo stopped.');
    if(JSON.stringify(await freshBook(history.book))!==JSON.stringify(current)) throw Error('The lorebook changed; try undo again.');
    await c.saveWorldInfo(history.book,reverted,true);
    if (JSON.stringify(await freshBook(history.book))!==JSON.stringify(reverted)) throw Error('Undo could not be verified.');
    d.history.pop(); await persist(); options(); status('Last entry changes undone.');
  }catch(e){status(e.message)}finally{if(ownsLock){syncing=false;queueSync();scheduleDrain()}}};
  panel.querySelector('#na-attach').onclick=async()=>{try {
    requireIdle(); const c=context(), d=data(); if(!d.book) throw Error('Choose a lorebook first.');
    if(c.chatMetadata.world_info && c.chatMetadata.world_info!==d.book && !await c.Popup.show.confirm('Change chat lorebook?', `Replace “${c.chatMetadata.world_info}” with “${d.book}”?`)) return;
    c.chatMetadata.world_info=d.book; await persist(); status('Lorebook linked to this chat.');
  }catch(e){status(e.message)}};
  panel.querySelector('#na-setup').onclick=async()=>{try{await setupNovel();}catch(e){status(e.message)}};
  document.getElementById('extension_floating_prompt')?.addEventListener('input',queueSync);
  panel.querySelector('#na-book').onchange=async e=>{try{requireIdle();changeBook(e.target.value); await persist(); options();}catch(err){options(); status(err.message)}};
  for (const [id,field] of [['na-reference','reference'],['na-profile','profile']]) panel.querySelector('#'+id).onchange=async e=>{try{requireIdle();data()[field]=e.target.value; await persist(); options();}catch(err){options();status(err.message)}};
  panel.querySelector('#na-tokens').onchange=async e=>{try{requireIdle();const n=Number(e.target.value);if(!Number.isInteger(n)||n<256||n>16000)throw Error('Response budget must be between 256 and 16000 tokens.');data().responseTokens=n;await persist();}catch(err){options();status(err.message)}};
  panel.querySelector('#na-watch').onchange=async e=>{try{const d=data();d.watch=e.target.checked;if(d.watch && changedProcessed(d.processed||[],context().chat||[])){d.review={reason:'Tracked chat changed while tracking was off.'};status('Tracked chat changed. Review the lore before resuming.');}await persist();if(d.watch)scheduleDrain();}catch(err){status(err.message)}};
  panel.querySelector('#na-new').onclick=async()=>{try {requireIdle(); if(data().directive) throw Error('Open a different chat before creating another novel.'); const name=(await context().Popup.show.input('Create a lorebook', 'Name this novel’s lorebook:'))?.trim(); if(!name)return; requireIdle(); if(!await createNewWorldInfo(name))throw Error('Book was not created'); changeBook(name); await persist(); options(); await setupNovel(); const c=context(); if(!c.chatMetadata.world_info){c.chatMetadata.world_info=name; await persist();}}catch(e){status(e.message)}};
  panel.querySelector('#na-stop').onclick=()=>{stopWriting=true; writingController?.abort(); status('Stopping…');};
  panel.querySelector('#na-download').onclick=()=>{try {
    const prose=(data().drafts || []).join('\n\n');
    if (!prose) throw Error('No draft text yet.');
    const a=document.createElement('a'), url=URL.createObjectURL(new Blob([prose],{type:'text/plain'}));
    a.href=url; a.download='storyloom-scenes.txt'; a.click(); URL.revokeObjectURL(url);
  }catch(e){status(e.message)}};
  panel.querySelector('#na-write').onclick=async()=>{let ownsSession=false;try {
    requireIdle();
    const c=context(), d=data(), id=c.chatId, bookName=d.book, profile=d.profile, referenceName=d.reference, tokens=Number(d.responseTokens || 6000);
    if(!bookName) throw Error('Choose this novel’s lorebook first.');
    if(d.pendingContinuity) throw Error('Retry the pending continuity update before writing more.');
    const count=sceneCount(panel.querySelector('#na-count').value);
    const request=panel.querySelector('#na-input').value.trim() || 'Continue the current scene.';
    stopWriting=false; writingSession=true; ownsSession=true; writingController=new AbortController();
    for(let i=0;i<count;i++) {
      if(stopWriting) {status('Writing stopped.'); break;}
      if(context().chatId!==id || data().book!==bookName || d.profile!==profile || d.reference!==referenceName) throw Error('Chat or lorebook changed; writing stopped.');
      busy=true; status(`Writing segment ${i+1} of ${count}…`);
      const book=await freshBook(bookName);
      const directive=Object.values(book.entries).find(e=>e.uid===d.directive?.uid)?.content || initialDirective();
      const previous=(d.drafts || []).slice(-2).join('\n\n');
      const readMain=()=>recentConversation((context().chat||[]).filter(m=>!m.is_system && m.mes).map(m=>({role:m.is_user?'user':'assistant',content:m.mes})),6000);
      const mainChat=readMain();
      const query=request+' '+previous.slice(-3000)+' '+JSON.stringify(mainChat);
      const lore=selectLore(synopsis(book),query,Math.max(2500,Math.min(9000,(Number(c.maxContext)||8192))));
      const reference=referenceName ? selectLore(synopsis(await freshBook(referenceName)),query,4000) : null;
      if(context().chatId!==id || data()!==d || d.profile!==profile || d.reference!==referenceName) throw Error('Chat or novel changed; writing stopped.');
      const prose=validateScene(await llm(c,makeWritingPrompt({directive,lore,reference:JSON.stringify(reference),mainChat:JSON.stringify(mainChat),previous:previous.slice(-6000),request}),profile,writingController.signal,tokens));
      if(stopWriting) {status('Stopped; current segment was not saved.'); break;}
      if(context().chatId!==id || data().book!==bookName || d.profile!==profile || d.reference!==referenceName || JSON.stringify(readMain())!==JSON.stringify(mainChat)) throw Error('Chat or story changed; current segment was not saved.');
      if(JSON.stringify(await freshBook(bookName))!==JSON.stringify(book) || JSON.stringify(readMain())!==JSON.stringify(mainChat)) throw Error('Lorebook or chat changed; current segment was not saved.');
      d.drafts ??= []; d.drafts.push(prose); d.messages.push({role:'assistant',content:prose});
      queueContinuity(d,{id:crypto.randomUUID(),text:prose});
      await persist(); showMessages();
      status('Segment saved. Updating continuity…'); busy=false;
      try {await flushContinuity(true);}
      catch(e) {throw Error('Segment saved; writing stopped because continuity update failed: '+e.message);}
    }
    panel.querySelector('#na-input').value='';
    if(!stopWriting) status('Writing session finished.');
  }catch(e){status(ownsSession && stopWriting?'Writing stopped.':e.message)}finally{if(ownsSession){writingController=null;writingSession=false;busy=false;queueSync();scheduleDrain()}}};
  panel.querySelector('#na-send').onclick=async()=>{const input=panel.querySelector('#na-input'); const v=input.value.trim(); if(!v)return; try{await interact(v);input.value=''}catch(e){status(e.message)}};
  const c=context();
  c.eventSource.on(c.event_types.WORLDINFO_UPDATED,queueSync);
  c.eventSource.on(c.event_types.CHAT_CHANGED,()=>{if(!panel.hidden){try{options();status('')}catch{panel.hidden=true}} queueSync(); scheduleDrain();});
  const sourceChanged=(id,deleted=false)=>{try {const d=data(); if(d.watch && (requiresReview(d.processed||[],id) || requiresReview(d.pending||[],id) || (deleted && [...(d.processed||[]),...(d.pending||[])].some(x=>x.index>=id)))) {d.review={index:id}; persist(); status('A previously processed chat message changed. Review your lore before resuming tracking.');}}catch(e){console.warn('Storyloom:',e.message)}};
  c.eventSource.on(c.event_types.MESSAGE_EDITED,id=>sourceChanged(id));
  c.eventSource.on(c.event_types.MESSAGE_DELETED,id=>sourceChanged(id,true));
  c.eventSource.on(c.event_types.MESSAGE_SWIPED,id=>sourceChanged(id));
  c.eventSource.on(c.event_types.MESSAGE_RECEIVED, (id,type)=>{try {
    if(type==='first_message') return;
    const cc=context(), d=data(); if(!d.watch || !d.book) return;
    const message=cc.chat[id], previous=cc.chat[id-1]; if(!message?.mes)return;
    if((d.processed||[]).some(x=>x.index===id && x.raw===message.mes && x.previous===(previous?.is_user ? previous.mes : undefined))) return;
    d.pending ??= [];
    enqueue(d.pending,{id:crypto.randomUUID(),chat:cc.chatId,index:id,raw:message.mes,previous:previous?.is_user ? previous.mes : undefined,text:[previous?.is_user ? `User: ${previous.mes}` : '', `Story: ${message.mes}`].filter(Boolean).join('\n')});
    persist().then(scheduleDrain).catch(e=>status('Could not queue main chat: '+e.message));
  }catch(e){status('Main chat processing: '+e.message)}});
}
jQuery(init);

import { createWorldInfoEntry, createNewWorldInfo } from '../../../world-info.js';
import { parseAssistant, planWrites, readDirective, replaceDirective } from './operations.mjs';
import { synchronize, resolveConflict, planInitialLink } from './sync.mjs';
import { createNovel, selectNovel } from './state.mjs';
import { makeWritingPrompt, validateScene, sceneCount, chapterStep, wordCount, currentChapterOutline } from './writing.mjs';
import { enqueue, nextJob, requiresReview, wasApplied, changedProcessed } from './queue.mjs';
import { foundationTemplate, initialDirective } from './template.mjs';
import { buildChange, undoChange, classifyChange, describeChange } from './history.mjs';
import { generate, profileOptions } from './generation.mjs';
import { queueContinuity, completeContinuity, continuityPrompt } from './continuity.mjs';
import { selectLore, recentConversation, ensureCompleteUpdates } from './context.mjs';
import { saveVerified } from './persistence.mjs';
import { linkBook, linkState } from './lorelink.mjs';
import { repairOutline } from './outline-repair.mjs';
import { normalizePeopleFocus } from './focus.mjs';
import { characterImportRequest, requiredCharacterUpdate, selectCharacterSource } from './reuse.mjs';
import { planningSystem, writingSystem } from './prompts.mjs';
import { PROVIDERS, readKeyOptions, readModels } from './providers.mjs';
import { startInterview, currentQuestion, advanceInterview, answerInstruction, finalizeInstruction, validateOutline, QUESTIONS, recordAnswer, isCollaborativeReply, deepNotesUpdate } from './interview.mjs';

const KEY = 'novelArchitect';
const context = () => SillyTavern.getContext();
let busy = false;
let syncing = false;
let stopWriting = false;
let writingController = null;
let writingSession = false;
let continuityBusy = false;
let interviewStarting = false;
let interviewTransition = false;
let draining = false;
let syncTimer;
let sessionKey=null;
const defaults = createNovel();

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
  const d=data(), question=currentQuestion(d.interview);
  for (const [i,msg] of d.messages.entries()) {
    if(question && i===d.messages.length-1 && msg.role==='assistant' && msg.content===question) continue;
    const bubble=document.createElement('article'); bubble.className=msg.role==='user'?'storyloom-message is-user':'storyloom-message is-assistant';
    const label=document.createElement('strong');label.textContent=msg.role==='user'?'YOU':'STORYLOOM';
    const text=document.createElement('div');text.textContent=msg.content; bubble.append(label,text);target.append(bubble);
  }
  target.scrollTop = target.scrollHeight;
}
function options() {
  const c = context(), d = data();
  for (const [id, list, val, blank] of [
    ['na-book', c.getWorldInfoNames(), d.book || c.chatMetadata.world_info, 'Create a lorebook when I begin'],
    ['na-reference', c.getWorldInfoNames().filter(n => n !== d.book), d.reference, 'No linked reference'],
    ['na-profile', profileOptions(c.extensionSettings.connectionManager?.profiles || [],c.ConnectionManagerRequestService,d.profile==='__direct__'?'':d.profile), d.profile, 'Use current connection'],
  ]) {
    const el = document.getElementById(id); el.replaceChildren(new Option(blank, ''));
    if(id==='na-profile')el.add(new Option('Choose another provider or model…','__direct__'));
    for (const item of list) el.add(new Option(typeof item === 'string' ? item : item.name, typeof item === 'string' ? item : item.id));
    el.value = val || '';
  }
  const shownBook=d.book || c.chatMetadata.world_info || '';
  const state=linkState(shownBook,c.chatMetadata.world_info);
  document.getElementById('na-book-status').textContent=({none:'No lorebook yet. One will be created when you begin.',linked:'Linked to this chat.',unlinked:'Selected, but not linked to this chat.',different:'A different lorebook is linked to this chat.'})[state];
  document.getElementById('na-watch').checked = !!d.watch;
  document.getElementById('na-tokens').value=String(d.responseTokens || 6000);
  renderDirectConnection(d);
  showMessages();
  renderInterview();
  const list=document.getElementById('na-history'); list.replaceChildren();
  for(const item of [...(d.history||[])].reverse()){const li=document.createElement('li');li.textContent=describeChange(item);list.append(li);}
  if(d.pendingContinuity)status('A saved draft is waiting for a continuity update. Retry it in settings.');
  else if(d.review)status('A previously processed chat message changed. Review your lore, then resume tracking in settings.');
}
async function attachBook(name,c=context(),approvedPrevious=null) {
  const chatId=c.chatId, metadata=c.chatMetadata;
  return linkBook({metadata,book:name,save:persist,select:async()=>{},
    mark:()=>document.querySelectorAll('.chat_lorebook_button').forEach(el=>el.classList.add('world_set')),
    confirm:async(previous,next)=>previous===approvedPrevious || await c.Popup.show.confirm('Change chat lorebook?', `Replace “${previous}” with “${next}” for this chat?`),
    isCurrent:()=>context().chatId===chatId && context().chatMetadata===metadata});
}
async function freshBook(name) {
  const r = await fetch('/api/worldinfo/get', { method:'POST', headers:context().getRequestHeaders(), body:JSON.stringify({name}), cache:'no-store' });
  if (!r.ok) throw new Error('Could not load lorebook: ' + name);
  return await r.json();
}
function renderDirectConnection(d) {
  const panel=document.getElementById('na-panel'), root=panel.querySelector('#na-direct'), direct=d.direct||{};
  root.hidden=d.profile!=='__direct__'; if(root.hidden)return;
  panel.querySelector('#na-provider').value=direct.provider||'custom';
  panel.querySelector('#na-model').value=direct.model||'';
  panel.querySelector('#na-direct-url').value=direct.url||'';
  const scoped=sessionKey?.chatId===context().chatId && sessionKey?.book===d.book;
  if(!scoped)panel.querySelector('#na-session-key').value='';
  const custom=direct.provider==='custom';
  panel.querySelector('#na-url-label').hidden=!custom;
  panel.querySelector('#na-session-label').hidden=!(custom || PROVIDERS.find(x=>x.id===direct.provider)?.sessionUrl);
  const key=panel.querySelector('#na-key');
  if(!key.options.length)key.add(new Option('Refresh saved keys',''));
  if(direct.keyId && ![...key.options].some(o=>o.value===direct.keyId))key.add(new Option('Previously selected key (refresh to check)',direct.keyId));
  key.value=direct.keyId||'';
}
async function refreshKeys() {
  const d=data(),c=context(),provider=d.direct?.provider;if(!provider)return;
  const keys=await readKeyOptions(fetch,c.getRequestHeaders(),provider);
  if(data()!==d || d.direct?.provider!==provider)return;
  const select=document.getElementById('na-key');
  select.replaceChildren(new Option(provider==='custom'?'No saved key / local model':'Choose a saved key',''));
  for(const key of keys)select.add(new Option(key.label,key.id));
  if(d.direct.keyId && !keys.some(k=>k.id===d.direct.keyId))select.add(new Option('Previously selected key (unavailable)',d.direct.keyId));
  select.value=d.direct.keyId||'';
}
function synopsis(book) {
  return Object.values(book.entries || {}).filter(e=>e.storyloom_kind!=='interview_notes').map(e => ({title:e.comment, content:e.content, keys:e.key || []})).filter(e => e.title && e.content);
}
function directSnapshot(d,c) {
  if(d.profile!=='__direct__') return null;
  return {...(d.direct||{}),sessionKey:sessionKey?.chatId===c.chatId && sessionKey?.book===d.book ? sessionKey.value : ''};
}
function sameDirect(d,snapshot) {
  if(!snapshot)return true;
  const current=directSnapshot(d,context());
  return JSON.stringify(current)===JSON.stringify(snapshot);
}
async function llm(c,prompt,profile,signal,tokens,systemPrompt,direct) { return await generate(c,prompt,profile,signal,tokens,systemPrompt,direct); }
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
async function interact(input, fromMain = false, guard = null, jobId = null, sourceKind = null, allowWriting = false, interview = null) {
  if (busy || syncing || interviewStarting || interviewTransition || (draining && !jobId) || (continuityBusy && !allowWriting) || (writingSession && !allowWriting)) throw new Error('Novel Architect is already working.');
  const c = context(), d = data(), chatId = c.chatId, bookName = d.book, profile=d.profile, referenceName=d.reference, tokens=Number(d.responseTokens || 6000), direct=directSnapshot(d,c);
  if (!bookName) throw new Error('Choose this novel’s lorebook first.');
  if(c.chatMetadata.world_info!==bookName)throw Error('The selected lorebook is not linked to this chat. Choose it in Storyloom to link it before saving.');
  busy = true;
  try {
    status('Thinking…');
    await recoverPending(d);
    if(context().chatId !== chatId || data() !== d) throw Error('Chat changed; nothing saved.');
    const before = await freshBook(bookName);
    const ref = referenceName ? await freshBook(referenceName) : null;
    if(input.length>30000) throw Error('The message is too long for one request. Split it into smaller parts.');
    const budget=Math.max(4000,Math.min(24000,(Number(c.maxContext)||8192)*2));
    const history=(interview?.sourceOnly || (interview?.requireOutline && d.interview?.mode==='deep')) ? [] : recentConversation(d.messages,Math.floor(budget*.25));
    const query=history.map(x=>x.content).join(' ')+input;
    const targetEntries=synopsis(before);
    const current=interview?.sourceOnly ? selectLore(targetEntries.filter(x=>x.title.trim().toLocaleLowerCase()===interview.requiredCharacterTitle.toLocaleLowerCase()),query,Math.floor(budget*.5)) : selectLore(targetEntries,query,Math.floor(budget*.5));
    const reference=interview?.sourceOnly ? selectCharacterSource(ref?synopsis(ref):[],interview.sourceCharacter,Math.floor(budget*.5)) : selectLore(ref?synopsis(ref):[],query,Math.floor(budget*.25));
    const prompt = `Only supplied lore is visible. Some entries may be omitted or shortened; never assume absence means a fact is unknown. Do not rewrite entries whose full content was not supplied.\nCurrent novel entries: ${JSON.stringify(current)}\nReference material from ${referenceName || 'no linked book'} (do not treat as current canon without relevance): ${JSON.stringify(reference)}\nConversation: ${JSON.stringify(history)}\n${fromMain ? 'New main story chat text; record only established developments and do not address the user: ' : 'Writer: '}${input}`;
    if(context().chatId!==chatId || data()!==d || d.profile!==profile || d.reference!==referenceName || !sameDirect(d,direct)) throw Error('Chat or novel changed; request stopped.');
    const mode=fromMain?'background':(d.interview?.mode || 'ongoing');
    const afterInterview=d.interview?.phase==='done' && mode==='deep'?'\nThe interview is finished; follow the writer’s current topic freely.':'';
    const system=planningSystem(mode)+afterInterview+(interview?.guidance ? `\n${interview.guidance}` : '');
    const allowProse=!!(interview?.collaborative && d.interview?.phase==='asking');
    let result;
    try {result=parseAssistant(await llm(c,prompt,profile,undefined,tokens,system,direct),{allowProse});}
    catch(error) {
      if(context().chatId!==chatId || context().chatMetadata.world_info!==bookName || data()!==d)throw Error('Chat or lorebook changed; nothing saved.');
      status('The model returned an unreadable response; asking it to try again…');
      const retrySystem=system+'\nYour last response could not be read. Respond with exactly one valid JSON object, beginning with { and ending with }, and no surrounding prose or markdown. Escape line breaks inside strings.';
      try {result=parseAssistant(await llm(c,prompt,profile,undefined,tokens,retrySystem,direct),{allowProse});}
      catch {throw Error('The model did not return a usable response after retrying. Nothing was saved; please try again.');}
    }
    if(interview?.collaborative && !isCollaborativeReply(result.reply)) {
      if(context().chatId!==chatId || data()!==d)throw Error('Chat changed; nothing saved.');
      const retrySystem=system+'\nYour previous response was too brief. Respond specifically to the writer, offer a useful possibility or observation, and ask a relevant follow-up question. Do not reply with only an acknowledgement.';
      result=parseAssistant(await llm(c,prompt,profile,undefined,tokens,retrySystem,direct),{allowProse});
      if(!isCollaborativeReply(result.reply))throw Error('The model did not give a collaborative response. Your message is still here; please try again.');
    }
    if(interview?.requireOutline) result=await repairOutline(result,value=>validateOutline(normalizePeopleFocus(value,d.interview?.answers),d.interview?.mode),async (previous,issue)=>{
      if(context().chatId!==chatId || context().chatMetadata.world_info!==bookName || data()!==d)throw Error('Chat or lorebook changed; nothing saved.');
      status('Completing missing story details…');
      const correction=`${prompt}\n\nYour previous plan needs correction: ${issue}. Return the complete corrected JSON object with all required entries, not just the missing part. Previous plan: ${JSON.stringify(previous)}`;
      return parseAssistant(await llm(c,correction,profile,undefined,tokens,system,direct));
    });
    if(interview?.requiredCharacterTitle) result.updates=[requiredCharacterUpdate(result,interview.requiredCharacterTitle)];
    if(interview?.collaborative && d.interview?.phase==='asking') {
      const prior=[...d.messages].reverse().find(m=>m.role==='assistant')?.content || '';
      result.updates=[deepNotesUpdate(before,d.interview,input,prior)];
    }
    if (context().chatId !== chatId || context().chatMetadata.world_info!==bookName || data().book !== bookName || d.profile!==profile || d.reference!==referenceName || !sameDirect(d,direct)) throw new Error('Chat or lorebook changed while generating; nothing saved.');
    if (guard && !guard()) throw Error('The source message changed; nothing was saved.');
    const fresh = await freshBook(bookName);
    if (JSON.stringify(fresh) !== JSON.stringify(before)) throw new Error('Lorebook changed while generating; nothing saved. Please retry.');
    const writes = planWrites(fresh, result.updates);
    ensureCompleteUpdates(writes.filter(w=>w.update.storyloomKind!=='interview_notes'),current);
    for (const w of writes) {
      const entry = w.uid === null ? createWorldInfoEntry(bookName, fresh) : fresh.entries[w.uid];
      if (!entry) throw new Error('Unable to create entry');
      entry.comment = w.update.title.trim(); entry.content = w.update.content; entry.key = w.update.keys;
      if(w.update.storyloomKind==='interview_notes'){entry.storyloom_kind='interview_notes';entry.disable=true;}
    }
    if (writes.length) {
      const record={id:crypto.randomUUID(),book:bookName,changes:buildChange(before,fresh),source:sourceKind || (fromMain?'main chat':'planning conversation'),jobId,reference:referenceName || null,at:new Date().toISOString()};
      d.pendingWrite=record;
      await persist();
      if (context().chatId !== chatId || context().chatMetadata.world_info!==bookName || data().book !== bookName || d.profile!==profile || d.reference!==referenceName || !sameDirect(d,direct)) throw Error('Chat or lorebook changed; the update was not saved.');
      const latest = await freshBook(bookName);
      if (JSON.stringify(latest) !== JSON.stringify(before)) throw Error('Lorebook changed before saving; update stopped.');
      if (guard && !guard()) throw Error('The source message changed; nothing was saved.');
      if(context().chatId!==chatId || context().chatMetadata!==c.chatMetadata || context().chatMetadata.world_info!==bookName || data()!==d)throw Error('The chat or its linked lorebook changed; nothing was saved.');
      await c.saveWorldInfo(bookName, fresh, true);
      const readback = await freshBook(bookName);
      if (JSON.stringify(readback) !== JSON.stringify(fresh)) throw Error('Save could not be verified; inspect the lorebook before retrying.');
      if(context().chatId!==chatId || data()!==d) throw Error('Chat changed after save; recovery will run when you return.');
      if(context().chatMetadata.world_info!==bookName) {d.review={reason:'The chat lorebook changed while an update was being saved.'}; await persist();throw Error('The lorebook link changed during the save. Review the original book before continuing.');}
      await recoverPending(d);
      if (guard && !guard()) {d.review={reason:'The source message changed during saving.'}; await persist(); throw Error('The source changed during saving. Review or undo the last update before resuming.');}
      if(!document.getElementById('na-panel').hidden) options();
    }
    if (!fromMain) { if(!interview?.silentUser)d.messages.push({role:'user',content:input}); d.messages.push({role:'assistant',content:result.reply}); await persist(); showMessages(); }
    status(writes.length ? `Saved ${writes.length} World Info ${writes.length === 1 ? 'entry' : 'entries'}.` : 'No entry changes.');
    return result;
  } finally { busy = false; queueSync(); if(!draining)scheduleDrain(); }
}
function requireIdle(allowStarting=false) { if(busy || syncing || draining || writingSession || continuityBusy || (interviewStarting && !allowStarting) || interviewTransition) throw Error('Wait for the current Storyloom operation to finish.'); }
async function setupNovel(allowStarting=false) {
 requireIdle(allowStarting); syncing=true;
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
  if(context().chatId!==chatId || context().chatMetadata.world_info!==name || data().book!==name) throw Error('Chat or linked lorebook changed; setup stopped.');
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
    if(context().chatId!==chatId || context().chatMetadata.world_info!==d.book || note.value!==originalNote) throw Error('Chat, lorebook or note changed; setup stopped.');
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
  if (syncing || busy || writingSession || draining || continuityBusy || interviewStarting || interviewTransition) return;
  const c=context(), d=data(), link=d.directive;
  if (!link || link.book !== d.book || c.chatMetadata.world_info!==d.book) return;
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
    if (entry.content !== result.book) { const latest=await freshBook(link.book); if(JSON.stringify(latest)!==JSON.stringify(book)) throw Error('Lorebook changed during sync; please retry.'); if(context().chatId!==chatId || context().chatMetadata.world_info!==link.book || note.value!==originalNote) throw Error('Chat, lorebook or note changed; sync stopped.'); entry.content=result.book; await c.saveWorldInfo(link.book,book,true); if(JSON.stringify(await freshBook(link.book))!==JSON.stringify(book)) throw Error('Lorebook save could not be verified; directive sync paused.'); }
    if(context().chatId!==chatId || note.value!==originalNote) throw Error('Chat or note changed during sync; review both versions.');
    if (note.value !== result.note) {note.value=result.note; note.dispatchEvent(new Event('input',{bubbles:true}));}
    if (link.base !== result.base) {link.base=result.base; await persist();}
  } finally {syncing=false;scheduleDrain();}
}
async function resolveDirective(choice) {
  requireIdle();
  const c=context(), d=data(), link=d.directive, id=c.chatId;
  if(!link || link.book!==d.book || c.chatMetadata.world_info!==d.book) throw Error('Link this lorebook to the current chat and set up the directive first.');
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
  if(busy || draining || writingSession || syncing || continuityBusy || interviewStarting || interviewTransition) return;
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
function renderInterview() {
  const panel=document.getElementById('na-panel'); if(!panel)return;
  const interview=data().interview;
  panel.querySelector('#na-welcome').hidden=!!interview;
  panel.querySelector('#na-mode-choices').hidden=!!interview;
  panel.querySelector('#na-composer').hidden=!interview || interview.phase==='outline';
  panel.querySelector('#na-writing').hidden=interview?.phase!=='done';
  const progress=panel.querySelector('#na-progress');
  progress.hidden=interview?.phase!=='asking';
  if(interview?.phase==='asking') {panel.querySelector('#na-step-label').textContent=`${interview.mode==='simple'?'SIMPLE':'DEEP'} · ${interview.step+1} OF ${QUESTIONS.length}`;panel.querySelector('#na-question').textContent=currentQuestion(interview);}
  panel.querySelector('#na-interview-controls').hidden=!interview || interview.phase==='done';
  panel.querySelector('#na-skip').hidden=!(interview?.phase==='asking' && interview.mode==='simple');
  panel.querySelector('#na-next').hidden=!(interview?.phase==='asking' && interview.mode==='deep');
  panel.querySelector('#na-outline').hidden=interview?.phase!=='outline';
}
async function beginInterview(mode) {
  let ownsStart=false;
  try {
    requireIdle(); interviewStarting=true; ownsStart=true; const original=context(), chatId=original.chatId;
    let d=data();
    if(d.interview) throw Error('This novel already has an interview in progress.');
    if(!d.book) {
      let name=original.chatMetadata.world_info;
      if(!name) {name=`Storyloom-${Date.now()}`; if(!await createNewWorldInfo(name))throw Error('Could not create the novel lorebook.');}
      if(context().chatId!==chatId)throw Error('Chat changed while preparing the novel.');
      d=changeBook(name); await persist();
    }
    if(!await attachBook(d.book,original))throw Error('The chat lorebook was not changed.');
    if(context().chatId!==chatId || data()!==d)throw Error('Chat changed while preparing the novel.');
    await setupNovel(true);
    if(context().chatId!==chatId || data()!==d)throw Error('Chat changed while preparing the novel.');
    d.interview=startInterview(mode);
    d.watch=true;
    d.messages.push({role:'assistant',content:currentQuestion(d.interview)});
    await persist(); options();status(mode==='simple'?'Simple mode: answer or skip each question.':'Deep mode: explore each topic, then choose Next topic.');
  }catch(e){status(e.message)}finally{if(ownsStart){interviewStarting=false;queueSync();scheduleDrain()}}
}
async function nextInterview(skipped) {
  let shouldFinish=false, ownsTransition=false;
  try {
    requireIdle();if(interviewTransition)throw Error('Please wait for the current question.');
    interviewTransition=true;ownsTransition=true;
    const d=data(), current=d.interview;
    if(!current || current.phase!=='asking')throw Error('There is no active question.');
    if(skipped && current.mode!=='simple')throw Error('Skipping is available in Simple mode.');
    if(skipped){d.messages.push({role:'user',content:'I’ll leave this for you to decide.'}); d.interview=recordAnswer(current,null);}
    d.interview=advanceInterview(d.interview);
    if(d.interview.phase==='asking')d.messages.push({role:'assistant',content:currentQuestion(d.interview)});
    await persist();options();shouldFinish=d.interview.phase==='outline';
  }catch(e){status(e.message)}finally{if(ownsTransition)interviewTransition=false;}
  if(shouldFinish)await finishInterview();
}
async function finishInterview() {
  try {
    requireIdle();const d=data(), interview=d.interview;
    if(interview?.phase!=='outline')throw Error('Finish the questions before creating the outline.');
    status('Creating the outline and filling the story foundation…');
    const book=await freshBook(d.book);
    if(data()!==d)throw Error('Chat changed. Return to the novel to finish.');
    const task=finalizeInstruction(interview.mode,interview.answers);
    const result=await interact(task,false,null,null,null,false,{guidance:'Complete the interview as instructed. Return every required planning entry, including Novel Outline, in updates.',requireOutline:true,silentUser:true});
    if(data()!==d)throw Error('Chat changed. Return to the novel to finish.');
    const outline=result.updates.find(x=>x.title.trim().toLocaleLowerCase()==='novel outline');
    d.messages.push({role:'assistant',content:'Here is your outline:\n\n'+outline.content});
    d.interview={...interview,phase:'done'};await persist();options();status('Outline saved. You can keep talking to Storyloom.');
  }catch(e){status(e.message);try{renderInterview()}catch{}}
}
function init() {
  const button = document.createElement('button'); button.className='menu_button'; button.textContent='Storyloom';
  const openPanel=()=>{try{options();document.getElementById('na-panel').hidden=false;const log=document.getElementById('na-messages');log.scrollTop=log.scrollHeight;if(data().profile==='__direct__')refreshKeys().catch(e=>status(e.message));}catch(e){toastr.warning(e.message)}};
  button.addEventListener('click',()=>{openPanel();document.querySelector('#extensions-settings-button .drawer-toggle')?.click();});
  const shortcut=document.createElement('button');shortcut.type='button';shortcut.id='storyloom-chat-shortcut';shortcut.title='Open Storyloom';shortcut.setAttribute('aria-label','Open Storyloom');shortcut.innerHTML='<i class="fa-solid fa-feather-pointed" aria-hidden="true"></i>';shortcut.addEventListener('click',openPanel);document.getElementById('leftSendForm')?.append(shortcut);
  document.querySelector('#extensions_settings2, #extensions_settings')?.append(button);
  const panel = document.createElement('aside'); panel.id='na-panel'; panel.hidden=true;
  panel.innerHTML=`
    <header class="storyloom-header">
      <div class="storyloom-brand"><span class="storyloom-mark" aria-hidden="true">✦</span><div><strong>Storyloom</strong><small>YOUR WRITING COMPANION</small></div></div>
      <button id="na-close" class="storyloom-close" aria-label="Close Storyloom">×</button>
    </header>
    <div class="storyloom-book"><label for="na-book">LOREBOOK FOR THIS CHAT</label><select id="na-book"></select><small id="na-book-status" role="status"></small></div>
    <details id="na-settings" class="storyloom-settings"><summary>Settings <span aria-hidden="true">⌄</span></summary>
      <div class="storyloom-settings-body">
        <label>Use another book for reference<select id="na-reference"></select></label>
        <div class="storyloom-row"><button id="na-import-character" type="button">Bring a character into this book</button><button id="na-link-character" type="button">Link reference to character card</button></div>
        <label>AI connection<select id="na-profile"></select></label>
        <div id="na-direct" class="storyloom-direct" hidden>
          <label>Provider<select id="na-provider"></select></label>
          <label id="na-url-label">Provider URL<input id="na-direct-url" type="url" placeholder="https://…/v1" autocomplete="url"></label>
          <label>Saved key<select id="na-key"></select></label>
          <label id="na-session-label">API key for this session <input id="na-session-key" type="password" autocomplete="off" placeholder="Optional; not saved"></label>
          <label>Model<input id="na-model" list="na-model-list" placeholder="Choose or enter a model name" autocomplete="off"><datalist id="na-model-list"></datalist></label>
          <div class="storyloom-row"><button id="na-load-models" type="button">Find available models</button><button id="na-refresh-keys" type="button">Refresh saved keys</button></div>
          <p class="storyloom-hint">Uses this provider only for Storyloom. Choose a saved provider key, or enter a session key where offered. Session keys take priority and are not saved.</p>
        </div>
        <label class="storyloom-check"><input id="na-watch" type="checkbox"> Follow the main chat</label>
        <details class="storyloom-advanced"><summary>More options <span aria-hidden="true">⌄</span></summary>
          <div class="storyloom-row"><button id="na-new" type="button">Create lorebook</button><button id="na-attach" type="button">Link to this chat</button></div>
          <button id="na-setup" type="button">Set up foundation and directive</button>
          <div class="storyloom-row"><button id="na-use-book" type="button">Use lorebook directive</button><button id="na-use-note" type="button">Use Author’s Note directive</button></div>
          <label>Response budget (tokens)<input id="na-tokens" type="number" min="256" max="16000" step="256" value="6000"></label>
          <div class="storyloom-row"><button id="na-undo" type="button">Undo last update</button><button id="na-retry" type="button">Retry pending updates</button></div>
          <button id="na-resume" type="button">Resume after reviewing changes</button>
          <details><summary>Recent updates <span aria-hidden="true">⌄</span></summary><ol id="na-history"></ol></details>
        </details>
      </div>
    </details>
    <div id="na-welcome" class="storyloom-welcome"><span class="storyloom-eyebrow">A SPACE FOR YOUR NEXT STORY</span><h2>Let’s make something<br><em>worth getting lost in.</em></h2><p>Start with a little or a lot. I’ll help you bring the story together.</p><div class="storyloom-rule"></div><span class="storyloom-choice-label">HOW WOULD YOU LIKE TO BEGIN?</span></div>
    <div id="na-mode-choices" class="storyloom-mode-grid">
      <button id="na-simple" type="button" class="storyloom-mode"><span class="storyloom-mode-icon" aria-hidden="true">✦</span><strong>Simple</strong><small>Answer what you like. I’ll fill in the rest.</small><span class="storyloom-arrow" aria-hidden="true">↗</span></button>
      <button id="na-deep" type="button" class="storyloom-mode"><span class="storyloom-mode-icon" aria-hidden="true">◇</span><strong>Deep</strong><small>Explore each part together, at your pace.</small><span class="storyloom-arrow" aria-hidden="true">↗</span></button>
    </div>
    <section id="na-progress" class="storyloom-question"><span id="na-step-label" class="storyloom-eyebrow"></span><p id="na-question"></p></section>
    <div id="na-messages" role="log" aria-live="polite" aria-label="Storyloom conversation"></div>
    <div id="na-interview-controls" class="storyloom-flow"><button id="na-skip" type="button">Skip for now <span aria-hidden="true">→</span></button><button id="na-next" type="button">Next topic <span aria-hidden="true">→</span></button><button id="na-outline" type="button">Create outline <span aria-hidden="true">→</span></button></div>
    <div id="na-composer" class="storyloom-composer"><label class="storyloom-sr-only" for="na-input">Message Storyloom</label><textarea id="na-input" placeholder="Tell me what you’re thinking…"></textarea><div class="storyloom-compose-footer"><span>YOUR STORY, YOUR WAY</span><button id="na-send" type="button">Send <span aria-hidden="true">↗</span></button></div></div>
    <details id="na-writing" class="storyloom-writing"><summary>Writing desk <span aria-hidden="true">⌄</span></summary><p>Continue your story using the current writing directive.</p><div class="storyloom-row"><label class="storyloom-count">Segments <input id="na-count" type="number" min="1" max="10" value="1"></label><button id="na-write" type="button">Write</button><button id="na-stop" type="button">Stop</button><button id="na-download" type="button">Download draft</button></div><div class="storyloom-row"><label class="storyloom-count">Chapter target words <input id="na-chapter-words" type="number" min="500" max="10000" step="250" value="3000"></label><button id="na-write-chapter" type="button">Write a chapter</button></div></details>
    <div id="na-status" role="status" aria-live="polite"></div>`;
  document.body.append(panel);
  for(const provider of PROVIDERS)panel.querySelector('#na-provider').add(new Option(provider.name,provider.id));
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
    requireIdle(); const c=context(), name=data().book || c.chatMetadata.world_info; if(!name) throw Error('Choose a lorebook first.');
    if(await attachBook(name,c)){options();status('Lorebook linked to this chat.');}
  }catch(e){status(e.message)}};
  panel.querySelector('#na-setup').onclick=async()=>{try{await setupNovel();}catch(e){status(e.message)}};
  document.getElementById('extension_floating_prompt')?.addEventListener('input',queueSync);
  panel.querySelector('#na-book').onchange=async e=>{try{
    requireIdle();const c=context(),name=e.target.value,current=data();
    if(!name)throw Error('Choose a lorebook, or start a new chat to create one.');
    if(current.directive && current.book!==name)throw Error('This chat already has a linked writing directive. Open a different chat for another novel.');
    if(!await attachBook(name,c)){options();return;}
    changeBook(name);await persist();options();status('Lorebook linked to this chat.');
  }catch(err){options();status(err.message)}};
  for (const [id,field] of [['na-reference','reference'],['na-profile','profile']]) panel.querySelector('#'+id).onchange=async e=>{try{
    requireIdle();const d=data(),value=e.target.value;
    if(field==='profile' && value==='__direct__' && !d.direct){
      const c=context(), current=c.chatCompletionSettings?.chat_completion_source;
      const provider=PROVIDERS.some(x=>x.id===current)?current:'custom';
      d.direct={provider,model:c.mainApi==='openai'?(c.getChatCompletionModel?.()||''):'',url:provider==='custom'?(c.chatCompletionSettings?.custom_url||''):'',keyId:''};
    }
    d[field]=value;await persist();options();if(field==='profile' && value==='__direct__')await refreshKeys();
  }catch(err){options();status(err.message)}};
  panel.querySelector('#na-import-character').onclick=async()=>{let ownsLock=false;try {
    requireIdle();const c=context(),d=data(),chatId=c.chatId,source=d.reference,target=d.book;
    if(!target || c.chatMetadata.world_info!==target)throw Error('Link this novel’s lorebook to the current chat first.');
    if(!source)throw Error('Choose another book for reference first.');
    const person=(await c.Popup.show.input('Bring in a character', 'Which character from the reference book?'))?.trim();if(!person)return;
    if(context().chatId!==chatId || data()!==d || d.reference!==source)throw Error('Chat or reference changed; nothing was imported.');
    const task=characterImportRequest(person,source);
    const result=await interact(task.request,false,null,null,null,false,{requiredCharacterTitle:task.title,sourceCharacter:task.name,sourceOnly:true,guidance:'Return exactly the requested novel character entry using only the supplied reference material. Do not create chatbot cards.'});
    const update=requiredCharacterUpdate(result,task.title);
    if(context().chatId!==chatId || data()!==d || d.book!==target || d.reference!==source)throw Error('Character was added to the novel, but the chat changed before a shared lorebook was created.');
    requireIdle();syncing=true;ownsLock=true;
    const safeName=task.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();
    if(!safeName)throw Error('Character was added to the novel, but its name cannot be used for a lorebook.');
    const shared=`Storyloom Character - ${safeName} - ${Date.now()}`;
    if(!await createNewWorldInfo(shared))throw Error('Character was added to the novel, but the shared lorebook could not be created.');
    if(context().chatId!==chatId || data()!==d)throw Error('Character was added to the novel and a shared lorebook was created, but the chat changed before the profile was copied.');
    const book=await freshBook(shared),entry=createWorldInfoEntry(shared,book);
    if(!entry)throw Error('The shared lorebook was created, but its character entry could not be added.');
    entry.comment=task.title;entry.content=update.content;entry.key=update.keys;entry.storyloom_source=source;
    await c.saveWorldInfo(shared,book,true);
    if(JSON.stringify(await freshBook(shared))!==JSON.stringify(book))throw Error('The shared character lorebook save could not be verified.');
    options();status(`Character added to this novel. Shared lorebook created: ${shared}.`);
  }catch(e){status(e.message)}finally{if(ownsLock){syncing=false;queueSync();scheduleDrain()}}};
  panel.querySelector('#na-link-character').onclick=async()=>{try {
    requireIdle();const c=context(),chatId=c.chatId,reference=data().reference,card=c.characters?.[c.characterId];
    if(!reference)throw Error('Choose a character lorebook as the reference first.');
    if(c.groupId || !card?.avatar)throw Error('Open an individual SillyTavern character chat first.');
    const confirmed=await c.Popup.show.confirm('Link character lore?', `Link “${reference}” to the SillyTavern character card “${card.name}”? It can then be used in that character’s other chats.`);
    if(!confirmed)return;
    if(context().chatId!==chatId || context().characters?.[context().characterId]?.avatar!==card.avatar || data().reference!==reference)throw Error('Chat, character or reference changed; nothing was linked.');
    const wi=await import('../../../world-info.js');
    if(typeof wi.charUpdateAddAuxWorld!=='function')throw Error('This SillyTavern version does not support linking additional character lorebooks.');
    await wi.charUpdateAddAuxWorld(card.avatar,reference);
    const key=card.avatar.replace(/\.[^/.]+$/,'');
    if(!wi.world_info?.charLore?.some(x=>x.name===key && x.extraBooks?.includes(reference)))throw Error('The character link could not be verified.');
    status(`“${reference}” linked to ${card.name}’s character card.`);
  }catch(e){status(e.message)}};
  panel.querySelector('#na-provider').onchange=async e=>{try{requireIdle();const d=data();d.direct={...(d.direct||{}),provider:e.target.value,keyId:'',model:'',url:'',sessionRequired:false};sessionKey=null;panel.querySelector('#na-session-key').value='';await persist();options();await refreshKeys();}catch(err){options();status(err.message)}};
  for(const [id,field] of [['na-model','model'],['na-direct-url','url'],['na-key','keyId']])panel.querySelector('#'+id).onchange=async e=>{try{requireIdle();const d=data();d.direct ??={provider:'custom'};d.direct[field]=e.target.value;if(field==='keyId'){d.direct.sessionRequired=false;sessionKey=null;panel.querySelector('#na-session-key').value='';}await persist();}catch(err){options();status(err.message)}};
  panel.querySelector('#na-session-key').onchange=async e=>{try{requireIdle();const d=data();const value=e.target.value;sessionKey=value?{chatId:context().chatId,book:d.book,value}:null;d.direct.sessionRequired=!!value;if(value)d.direct.keyId='';await persist();}catch(err){e.target.value='';sessionKey=null;status(err.message)}};
  panel.querySelector('#na-refresh-keys').onclick=()=>refreshKeys().catch(e=>status(e.message));
  panel.querySelector('#na-load-models').onclick=async()=>{try{requireIdle();const d=data(),c=context(),snapshot=directSnapshot(d,c),provider=snapshot?.provider;status('Finding models…');const models=await readModels(fetch,c.getRequestHeaders(),snapshot);if(data()!==d || d.direct?.provider!==provider)throw Error('Connection changed while loading models.');const list=panel.querySelector('#na-model-list');list.replaceChildren(...models.map(x=>new Option(x,x)));status(models.length?`Found ${models.length} models. Choose or type one.`:'No models returned. Enter a model name.');}catch(e){status(e.message)}};
  panel.querySelector('#na-tokens').onchange=async e=>{try{requireIdle();const n=Number(e.target.value);if(!Number.isInteger(n)||n<256||n>16000)throw Error('Response budget must be between 256 and 16000 tokens.');data().responseTokens=n;await persist();}catch(err){options();status(err.message)}};
  panel.querySelector('#na-watch').onchange=async e=>{try{const d=data();d.watch=e.target.checked;if(d.watch && changedProcessed(d.processed||[],context().chat||[])){d.review={reason:'Tracked chat changed while tracking was off.'};status('Tracked chat changed. Review the lore before resuming.');}await persist();if(d.watch)scheduleDrain();}catch(err){status(err.message)}};
  panel.querySelector('#na-new').onclick=async()=>{try {
    requireIdle();const c=context(),chatId=c.chatId;if(data().directive)throw Error('Open a different chat before creating another novel.');
    const name=(await c.Popup.show.input('Create a lorebook', 'Name this novel’s lorebook:'))?.trim();if(!name)return;
    requireIdle();if(context().chatId!==chatId)throw Error('Chat changed; no lorebook was created.');
    const previous=c.chatMetadata.world_info;
    if(previous && previous!==name && !await c.Popup.show.confirm('Change chat lorebook?', `Replace “${previous}” with the new lorebook “${name}” for this chat?`))return;
    if(context().chatId!==chatId)throw Error('Chat changed; no lorebook was created.');
    if(!await createNewWorldInfo(name))throw Error('Book was not created');
    if(context().chatId!==chatId)throw Error('Lorebook created, but the chat changed before it could be linked.');
    if(c.chatMetadata.world_info!==previous)throw Error('The chat lorebook changed; the new book was not linked.');
    if(!await attachBook(name,c,previous))throw Error('The chat lorebook changed; the new book was not linked.');
    changeBook(name);await persist();options();await setupNovel();status('New lorebook linked to this chat.');
  }catch(e){status(e.message)}};
  panel.querySelector('#na-stop').onclick=()=>{stopWriting=true; writingController?.abort(); status('Stopping…');};
  panel.querySelector('#na-download').onclick=()=>{try {
    const prose=(data().drafts || []).join('\n\n');
    if (!prose) throw Error('No draft text yet.');
    const a=document.createElement('a'), url=URL.createObjectURL(new Blob([prose],{type:'text/plain'}));
    a.href=url; a.download='storyloom-scenes.txt'; a.click(); URL.revokeObjectURL(url);
  }catch(e){status(e.message)}};
  const writeRun=async(chapterMode=false)=>{let ownsSession=false;try {
    requireIdle();
    const c=context(), d=data(), id=c.chatId, bookName=d.book, profile=d.profile, referenceName=d.reference, tokens=Number(d.responseTokens || 6000), direct=directSnapshot(d,c);
    if(!bookName) throw Error('Choose this novel’s lorebook first.');
    if(c.chatMetadata.world_info!==bookName)throw Error('Link the selected lorebook to this chat before writing.');
    if(d.pendingContinuity) throw Error('Retry the pending continuity update before writing more.');
    const target=chapterMode?Number(panel.querySelector('#na-chapter-words').value):0;
    if(chapterMode)chapterStep(0,target,0);
    const count=chapterMode?10:sceneCount(panel.querySelector('#na-count').value);let chapterWords=0,chapterFinished=false;
    const request=panel.querySelector('#na-input').value.trim() || 'Continue the current scene.';
    stopWriting=false; writingSession=true; ownsSession=true; writingController=new AbortController();
    for(let i=0;i<count;i++) {
      if(stopWriting) {status('Writing stopped.'); break;}
      if(context().chatId!==id || context().chatMetadata.world_info!==bookName || data().book!==bookName || d.profile!==profile || d.reference!==referenceName || !sameDirect(d,direct)) throw Error('Chat or lorebook changed; writing stopped.');
      const step=chapterMode?chapterStep(chapterWords,target,i):null;
      busy=true; status(chapterMode?`Writing chapter: ${chapterWords} words so far…`:`Writing segment ${i+1} of ${count}…`);
      const book=await freshBook(bookName);
      const directive=Object.values(book.entries).find(e=>e.uid===d.directive?.uid)?.content || initialDirective();
      const previous=(d.drafts || []).slice(-2).join('\n\n');
      const readMain=()=>recentConversation((context().chat||[]).filter(m=>!m.is_system && m.mes).map(m=>({role:m.is_user?'user':'assistant',content:m.mes})),6000);
      const mainChat=readMain();
      const query=request+' '+previous.slice(-3000)+' '+JSON.stringify(mainChat);
      const lore=selectLore(synopsis(book),query,Math.max(2500,Math.min(9000,(Number(c.maxContext)||8192))));
      const reference=referenceName ? selectLore(synopsis(await freshBook(referenceName)),query,4000) : null;
      if(context().chatId!==id || data()!==d || d.profile!==profile || d.reference!==referenceName || !sameDirect(d,direct)) throw Error('Chat or novel changed; writing stopped.');
      const chapterOutline=chapterMode ? currentChapterOutline(book,directive) : '';
      const chapterRequest=chapterMode ? `${request}\nCurrent chapter outline (follow this plan while preserving established events):\n${chapterOutline}\nWrite the ${step.final?'final':'next'} segment of this chapter. Aim for about ${Math.max(500,Math.min(1200,step.remaining))} words. ${step.final?'Bring this chapter to a natural ending that follows the outline; do not recap.':'Develop the scene and advance the chapter; do not conclude the chapter yet.'}` : request;
      const prose=validateScene(await llm(c,makeWritingPrompt({directive,lore,reference:JSON.stringify(reference),mainChat:JSON.stringify(mainChat),previous:previous.slice(-6000),request:chapterRequest}),profile,writingController.signal,tokens,writingSystem(),direct));
      if(stopWriting) {status('Stopped; current segment was not saved.'); break;}
      if(context().chatId!==id || context().chatMetadata.world_info!==bookName || data().book!==bookName || d.profile!==profile || d.reference!==referenceName || !sameDirect(d,direct) || JSON.stringify(readMain())!==JSON.stringify(mainChat)) throw Error('Chat or story changed; current segment was not saved.');
      if(JSON.stringify(await freshBook(bookName))!==JSON.stringify(book) || JSON.stringify(readMain())!==JSON.stringify(mainChat)) throw Error('Lorebook or chat changed; current segment was not saved.');
      if(context().chatId!==id || context().chatMetadata.world_info!==bookName || data()!==d)throw Error('The chat or linked lorebook changed; current segment was not saved.');
      d.drafts ??= []; d.drafts.push(prose); d.messages.push({role:'assistant',content:prose});
      queueContinuity(d,{id:crypto.randomUUID(),text:prose});
      await persist();
      if(context().chatId!==id || data()!==d || context().chatMetadata.world_info!==bookName)throw Error('The segment was saved, but the chat or lorebook changed. Return to the original chat and review it.');
      showMessages();
      status('Segment saved. Updating continuity…'); busy=false;
      try {await flushContinuity(true);}
      catch(e) {throw Error('Segment saved; writing stopped because continuity update failed: '+e.message);}
      if(chapterMode){chapterWords+=wordCount(prose);if(step.final){chapterFinished=true;break;}}
    }
    panel.querySelector('#na-input').value='';
    if(!stopWriting) status(chapterMode?(chapterFinished?`Chapter draft saved (${chapterWords} words).`:'Chapter writing stopped before completion.'):'Writing session finished.');
  }catch(e){status(ownsSession && stopWriting?'Writing stopped.':e.message)}finally{if(ownsSession){writingController=null;writingSession=false;busy=false;queueSync();scheduleDrain()}}};
  panel.querySelector('#na-write').onclick=()=>writeRun(false);
  panel.querySelector('#na-write-chapter').onclick=()=>writeRun(true);
  panel.querySelector('#na-simple').onclick=()=>beginInterview('simple');
  panel.querySelector('#na-deep').onclick=()=>beginInterview('deep');
  panel.querySelector('#na-skip').onclick=()=>nextInterview(true);
  panel.querySelector('#na-next').onclick=()=>nextInterview(false);
  panel.querySelector('#na-outline').onclick=()=>finishInterview();
  panel.querySelector('#na-send').onclick=async()=>{
    const input=panel.querySelector('#na-input'), v=input.value.trim(); if(!v)return;
    try {
      const d=data(), interview=d.interview;
      if(!interview)throw Error('Choose Simple or Deep to begin.');
      if(interview?.phase==='outline')throw Error('Create the outline before continuing.');
      if(interview?.phase==='asking') {
        await interact(v,false,null,null,null,false,{guidance:answerInstruction(interview),collaborative:interview.mode==='deep'});
        if(data()!==d)throw Error('Chat changed; return to this novel.');
        d.interview=recordAnswer(d.interview,v); await persist(); input.value='';
        if(interview.mode==='simple') await nextInterview(false);
      } else {await interact(v,false,null,null,null,false,{collaborative:interview.mode==='deep'});input.value='';}
    } catch(e){status(e.message)}
  };
  const c=context();
  c.eventSource.on(c.event_types.WORLDINFO_UPDATED,queueSync);
  c.eventSource.on(c.event_types.CHAT_CHANGED,()=>{sessionKey=null;panel.querySelector('#na-session-key').value='';if(!panel.hidden){try{options();status('')}catch{panel.hidden=true}} queueSync(); scheduleDrain();});
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

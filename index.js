import { doNewChat } from '../../../../script.js';
import { createWorldInfoEntry, createNewWorldInfo, deleteWorldInfo, openWorldInfoEditor, showWorldEditor } from '../../../world-info.js';
import { parseAssistant, planWrites, readDirective, replaceDirective } from './operations.mjs';
import { synchronize, resolveConflict, planInitialLink } from './sync.mjs';
import { createNovel, selectNovel } from './state.mjs';
import { enqueue, nextJob, requiresReview, wasApplied, changedProcessed } from './queue.mjs';
import { foundationTemplate, initialDirective, normalizeFoundation, foundationTitle } from './template.mjs';
import { buildChange, undoChange, classifyChange, describeChange } from './history.mjs';
import { generate, profileOptions, requestModel } from './generation.mjs';
import { queueContinuity, completeContinuity, continuityPrompt } from './continuity.mjs';
import { selectLore, recentConversation, ensureCompleteUpdates } from './context.mjs';
import { saveVerified } from './persistence.mjs';
import { linkBook, linkState } from './lorelink.mjs';
import { repairOutline } from './outline-repair.mjs';
import { normalizePeopleFocus } from './focus.mjs';
import { characterImportRequest, requiredCharacterUpdate, selectCharacterSource } from './reuse.mjs';
import { planningSystem } from './prompts.mjs';
import { PROVIDERS, readKeyOptions, readModels } from './providers.mjs';
import { castNames, characterProfilesInstruction, validateCharacters } from './characters.mjs';
import { layoutBook, chapterList, directiveForChapter } from './lorebook-layout.mjs';
import { planLinkSync, resolveLink, linkBookName, findCharacterEntry, linksFor } from './links.mjs';
import { NOVEL, BUILT_IN, templateToText, parseTemplate } from './templates.mjs';
import { startInterview, currentQuestion, questionCount, advanceInterview, answerInstruction, finalizeInstruction, validateOutline, recordAnswer, isCollaborativeReply, deepNotesUpdate } from './interview.mjs';

const KEY = 'novelArchitect';
const context = () => SillyTavern.getContext();
let busy = false;
let modelController = null;
let settingsOpen = false;
let atStart = false;
let syncing = false;
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
/** The template a novel was started with (older novels: Novel). */
const tpl=(d=data())=>d.template || NOVEL;
const findEntry=(book,title)=>Object.values(book?.entries||{}).find(e=>String(e.comment||'').trim().toLocaleLowerCase()===String(title).toLocaleLowerCase());
function storedTemplates() {
  const c=context(); c.extensionSettings.storyloom ??= {}; c.extensionSettings.storyloom.templates ??= [];
  return c.extensionSettings.storyloom.templates;
}
function allTemplates() {
  const custom=[];
  for(const text of storedTemplates()){try{custom.push({...parseTemplate(text),custom:true});}catch(e){console.warn('Storyloom template:',e.message);}}
  return [...BUILT_IN,...custom];
}
function storedLinks() {
  const c=context(); c.extensionSettings.storyloom ??= {}; c.extensionSettings.storyloom.links ??= [];
  return c.extensionSettings.storyloom.links;
}
const linkValue=e=>e?JSON.stringify({content:e.content??'',key:e.key||[]}):null;
let linkRunning=false, linkAgain=false, linkTimer;
/** Bring every copy of each linked character in line (see links.mjs). */
async function syncLinks(onlyBook=null) {
  if(linkRunning){linkAgain=true;return;}
  linkRunning=true;
  const c=context(), names=new Set(c.getWorldInfoNames()), notes=[];
  try {
    for(const link of onlyBook?linksFor(storedLinks(),onlyBook):storedLinks()) {
      const books={}, contents={};
      for(const name of link.books) {
        if(!names.has(name)){contents[name]=null;continue;}
        books[name]=await freshBook(name);
        contents[name]=linkValue(findCharacterEntry(books[name],link.title));
      }
      const plan=planLinkSync(link.base,contents);
      link.conflict=plan.conflict;
      link.missing=plan.missing;
      for(const [name,value] of Object.entries(plan.writes)) {
        const entry=findCharacterEntry(books[name],link.title), v=JSON.parse(value);
        entry.content=v.content; entry.key=v.key;
        await c.saveWorldInfo(name,books[name],true);
      }
      link.base=plan.base;
      if(Object.keys(plan.writes).length)notes.push(`Synced “${link.title}” to ${Object.keys(plan.writes).join(', ')}.`);
      if(plan.conflict)notes.push(`“${link.title}” was edited differently in ${plan.conflict.join(' and ')}. Choose which version to keep under Reference & characters.`);
      if(plan.missing.length)notes.push(`“${link.title}” is missing from ${plan.missing.join(', ')}.`);
    }
    c.saveSettingsDebounced();
    if(notes.length && document.getElementById('na-status'))status(notes.join(' '));
    renderLinks();
  } catch(e) {console.warn('Storyloom link sync:',e); if(document.getElementById('na-status'))fail(e,'Keep characters in sync');}
  finally {linkRunning=false; if(linkAgain){linkAgain=false;setTimeout(()=>syncLinks(),500);}}
}
function renderLinks() {
  const list=document.getElementById('na-links'); if(!list)return;
  const links=storedLinks();
  list.replaceChildren();
  document.getElementById('na-links-area').hidden=!links.length;
  for(const link of links) {
    const li=document.createElement('li');
    const text=document.createElement('span');
    text.textContent=`${link.title} — ${link.books.join(' ↔ ')}`+(link.conflict?' · edited differently, choose one:':link.missing?.length?` · missing from ${link.missing.join(', ')}`:' · in sync');
    li.append(text);
    for(const book of link.conflict||[]){const b=document.createElement('button');b.type='button';b.textContent=`Keep ${book}’s`;b.title=`Copy the version from “${book}” to every linked book.`;b.onclick=()=>chooseLinkVersion(link.id,book);li.append(b);}
    const un=document.createElement('button');un.type='button';un.textContent='Unlink';un.title='Stop syncing. Every copy stays where it is and can then be edited separately.';
    un.onclick=async()=>{lastAction='Unlink';try{if(!await context().Popup.show.confirm('Stop syncing?',`Stop keeping “${link.title}” in sync? All copies stay where they are.`))return;const all=storedLinks();all.splice(all.findIndex(x=>x.id===link.id),1);context().saveSettingsDebounced();renderLinks();status(`“${link.title}” is no longer synced.`);}catch(e){fail(e);}};
    li.append(un); list.append(li);
  }
}
async function chooseLinkVersion(id,winner) {
  lastAction=`Keep ${winner}’s`;
  try {
    const link=storedLinks().find(x=>x.id===id); if(!link)return;
    const c=context(), books={}, contents={};
    for(const name of link.books){books[name]=await freshBook(name);contents[name]=linkValue(findCharacterEntry(books[name],link.title));}
    const plan=resolveLink(contents,winner);
    linkRunning=true;
    try {
      for(const [name,value] of Object.entries(plan.writes)){const e=findCharacterEntry(books[name],link.title),v=JSON.parse(value);e.content=v.content;e.key=v.key;await c.saveWorldInfo(name,books[name],true);}
    } finally {linkRunning=false;}
    link.base=plan.base; link.conflict=null; c.saveSettingsDebounced(); renderLinks();
    status(`Every copy of “${link.title}” now matches ${winner}.`);
  } catch(e){fail(e);}
}
function changeBook(book) {
  const state=root(), current=selectNovel(state,state.selected || '');
  if (current.directive && current.book !== book) throw Error('This chat already has a linked writing directive. Open a different chat for another novel.');
  return selectNovel(state,book);
}
async function persist() { await saveVerified(context); }
let lastAction='';
function status(s) { const el=document.getElementById('na-status'); el.textContent = s; el.classList.remove('is-error'); }
/** Show a failure with the button that triggered it, so the bottom line says what went wrong where. */
function fail(error,label=lastAction) {
  const message=String(error?.message||error||'Something went wrong.');
  console.warn('Storyloom:',label||'(no action)',error);
  const el=document.getElementById('na-status');
  el.textContent=(label?`“${label}” didn’t work: `:'')+message;
  el.classList.add('is-error');
}
const TIPS={
  'na-back':'Leave this conversation and go back to the start screen. Nothing is lost; you can resume it or start a new novel there.',
  'na-settings-toggle':'AI connection, chat tracking, and repair tools. Click again (or press Esc) to come back.',
  'na-close':'Hide the Storyloom panel. Everything is saved.',
  'na-book':'The lorebook (World Info book) this novel lives in. Pick an existing one, or “Start a new novel” to create a fresh one.',
  'na-new':'Make an empty lorebook with a name you choose and use it for this novel.',
  'na-view-book':'Open this novel’s lorebook in SillyTavern’s World Info editor to read or edit the entries.',
  'na-use-title':'Rename the lorebook to the title in the summary entry (Novel Foundation, Campaign Overview…).',
  'na-reference':'Another lorebook to borrow from. Storyloom reads it but never changes it.',
  'na-import-character':'Copy one character from the reference lorebook into this novel as a full character entry.',
  'na-link-character':'Attach the whole reference lorebook to the SillyTavern character you are chatting with, in all their chats.',
  'na-resume-chat':'Go back to this novel’s Storyloom conversation where you left off.',
  'na-start-new-chat':'Open a new SillyTavern chat for a brand-new novel with its own lorebook. This novel stays in this chat.',
  'na-simple':'Answer a few questions (or skip them). The AI fills in everything else and builds the outline and characters.',
  'na-deep':'Talk through each topic with the AI before moving on. Ends with the same outline and character profiles.',
  'na-skip':'Skip this question; the AI will decide it for you when it builds the outline.',
  'na-next':'Done with this topic; move to the next question.',
  'na-outline':'Build the full outline, foundation and character profiles from your answers.',
  'na-send':'Send your message to Storyloom.',
  'na-cancel-model':'Stop waiting for the AI. Your message stays in the box.',
  'na-attach':'Make this chat use the novel’s lorebook.',
  'na-setup':'Add the summary entry (e.g. Novel Foundation) and the Writing Directive to the lorebook if they are missing.',
  'na-use-book':'The lorebook’s copy of the writing directive wins; the Author’s Note is overwritten.',
  'na-use-note':'The Author’s Note copy of the writing directive wins; the lorebook entry is overwritten.',
  'na-undo':'Restore the lorebook entries from before Storyloom’s last save.',
  'na-retry':'Try a failed lorebook update again.',
  'na-resume':'Start reading the main chat again after reviewing changed messages.',
  'na-load-models':'Ask the provider which models are available.',
  'na-refresh-keys':'Reload the API keys saved in SillyTavern.',
  'na-watch':'Read new main-chat messages and add story developments to the lorebook.',
  'na-tokens':'Longest reply Storyloom asks the AI for.',
  'na-profile':'Which AI Storyloom uses.',
  'na-template':'What kind of project this is. It decides the questions and the lorebook entries. Edit or add templates in Settings → Templates.',
  'na-template-edit':'Pick a template to view or edit.',
  'na-template-save':'Save your changes to this template (your own templates only).',
  'na-template-copy':'Save the text below as a new template, using the Name line as its name.',
  'na-template-delete':'Delete this template (your own templates only).',
  'na-chapter':'Which chapter the story is on. The main chat only gets this chapter’s plan (in the always-on “Current Chapter” entry), so it doesn’t run ahead.',
};
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
    ['na-book', c.getWorldInfoNames(), root().newBookRequested ? '' : (d.book || c.chatMetadata.world_info), '＋ Start a new novel (new lorebook)'],
    ['na-reference', c.getWorldInfoNames().filter(n => n !== d.book), d.reference, 'No linked reference'],
    ['na-profile', profileOptions(c.extensionSettings.connectionManager?.profiles || [],c.ConnectionManagerRequestService,d.profile==='__direct__'?'':d.profile), d.profile, 'Use current connection'],
  ]) {
    const el = document.getElementById(id); el.replaceChildren(new Option(blank, ''));
    if(id==='na-profile')el.add(new Option('Choose another provider or model…','__direct__'));
    for (const item of list) el.add(new Option(typeof item === 'string' ? item : item.name, typeof item === 'string' ? item : item.id));
    el.value = val || '';
  }
  const shownBook=root().newBookRequested ? '' : (d.book || c.chatMetadata.world_info || '');
  const state=linkState(shownBook,c.chatMetadata.world_info);
  document.getElementById('na-book-status').textContent=({none:'A new lorebook will be created when you choose Simple or Deep below. It is renamed to your novel’s title once the outline is done.',linked:'Linked to this chat.',unlinked:'Selected, but not linked to this chat.',different:'A different lorebook is linked to this chat.'})[state];
  document.getElementById('na-watch').checked = !!d.watch;
  document.getElementById('na-reference-actions').hidden = !d.reference;
  document.getElementById('na-new').hidden = !!shownBook;
  document.getElementById('na-view-book').hidden = !shownBook;
  document.getElementById('na-use-title').hidden = d.interview?.phase!=='done' || !isDraftLorebook(d);
  document.getElementById('na-tokens').value=String(d.responseTokens || 12000);
  renderDirectConnection(d);
  renderTemplates(d);
  renderLinks();
  showMessages();
  renderInterview();
  renderPanelView();
  const list=document.getElementById('na-history'); list.replaceChildren();
  document.getElementById('na-history-empty').hidden=!!d.history?.length;
  document.getElementById('na-profiles').hidden=d.interview?.phase!=='done';
  renderChapters(d);
  loadChapters(d).catch(e=>console.warn('Storyloom chapters:',e));
  for(const item of [...(d.history||[])].reverse()){const li=document.createElement('li');li.textContent=describeChange(item);list.append(li);}
  if(d.pendingContinuity)status('A saved draft is waiting for a continuity update. Retry it in settings.');
  else if(d.review)status('A previously processed chat message changed. Review your lore, then resume tracking in settings.');
}
function renderTemplates(d) {
  const templates=allTemplates(), names=templates.map(t=>t.name);
  const pick=document.getElementById('na-template'), keep=pick.value;
  pick.replaceChildren(...names.map(n=>new Option(n,n)));
  pick.value=names.includes(keep)?keep:NOVEL.name;
  document.getElementById('na-template-label').hidden=!!d.interview;
  const edit=document.getElementById('na-template-edit'), current=edit.value;
  edit.replaceChildren(...templates.map(t=>new Option(t.custom?t.name:`${t.name} (built-in)`,t.name)));
  edit.value=names.includes(current)?current:(d.template?.name && names.includes(d.template.name)?d.template.name:NOVEL.name);
  showTemplateText();
}
function showTemplateText() {
  const t=allTemplates().find(x=>x.name===document.getElementById('na-template-edit').value) || NOVEL;
  document.getElementById('na-template-text').value=templateToText(t);
  document.getElementById('na-template-delete').disabled=!t.custom;
  document.getElementById('na-template-save').disabled=!t.custom;
}
function saveTemplate(asNew) {
  const text=document.getElementById('na-template-text').value;
  const parsed=parseTemplate(text);
  const list=storedTemplates(), selected=document.getElementById('na-template-edit').value;
  const nameTaken=allTemplates().some(t=>t.name.toLowerCase()===parsed.name.toLowerCase() && (asNew || t.name!==selected));
  if(nameTaken)throw Error(`A template named “${parsed.name}” already exists. Change the Name line first.`);
  if(asNew) list.push(templateToText(parsed));
  else {
    const i=list.findIndex(x=>{try{return parseTemplate(x).name===selected}catch{return false}});
    if(i<0)throw Error('Built-in templates can’t be changed. Use “Save as new”.');
    list[i]=templateToText(parsed);
  }
  context().saveSettingsDebounced();
  document.getElementById('na-template-edit').value=parsed.name;
  renderTemplates(data());
  status(`Template “${parsed.name}” saved. Choose it on the start screen for your next novel.`);
}
function renderChapters(d) {
  const label=document.getElementById('na-chapter-label'), select=document.getElementById('na-chapter');
  const chapters=d.outlineChapters||[];
  label.hidden=d.interview?.phase!=='done' || !chapters.length;
  if(label.hidden)return;
  select.replaceChildren(...chapters.map(ch=>new Option(`${tpl(d).unit} ${ch.number} — ${ch.title}`,String(ch.number))));
  select.value=String(d.chapter||1);
}
/** Novels finished before the chapter picker existed: read chapters from the saved outline once. */
async function loadChapters(d) {
  if(d.outlineChapters || d.interview?.phase!=='done' || !d.book)return;
  const book=await freshBook(d.book);
  const outline=findEntry(book,tpl(d).outline.title);
  if(!outline || data()!==d)return;
  d.outlineChapters=chapterList(outline.content,tpl(d).unit).map(({number,title})=>({number,title}));
  renderChapters(d);
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
// Big planning replies from slower providers can take several minutes; Stop is always available.
const MODEL_TIMEOUT_MS=10*60*1000;
async function llm(c,prompt,profile,signal,tokens,systemPrompt,direct) {
  const started=Date.now(), label=document.getElementById('na-status')?.textContent?.replace(/\s*\(\d+s\)$/,'') || 'Waiting for the AI…';
  const ticker=setInterval(()=>{const el=document.getElementById('na-status');if(el && busyLabel(el.textContent,label))el.textContent=`${label} (${Math.round((Date.now()-started)/1000)}s)`;},1000);
  try {
    return await requestModel(async requestSignal=>{
      try {
        try {return await generate(c,prompt,profile,requestSignal,tokens,systemPrompt,direct);}
        catch(error) {
          if(!error?.emptyReply || requestSignal.aborted)throw error;
          // Empty answers are usually a one-off from the provider; ask once more before failing.
          console.warn('Storyloom: empty model reply, retrying once:',error.message);
          const el=document.getElementById('na-status'); if(el)el.textContent=`The model answered with nothing (${error.message.replace(/^the model /,'')}); asking once more…`;
          return await generate(c,prompt,profile,requestSignal,tokens,systemPrompt,direct);
        }
      } catch(error) {
        if(requestSignal.aborted)throw requestSignal.reason;
        if(/^Choose |^Enter |^Select |^Response budget/.test(error?.message))throw error;
        const detail=String(error?.message||error||'').trim().slice(0,200);
        if(error?.emptyReply)throw Error(`The model answered twice with nothing: ${detail}. This is the model, not your connection — try again, or raise the response budget in Settings if it keeps happening.`);
        throw Error(`The AI connection failed${detail?` (${detail})`:''}. Check AI connection in Settings and try again.`);
      }
    },signal,MODEL_TIMEOUT_MS);
  } finally {clearInterval(ticker);}
}
function busyLabel(text,label) {return text===label || text.startsWith(label+' (');}
function renderModelWork(controller) {
  modelController=controller;
  const panel=document.getElementById('na-panel');
  panel.querySelector('#na-cancel-model').hidden=!controller;
  for (const id of ['na-send','na-skip','na-next','na-outline']) panel.querySelector('#'+id).disabled=!!controller;
}
function renderPanelView() {
  const panel=document.getElementById('na-panel');
  panel.querySelector('#na-settings').hidden=!settingsOpen;
  panel.querySelector('#na-workspace').hidden=settingsOpen;
  const toggle=panel.querySelector('#na-settings-toggle');
  toggle.textContent=settingsOpen?'Done':'Settings';
  toggle.setAttribute('aria-expanded',String(settingsOpen));
  const novel=data();
  panel.querySelector('#na-undo-area').hidden=!novel.history?.length;
  panel.querySelector('#na-retry-area').hidden=!(novel.pendingContinuity || novel.queueError);
  panel.querySelector('#na-resume-area').hidden=!novel.review;
  const back=panel.querySelector('#na-back');
  back.hidden=!novel.interview;
  back.textContent=atStart?'Resume chat':'Back to start';
}
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
  if (busy || syncing || interviewStarting || interviewTransition || (draining && !jobId) || (continuityBusy && !allowWriting)) throw new Error('Storyloom is finishing another operation. Use Stop if a model request is running.');
  const c = context(), d = data(), chatId = c.chatId, bookName = d.book, profile=d.profile, referenceName=d.reference, tokens=Number(d.responseTokens || 12000), direct=directSnapshot(d,c);
  if (!bookName) throw new Error('Choose this novel’s lorebook first.');
  if(c.chatMetadata.world_info!==bookName)throw Error('The selected lorebook is not linked to this chat. Choose it in Storyloom to link it before saving.');
  busy = true;
  const controller=new AbortController();
  renderModelWork(controller);
  try {
    const modelName=profile==='__direct__'?direct?.model:!profile && c.mainApi==='openai'?c.getChatCompletionModel?.():'';
    status(modelName?'Waiting for '+modelName+'…':'Waiting for the AI…');
    await recoverPending(d);
    if(context().chatId !== chatId || data() !== d) throw Error('Chat changed; nothing saved.');
    const before = await freshBook(bookName);
    const ref = referenceName ? await freshBook(referenceName) : null;
    if(input.length>30000) throw Error('The message is too long for one request. Split it into smaller parts.');
    const budget=Math.max(4000,Math.min(24000,(Number(c.maxContext)||8192)*2));
    const history=(interview?.sourceOnly || (interview?.requireOutline && d.interview?.mode==='deep')) ? [] : recentConversation(d.messages,Math.floor(budget*.25));
    const query=history.map(x=>x.content).join(' ')+input;
    const targetEntries=synopsis(before);
    const loreBudget=interview?.loreBudget || Math.floor(budget*.5);
    const current=interview?.sourceOnly ? selectLore(targetEntries.filter(x=>x.title.trim().toLocaleLowerCase()===interview.requiredCharacterTitle.toLocaleLowerCase()),query,loreBudget,tpl(d).summary.title) : selectLore(targetEntries,query,loreBudget,tpl(d).summary.title);
    const reference=interview?.sourceOnly ? selectCharacterSource(ref?synopsis(ref):[],interview.sourceCharacter,Math.floor(budget*.5)) : selectLore(ref?synopsis(ref):[],query,Math.floor(budget*.25));
    const prompt = `Use the available lore for continuity. For an existing fact you can see, carry it forward unless the writer changes it. Blank interview fields in Simple mode are yours to complete.\nCurrent novel entries: ${JSON.stringify(current)}\nReference material from ${referenceName || 'no linked book'} (do not treat as current canon without relevance): ${JSON.stringify(reference)}\nConversation: ${JSON.stringify(history)}\n${fromMain ? 'New main story chat text; record only established developments and do not address the user: ' : 'Writer: '}${input}`;
    if(context().chatId!==chatId || data()!==d || d.profile!==profile || d.reference!==referenceName || !sameDirect(d,direct)) throw Error('Chat or novel changed; request stopped.');
    const mode=fromMain?'background':(d.interview?.phase==='done'?'ongoing':d.interview?.mode || 'ongoing');
    const system=planningSystem(mode,tpl(d))+(interview?.guidance ? `\n${interview.guidance}` : '');
    const allowProse=!fromMain && !interview?.requireOutline && !interview?.requiredCharacterTitle && !interview?.requireCharacters;
    const ask=(request,instructions)=>llm(c,request,profile,controller.signal,tokens,instructions,direct);
    const raw=await ask(prompt,system);
    let result;
    try {result=parseAssistant(raw,{allowProse});}
    catch(error) {
      if(context().chatId!==chatId || context().chatMetadata.world_info!==bookName || data()!==d)throw Error('Chat or lorebook changed; nothing saved.');
      console.warn('Storyloom: could not read the model reply ('+error.message+'). Start:',String(raw).slice(0,500),'… End:',String(raw).slice(-500));
      status(`The model’s reply couldn’t be read (${String(error.message).slice(0,80)}); asking it to try again…`);
      const retrySystem=system+'\nYour last response could not be read. Respond with exactly one valid JSON object, beginning with { and ending with }, and no surrounding prose or markdown. Escape line breaks inside strings.';
      const retried=await ask(prompt,retrySystem);
      try {result=parseAssistant(retried,{allowProse});}
      catch {throw Error('The model did not return a usable response after retrying. Nothing was saved; please try again.');}
    }
    if(interview?.collaborative && !isCollaborativeReply(result.reply)) {
      if(context().chatId!==chatId || data()!==d)throw Error('Chat changed; nothing saved.');
      const retrySystem=system+'\nYour previous response was too brief. Respond specifically to the writer, offer a useful possibility or observation, and ask a relevant follow-up question. Do not reply with only an acknowledgement.';
      result=parseAssistant(await ask(prompt,retrySystem),{allowProse});
      if(!isCollaborativeReply(result.reply))throw Error('The model did not give a collaborative response. Your message is still here; please try again.');
    }
    if(interview?.requireOutline) result=await repairOutline(result,value=>{
      const t=tpl(d), foundation=value.updates.find(entry=>entry.title.trim().toLowerCase()===t.summary.title.toLowerCase());
      if(foundation)foundation.content=normalizeFoundation(foundation.content,targetEntries.find(entry=>entry.title===t.summary.title)?.content,t.summary.fields);
      validateOutline(normalizePeopleFocus(value,d.interview?.answers,t.cast),d.interview?.mode,t);
    },async (previous,issue)=>{
      if(context().chatId!==chatId || context().chatMetadata.world_info!==bookName || data()!==d)throw Error('Chat or lorebook changed; nothing saved.');
      status('Completing missing story details…');
      const correction=`${prompt}\n\nYour previous plan needs correction: ${issue}. Return the complete corrected JSON object with all required entries, not just the missing part. Previous plan: ${JSON.stringify(previous)}`;
      return parseAssistant(await ask(correction,system));
    });
    if(interview?.requireCharacters) result=await repairOutline(result,value=>validateCharacters(value,interview.requireCharacters,tpl(d).characterSections),async (previous,issue)=>{
      if(context().chatId!==chatId || context().chatMetadata.world_info!==bookName || data()!==d)throw Error('Chat or lorebook changed; nothing saved.');
      status('Filling in thin character profiles…');
      const correction=`${prompt}\n\nYour previous profiles need correction: ${issue}. Return every requested profile again in full, with every heading filled in. Previous profiles: ${JSON.stringify(previous)}`;
      return parseAssistant(await ask(correction,system));
    });
    if(controller.signal.aborted)throw Error('Stopped. Your message is still in the box.');
    document.getElementById('na-cancel-model').hidden=true;
    if(interview?.requiredCharacterTitle) result.updates=[requiredCharacterUpdate(result,interview.requiredCharacterTitle)];
    if(interview?.collaborative && d.interview?.phase==='asking') {
      const prior=[...d.messages].reverse().find(m=>m.role==='assistant')?.content || '';
      result.updates=[deepNotesUpdate(before,d.interview,input,prior)];
    }
    if (context().chatId !== chatId || context().chatMetadata.world_info!==bookName || data().book !== bookName || d.profile!==profile || d.reference!==referenceName || !sameDirect(d,direct)) throw new Error('Chat or lorebook changed while generating; nothing saved.');
    if (guard && !guard()) throw Error('The source message changed; nothing was saved.');
    const fresh = await freshBook(bookName);
    if (JSON.stringify(fresh) !== JSON.stringify(before)) throw new Error('Lorebook changed while generating; nothing saved. Please retry.');
    let skippedFoundation=false;
    if(!fromMain && !interview?.requireOutline) {
      const foundation=result.updates.find(entry=>entry.title.trim().toLowerCase()===tpl(d).summary.title.toLowerCase());
      if(foundation) {
        try {planWrites(fresh,[foundation],tpl(d).summary);}
        catch {
          result.updates=result.updates.filter(entry=>entry!==foundation);
          skippedFoundation=true;
        }
      }
    }
    const writes = planWrites(fresh, result.updates, tpl(d).summary);
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
    status(result.ignoredUpdates?'Reply received. The proposed lorebook updates could not be read.':skippedFoundation?'Reply received. Storyloom kept the existing foundation because the proposed update could not be read.':writes.length ? `Saved ${writes.length} World Info ${writes.length === 1 ? 'entry' : 'entries'}.` : 'No entry changes.');
    return result;
  } finally { renderModelWork(null); busy = false; queueSync(); if(!draining)scheduleDrain(); }
}
function requireIdle(allowStarting=false) { if(busy || syncing || draining || continuityBusy || (interviewStarting && !allowStarting) || interviewTransition) throw Error('Wait for the current Storyloom operation to finish.'); }
async function setupNovel(allowStarting=false) {
 requireIdle(allowStarting); syncing=true;
 try {await setupFoundation(); await setupDirective();} finally {syncing=false;queueSync();scheduleDrain();}
}
async function setupFoundation() {
  const c=context(), d=data(), chatId=c.chatId, name=d.book;
  if(!name) throw Error('Choose a lorebook first.');
  const book=await freshBook(name);
  const summary=tpl(d).summary;
  const existing=Object.values(book.entries).filter(e=>e.comment===summary.title);
  if(existing.length>1) throw Error(`This book has more than one ${summary.title} entry.`);
  if(existing.length) return;
  const before=structuredClone(book), entry=createWorldInfoEntry(name,book);
  if(!entry) throw Error('Could not create foundation.');
  entry.comment=summary.title; entry.content=foundationTemplate(summary.fields); entry.constant=true; entry.key=[];
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
  if (syncing || busy || draining || continuityBusy || interviewStarting || interviewTransition) return;
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
  syncTimer=setTimeout(async()=>{
    const message=document.getElementById('na-sync-status');
    try {await syncDirective();if(message)message.textContent='';}
    catch(error){if(message)message.textContent='Writing directive: '+error.message;}
  },800);
}
async function flushContinuity(allowWriting=false) {
  const d=data(), c=context(), job=d.pendingContinuity;
  if(!job) return;
  if(busy || syncing || draining || continuityBusy) throw Error('Wait for the current operation to finish.');
  continuityBusy=true;
  try {
    await recoverPending(d);
    if(context().chatId!==c.chatId || data()!==d) throw Error('Chat changed; continuity remains pending.');
    if(!wasApplied(d.history||[],job.id)) await interact(continuityPrompt(job.text),true,null,job.id,'written draft',true);
    if(context().chatId!==c.chatId || data()!==d) throw Error('Chat changed; continuity remains pending.');
    completeContinuity(d,job.id); await persist();
  } finally {continuityBusy=false;queueSync();scheduleDrain();}
}
function scheduleDrain() { setTimeout(()=>drainMain().catch(e=>fail(e,'Follow the main chat')),0); }
async function drainMain() {
  if(busy || draining || syncing || continuityBusy || interviewStarting || interviewTransition) return;
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
  const savedInterview=data().interview;
  const interview=atStart?null:savedInterview;
  panel.querySelector('#na-messages').hidden=atStart;
  panel.querySelector('#na-resume-chat').hidden=!(atStart && savedInterview);
  panel.querySelector('#na-start-new-chat').hidden=!(atStart && savedInterview);
  panel.querySelector('#na-welcome').hidden=!!interview || !!savedInterview;
  panel.querySelector('#na-mode-choices').hidden=!!savedInterview;
  panel.querySelector('#na-composer').hidden=!interview || interview.phase==='outline';
  const progress=panel.querySelector('#na-progress');
  progress.hidden=interview?.phase!=='asking';
  if(interview?.phase==='asking') {panel.querySelector('#na-step-label').textContent=`${interview.mode==='simple'?'SIMPLE':'DEEP'} · ${interview.step+1} OF ${questionCount(interview)}`;panel.querySelector('#na-question').textContent=currentQuestion(interview);}
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
    const chosen=allTemplates().find(t=>t.name===document.getElementById('na-template')?.value) || NOVEL;
    if(!d.book) {
      let name=root().newBookRequested ? '' : original.chatMetadata.world_info;
      const automatic=!name;
      delete root().newBookRequested;
      if(automatic) {
        name=availableBookName('Untitled novel',original.getWorldInfoNames());
        if(!await createNewWorldInfo(name))throw Error('Could not create the novel lorebook.');
      }
      if(context().chatId!==chatId)throw Error('Chat changed while preparing the novel.');
      d=changeBook(name);
      if(automatic)d.automaticBook=true;
      await persist();
    }
    if(!await attachBook(d.book,original))throw Error('The chat lorebook was not changed.');
    if(context().chatId!==chatId || data()!==d)throw Error('Chat changed while preparing the novel.');
    const {custom,...template}=chosen; d.template=structuredClone(template); await persist();
    await setupNovel(true);
    if(context().chatId!==chatId || data()!==d)throw Error('Chat changed while preparing the novel.');
    atStart=false;
    d.interview=startInterview(mode,d.template);
    d.messages.push({role:'assistant',content:currentQuestion(d.interview)});
    await persist(); options();status(mode==='simple'?'Simple mode: answer or skip each question.':'Deep mode: explore each topic, then choose Next topic.');
  }catch(e){fail(e)}finally{if(ownsStart){interviewStarting=false;queueSync();scheduleDrain()}}
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
  }catch(e){fail(e)}finally{if(ownsTransition)interviewTransition=false;}
  if(shouldFinish)await finishInterview();
}
function isDraftLorebook(novel) {
  return /^Storyloom-\d{10,}$/.test(novel.book) || novel.automaticBook===true;
}
function availableBookName(title,existing) {
  const names=new Set(existing.map(name=>name.toLowerCase()));
  let name=title;
  for(let i=2;names.has(name.toLowerCase());i++)name=title+' ('+i+')';
  return name;
}
async function nameFinishedLorebook(novel) {
  const original=novel.book;
  if(!isDraftLorebook(novel))return '';
  const c=context();
  const matchesChat=()=>context().chatId===c.chatId && context().chatMetadata===c.chatMetadata;
  if(!matchesChat() || c.chatMetadata.world_info!==original || data()!==novel)return '';
  requireIdle();
  syncing=true;
  try {
    const book=await freshBook(original);
    const foundation=findEntry(book,tpl(novel).summary.title);
    const title=foundationTitle(foundation?.content,tpl(novel).summary.fields)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().slice(0,100);
    if(!title || /^(untitled|undecided|tbd|unknown)$/i.test(title))return '';
    const state=root();
    const name=availableBookName(title,[...c.getWorldInfoNames(),...Object.keys(state.novels)]);
    if(!matchesChat() || c.chatMetadata.world_info!==original)throw Error('Chat changed.');
    if(!await createNewWorldInfo(name))throw Error('Could not create titled lorebook.');
    await c.saveWorldInfo(name,book,true);
    if(JSON.stringify(await freshBook(name))!==JSON.stringify(book))throw Error('Could not verify titled lorebook.');
    const editor=document.getElementById('world_editor_select');
    if(editor?.selectedOptions[0]?.textContent===name)await showWorldEditor(name);
    if(JSON.stringify(await freshBook(original))!==JSON.stringify(book))throw Error('The draft lorebook changed. Try using the title again.');
    if(!matchesChat() || c.chatMetadata.world_info!==original || data()!==novel)throw Error('Chat changed.');
    const renamed={...novel,book:name,automaticBook:false};
    if(novel.directive)renamed.directive={...novel.directive,book:name};
    if(novel.history)renamed.history=novel.history.map(change=>change.book===original?{...change,book:name}:change);
    Object.defineProperty(state.novels,name,{value:renamed,enumerable:true,writable:true,configurable:true});
    state.selected=name;
    delete state.novels[original];
    try {
      if(!await attachBook(name,c,original))throw Error('Could not link titled lorebook.');
    } catch(error) {
      if(matchesChat() && c.chatMetadata.world_info===original) {
        Object.defineProperty(state.novels,original,{value:novel,enumerable:true,writable:true,configurable:true});
        delete state.novels[name];
        state.selected=original;
      }
      throw error;
    }
    // The draft was created by Storyloom for this novel and its contents now live in the titled book.
    let removed=false;
    try {removed=await deleteWorldInfo(original);} catch {}
    return ' The lorebook is now named “'+name+'”.'+(removed?'':' The temporary “'+original+'” lorebook could not be removed; you can delete it.');
  } finally {syncing=false;queueSync();scheduleDrain();}
}
async function finishInterview() {
  try {
    requireIdle();const d=data(), interview=d.interview;
    if(interview?.phase!=='outline')throw Error('Finish the questions before creating the outline.');
    status('Creating the outline and filling the story foundation…');
    const t=tpl(d), task=finalizeInstruction(interview.mode,interview.answers,t);
    const result=await interact(task,false,null,null,null,false,{guidance:'Complete the interview as instructed. Return every required planning entry, including the outline, in updates.',requireOutline:true,silentUser:true});
    if(data()!==d)throw Error('Chat changed. Return to the novel to finish.');
    const outline=result.updates.find(x=>x.title.trim().toLocaleLowerCase()===t.outline.title.toLocaleLowerCase());
    d.messages.push({role:'assistant',content:'Here is your outline:\n\n'+outline.content});
    d.interview={...interview,phase:'done'};
    d.outlineChapters=chapterList(outline.content,t.unit).map(({number,title})=>({number,title}));
    await persist();
    let bookMessage='';
    try {bookMessage=await nameFinishedLorebook(d);}
    catch {bookMessage=' The outline is saved in the draft lorebook. Storyloom could not switch it to a titled book.';}
    try {await organizeBook(1);} catch(e) {console.warn('Storyloom layout:',e);}
    options();
    status('Outline saved.'+bookMessage+' Writing full character profiles next…');
    await writeProfiles(bookMessage);
  }catch(e){fail(e);try{renderInterview()}catch{}}
}
/** Arrange entries so the main chat sees the right things (see lorebook-layout.mjs). */
async function organizeBook(chapter=null) {
  requireIdle();
  const c=context(), d=data(), name=d.book, chatId=c.chatId;
  if(!name)throw Error('Choose this novel’s lorebook first.');
  syncing=true;
  try {
    const before=await freshBook(name);
    const n=chapter ?? d.chapter ?? 1;
    const t=tpl(d), outlineEntry=findEntry(before,t.outline.title);
    if(outlineEntry)d.outlineChapters=chapterList(outlineEntry.content,t.unit).map(({number,title})=>({number,title}));
    const after=layoutBook(before,{chapter:n,create:book=>createWorldInfoEntry(name,book),template:t});
    const directive=Object.values(after.entries).find(e=>e.comment==='Current Writing Directive');
    if(directive)directive.content=directiveForChapter(directive.content,n);
    const changes=buildChange(before,after);
    if(!changes.length){d.chapter=n;await persist();return;}
    if(context().chatId!==chatId || data()!==d || JSON.stringify(await freshBook(name))!==JSON.stringify(before))throw Error('The chat or lorebook changed; try again.');
    await c.saveWorldInfo(name,after,true);
    if(JSON.stringify(await freshBook(name))!==JSON.stringify(after))throw Error('The lorebook save could not be verified.');
    d.chapter=n;
    d.history ??= []; d.history.push({id:crypto.randomUUID(),book:name,changes,source:'lorebook layout',at:new Date().toISOString()}); if(d.history.length>30)d.history.shift();
    await persist();
  } finally {syncing=false;queueSync();scheduleDrain();}
}
/** Second planning pass: one full lorebook entry per cast member. */
async function writeProfiles(prefix='') {
  try {
    requireIdle();
    const d=data();
    if(!d.book)throw Error('Choose this novel’s lorebook first.');
    const book=await freshBook(d.book);
    const people=findEntry(book,tpl(d).cast);
    const names=castNames(people?.content);
    if(!names.length)throw Error(`There is no cast list (${tpl(d).cast} entry) to build character profiles from.`);
    // One request per person: several full profiles in one reply overflow typical response budgets.
    const done=[];
    for(const [i,name] of names.entries()) {
      try {
        status(`Writing character profile ${i+1} of ${names.length}: ${name}…`);
        await interact(characterProfilesInstruction([name],names,tpl(d).characterSections,tpl(d).unit),false,null,null,`character profile: ${name}`,false,{silentUser:true,requireCharacters:[name],loreBudget:60000,guidance:'Write the requested character profile as a complete lorebook entry.'});
        done.push(name);
      } catch(e) {
        try{options()}catch{}
        fail(Error(`${prefix.trim()?prefix.trim()+' ':''}Saved ${done.length} of ${names.length} character profiles. ${name}’s profile failed: ${e.message} Click “Write character profiles” to try again.`),'Write character profiles');
        return;
      }
    }
    await organizeBook();
    options();
    status(`${prefix.trim()?prefix.trim()+' ':''}Saved full character profiles for ${names.join(', ')}. Click “View entries” to read them.`);
  } catch(e) {
    try{options()}catch{}
    fail(e,'Write character profiles');
  }
}
function init() {
  const button = document.createElement('button'); button.className='menu_button'; button.textContent='Storyloom';
  const openPanel=()=>{try{options();document.getElementById('na-panel').hidden=false;const log=document.getElementById('na-messages');log.scrollTop=log.scrollHeight;if(data().profile==='__direct__')refreshKeys().catch(e=>fail(e));}catch(e){toastr.warning(e.message)}};
  button.addEventListener('click',()=>{openPanel();document.querySelector('#extensions-settings-button .drawer-toggle')?.click();});
  const shortcut=document.createElement('button');shortcut.type='button';shortcut.id='storyloom-chat-shortcut';shortcut.title='Open Storyloom';shortcut.setAttribute('aria-label','Open Storyloom');shortcut.innerHTML='<i class="fa-solid fa-feather-pointed" aria-hidden="true"></i>';shortcut.addEventListener('click',openPanel);document.getElementById('leftSendForm')?.append(shortcut);
  document.querySelector('#extensions_settings2, #extensions_settings')?.append(button);
  const panel = document.createElement('aside'); panel.id='na-panel'; panel.hidden=true;
  panel.innerHTML=`
    <header class="storyloom-header">
      <div class="storyloom-brand"><span class="storyloom-mark" aria-hidden="true">✦</span><div><strong>Storyloom</strong></div></div>
      <div class="storyloom-header-actions">
        <button id="na-back" type="button">Back to start</button>
        <button id="na-settings-toggle" type="button" aria-controls="na-settings" aria-expanded="false">Settings</button>
        <button id="na-close" type="button" class="storyloom-close" aria-label="Close Storyloom">×</button>
      </div>
    </header>
    <section id="na-settings" class="storyloom-settings" aria-label="Storyloom settings" hidden>
      <div class="storyloom-settings-body">
        <label>AI connection<select id="na-profile"></select></label><p class="storyloom-hint">Which AI Storyloom talks to. “Use current connection” uses whatever is set in SillyTavern’s API Connections; pick another to use a different model just for Storyloom.</p>
        <div id="na-direct" class="storyloom-direct" hidden>
          <label>Provider<select id="na-provider"></select></label>
          <label id="na-url-label">Provider URL<input id="na-direct-url" type="url" placeholder="https://…/v1" autocomplete="url"></label>
          <label>Saved key<select id="na-key"></select></label>
          <label id="na-session-label">API key for this session <input id="na-session-key" type="password" autocomplete="off" placeholder="Optional; not saved"></label>
          <label>Model<input id="na-model" list="na-model-list" placeholder="Choose or enter a model name" autocomplete="off"><datalist id="na-model-list"></datalist></label>
          <div class="storyloom-row"><button id="na-load-models" type="button">Find available models</button><button id="na-refresh-keys" type="button">Refresh saved keys</button></div>
          <p class="storyloom-hint">Uses this provider only for Storyloom. Choose a saved provider key, or enter a session key where offered. Session keys take priority and are not saved.</p>
        </div>
        <label class="storyloom-check"><input id="na-watch" type="checkbox"> Follow the main chat</label><p class="storyloom-hint">When on, Storyloom reads new messages in your main SillyTavern chat and adds anything that happens in the story (new people, events, changes) to the lorebook.</p>
        <details class="storyloom-advanced storyloom-templates"><summary>Templates <span aria-hidden="true">⌄</span></summary><p class="storyloom-hint">A template decides what the wizard asks and which lorebook entries it saves — for a novel, a roleplay or a D&amp;D campaign. Pick one to see it. Built-in templates can’t be changed, but “Save as new” makes your own copy to edit. Novels keep the template they were started with.</p><select id="na-template-edit"></select><textarea id="na-template-text" rows="16" spellcheck="false"></textarea><div class="storyloom-row"><button id="na-template-save" type="button">Save</button><button id="na-template-copy" type="button">Save as new</button><button id="na-template-delete" type="button">Delete</button></div><p class="storyloom-hint">Format: keep the labels before the colons. Questions and Entries are lists starting with “-”. Each entry says when the story chat sees it: always, by name (when its keywords come up) or off (planning only).</p></details>
        <details class="storyloom-advanced"><summary>More options <span aria-hidden="true">⌄</span></summary><p class="storyloom-hint">Repair and recovery tools. You normally don’t need these.</p>
          <button id="na-attach" type="button">Link selected lorebook to this chat</button><p class="storyloom-hint">Makes this chat use the novel’s lorebook, so the main chat’s AI sees your characters and world. Storyloom does this for you when you start; use it if the link was removed.</p>
          <button id="na-setup" type="button">Set up foundation and directive</button><p class="storyloom-hint">Adds the two entries Storyloom needs to an existing lorebook: “Novel Foundation” (the story summary) and “Current Writing Directive” (POV, tense, tone and pacing). Existing entries are left alone.</p><p id="na-sync-status" class="storyloom-hint" role="status"></p>
          <div class="storyloom-row"><button id="na-use-book" type="button">Use lorebook directive</button><button id="na-use-note" type="button">Use Author’s Note directive</button></div><p class="storyloom-hint">The writing directive is kept in two places: the lorebook and this chat’s Author’s Note. If both were edited differently, pick which version wins; the other is overwritten to match.</p>
          <label>Response budget (tokens)<input id="na-tokens" type="number" min="256" max="16000" step="256" value="12000"></label><p class="storyloom-hint">The longest reply Storyloom asks the AI for. Raise it if outlines or profiles get cut off; lower it if replies are slow or your model has a small limit.</p>
          <div id="na-undo-area"><button id="na-undo" type="button">Undo last lorebook change</button><p class="storyloom-hint">Puts back the lorebook entries exactly as they were before Storyloom’s most recent save. Use it if an update got something wrong. It won’t run if you’ve edited those entries since.</p></div>
          <div id="na-retry-area"><button id="na-retry" type="button">Retry a failed lorebook update</button><p class="storyloom-hint">Shown only when an update failed (for example the AI timed out). Tries again to add the waiting story details to the lorebook.</p></div>
          <div id="na-resume-area"><button id="na-resume" type="button">Resume tracking this chat</button><p class="storyloom-hint">Shown when you edited, deleted or swiped a main-chat message Storyloom already read. Tracking pauses so the lorebook doesn’t keep facts that no longer happened. Fix the lorebook if needed, then resume.</p></div>
          <details class="storyloom-history"><summary>Recent updates <span aria-hidden="true">⌄</span></summary><p id="na-history-empty" class="storyloom-hint">No lorebook changes yet for this novel.</p><ol id="na-history"></ol></details>
        </details>
      </div>
    </section>
    <div id="na-workspace" class="storyloom-workspace">
    <div class="storyloom-book">
      <label for="na-book">Lorebook for this chat</label>
      <select id="na-book"></select>
      <small id="na-book-status"></small>
      <div class="storyloom-row">
        <button id="na-new" type="button">Create a lorebook</button>
        <button id="na-view-book" type="button" hidden>View entries</button>
        <button id="na-use-title" type="button" hidden>Use novel title for lorebook</button>
        <label id="na-chapter-label" class="storyloom-chapter" hidden>Now on <select id="na-chapter"></select></label>
        <button id="na-profiles" type="button" hidden title="Writes a full entry (history, personality, motivation, arc…) for every person in the cast list. Existing profiles are rewritten.">Write character profiles</button>
      </div>
    </div>
    <details class="storyloom-reference">
      <summary>Reference &amp; characters</summary><p class="storyloom-hint">Use another lorebook — say, an earlier book in a series or a world you already built — as source material. Storyloom reads it for ideas and to copy characters from. It only ever changes it if you choose “Keep in sync” for a character.</p>
      <label for="na-reference">Reference lorebook</label><select id="na-reference"></select>
      <div id="na-reference-actions" hidden>
        <button id="na-import-character" type="button">Copy a character into this novel</button>
        <p class="storyloom-hint">Type a character’s name, then choose: <b>Just copy</b> — the AI writes a fresh character entry for this novel from what the reference says (the two copies are separate afterwards); or <b>Keep in sync</b> — the entry is copied exactly, a shared “Shared — … ↔ …” lorebook is made for it, and editing any copy updates the others.</p>
        <button id="na-link-character" type="button">Attach reference to this character card</button>
        <p class="storyloom-hint">Different thing: attaches the whole reference lorebook to the SillyTavern character you’re chatting with, so that character knows it in all their chats. Nothing is copied into the novel.</p>
      </div>
      <div id="na-links-area" hidden><strong class="storyloom-links-title">Linked characters</strong><ul id="na-links" class="storyloom-links"></ul></div>
    </details>
    <button id="na-resume-chat" type="button" hidden>Resume Storyloom chat</button>
    <button id="na-start-new-chat" type="button" hidden>Start a new novel</button>
    <div id="na-welcome" class="storyloom-welcome"><span class="storyloom-eyebrow">A SPACE FOR YOUR NEXT STORY</span><h2>Let’s make something<br><em>worth getting lost in.</em></h2><p>Start with a little or a lot. I’ll help you bring the story together.</p><div class="storyloom-rule"></div><span class="storyloom-choice-label">HOW WOULD YOU LIKE TO BEGIN?</span></div>
    <label id="na-template-label" class="storyloom-template-pick">Template <select id="na-template"></select></label>
    <div id="na-mode-choices" class="storyloom-mode-grid">
      <button id="na-simple" type="button" class="storyloom-mode"><span class="storyloom-mode-icon" aria-hidden="true">✦</span><strong>Simple</strong><small>Answer what you like. I’ll fill in the rest.</small><span class="storyloom-arrow" aria-hidden="true">↗</span></button>
      <button id="na-deep" type="button" class="storyloom-mode"><span class="storyloom-mode-icon" aria-hidden="true">◇</span><strong>Deep</strong><small>Explore each part together, at your pace.</small><span class="storyloom-arrow" aria-hidden="true">↗</span></button>
    </div>
    <section id="na-progress" class="storyloom-question"><span id="na-step-label" class="storyloom-eyebrow"></span><p id="na-question"></p></section>
    <div id="na-messages" role="log" aria-live="polite" aria-label="Storyloom conversation"></div>
    <div id="na-interview-controls" class="storyloom-flow"><button id="na-skip" type="button">Skip for now <span aria-hidden="true">→</span></button><button id="na-next" type="button">Next topic <span aria-hidden="true">→</span></button><button id="na-outline" type="button">Create outline <span aria-hidden="true">→</span></button></div>
    <div id="na-composer" class="storyloom-composer"><label class="storyloom-sr-only" for="na-input">Message Storyloom</label><textarea id="na-input" placeholder="Tell me what you’re thinking…"></textarea><div class="storyloom-compose-footer"><span>YOUR STORY, YOUR WAY</span><button id="na-send" type="button">Send <span aria-hidden="true">↗</span></button></div></div>
    </div>
    <div class="storyloom-feedback"><div id="na-status" role="status" aria-live="polite"></div><button id="na-cancel-model" type="button" hidden>Stop</button></div>`;
  document.body.append(panel);
  for(const [id,tip] of Object.entries(TIPS)){const el=panel.querySelector('#'+id);if(el)el.title=tip;}
  panel.addEventListener('click',event=>{const b=event.target.closest('button');if(b && b.id!=='na-cancel-model')lastAction=b.textContent.replace(/[↗→⌄×]/g,'').trim()||b.getAttribute('aria-label')||'';},true);
  panel.addEventListener('change',event=>{const l=event.target.closest('label')?.childNodes[0]?.textContent?.trim();const f=event.target.id==='na-book'?'Lorebook for this chat':event.target.id==='na-reference'?'Reference lorebook':l;if(f)lastAction=f;},true);
  for(const provider of PROVIDERS)panel.querySelector('#na-provider').add(new Option(provider.name,provider.id));
  panel.querySelector('#na-close').onclick=()=>{panel.hidden=true;settingsOpen=false;};
  panel.querySelector('#na-settings-toggle').onclick=()=>{settingsOpen=!settingsOpen;renderPanelView();};
  panel.querySelector('#na-back').onclick=()=>{atStart=!atStart;settingsOpen=false;renderInterview();renderPanelView();};
  panel.querySelector('#na-resume-chat').onclick=()=>{atStart=false;renderInterview();renderPanelView();};
  const startNewNovel=async()=>{
    const button=panel.querySelector('#na-start-new-chat');
    try {
      requireIdle();
      const previous=context().chatId;
      button.disabled=true;
      status('Opening a new SillyTavern chat…');
      await doNewChat();
      if(context().chatId===previous)throw Error('SillyTavern could not open a new chat. Close any character editor or stop the main chat’s generation, then try again.');
      atStart=false;
      settingsOpen=false;
      options();
      status('New novel ready. Choose Simple or Deep to start with a fresh lorebook, or select an existing one.');
    } catch(error) {fail(error);}
    finally {button.disabled=false;}
  };
  panel.querySelector('#na-start-new-chat').onclick=startNewNovel;
  panel.querySelector('#na-cancel-model').onclick=()=>modelController?.abort();
  panel.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    event.stopPropagation();
    if(settingsOpen){settingsOpen=false;renderPanelView();}else panel.hidden=true;
  });
  panel.querySelector('#na-retry').onclick=async()=>{try{await flushContinuity(); const d=data(); delete d.queueError; await persist(); status('Pending updates ready to retry.');scheduleDrain();}catch(e){fail(e)}};
  for(const [id,choice] of [['na-use-book','book'],['na-use-note','note']]) panel.querySelector('#'+id).onclick=async()=>{try{if(await context().Popup.show.confirm('Resolve directive difference?', 'Use the selected version for both the lorebook and Author’s Note?'))await resolveDirective(choice);}catch(e){fail(e)}};
  panel.querySelector('#na-resume').onclick=async()=>{try{const d=data(); if(!d.review){status('Tracking is not paused.');return;} if(!await context().Popup.show.confirm('Resume tracking?', 'Confirm that you reviewed the changed chat and affected lore. Stale queued updates will be discarded.'))return; const c=context(); d.pending=(d.pending||[]).filter(j=>c.chat[j.index]?.mes===j.raw && (j.previous===undefined || c.chat[j.index-1]?.mes===j.previous)); delete d.review; d.processed=[]; await persist(); status('Tracking resumed.'); scheduleDrain();}catch(e){fail(e)}};
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
  }catch(e){fail(e)}finally{if(ownsLock){syncing=false;queueSync();scheduleDrain()}}};
  panel.querySelector('#na-attach').onclick=async()=>{try {
    requireIdle(); const c=context(), name=data().book || c.chatMetadata.world_info; if(!name) throw Error('Choose a lorebook first.');
    if(await attachBook(name,c)){options();status('Lorebook linked to this chat.');}
  }catch(e){fail(e)}};
  panel.querySelector('#na-setup').onclick=async()=>{try{await setupNovel();}catch(e){fail(e)}};
  document.getElementById('extension_floating_prompt')?.addEventListener('input',queueSync);
  panel.querySelector('#na-book').onchange=async e=>{try{
    requireIdle();const c=context(),name=e.target.value,current=data();
    if(!name) {
      if(current.interview || current.directive) {
        if(!await c.Popup.show.confirm('Start a new novel?', 'Each chat holds one novel, and this chat already has one. Storyloom will open a new chat with the same character, where your new novel gets its own lorebook. This novel stays safe in this chat.')){options();return;}
        await startNewNovel();return;
      }
      root().newBookRequested=true;await persist();options();status('Choose Simple or Deep to start. A new lorebook will be created for this novel.');return;
    }
    delete root().newBookRequested;
    if(current.directive && current.book!==name)throw Error('This chat already has a linked writing directive. Open a different chat for another novel.');
    if(!await attachBook(name,c)){options();return;}
    changeBook(name);await persist();options();status('Lorebook linked to this chat.');
  }catch(err){options();fail(err)}};
  for (const [id,field] of [['na-reference','reference'],['na-profile','profile']]) panel.querySelector('#'+id).onchange=async e=>{try{
    requireIdle();const d=data(),value=e.target.value;
    if(field==='profile' && value==='__direct__' && !d.direct){
      const c=context(), current=c.chatCompletionSettings?.chat_completion_source;
      const provider=PROVIDERS.some(x=>x.id===current)?current:'custom';
      d.direct={provider,model:c.mainApi==='openai'?(c.getChatCompletionModel?.()||''):'',url:provider==='custom'?(c.chatCompletionSettings?.custom_url||''):'',keyId:''};
    }
    d[field]=value;await persist();options();if(field==='profile' && value==='__direct__')await refreshKeys();
  }catch(err){options();fail(err)}};
  panel.querySelector('#na-import-character').onclick=async()=>{try {
    requireIdle();const c=context(),d=data(),chatId=c.chatId,source=d.reference,target=d.book;
    if(!target || c.chatMetadata.world_info!==target)throw Error('Link this novel’s lorebook to the current chat first.');
    if(!source)throw Error('Choose a reference lorebook first.');
    const person=(await c.Popup.show.input('Copy a character', `Which character from “${source}”?`))?.trim();if(!person)return;
    const choice=await c.Popup.show.confirm('Keep them in sync?',`<p><b>Just copy</b>: the AI writes a fresh entry for “${person}” in this novel. Afterwards the two are separate.</p><p><b>Keep in sync</b>: the entry is copied exactly, a shared lorebook is made for it, and editing it in either book updates the other.</p>`,{okButton:'Keep in sync',cancelButton:'Just copy'});
    if(choice===null || choice===undefined)return;
    if(context().chatId!==chatId || data()!==d || d.reference!==source)throw Error('Chat or reference changed; nothing was copied.');
    if(choice) {await linkCharacter(person,source,target);return;}
    const task=characterImportRequest(person,source);
    const result=await interact(task.request,false,null,null,null,false,{silentUser:true,requiredCharacterTitle:task.title,sourceCharacter:task.name,sourceOnly:true,guidance:'Return exactly the requested novel character entry using only the supplied reference material. Do not create chatbot cards.'});
    requiredCharacterUpdate(result,task.title);
    options();status(`${task.title} saved in this novel’s lorebook (${target}). The reference lorebook was not changed.`);
  }catch(e){fail(e)}};
  /** Exact copy into the novel + a shared link lorebook, registered for syncing. */
  const linkCharacter=async(person,source,target)=>{
    requireIdle(); syncing=true;
    try {
      const c=context(), ref=await freshBook(source), want=person.toLocaleLowerCase();
      const candidates=Object.values(ref.entries||{}).filter(e=>{const t=String(e.comment||'').trim().toLocaleLowerCase();return t===want || t===`character — ${want}` || t===`character - ${want}`;});
      const fallback=candidates.length?candidates:Object.values(ref.entries||{}).filter(e=>(e.key||[]).some(k=>String(k).toLocaleLowerCase()===want));
      if(fallback.length!==1)throw Error(fallback.length?`“${source}” has ${fallback.length} entries for “${person}”. Rename them so the title matches exactly one.`:`No entry titled “${person}” (or with “${person}” as a keyword) in “${source}”. Use the entry’s exact title.`);
      const original=fallback[0], title=String(original.comment).trim();
      if(storedLinks().some(l=>l.title.toLocaleLowerCase()===title.toLocaleLowerCase() && l.books.includes(source) && l.books.includes(target)))throw Error(`“${title}” is already synced between these books.`);
      const shared=linkBookName(source,target);
      const books={[target]:await freshBook(target)};
      if(findCharacterEntry(books[target],title))throw Error(`This novel already has an entry called “${title}”. Rename or delete it first.`);
      if(!c.getWorldInfoNames().includes(shared) && !await createNewWorldInfo(shared))throw Error(`Could not create the shared lorebook “${shared}”.`);
      books[shared]=await freshBook(shared);
      if(findCharacterEntry(books[shared],title))throw Error(`“${shared}” already has an entry called “${title}”.`);
      for(const [name,book] of Object.entries(books)) {
        const entry=createWorldInfoEntry(name,book); if(!entry)throw Error(`Could not add “${title}” to “${name}”.`);
        const {uid,...props}=structuredClone(original); Object.assign(entry,props);
        await c.saveWorldInfo(name,book,true);
        if(!findCharacterEntry(await freshBook(name),title))throw Error(`Saving “${title}” to “${name}” could not be verified.`);
      }
      storedLinks().push({id:crypto.randomUUID(),title,books:[source,target,shared],base:linkValue(original),conflict:null,missing:[]});
      c.saveSettingsDebounced();
      renderLinks();
      status(`“${title}” is now in this novel and in “${shared}”. Edit it in any of the three books and the others follow.`);
    } finally {syncing=false;queueSync();scheduleDrain();}
  };
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
  }catch(e){fail(e)}};
  panel.querySelector('#na-provider').onchange=async e=>{try{requireIdle();const d=data();d.direct={...(d.direct||{}),provider:e.target.value,keyId:'',model:'',url:'',sessionRequired:false};sessionKey=null;panel.querySelector('#na-session-key').value='';await persist();options();await refreshKeys();}catch(err){options();fail(err)}};
  for(const [id,field] of [['na-model','model'],['na-direct-url','url'],['na-key','keyId']])panel.querySelector('#'+id).onchange=async e=>{try{requireIdle();const d=data();d.direct ??={provider:'custom'};d.direct[field]=e.target.value;if(field==='keyId'){d.direct.sessionRequired=false;sessionKey=null;panel.querySelector('#na-session-key').value='';}await persist();}catch(err){options();fail(err)}};
  panel.querySelector('#na-session-key').onchange=async e=>{try{requireIdle();const d=data();const value=e.target.value;sessionKey=value?{chatId:context().chatId,book:d.book,value}:null;d.direct.sessionRequired=!!value;if(value)d.direct.keyId='';await persist();}catch(err){e.target.value='';sessionKey=null;fail(err)}};
  panel.querySelector('#na-refresh-keys').onclick=()=>refreshKeys().catch(e=>fail(e));
  panel.querySelector('#na-load-models').onclick=async()=>{try{requireIdle();const d=data(),c=context(),snapshot=directSnapshot(d,c),provider=snapshot?.provider;status('Finding models…');const models=await readModels(fetch,c.getRequestHeaders(),snapshot);if(data()!==d || d.direct?.provider!==provider)throw Error('Connection changed while loading models.');const list=panel.querySelector('#na-model-list');list.replaceChildren(...models.map(x=>new Option(x,x)));status(models.length?`Found ${models.length} models. Choose or type one.`:'No models returned. Enter a model name.');}catch(e){fail(e)}};
  panel.querySelector('#na-tokens').onchange=async e=>{try{requireIdle();const n=Number(e.target.value);if(!Number.isInteger(n)||n<256||n>16000)throw Error('Response budget must be between 256 and 16000 tokens.');data().responseTokens=n;await persist();}catch(err){options();fail(err)}};
  panel.querySelector('#na-watch').onchange=async e=>{try{const d=data();d.watch=e.target.checked;if(d.watch && changedProcessed(d.processed||[],context().chat||[])){d.review={reason:'Tracked chat changed while tracking was off.'};status('Tracked chat changed. Review the lore before resuming.');}await persist();if(d.watch)scheduleDrain();}catch(err){fail(err)}};
  panel.querySelector('#na-view-book').onclick=()=>{
    try {
      const c=context(), name=data().book || c.chatMetadata.world_info;
      if(!name || !c.getWorldInfoNames().includes(name))throw Error('The selected lorebook is unavailable.');
      openWorldInfoEditor(name);
      panel.hidden=true;
    } catch(error) {fail(error);}
  };
  panel.querySelector('#na-use-title').onclick=async()=>{
    try {
      status('Naming the lorebook…');
      const message=await nameFinishedLorebook(data());
      options();
      status(message.trim() || `Set a title in ${tpl().summary.title} first.`);
    } catch(error) {fail(error);}
  };
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
  }catch(e){fail(e)}};
  panel.querySelector('#na-profiles').onclick=()=>writeProfiles();
  panel.querySelector('#na-template-edit').onchange=()=>showTemplateText();
  panel.querySelector('#na-template-save').onclick=()=>{try{saveTemplate(false);}catch(e){fail(e);}};
  panel.querySelector('#na-template-copy').onclick=()=>{try{saveTemplate(true);}catch(e){fail(e);}};
  panel.querySelector('#na-template-delete').onclick=async()=>{try{
    const name=panel.querySelector('#na-template-edit').value, list=storedTemplates();
    const i=list.findIndex(x=>{try{return parseTemplate(x).name===name}catch{return false}});
    if(i<0)throw Error('Built-in templates can’t be deleted.');
    if(!await context().Popup.show.confirm('Delete template?',`Delete the template “${name}”? Novels already started with it keep working.`))return;
    list.splice(i,1);context().saveSettingsDebounced();panel.querySelector('#na-template-edit').value=NOVEL.name;renderTemplates(data());status(`Template “${name}” deleted.`);
  }catch(e){fail(e);}};
  panel.querySelector('#na-chapter').onchange=async e=>{try{const n=Number(e.target.value);status('Moving to chapter '+n+'…');await organizeBook(n);options();status(`Now on Chapter ${n}. The main chat gets this chapter’s plan, and the writing directive says Chapter ${n}.`);}catch(err){options();fail(err,'Now on chapter');}};
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
    } catch(e){fail(e)}
  };
  const c=context();
  c.eventSource.on(c.event_types.WORLDINFO_UPDATED,queueSync);
  c.eventSource.on(c.event_types.WORLDINFO_UPDATED,name=>{if(linkRunning)return;clearTimeout(linkTimer);linkTimer=setTimeout(()=>syncLinks(typeof name==='string'?name:null),1000);});
  setTimeout(()=>{if(storedLinks().length)syncLinks();},4000);
  c.eventSource.on(c.event_types.CHAT_CHANGED,()=>{modelController?.abort();atStart=false;settingsOpen=false;sessionKey=null;panel.querySelector('#na-session-key').value='';if(!panel.hidden){try{options();status('')}catch{panel.hidden=true}} queueSync(); scheduleDrain();});
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

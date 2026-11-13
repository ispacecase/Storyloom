import { doNewChat } from '../../../../script.js';
import { createWorldInfoEntry, createNewWorldInfo, deleteWorldInfo, openWorldInfoEditor, showWorldEditor } from '../../../world-info.js';
import { parseAssistant, toBlocks, planWrites, readDirective, replaceDirective } from './operations.mjs';
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
import { PROMPT_DEFAULTS, setPromptOverrides } from './prompt-texts.mjs';
import { PROVIDERS, readKeyOptions, readModels } from './providers.mjs';
import { castNames, characterProfilesInstruction, validateCharacters, characterTitle, splitExtraCast } from './characters.mjs';
import { layoutBook, chapterList, directiveForChapter } from './lorebook-layout.mjs';
import { assistantSystem, parseActions, applyAction, describeAction, formatSnapshot, needsCompaction, compactionPrompt } from './assistant.mjs';
import { downloadDocs, chunkMarkdown, indexChunks, searchDocsMany, searchTermsPrompt, parseSearchTerms, vectorSource } from './docs-rag.mjs';
import { MEMORY_ITEMS, WHERE, CHAT_START_DEPTH, memoryKey, injection, transcriptOf, chapterEndInstruction, summaryTitle, mergeCurrentState } from './memory.mjs';
import { planLinkSync, resolveLink, linkBookName, findCharacterEntry, linksFor } from './links.mjs';
import { NOVEL, BUILT_IN, templateToText, parseTemplate, requiredOf } from './templates.mjs';
import { requiredTitles, reviewInstruction, REVIEW_PROTECTED } from './interview.mjs';
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
  'na-prompt-key':'Pick which part of Storyloom’s instructions to the AI you want to see or change.',
  'na-prompt-save':'Use your wording for this part from the next request on.',
  'na-prompt-reset':'Go back to Storyloom’s original wording for this part.',
  'na-template':'What kind of project this is. It decides the questions and the lorebook entries. Edit or add templates in Settings → Templates.',
  'na-template-edit':'Pick a template to view or edit.',
  'na-template-save':'Save your changes to this template (your own templates only).',
  'na-template-copy':'Save the text below as a new template, using the Name line as its name.',
  'na-template-delete':'Delete this template (your own templates only).',
  'na-review':'Has the AI re-read the whole plan without the template in front of it. It only changes something if the story clearly needs it — a missing entry or heading, or something that doesn’t belong — and says why. Usually it changes nothing.',
  'na-tab-story':'Plan and organise your story.',
  'na-tab-assistant':'Ask about SillyTavern and your setup. It reads your live settings and the SillyTavern docs, and can suggest lorebook changes you apply yourself.',
  'na-docs-update':'Download the newest SillyTavern docs from GitHub and re-index them.',
  'na-assistant-new':'Clear this conversation and its summary. Applied changes stay.',
  'na-assistant-send':'Send your question (Ctrl+Enter).',
  'na-tab-memory':'What the story chat remembers between chapters, and where it goes in the prompt. Also where you finish a chapter.',
  'na-finish-chapter':'Summarise this chapter’s chat, update Story so far, move to the next chapter and open a fresh chat with everything carried over.',
  'na-update':'A newer Storyloom is on GitHub. Click to install it and reload SillyTavern; your novels and settings stay as they are.',
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
  renderPromptEditor();
  renderLinks();
  renderSuggestions();
  showMessages();
  renderInterview();
  renderPanelView();
  const list=document.getElementById('na-history'); list.replaceChildren();
  document.getElementById('na-history-empty').hidden=!!d.history?.length;
  document.getElementById('na-profiles').hidden=d.interview?.phase!=='done';
  document.getElementById('na-review').hidden=d.interview?.phase!=='done';
  renderChapters(d);
  loadChapters(d).catch(e=>console.warn('Storyloom chapters:',e));
  for(const item of [...(d.history||[])].reverse()){const li=document.createElement('li');li.textContent=describeChange(item);list.append(li);}
  if(d.pendingContinuity)status('A saved draft is waiting for a continuity update. Retry it in settings.');
  else if(d.review)status('A previously processed chat message changed. Review your lore, then resume tracking in settings.');
}
function storedPrompts() {
  const c=context(); c.extensionSettings.storyloom ??= {}; c.extensionSettings.storyloom.prompts ??= {};
  return c.extensionSettings.storyloom.prompts;
}
function renderPromptEditor() {
  const select=document.getElementById('na-prompt-key'); if(!select)return;
  if(!select.options.length)for(const [key,p] of Object.entries(PROMPT_DEFAULTS))select.add(new Option(p.label,key));
  const key=select.value||Object.keys(PROMPT_DEFAULTS)[0], saved=storedPrompts()[key];
  document.getElementById('na-prompt-text').value=saved||PROMPT_DEFAULTS[key].text;
  document.getElementById('na-prompt-locked').textContent=(saved?'Edited. ':'Default. ')+PROMPT_DEFAULTS[key].locked;
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
/** Extras the model proposed: shown for the author to approve or skip; nothing is saved until approved. */
function renderSuggestions() {
  const box=document.getElementById('na-suggestions'); if(!box)return;
  let d; try{d=data();}catch{box.hidden=true;return;}
  const list=d.suggestions||[];
  box.hidden=!list.length;
  box.querySelector('.storyloom-sugg-count').textContent=String(list.length);
  const ul=box.querySelector('ul'); ul.replaceChildren();
  for(const sug of list) {
    const li=document.createElement('li');
    const head=document.createElement('div'); head.className='storyloom-sugg-head';
    const name=document.createElement('strong'); name.textContent=sug.title;
    const kind=document.createElement('span'); kind.className='storyloom-sugg-kind'; kind.textContent=sug.kind==='change'?'change to existing entry':'new entry';
    head.append(name,kind);
    // Shown directly, not behind a click: the reason and the exact text are what the writer decides on.
    const whyLabel=document.createElement('div'); whyLabel.className='storyloom-sugg-label'; whyLabel.textContent='Why';
    const why=document.createElement('p'); why.className='storyloom-sugg-why'; why.textContent=sug.reason||'(no reason given)';
    const whatLabel=document.createElement('div'); whatLabel.className='storyloom-sugg-label'; whatLabel.textContent=`What it would save (${(String(sug.content).match(/\S+/g)||[]).length} words)`;
    const what=document.createElement('pre'); what.textContent=`KEYS: ${(sug.keys||[]).join(', ')}\n\n${sug.content}`;
    const err=document.createElement('small'); err.className='storyloom-action-error'; err.hidden=true;
    const row=document.createElement('div'); row.className='storyloom-row';
    const ok=document.createElement('button'); ok.type='button'; ok.textContent='Approve'; ok.title='Save this to the lorebook. You can undo it afterwards in Settings → More options.';
    ok.onclick=async()=>{lastAction='Approve';ok.disabled=true;ok.textContent='Saving…';err.hidden=true;try{await applySuggestion(sug.id);}catch(e){ok.disabled=false;ok.textContent='Approve';err.textContent=`Not saved: ${e.message}`;err.hidden=false;fail(e);}};
    const no=document.createElement('button'); no.type='button'; no.textContent='Skip'; no.title='Throw this suggestion away. Nothing is saved.'; no.onclick=async()=>{lastAction='Skip';try{d.suggestions=d.suggestions.filter(x=>x.id!==sug.id);await persist();renderSuggestions();status(`Skipped “${sug.title}”.`);}catch(e){fail(e);}};
    row.append(ok,no);
    li.append(head,whyLabel,why,whatLabel,what,row,err); ul.append(li);
  }
}
async function applySuggestion(id) {
  requireIdle();
  const c=context(), d=data(), sug=(d.suggestions||[]).find(x=>x.id===id); if(!sug)return;
  if(!d.book || c.chatMetadata.world_info!==d.book)throw Error('Link this novel’s lorebook to the current chat first.');
  syncing=true;
  try {
    const before=await freshBook(d.book), fresh=structuredClone(before);
    const t=tpl(d);
    const [w]=planWrites(fresh,[{title:sug.title,content:sug.content,keys:sug.keys}],{...t.summary,required:requiredOf(t.summary,true)});
    const entry=w.uid===null?createWorldInfoEntry(d.book,fresh):fresh.entries[w.uid];
    if(!entry)throw Error('Could not create the entry.');
    entry.comment=w.update.title.trim(); entry.content=w.update.content; entry.key=w.update.keys;
    if(JSON.stringify(await freshBook(d.book))!==JSON.stringify(before))throw Error('The lorebook changed; try again.');
    await c.saveWorldInfo(d.book,fresh,true);
    if(JSON.stringify(await freshBook(d.book))!==JSON.stringify(fresh))throw Error('The save could not be verified.');
    d.history ??= []; d.history.push({id:crypto.randomUUID(),book:d.book,changes:buildChange(before,fresh),source:'approved suggestion',at:new Date().toISOString()}); if(d.history.length>30)d.history.shift();
    d.suggestions=d.suggestions.filter(x=>x.id!==id);
    await persist();
  } finally {syncing=false;queueSync();scheduleDrain();}
  renderSuggestions(); options();
  status(`Saved “${sug.title}”.`);
  if(sug.title.toLocaleLowerCase()===tpl(d).cast.toLocaleLowerCase())await writeProfiles('',{onlyMissing:true});
  else try{await organizeBook();}catch(e){console.warn('Storyloom layout:',e);}
}
/* ---------- Assistant tab ---------- */
let activeTab='story', assistantBusy=false, docsChunks=null;
const DOCS_CACHE='storyloom-docs-v1', DOCS_MAX_AGE=14*24*3600*1000;
function assistantState() {
  const c=context(); c.extensionSettings.storyloom ??= {};
  return c.extensionSettings.storyloom.assistant ??= {messages:[],summary:''};
}
function saveAssistant() {context().saveSettingsDebounced();}
function docsIndexState() {const c=context(); c.extensionSettings.storyloom ??= {}; return c.extensionSettings.storyloom.docsIndex ??= {};}
function readDocsCache() {try{const v=JSON.parse(localStorage.getItem(DOCS_CACHE)||'null');return v?.chunks?.length?v:null;}catch{return null;}}
function docsLabel(text) {const el=document.getElementById('na-docs-status'); if(el)el.textContent=text;}
function renderDocsStatus() {
  const cache=readDocsCache(), idx=docsIndexState(), src=vectorSource(context().extensionSettings.vectors);
  if(!cache){docsLabel('SillyTavern docs: not downloaded yet (they download on your first question).');return;}
  const age=Math.round((Date.now()-cache.at)/86400000);
  const how=src && idx.source===src.source && idx.count===cache.chunks.length ? `searched by meaning (${src.source})` : src ? 'searched by keywords until indexing finishes' : 'searched by keywords (no embedding source set in Vector Storage)';
  docsLabel(`SillyTavern docs: ${cache.chunks.length.toLocaleString()} sections, ${age?`${age} day${age===1?'':'s'} old`:'downloaded today'}, ${how}.`);
}
/** Download, cache and index the docs when missing, stale or forced. Returns the chunks. */
async function ensureDocs({force=false}={}) {
  let cache=readDocsCache();
  if(force || !cache || Date.now()-cache.at>DOCS_MAX_AGE) {
    docsLabel('Downloading SillyTavern docs from GitHub…');
    const pages=await downloadDocs(fetch,(done,total)=>docsLabel(`Downloading SillyTavern docs… ${done} of ${total} pages`));
    if(!pages.length)throw Error('Could not download the SillyTavern docs from GitHub.');
    const chunks=pages.flatMap(p=>chunkMarkdown(p.path,p.text));
    cache={at:Date.now(),chunks};
    try{localStorage.setItem(DOCS_CACHE,JSON.stringify(cache));}catch(e){console.warn('Storyloom: docs cache not saved (browser storage full); keeping them in memory.',e);}
  }
  docsChunks=cache.chunks;
  const c=context(), src=vectorSource(c.extensionSettings.vectors), idx=docsIndexState();
  if(src && (force || idx.source!==src.source || idx.model!==src.model || idx.count!==cache.chunks.length || idx.at<cache.at)) {
    try {
      docsLabel('Indexing the docs for search by meaning…');
      const r=await indexChunks({fetchFn:fetch,headers:c.getRequestHeaders(),source:src,chunks:cache.chunks,onProgress:(done,total)=>docsLabel(`Indexing the docs for search by meaning… ${done} of ${total}`)});
      Object.assign(idx,{source:src.source,model:src.model,count:r.total,at:Date.now()}); saveAssistant();
    } catch(e) {console.warn('Storyloom docs indexing:',e); docsLabel(`Could not index the docs by meaning (${e.message}); using keyword search.`); return cache.chunks;}
  }
  renderDocsStatus();
  return cache.chunks;
}
async function gatherSnapshot(question) {
  const c=context(), wi=await import('../../../world-info.js'), oai=c.chatCompletionSettings||{};
  const order=(oai.prompt_order||[]).find(o=>Number(o.character_id)===100001)?.order || [];
  const byId=Object.fromEntries((oai.prompts||[]).map(p=>[p.identifier,p]));
  const prompts=order.map(o=>({name:byId[o.identifier]?.name||o.identifier,enabled:!!o.enabled,content:byId[o.identifier]?.marker?'':String(byId[o.identifier]?.content||'')}));
  const card=c.characters?.[c.characterId];
  const chatLorebook=c.chatMetadata?.world_info||'';
  let entries=[], entryTexts=[];
  if(chatLorebook && c.getWorldInfoNames().includes(chatLorebook)) {
    const book=await freshBook(chatLorebook);
    entries=Object.values(book.entries||{});
    const picked=selectLore(entries.map(e=>({title:e.comment,content:e.content,keys:e.key||[]})),question,6000).entries;
    entryTexts=picked.slice(0,5).map(e=>({comment:e.title,content:e.content}));
  }
  let novel='';
  try{const d=data(); if(d.book)novel=`lorebook “${d.book}”, template ${tpl(d).name}, ${d.interview?.phase==='done'?`planned, now on ${tpl(d).unit} ${d.chapter||1}`:`planning (${d.interview?.phase||'not started'})`}`;}catch{}
  const md=c.chatMetadata||{};
  return formatSnapshot({
    character:card?{name:card.name,description:String(card.description||card.data?.description||''),lorebook:card.data?.extensions?.world||''}:null,
    chatLorebook,globalLorebooks:[...(wi.selected_world_info||[])],allLorebooks:c.getWorldInfoNames(),
    worldInfo:{depth:wi.world_info_depth,budget:wi.world_info_budget,recursive:wi.world_info_recursive,caseSensitive:wi.world_info_case_sensitive,wholeWords:wi.world_info_match_whole_words},
    vectors:c.extensionSettings.vectors||null,prompts,
    authorsNote:{text:String(md.note_prompt||''),position:md.note_position,depth:md.note_depth,role:md.note_role},
    connection:c.mainApi==='openai'?`${oai.chat_completion_source} / ${c.getChatCompletionModel?.()||'?'}`:c.mainApi,
    novel,entries,entryTexts,
  });
}
function renderAssistant() {
  const log=document.getElementById('na-assistant-log'); if(!log)return;
  const st=assistantState();
  log.replaceChildren();
  if(!st.messages.length){const p=document.createElement('p');p.className='storyloom-hint';p.textContent='Ask anything about SillyTavern or your setup — “why isn’t Ruth’s entry showing up?”, “where should a recap go?”, “what does sticky do?”. It reads your live settings and the SillyTavern docs. Lorebook changes it suggests show up as cards you apply yourself.';log.append(p);}
  st.messages.forEach((m,mi)=>{
    const bubble=document.createElement('article'); bubble.className=m.role==='user'?'storyloom-message is-user':'storyloom-message is-assistant';
    const label=document.createElement('strong'); label.textContent=m.role==='user'?'YOU':'ASSISTANT';
    const text=document.createElement('div'); text.textContent=m.content; bubble.append(label,text);
    if(m.sources?.length){const s=document.createElement('small');s.className='storyloom-sources';s.textContent=`Docs (by ${m.method||'keywords'}): ${m.sources.join(' · ')}`;bubble.append(s);}
    for(const a of m.actions||[]) {
      const card=document.createElement('div'); card.className='storyloom-action is-'+a.status;
      const d=document.createElement('div'); d.textContent=describeAction(a); card.append(d);
      if(a.content){const det=document.createElement('details');det.innerHTML='<summary>Text</summary>';const pre=document.createElement('pre');pre.textContent=a.content;det.append(pre);card.append(det);}
      if(a.error){const e=document.createElement('small');e.className='storyloom-action-error';e.textContent=a.error;card.append(e);}
      const row=document.createElement('div'); row.className='storyloom-row';
      if(a.status==='applied'){const u=document.createElement('button');u.type='button';u.textContent='Undo';u.title='Put this entry back exactly as it was before you applied the card.';u.onclick=()=>{lastAction='Undo';undoAssistantAction(mi,a.id).catch(fail);};row.append(Object.assign(document.createElement('span'),{textContent:'Applied ✓ '}),u);}
      else if(a.status==='undone')row.append(Object.assign(document.createElement('span'),{textContent:'Undone'}));
      else {const ap=document.createElement('button');ap.type='button';ap.textContent='Apply';ap.title='Make exactly this change in the lorebook. You can undo it.';ap.onclick=()=>{lastAction='Apply';applyAssistantAction(mi,a.id).catch(fail);};const sk=document.createElement('button');sk.type='button';sk.textContent='Dismiss';sk.onclick=()=>{a.status='dismissed';saveAssistant();renderAssistant();};row.append(ap,sk);}
      if(a.status!=='dismissed'){card.append(row);bubble.append(card);}
    }
    log.append(bubble);
  });
  log.scrollTop=log.scrollHeight;
}
async function applyAssistantAction(mi,id) {
  const st=assistantState(), a=st.messages[mi]?.actions?.find(x=>x.id===id); if(!a)return;
  requireIdle(); syncing=true;
  try {
    const c=context();
    if(!c.getWorldInfoNames().includes(a.book))throw Error(`There is no lorebook called “${a.book}”.`);
    const before=await freshBook(a.book);
    const {book,uid}=applyAction(before,a,b=>createWorldInfoEntry(a.book,b));
    await c.saveWorldInfo(a.book,book,true);
    if(JSON.stringify(await freshBook(a.book))!==JSON.stringify(book))throw Error('The save could not be verified; check the lorebook.');
    a.status='applied'; a.error=''; a.undo={uid,before:before.entries?.[uid]??null,after:book.entries[uid]};
    saveAssistant(); renderAssistant(); status(`Applied: ${describeAction(a)}`);
  } catch(e) {a.error=e.message; saveAssistant(); renderAssistant(); throw e;}
  finally {syncing=false;queueSync();}
}
async function undoAssistantAction(mi,id) {
  const st=assistantState(), a=st.messages[mi]?.actions?.find(x=>x.id===id); if(!a?.undo)return;
  requireIdle(); syncing=true;
  try {
    const c=context(), book=await freshBook(a.book), {uid,before,after}=a.undo;
    if(JSON.stringify(book.entries?.[uid]??null)!==JSON.stringify(after))throw Error(`“${a.title}” was changed after you applied this, so it can’t be undone safely. Edit it in the World Info editor instead.`);
    if(before===null)delete book.entries[uid]; else book.entries[uid]=before;
    await c.saveWorldInfo(a.book,book,true);
    a.status='pending'; delete a.undo; saveAssistant(); renderAssistant(); status(`Undone: ${describeAction(a)}. The card can be applied again.`);
  } finally {syncing=false;queueSync();}
}
async function askAssistant(text) {
  if(assistantBusy)throw Error('The assistant is still answering. Use Stop to cancel it.');
  requireIdle();
  const c=context(), st=assistantState();
  let profile='',direct=null,tokens=12000;
  try{const d=data();profile=d.profile||'';direct=directSnapshot(d,c);tokens=Number(d.responseTokens||12000);}catch{}
  st.messages.push({role:'user',content:text}); saveAssistant(); renderAssistant();
  assistantBusy=true; const controller=new AbortController(); renderModelWork(controller);
  try {
    status('Reading the SillyTavern docs…');
    let results=[],method='keywords';
    try {
      const chunks=await ensureDocs();
      const idx=docsIndexState(), src=vectorSource(c.extensionSettings.vectors);
      const indexed=src && idx.source===src.source && idx.count===chunks.length;
      const prior=st.messages.slice(-3,-1).map(m=>m.content).join(' ').slice(-600);
      // Questions use story words; the docs use SillyTavern's. A short request translates first.
      let terms=[];
      try {status('Working out which SillyTavern features this is about…');terms=parseSearchTerms(await llm(c,searchTermsPrompt(`${prior}\n${text}`.trim()),profile,controller.signal,600,'You map questions to SillyTavern documentation search terms.',direct));}
      catch(e){if(controller.signal.aborted)throw e;console.warn('Storyloom search terms:',e);}
      status('Reading the SillyTavern docs…');
      ({results,method}=await searchDocsMany({fetchFn:fetch,headers:c.getRequestHeaders(),source:indexed?src:null,chunks},[...terms,text],6));
    } catch(e) {console.warn('Storyloom docs:',e); docsLabel(`SillyTavern docs unavailable (${e.message}).`);}
    status('Reading your setup…');
    const snapshot=await gatherSnapshot(text);
    const recent=st.messages.slice(-15,-1).map(m=>`${m.role==='user'?'Writer':'Assistant'}: ${m.content}`).join('\n\n');
    const prompt=`SETUP SNAPSHOT\n${snapshot}\n\nSILLYTAVERN DOCS EXCERPTS (found by ${method})\n${results.map(r=>r.text).join('\n\n---\n\n')||'(none found)'}\n\n${st.summary?`EARLIER CONVERSATION SUMMARY\n${st.summary}\n\n`:''}RECENT CONVERSATION\n${recent||'(this is the first message)'}\n\nWriter: ${text}`;
    status('Waiting for the AI…');
    const raw=await llm(c,prompt,profile,controller.signal,tokens,assistantSystem(),direct);
    const parsed=parseActions(raw);
    st.messages.push({role:'assistant',content:parsed.reply+(parsed.problems.length?`\n\n(Some suggested changes were malformed and left out: ${parsed.problems.join(' ')})`:''),actions:parsed.actions.map(a=>({...a,id:crypto.randomUUID(),status:'pending'})),sources:[...new Set(results.map(r=>r.page).filter(Boolean))].slice(0,6),method});
    saveAssistant(); renderAssistant(); status(parsed.actions.length?`${parsed.actions.length} suggested change${parsed.actions.length===1?'':'s'} below — nothing is changed until you click Apply.`:'');
    const fold=needsCompaction(st.messages);
    if(fold) {
      try {
        status('Tidying up older conversation…');
        st.summary=(await llm(c,compactionPrompt(st.summary,st.messages.slice(0,fold)),profile,controller.signal,2000,'You summarise conversations accurately and briefly.',direct)).trim();
        st.messages=st.messages.slice(fold); saveAssistant(); renderAssistant(); status('');
      } catch(e) {console.warn('Storyloom assistant summary:',e);}
    }
  } finally {assistantBusy=false;renderModelWork(null);}
}
function renderTabs() {
  const panel=document.getElementById('na-panel'); if(!panel)return;
  for(const tab of ['story','memory','assistant'])panel.querySelector('#na-tab-'+tab).classList.toggle('is-active',activeTab===tab);
  panel.querySelector('#na-assistant').hidden=settingsOpen || activeTab!=='assistant';
  panel.querySelector('#na-memory').hidden=settingsOpen || activeTab!=='memory';
  if(activeTab==='memory')renderMemory().catch(fail);
  if(activeTab==='assistant'){renderAssistant();renderDocsStatus();}
}

/* ---------- Memory tab ---------- */
/** Send each memory item into the main chat's prompt with its chosen placement (or clear it). */
async function applyMemory() {
  const c=context();
  let book=null;
  try {const d=data(); if(d.book && c.chatMetadata?.world_info===d.book && c.getWorldInfoNames().includes(d.book))book=await freshBook(d.book);} catch {}
  for(const item of MEMORY_ITEMS) {
    const e=book?findEntry(book,item.title):null;
    const inj=injection(item,e?.content||'',e?.storyloom_memory||item.place);
    c.setExtensionPrompt(memoryKey(item),inj.value,inj.position,inj.depth,false,inj.role);
  }
}
let memoryTimer;
const queueMemory=()=>{clearTimeout(memoryTimer);memoryTimer=setTimeout(()=>applyMemory().catch(e=>console.warn('Storyloom memory:',e)),400);};
/** Save one memory item's text and placement into its (switched-off) lorebook entry. */
async function saveMemoryItem(item,content,place) {
  requireIdle();
  const c=context(), d=data();
  if(!d.book || c.chatMetadata.world_info!==d.book)throw Error('Link this novel’s lorebook to the chat first.');
  syncing=true;
  try {
    const before=await freshBook(d.book), book=structuredClone(before);
    let entry=findEntry(book,item.title);
    if(!entry){entry=createWorldInfoEntry(d.book,book); if(!entry)throw Error('Could not create the memory entry.'); entry.comment=item.title; entry.key=[];}
    if(content!==undefined)entry.content=content;
    if(place)entry.storyloom_memory=place;
    entry.disable=true; entry.constant=false;
    await c.saveWorldInfo(d.book,book,true);
    if(JSON.stringify(await freshBook(d.book))!==JSON.stringify(book))throw Error('The save could not be verified.');
    d.history ??= []; d.history.push({id:crypto.randomUUID(),book:d.book,changes:buildChange(before,book),source:`memory: ${item.label}`,at:new Date().toISOString()}); if(d.history.length>30)d.history.shift();
    await persist();
  } finally {syncing=false;queueSync();}
  await applyMemory();
}
async function renderMemory() {
  const root_=document.getElementById('na-memory'); if(!root_ || root_.hidden)return;
  let d=null,book=null;
  try{d=data(); if(d.book && context().getWorldInfoNames().includes(d.book))book=await freshBook(d.book);}catch{}
  const ready=!!(d?.book && d.interview?.phase==='done');
  root_.querySelector('#na-memory-empty').hidden=ready;
  root_.querySelector('#na-memory-items').hidden=!ready;
  root_.querySelector('#na-finish-area').hidden=!ready;
  if(!ready)return;
  // Books arranged before the Memory tab still send Current Chapter through the lorebook: re-arrange once.
  const cc=book?findEntry(book,'Current Chapter'):null;
  if(cc && !cc.disable){try{await organizeBook();book=await freshBook(d.book);}catch(e){console.warn('Storyloom layout:',e);}}
  const t=tpl(d), n=d.chapter||1, total=d.outlineChapters?.length||0;
  root_.querySelector('#na-finish-label').textContent=`You are on ${t.unit} ${n}${total?` of ${total}`:''}.`;
  root_.querySelector('#na-finish-chapter').textContent=n<total?`Finish ${t.unit} ${n} → start ${t.unit} ${n+1}`:`Finish ${t.unit} ${n}`;
  for(const item of MEMORY_ITEMS) {
    const box=root_.querySelector(`[data-memory="${item.key}"]`), e=book?findEntry(book,item.title):null, place=e?.storyloom_memory||item.place;
    box.querySelector('textarea').value=e?.content||'';
    box.querySelector('.na-mem-where').value=place.where;
    box.querySelector('.na-mem-depth').value=String(place.depth??3);
    box.querySelector('.na-mem-role').value=place.role||'system';
    box.querySelector('.na-mem-depth-label').hidden=place.where!=='chat-depth';
    box.querySelector('.na-mem-role-label').hidden=place.where==='off';
  }
}
function memoryMarkup() {
  const opts=(o)=>Object.entries(o).map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
  return MEMORY_ITEMS.map(item=>`<div class="storyloom-memory-item" data-memory="${item.key}">
    <strong>${item.label}</strong><p class="storyloom-hint">${item.hint}</p>
    <textarea rows="5"></textarea>
    <div class="storyloom-row">
      <label>Where <select class="na-mem-where">${opts(WHERE)}</select></label>
      <label class="na-mem-depth-label">Messages from the end <input class="na-mem-depth" type="number" min="0" max="${CHAT_START_DEPTH}" step="1"></label>
      <label class="na-mem-role-label">Sent as <select class="na-mem-role"><option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option></select></label>
      <button class="na-mem-save" type="button">Save</button>
    </div></div>`).join('');
}
async function finishChapter() {
  requireIdle();
  const c=context(), d=data(), t=tpl(d);
  if(!d.book || d.interview?.phase!=='done')throw Error('Create the outline first.');
  const n=d.chapter||1, total=d.outlineChapters?.length||0;
  const {text,messages}=transcriptOf(c.chat);
  if(messages<2)throw Error(`This chat has almost nothing in it yet. Write ${t.unit} ${n} in the main chat first.`);
  const next=n<total;
  if(!await c.Popup.show.confirm(`Finish ${t.unit} ${n}?`,`<p>Storyloom will:</p><ol><li>Read this chat (${messages} messages) and write a ${t.unit.toLowerCase()} summary.</li><li>Update <b>Story so far</b> with what this ${t.unit.toLowerCase()} settled.</li><li>Offer any changes to character entries as Suggestions for you to approve.</li>${next?`<li>Move to ${t.unit} ${n+1} and open a fresh chat with the novel, lorebook and memory carried over.</li>`:''}</ol><p>This chat stays as it is.</p>`))return;
  const book=await freshBook(d.book);
  const sofarTitle=MEMORY_ITEMS[0].title, sumTitle=summaryTitle(t.unit,n);
  const castTitles=Object.values(book.entries||{}).map(e=>String(e.comment||'')).filter(x=>/^character\s*[—–-]/i.test(x));
  status(`Reading ${t.unit} ${n} and writing its summary…`);
  const result=await interact(chapterEndInstruction({unit:t.unit,number:n,transcript:text,storySoFar:findEntry(book,sofarTitle)?.content||'',castTitles}),false,null,null,`${t.unit} ${n} ending`,false,{silentUser:true,loreBudget:20000,holdForAuthor:'allExcept',keep:[sofarTitle,sumTitle],mergeState:true,guidance:'Summarise only what happened in the transcript.'});
  const summary=(result.updates||[]).find(u=>u.title.trim().toLocaleLowerCase()===sumTitle.toLocaleLowerCase());
  if(!summary)throw Error(`The AI did not return the ${t.unit.toLowerCase()} summary. Nothing was moved on; try again.`);
  await saveMemoryItem(MEMORY_ITEMS[1],summary.content);
  if(next) {
    await organizeBook(n+1);
    await startChapterChat();
    status(`${t.unit} ${n} is summarised. This is a fresh chat for ${t.unit} ${n+1}; Story so far, Previously and the ${t.unit.toLowerCase()} plan are already in place.${result.held?.length?' Character updates are waiting under Suggestions.':''}`);
  } else {
    try{await organizeBook();}catch{}
    status(`${t.unit} ${n} is summarised. That was the last ${t.unit.toLowerCase()} in the outline.${result.held?.length?' Character updates are waiting under Suggestions.':''}`);
  }
  options(); renderMemory();
}
/** Open a new chat with the same character and carry the novel over: lorebook link, Author's Note directive, memory. */
async function startChapterChat() {
  const c=context(), d=data(), bookName=d.book, previous=c.chatId;
  const copy=structuredClone(d);
  for(const k of ['directive','pending','processed','review','queueError','pendingContinuity','pendingWrite'])delete copy[k];
  await doNewChat();
  if(context().chatId===previous)throw Error('SillyTavern could not open a new chat. Close any character editor or stop the main chat’s generation, then use “Start a new novel”… or open a new chat and choose this lorebook.');
  const state=root();
  Object.defineProperty(state.novels,bookName,{value:copy,writable:true,enumerable:true,configurable:true});
  state.selected=bookName;
  await persist();
  if(!await attachBook(bookName,context()))throw Error('The new chat could not be linked to the novel’s lorebook.');
  await setupNovel();
  await applyMemory();
}

/* ---------- Version and updates (installs only change when GitHub does) ---------- */
const EXTENSION_FOLDER=decodeURIComponent(new URL(import.meta.url).pathname.split('/').at(-2));
let updateCheckedAt=0, updateGlobal=false;
async function showVersion() {
  try {const m=await (await fetch(new URL('manifest.json',import.meta.url),{cache:'no-store'})).json(); const el=document.getElementById('na-version'); if(el)el.textContent=`v${m.version}`;} catch {}
}
async function versionInfo(global) {
  const r=await fetch('/api/extensions/version',{method:'POST',headers:context().getRequestHeaders(),body:JSON.stringify({extensionName:EXTENSION_FOLDER,global})});
  return r.ok?r.json():null;
}
/** Ask SillyTavern whether this install is behind GitHub; show the update button if so. */
async function checkForUpdate(force=false) {
  if(!force && Date.now()-updateCheckedAt<30*60*1000)return;
  updateCheckedAt=Date.now();
  try {
    let info=await versionInfo(false);
    if(!info?.currentCommitHash){const g=await versionInfo(true); if(g?.currentCommitHash){info=g;updateGlobal=true;}}
    const btn=document.getElementById('na-update');
    if(btn)btn.hidden=!info?.currentCommitHash || info.isUpToDate!==false;
  } catch(e) {console.warn('Storyloom update check:',e);}
}
async function updateStoryloom() {
  if(!await context().Popup.show.confirm('Update Storyloom?','Download the newest Storyloom from GitHub and reload SillyTavern. Your novels, lorebooks and settings are not touched.'))return;
  status('Updating Storyloom from GitHub…');
  const r=await fetch('/api/extensions/update',{method:'POST',headers:context().getRequestHeaders(),body:JSON.stringify({extensionName:EXTENSION_FOLDER,global:updateGlobal})});
  if(!r.ok)throw Error(`SillyTavern could not update the extension (${r.status}). Try Extensions → Manage extensions.`);
  status('Updated. Reloading…');
  setTimeout(()=>location.reload(),800);
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
/** Small box at the bottom of the panel showing the reply as it streams in. */
const live={frame:0,data:null};
function showLive(data) {
  live.data=data;
  if(live.frame)return;
  live.frame=requestAnimationFrame(()=>{
    live.frame=0;
    const box=document.getElementById('na-live'); if(!box)return;
    const d=live.data;
    if(!d){box.hidden=true;return;}
    box.hidden=false;
    const thinkingRaw=String(d.reasoning||''), inThought=!d.text && /^[\s*_#>]*=+\s*ENTRY\s*:/m.test(thinkingRaw);
    const answer=readable(d.text) || (inThought ? thinkingRaw.slice(thinkingRaw.search(/^[\s*_#>]*=+\s*ENTRY\s*:/m)) : ''), thinking=thinkingRaw;
    const words=s=>(s.match(/\S+/g)||[]).length;
    box.querySelector('.storyloom-live-head').textContent=answer
      ? `Writing… ${words(answer).toLocaleString()} words`
      : thinking ? `Thinking… ${words(thinking).toLocaleString()} words` : 'Waiting for the first words…';
    const body=box.querySelector('.storyloom-live-body');
    body.classList.toggle('is-thinking',!answer);
    body.textContent=(answer||thinking).slice(-4000);
    body.scrollTop=body.scrollHeight;
  });
}
/** Make streaming JSON readable: drop the wrapper and unescape line breaks and quotes. */
function readable(text) {
  return String(text||'').replace(/^\s*```(?:json)?\s*/,'').replace(/^\s*\{\s*"reply"\s*:\s*"/,'')
    .replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/"\s*,\s*"updates"\s*:\s*\[\s*\{\s*"title"\s*:\s*"/,'\n\n— ').replace(/"\s*,\s*"content"\s*:\s*"/g,'\n').replace(/"\s*,\s*"keys"\s*:\s*\[[^\]]*\]\s*\}\s*,?\s*\{?\s*(?:"title"\s*:\s*")?/g,'\n\n— ');
}
async function llm(c,prompt,profile,signal,tokens,systemPrompt,direct) {
  const progress=data=>showLive(data);
  showLive({text:'',reasoning:''});
  const started=Date.now(), label=document.getElementById('na-status')?.textContent?.replace(/\s*\(\d+s\)$/,'') || 'Waiting for the AI…';
  const ticker=setInterval(()=>{const el=document.getElementById('na-status');if(el && busyLabel(el.textContent,label))el.textContent=`${label} (${Math.round((Date.now()-started)/1000)}s)`;},1000);
  try {
    return await requestModel(async requestSignal=>{
      try {
        try {return await generate(c,prompt,profile,requestSignal,tokens,systemPrompt,direct,progress);}
        catch(error) {
          if(!error?.emptyReply || requestSignal.aborted)throw error;
          // Empty answers are usually a one-off from the provider; ask once more before failing.
          console.warn('Storyloom: empty model reply, retrying once:',error.message);
          const el=document.getElementById('na-status'); if(el)el.textContent=`The model answered with nothing (${error.message.replace(/^the model /,'')}); asking once more…`;
          showLive({text:'',reasoning:''});
          return await generate(c,prompt,profile,requestSignal,tokens,systemPrompt,direct,progress);
        }
      } catch(error) {
        if(requestSignal.aborted)throw requestSignal.reason;
        if(/^Choose |^Enter |^Select |^Response budget/.test(error?.message))throw error;
        const detail=String(error?.message||error||'').trim().slice(0,200);
        if(error?.emptyReply)throw Error(`The model answered twice with nothing: ${detail}. This is the model, not your connection — try again, or raise the response budget in Settings if it keeps happening.`);
        throw Error(`The AI connection failed${detail?` (${detail})`:''}. Check AI connection in Settings and try again.`);
      }
    },signal,MODEL_TIMEOUT_MS);
  } finally {clearInterval(ticker);showLive(null);}
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
  panel.querySelector('#na-workspace').hidden=settingsOpen || activeTab!=='story';
  renderTabs();
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
      const cutOff=/Unterminated|Unexpected end of JSON|cut off|Expected .* after/i.test(String(error.message));
      status(cutOff?`The model’s reply stopped partway through (${String(raw).length.toLocaleString()} characters${String(raw).length>tokens*2.5?', about the response budget':''}); asking it to try again…`:`The model’s reply couldn’t be read (${String(error.message).slice(0,80)}); asking it to try again…`);
      const retrySystem=system+'\nYour last response could not be read. Use the plain-text entry format exactly: your reply, then each entry as === ENTRY: title / KEYS: … / content / === END. Never JSON.';
      const retried=await ask(prompt,retrySystem);
      try {result=parseAssistant(retried,{allowProse});}
      catch(second) {throw Error(/Unterminated|Unexpected end of JSON|cut off/i.test(String(second?.message))?(String(retried).length>tokens*2.5?'The model’s reply was cut off twice at about the response budget. Raise “Response budget” in Settings (up to 16000) and try again. Nothing was saved.':'The model’s reply stopped partway through twice. Nothing was saved; try again (the raw replies are in the browser console).'):'The model did not return a usable response after retrying. Nothing was saved; please try again.');}
    }
    if(interview?.collaborative && !isCollaborativeReply(result.reply)) {
      if(context().chatId!==chatId || data()!==d)throw Error('Chat changed; nothing saved.');
      const retrySystem=system+'\nYour previous response was too brief. Respond specifically to the writer, offer a useful possibility or observation, and ask a relevant follow-up question. Do not reply with only an acknowledgement.';
      result=parseAssistant(await ask(prompt,retrySystem),{allowProse});
      if(!isCollaborativeReply(result.reply))throw Error('The model did not give a collaborative response. Your message is still here; please try again.');
    }
    if(interview?.requireOutline) result=await repairOutline(result,value=>{
      const t=tpl(d), foundation=value.updates.find(entry=>entry.title.trim().toLowerCase()===t.summary.title.toLowerCase());
      if(foundation)foundation.content=normalizeFoundation(foundation.content,targetEntries.find(entry=>entry.title===t.summary.title)?.content,t.summary.fields,requiredOf(t.summary,true));
      validateOutline(normalizePeopleFocus(value,d.interview?.answers,t.cast),d.interview?.mode,t,interview.part||'all',Object.fromEntries(targetEntries.map(e=>[e.title,e.content])));
    },async (previous,issue)=>{
      if(context().chatId!==chatId || context().chatMetadata.world_info!==bookName || data()!==d)throw Error('Chat or lorebook changed; nothing saved.');
      status('Completing missing story details…');
      const correction=`${prompt}\n\nYour previous plan needs correction: ${issue}. Return all required entries again, complete and corrected, as entry blocks — not just the missing part. Your previous entries were:\n${toBlocks(previous.updates)}`;
      return parseAssistant(await ask(correction,system));
    });
    if(interview?.requireCharacters) result=await repairOutline(result,value=>validateCharacters(value,interview.requireCharacters,tpl(d).characterSections),async (previous,issue)=>{
      if(context().chatId!==chatId || context().chatMetadata.world_info!==bookName || data()!==d)throw Error('Chat or lorebook changed; nothing saved.');
      status('Filling in thin character profiles…');
      const correction=`${prompt}\n\nYour previous profiles need correction: ${issue}. Return every requested profile again in full, with every heading filled in. Your previous profiles were:\n${toBlocks(previous.updates)}`;
      return parseAssistant(await ask(correction,system));
    });
    if(controller.signal.aborted)throw Error('Stopped. Your message is still in the box.');
    document.getElementById('na-cancel-model').hidden=true;
    if(interview?.requiredCharacterTitle) result.updates=[requiredCharacterUpdate(result,interview.requiredCharacterTitle)];
    if(interview?.dropTitles) {const drop=new Set(interview.dropTitles.map(x=>x.toLocaleLowerCase()));result.updates=(result.updates||[]).filter(u=>!drop.has(String(u.title).trim().toLocaleLowerCase()));}
    if(interview?.collaborative && d.interview?.phase==='asking') {
      const prior=[...d.messages].reverse().find(m=>m.role==='assistant')?.content || '';
      // Writer-stated facts that fit no planned entry may become their own entry; proposals stay in the notes.
      const reserved=new Set([...requiredTitles(tpl(d)),'Storyloom Interview Notes','Current Chapter'].map(x=>x.toLocaleLowerCase()));
      const extras=(result.updates||[]).filter(u=>u?.title && !reserved.has(u.title.trim().toLocaleLowerCase())).slice(0,3);
      result.updates=[deepNotesUpdate(before,d.interview,input,prior),...extras];
    }
    if (context().chatId !== chatId || context().chatMetadata.world_info!==bookName || data().book !== bookName || d.profile!==profile || d.reference!==referenceName || !sameDirect(d,direct)) throw new Error('Chat or lorebook changed while generating; nothing saved.');
    if (guard && !guard()) throw Error('The source message changed; nothing was saved.');
    const fresh = await freshBook(bookName);
    if (JSON.stringify(fresh) !== JSON.stringify(before)) throw new Error('Lorebook changed while generating; nothing saved. Please retry.');
    // The writer named the characters: extra cast members wait for approval instead of getting profiles automatically.
    let castHeld=null;
    const writerPeople=(d.interview?.answers?.people||[]).join('\n');
    if(interview?.part==='plan' && writerPeople.trim()) {
      const castUpdate=(result.updates||[]).find(u=>String(u.title).trim().toLocaleLowerCase()===tpl(d).cast.toLocaleLowerCase());
      if(castUpdate) {
        const {kept,extras}=splitExtraCast(castUpdate.content,writerPeople);
        if(extras.length && kept.includes('|')) {
          castHeld={title:castUpdate.title.trim(),content:`${kept}\n${extras.join('\n')}`,keys:castUpdate.keys||[castUpdate.title],kind:'change',source:'cast',reason:`You named the characters, so the cast list was saved with only them. The AI also wants to add: ${extras.map(l=>l.split('|')[0].replace(/\*\*/g,'').trim()).join(', ')}. Approve to add them (each gets a full profile); skip to keep the cast as you wrote it.`};
          castUpdate.content=kept;
        }
      }
    }
    // Anything beyond the planned entries waits for the author's approval instead of being saved.
    let held=[];
    if(interview?.holdForAuthor) {
      const planned=new Set([...requiredTitles(tpl(d)),'Storyloom Interview Notes'].map(x=>x.toLocaleLowerCase()));
      const exists=title=>Object.values(fresh.entries||{}).some(e=>String(e.comment||'').trim().toLocaleLowerCase()===title);
      const keep=new Set((interview.keep||[]).map(x=>x.toLocaleLowerCase()));
      const isExtra=u=>{const t=String(u.title).trim().toLocaleLowerCase();if(interview.holdForAuthor==='allExcept')return !keep.has(t);return interview.holdForAuthor==='all' || (!planned.has(t) && !exists(t) && !/^character\s*[—–-]/i.test(t));};
      held=(result.updates||[]).filter(u=>u.storyloomKind!=='interview_notes' && isExtra(u));
      result.updates=(result.updates||[]).filter(u=>!held.includes(u));
      if(held.length) {
        d.suggestions ??= [];
        for(const u of held) {
          const title=u.title.trim(), kind=exists(title.toLocaleLowerCase())?'change':'new';
          // Chapter endings send only a character's CURRENT STATE; merge it into their full entry.
          if(interview.mergeState && kind==='change' && /^character\s*[—–-]/i.test(title)){const cur=Object.values(fresh.entries||{}).find(e=>String(e.comment||'').trim().toLocaleLowerCase()===title.toLocaleLowerCase());u.content=mergeCurrentState(cur?.content,u.content);u.keys=cur?.key?.length?cur.key:u.keys;}
          d.suggestions=d.suggestions.filter(x=>x.title.toLocaleLowerCase()!==title.toLocaleLowerCase());
          d.suggestions.push({id:crypto.randomUUID(),title,content:u.content,keys:u.keys||[title],kind,source:sourceKind||'planning',reason:String(result.reply||'').slice(0,2000),at:new Date().toISOString()});
        }
        await persist();
      }
      result.held=held;
    }
    if(castHeld) {
      d.suggestions ??= [];
      d.suggestions=d.suggestions.filter(x=>x.title.toLocaleLowerCase()!==castHeld.title.toLocaleLowerCase());
      d.suggestions.push({id:crypto.randomUUID(),...castHeld,at:new Date().toISOString()});
      held.push(castHeld); await persist();
    }
    let skippedFoundation=false;
    if(!fromMain && !interview?.requireOutline) {
      const foundation=result.updates.find(entry=>entry.title.trim().toLowerCase()===tpl(d).summary.title.toLowerCase());
      if(foundation) {
        try {planWrites(fresh,[foundation],{...tpl(d).summary,required:requiredOf(tpl(d).summary,true)});}
        catch {
          result.updates=result.updates.filter(entry=>entry!==foundation);
          skippedFoundation=true;
        }
      }
    }
    const writes = planWrites(fresh, result.updates, {...tpl(d).summary,required:requiredOf(tpl(d).summary,true)});
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
    if(held.length)renderSuggestions();
    const heldNote=held.length?` ${held.length} suggestion${held.length===1?'':'s'} waiting for your OK under “Suggestions”.`:'';
    status((result.ignoredUpdates?'Reply received. The proposed lorebook updates could not be read.':skippedFoundation?'Reply received. Storyloom kept the existing foundation because the proposed update could not be read.':writes.length ? `Saved ${writes.length} World Info ${writes.length === 1 ? 'entry' : 'entries'}.` : 'No entry changes.')+heldNote);
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
    const t=tpl(d);
    // Two requests so each reply fits the response budget (reasoning models spend part of it thinking).
    if(!interview.planSaved) {
      status(`Step 1 of 2: filling in ${t.summary.title} and the planning entries…`);
      await interact(finalizeInstruction(interview.mode,interview.answers,t,'plan'),false,null,null,null,false,{guidance:'Complete the interview as instructed. Return every required planning entry as an entry block.',requireOutline:true,part:'plan',holdForAuthor:'extras',silentUser:true,loreBudget:60000});
      if(data()!==d)throw Error('Chat changed. Return to the novel to finish.');
      d.interview={...d.interview,planSaved:true}; await persist();
    }
    status(`Step 2 of 2: writing the ${t.outline.title}…`);
    const result=await interact(finalizeInstruction(interview.mode,interview.answers,t,'outline'),false,null,null,null,false,{guidance:`Return the ${t.outline.title} entry in updates.`,requireOutline:true,holdForAuthor:'extras',part:'outline',silentUser:true,loreBudget:60000});
    if(data()!==d)throw Error('Chat changed. Return to the novel to finish.');
    const outline=result.updates.find(x=>x.title.trim().toLocaleLowerCase()===t.outline.title.toLocaleLowerCase());
    d.messages.push({role:'assistant',content:'Here is your outline:\n\n'+outline.content});
    d.interview={...d.interview,phase:'done'};
    d.outlineChapters=chapterList(outline.content,t.unit).map(({number,title})=>({number,title}));
    await persist();
    let reviewNote='';
    try {reviewNote=(await reviewStory({quiet:true})).note;} catch(e) {console.warn('Storyloom review:',e); reviewNote='The fresh-eyes review could not run; use “Check what’s missing” later.';}
    let bookMessage='';
    try {bookMessage=await nameFinishedLorebook(d);}
    catch {bookMessage=' The outline is saved in the draft lorebook. Storyloom could not switch it to a titled book.';}
    try {await organizeBook(1);} catch(e) {console.warn('Storyloom layout:',e);}
    options();
    status('Outline saved.'+bookMessage+' '+reviewNote.slice(0,300)+' Writing full character profiles next…');
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
/** Second look with no template in view: add only what this story clearly needs, trim what doesn't fit. */
async function reviewStory({quiet=false}={}) {
  const d=data(), t=tpl(d);
  status('Checking the plan with fresh eyes for anything missing or out of place…');
  const result=await interact(reviewInstruction(d.interview?.answers||{},[...REVIEW_PROTECTED,t.outline.title]),false,null,null,'story review',false,{silentUser:true,loreBudget:60000,holdForAuthor:'all',dropTitles:[...REVIEW_PROTECTED,t.outline.title],guidance:'You are reviewing, not filling in a form. Changing nothing is a good outcome.'});
  const changed=(result.held||[]).map(u=>u.title);
  const note=changed.length?`Review suggests: ${changed.join(', ')} — approve or skip under “Suggestions”.`:`Review: nothing needed changing. ${String(result.reply||'').slice(0,300)}`;
  if(!quiet)status(note.slice(0,600));
  return {changed,note};
}
/** Second planning pass: one full lorebook entry per cast member. */
async function writeProfiles(prefix='',{onlyMissing=false}={}) {
  try {
    requireIdle();
    const d=data();
    if(!d.book)throw Error('Choose this novel’s lorebook first.');
    const book=await freshBook(d.book);
    const people=findEntry(book,tpl(d).cast);
    const cast=castNames(people?.content);
    if(!cast.length)throw Error(`There is no cast list (${tpl(d).cast} entry) to build character profiles from.`);
    const names=onlyMissing?cast.filter(n=>!findEntry(book,characterTitle(n))):cast;
    if(!names.length){if(onlyMissing){status(`${prefix.trim()?prefix.trim()+' ':''}Every character already has a profile.`);return;}}
    // One request per person: several full profiles in one reply overflow typical response budgets.
    const done=[];
    for(const [i,name] of names.entries()) {
      try {
        status(`Writing character profile ${i+1} of ${names.length}: ${name}…`);
        await interact(characterProfilesInstruction([name],cast,tpl(d).characterSections,tpl(d).unit),false,null,null,`character profile: ${name}`,false,{silentUser:true,requireCharacters:[name],loreBudget:60000,guidance:'Write the requested character profile as a complete lorebook entry.'});
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
  const openPanel=()=>{checkForUpdate().catch(()=>{});try{options();document.getElementById('na-panel').hidden=false;const log=document.getElementById('na-messages');log.scrollTop=log.scrollHeight;if(data().profile==='__direct__')refreshKeys().catch(e=>fail(e));}catch(e){toastr.warning(e.message)}};
  button.addEventListener('click',()=>{openPanel();document.querySelector('#extensions-settings-button .drawer-toggle')?.click();});
  const shortcut=document.createElement('button');shortcut.type='button';shortcut.id='storyloom-chat-shortcut';shortcut.title='Open Storyloom';shortcut.setAttribute('aria-label','Open Storyloom');shortcut.innerHTML='<i class="fa-solid fa-feather-pointed" aria-hidden="true"></i>';shortcut.addEventListener('click',openPanel);document.getElementById('leftSendForm')?.append(shortcut);
  document.querySelector('#extensions_settings2, #extensions_settings')?.append(button);
  const panel = document.createElement('aside'); panel.id='na-panel'; panel.hidden=true;
  panel.innerHTML=`
    <header class="storyloom-header">
      <div class="storyloom-brand"><span class="storyloom-mark" aria-hidden="true">✦</span><div><strong>Storyloom</strong><small id="na-version"></small></div><button id="na-update" type="button" class="storyloom-update" hidden>Update available</button></div>
      <div class="storyloom-header-actions">
        <button id="na-back" type="button">Back to start</button>
        <button id="na-settings-toggle" type="button" aria-controls="na-settings" aria-expanded="false">Settings</button>
        <button id="na-close" type="button" class="storyloom-close" aria-label="Close Storyloom">×</button>
      </div>
    </header>
    <nav class="storyloom-tabs" role="tablist"><button id="na-tab-story" type="button" role="tab" class="is-active">Story</button><button id="na-tab-memory" type="button" role="tab">Memory</button><button id="na-tab-assistant" type="button" role="tab">Assistant</button></nav>
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
        <details class="storyloom-advanced storyloom-prompts"><summary>Prompts <span aria-hidden="true">⌄</span></summary><p class="storyloom-hint">Change how Storyloom talks to the AI. Only the wording below is yours to change; the parts that make saving work are always added and shown underneath, so an edit can’t break Storyloom. Changes apply to the next request.</p><select id="na-prompt-key"></select><textarea id="na-prompt-text" rows="10"></textarea><p id="na-prompt-locked" class="storyloom-hint"></p><div class="storyloom-row"><button id="na-prompt-save" type="button">Save prompt</button><button id="na-prompt-reset" type="button">Reset to default</button></div></details>
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
        <button id="na-review" type="button" hidden>Check what’s missing</button>
        <button id="na-profiles" type="button" hidden title="Writes a full entry (history, personality, motivation, arc…) for every person in the cast list. Existing profiles are rewritten.">Write character profiles</button>
      </div>
    </div>
    <section id="na-suggestions" class="storyloom-suggestions" hidden><strong>Suggestions waiting for you (<span class="storyloom-sugg-count">0</span>)</strong><p class="storyloom-hint">Extra entries and changes the AI thinks the story needs. Nothing here is saved until you approve it.</p><ul></ul></section>
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
    <section id="na-memory" class="storyloom-memory" hidden>
      <p id="na-memory-empty" class="storyloom-hint">Memory starts once your outline exists. It carries what has happened from one chapter chat to the next.</p>
      <div id="na-finish-area" class="storyloom-finish"><p id="na-finish-label"></p><button id="na-finish-chapter" type="button">Finish chapter</button><p class="storyloom-hint">When a chapter is done in the main chat: writes its summary, updates Story so far, moves to the next chapter and opens a fresh chat with everything carried over. This chat is kept.</p></div>
      <div id="na-memory-items">${memoryMarkup()}</div>
    </section>
    <section id="na-assistant" class="storyloom-assistant" hidden>
      <div class="storyloom-assistant-bar"><small id="na-docs-status" class="storyloom-hint"></small><div class="storyloom-row"><button id="na-docs-update" type="button">Update docs</button><button id="na-assistant-new" type="button">New conversation</button></div></div>
      <div id="na-assistant-log" role="log" aria-live="polite" aria-label="Assistant conversation"></div>
      <div class="storyloom-composer"><label class="storyloom-sr-only" for="na-assistant-input">Ask the assistant</label><textarea id="na-assistant-input" placeholder="Ask about SillyTavern, your lorebook, or where something should go…"></textarea><div class="storyloom-compose-footer"><span>CTRL+ENTER TO SEND</span><button id="na-assistant-send" type="button">Ask <span aria-hidden="true">↗</span></button></div></div>
    </section>
    <div id="na-live" class="storyloom-live" hidden aria-live="off"><div class="storyloom-live-head"></div><div class="storyloom-live-body"></div></div>
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
  panel.querySelector('#na-update').onclick=()=>updateStoryloom().catch(fail);
  panel.querySelector('#na-tab-story').onclick=()=>{activeTab='story';settingsOpen=false;renderPanelView();};
  panel.querySelector('#na-tab-assistant').onclick=()=>{activeTab='assistant';settingsOpen=false;renderPanelView();};
  panel.querySelector('#na-tab-memory').onclick=()=>{activeTab='memory';settingsOpen=false;renderPanelView();};
  for(const item of MEMORY_ITEMS) {
    const box=panel.querySelector(`[data-memory="${item.key}"]`);
    const place=()=>({where:box.querySelector('.na-mem-where').value,depth:Number(box.querySelector('.na-mem-depth').value)||0,role:box.querySelector('.na-mem-role').value});
    box.querySelector('.na-mem-where').onchange=()=>{const p=place();box.querySelector('.na-mem-depth-label').hidden=p.where!=='chat-depth';box.querySelector('.na-mem-role-label').hidden=p.where==='off';};
    box.querySelector('.na-mem-save').onclick=async()=>{lastAction=`Save ${item.label}`;try{await saveMemoryItem(item,box.querySelector('textarea').value,place());status(`${item.label} saved and in place for the next reply.`);}catch(e){fail(e);}};
  }
  panel.querySelector('#na-finish-chapter').onclick=()=>finishChapter().catch(fail);
  const sendAssistant=async()=>{const input=panel.querySelector('#na-assistant-input'),v=input.value.trim();if(!v)return;input.value='';try{await askAssistant(v);}catch(e){fail(e);if(!input.value)input.value=v;}};
  panel.querySelector('#na-assistant-send').onclick=sendAssistant;
  panel.querySelector('#na-assistant-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();sendAssistant();}});
  panel.querySelector('#na-assistant-new').onclick=async()=>{try{if(!await context().Popup.show.confirm('Start a new conversation?','The assistant forgets this conversation and its summary. Changes you already applied stay.'))return;const st=assistantState();st.messages=[];st.summary='';saveAssistant();renderAssistant();}catch(e){fail(e);}};
  panel.querySelector('#na-docs-update').onclick=async()=>{try{await ensureDocs({force:true});status('SillyTavern docs updated.');}catch(e){fail(e);}};
  panel.querySelector('#na-review').onclick=async()=>{try{await reviewStory();options();}catch(e){fail(e);}};
  panel.querySelector('#na-template-edit').onchange=()=>showTemplateText();
  panel.querySelector('#na-prompt-key').onchange=()=>renderPromptEditor();
  panel.querySelector('#na-prompt-save').onclick=()=>{try{const key=panel.querySelector('#na-prompt-key').value,text=panel.querySelector('#na-prompt-text').value.trim();if(!text)throw Error('The prompt is empty. Use “Reset to default” to go back to the original.');const all=storedPrompts();if(text===PROMPT_DEFAULTS[key].text)delete all[key];else all[key]=text;setPromptOverrides(all);context().saveSettingsDebounced();renderPromptEditor();status(`“${PROMPT_DEFAULTS[key].label}” saved. It applies from the next request.`);}catch(e){fail(e);}};
  panel.querySelector('#na-prompt-reset').onclick=async()=>{try{const key=panel.querySelector('#na-prompt-key').value;if(!await context().Popup.show.confirm('Reset this prompt?',`Put “${PROMPT_DEFAULTS[key].label}” back to Storyloom’s original wording?`))return;const all=storedPrompts();delete all[key];setPromptOverrides(all);context().saveSettingsDebounced();renderPromptEditor();status(`“${PROMPT_DEFAULTS[key].label}” is back to the default.`);}catch(e){fail(e);}};
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
        await interact(v,false,null,null,null,false,{guidance:answerInstruction(interview),collaborative:interview.mode==='deep',holdForAuthor:'extras'});
        if(data()!==d)throw Error('Chat changed; return to this novel.');
        d.interview=recordAnswer(d.interview,v); await persist(); input.value='';
        if(interview.mode==='simple') await nextInterview(false);
      } else {await interact(v,false,null,null,null,false,{collaborative:interview.mode==='deep',holdForAuthor:'extras'});input.value='';}
    } catch(e){fail(e)}
  };
  const c=context();
  setPromptOverrides(c.extensionSettings.storyloom?.prompts);
  c.eventSource.on(c.event_types.WORLDINFO_UPDATED,queueSync);
  c.eventSource.on(c.event_types.WORLDINFO_UPDATED,queueMemory);
  setTimeout(()=>applyMemory().catch(e=>console.warn('Storyloom memory:',e)),2500);
  showVersion();
  setTimeout(()=>checkForUpdate(true),8000);
  c.eventSource.on(c.event_types.WORLDINFO_UPDATED,name=>{if(linkRunning)return;clearTimeout(linkTimer);linkTimer=setTimeout(()=>syncLinks(typeof name==='string'?name:null),1000);});
  setTimeout(()=>{if(storedLinks().length)syncLinks();},4000);
  c.eventSource.on(c.event_types.CHAT_CHANGED,()=>{queueMemory();modelController?.abort();atStart=false;settingsOpen=false;sessionKey=null;panel.querySelector('#na-session-key').value='';if(!panel.hidden){try{options();status('')}catch{panel.hidden=true}} queueSync(); scheduleDrain();});
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

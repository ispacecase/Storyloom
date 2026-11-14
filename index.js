import { doNewChat } from '../../../../script.js';
import { promptManager, getChatCompletionPreset } from '../../../openai.js';
import { PRESET_NAME, NARRATOR_NAME, NARRATOR_CARD, VALUES, varName, isGeneralNarrator, bookValues, novelPreset, presetPrompts, narrationInstruction, parseNarration } from './novelist.mjs';
import { addBackup, latestGroup, backupText, BACKUP_KINDS } from './backups.mjs';
import { chapterProse, bookText, bookDocx, fileName } from './export.mjs';
import { createWorldInfoEntry, createNewWorldInfo, deleteWorldInfo, openWorldInfoEditor, showWorldEditor, reloadEditor } from '../../../world-info.js';
import { parseAssistant, toBlocks, planWrites, readDirective, replaceDirective } from './operations.mjs';
import { synchronize, resolveConflict, planInitialLink } from './sync.mjs';
import { createNovel, selectNovel } from './state.mjs';
import { enqueue, nextJob, requiresReview, wasApplied, changedProcessed } from './queue.mjs';
import { foundationTemplate, initialDirective, normalizeFoundation, foundationTitle } from './template.mjs';
import { buildChange, undoChange, classifyChange, describeChange } from './history.mjs';
import { generate, profileOptions, requestModel } from './generation.mjs';
import { queueContinuity, completeContinuity, continuityPrompt } from './continuity.mjs';
import { selectLore, recentConversation, ensureCompleteUpdates, unsafeUpdates, planningBudget } from './context.mjs';
import { saveVerified } from './persistence.mjs';
import { linkBook, linkState } from './lorelink.mjs';
import { repairOutline } from './outline-repair.mjs';
import { normalizePeopleFocus } from './focus.mjs';
import { characterImportRequest, requiredCharacterUpdate, selectCharacterSource } from './reuse.mjs';
import { planningSystem } from './prompts.mjs';
import { PROMPT_DEFAULTS, setPromptOverrides } from './prompt-texts.mjs';
import { PROVIDERS, readKeyOptions, readModels } from './providers.mjs';
import { castNames, characterProfilesInstruction, validateCharacters, characterTitle, splitExtraCast } from './characters.mjs';
import { layoutBook, chapterList, directiveForChapter, mergeOutline, laterChapters } from './lorebook-layout.mjs';
import { assistantSystem, parseActions, applyAction, describeAction, formatSnapshot, needsCompaction, compactionPrompt } from './assistant.mjs';
import { downloadDocs, chunkMarkdown, indexChunks, searchDocsMany, searchTermsPrompt, parseSearchTerms, vectorSource } from './docs-rag.mjs';
import { MEMORY_ITEMS, WHERE, CHAT_START_DEPTH, memoryKey, injection, transcriptOf, chapterEndInstruction, summaryTitle, mergeCurrentState, outlineBody } from './memory.mjs';
import { planLinkSync, resolveLink, linkBookName, findCharacterEntry, linksFor } from './links.mjs';
import { NOVEL, BUILT_IN, templateToText, parseTemplate, requiredOf } from './templates.mjs';
import { requiredTitles, reviewInstruction, REVIEW_PROTECTED, PROPOSAL_TITLE, proposalInstruction, parseProposal, validateProposal, approvedBrief } from './interview.mjs';
import { wordBudget, castFit, budgetLines, SCENE_MIN, parseNumber, coreShare } from './budget.mjs';
import { exactLint, lintInstruction, parseFindings, countsLine, biggestProblem, ALL_BUCKETS } from './lint.mjs';
import { addEntry, filterEntries, logText } from './log.mjs';
import { ROLES, ROLE_KEYS, STEPS, roleSettings, roleSystem, activeSteps, parseNotes, overallLine, markupInstruction, readerInstruction, reviseInstruction, parseRevision, wordDiff, narratorInstruction, parseNarrator, narratorLabel, suggestNarrators, parseNarratorTemplate, narratorTemplateText, defaultMainPrompt } from './roles.mjs';
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
  for(const text of storedTemplates()){try{custom.push({...parseTemplate(text),custom:true});}catch(e){warnLog('Storyloom template:',e.message);}}
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
        await c.saveWorldInfo(name,books[name],true); refreshEditor(name);
      }
      link.base=plan.base;
      if(Object.keys(plan.writes).length)notes.push(`Synced “${link.title}” to ${Object.keys(plan.writes).join(', ')}.`);
      if(plan.conflict)notes.push(`“${link.title}” was edited differently in ${plan.conflict.join(' and ')}. Choose which version to keep under Reference & characters.`);
      if(plan.missing.length)notes.push(`“${link.title}” is missing from ${plan.missing.join(', ')}.`);
    }
    c.saveSettingsDebounced();
    if(notes.length && document.getElementById('na-status'))status(notes.join(' '));
    renderLinks();
  } catch(e) {warnLog('Storyloom link sync:',e); if(document.getElementById('na-status'))fail(e,'Keep characters in sync');}
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
      for(const [name,value] of Object.entries(plan.writes)){const e=findCharacterEntry(books[name],link.title),v=JSON.parse(value);e.content=v.content;e.key=v.key;await c.saveWorldInfo(name,books[name],true); refreshEditor(name);}
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
  logEvent('error',label||'',message,error?.stack||'');
  const el=document.getElementById('na-status');
  el.textContent=(label?`“${label}” didn’t work: `:'')+message+' ';
  const link=document.createElement('button'); link.type='button'; link.className='storyloom-linkish'; link.textContent='See log'; link.onclick=()=>openStoryloomSettings('sl-log');
  el.append(link);
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
  'na-proposal-approve':'Build the plan, outline and characters exactly to this proposal.',
  'na-proposal-revise':'Rewrite the proposal with the change you typed; nothing is built yet.',
  'na-lint':'Check what’s written in this chat against the book and your rules. Reports only — nothing is changed.',
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
  renderProposal();
  renderBudget(d);
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
  loadChapters(d).catch(e=>warnLog('Storyloom chapters:',e));
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
    if(list[i]!==templateToText(parsed))backup({kind:'template',label:`Template “${selected}”`,target:{name:selected},before:{name:selected,text:list[i]}});
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
    await c.saveWorldInfo(d.book,fresh,true); refreshEditor(d.book);
    if(JSON.stringify(await freshBook(d.book))!==JSON.stringify(fresh))throw Error('The save could not be verified.');
    d.history ??= []; d.history.push({id:crypto.randomUUID(),book:d.book,changes:buildChange(before,fresh),source:'approved suggestion',at:new Date().toISOString()}); if(d.history.length>30)d.history.shift();
    d.suggestions=d.suggestions.filter(x=>x.id!==id);
    await persist();
  } finally {syncing=false;queueSync();scheduleDrain();}
  renderSuggestions(); options();
  status(`Saved “${sug.title}”.`);
  if(sug.title.toLocaleLowerCase()===tpl(d).cast.toLocaleLowerCase())await writeProfiles('',{onlyMissing:true});
  else try{await organizeBook();}catch(e){warnLog('Storyloom layout:',e);}
}
/* ---------- Assistant tab ---------- */
/** Entries Storyloom delivers itself (switched off on purpose) and what the Memory tab currently sends. */
async function storyloomManaged() {
  const managed=[], memory=[];
  let d; try{d=data();}catch{return {managed,memory};}
  if(!d?.book)return {managed,memory};
  const t=tpl(d), c=context();
  managed.push({title:t.outline.title,how:'kept switched off in the lorebook; the Memory tab sends it (“Whole outline”) with an instruction not to write ahead, at the writer’s chosen position'});
  for(const e of t.entries)if(e.show==='off')managed.push({title:e.title,how:'planning notes the story does not need'});
  managed.push({title:t.cast,how:'the cast index Storyloom uses; full character entries are the “Character — Name” entries'});
  managed.push({title:'Current Writing Directive',how:'sent through the Author’s Note, which Storyloom keeps in sync'});
  managed.push({title:'Storyloom Interview Notes',how:'the planning interview record'});
  let book=null; try{if(c.getWorldInfoNames().includes(d.book))book=await freshBook(d.book);}catch{}
  for(const item of MEMORY_ITEMS) {
    if(!item.fromOutline)managed.push({title:item.title,how:`sent by the Memory tab as “${item.label}”`});
    const e=book?findEntry(book,memoryTitle(item,d)):null, place=e?.storyloom_memory||item.place, w=(String(e?.content||'').match(/\S+/g)||[]).length;
    memory.push({label:item.label,words:place.where==='off'?0:w,where:place.where==='chat-depth'?`${place.depth} messages from the end as ${place.role}`:`${WHERE[place.where]||place.where} as ${place.role}`});
  }
  for(const e of Object.values(book?.entries||{}))if(/^storyloom memory\s*[—–-]/i.test(String(e.comment||'')) && !managed.some(m=>m.title===e.comment))managed.push({title:e.comment,how:'chapter memory kept for Storyloom'});
  return {managed,memory};
}
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
    try{localStorage.setItem(DOCS_CACHE,JSON.stringify(cache));}catch(e){warnLog('Storyloom: docs cache not saved (browser storage full); keeping them in memory.',e);}
  }
  docsChunks=cache.chunks;
  const c=context(), src=vectorSource(c.extensionSettings.vectors), idx=docsIndexState();
  if(src && (force || idx.source!==src.source || idx.model!==src.model || idx.count!==cache.chunks.length || idx.at<cache.at)) {
    try {
      docsLabel('Indexing the docs for search by meaning…');
      const r=await indexChunks({fetchFn:fetch,headers:c.getRequestHeaders(),source:src,chunks:cache.chunks,onProgress:(done,total)=>docsLabel(`Indexing the docs for search by meaning… ${done} of ${total}`)});
      Object.assign(idx,{source:src.source,model:src.model,count:r.total,at:Date.now()}); saveAssistant();
    } catch(e) {warnLog('Storyloom docs indexing:',e); docsLabel(`Could not index the docs by meaning (${e.message}); using keyword search.`); return cache.chunks;}
  }
  renderDocsStatus();
  return cache.chunks;
}
/** Storyloom's own research (docs/ in the extension), searched alongside the SillyTavern docs. */
const STORYLOOM_DOCS=['prompt-slots.md','novel-craft.md','novel-setups.md'];
let storyloomChunks=null;
async function loadStoryloomDocs() {
  if(storyloomChunks)return storyloomChunks;
  const out=[];
  for(const f of STORYLOOM_DOCS){try{const r=await fetch(new URL(`docs/${f}`,import.meta.url),{cache:'no-store'}); if(r.ok)out.push(...chunkMarkdown(`storyloom/${f}`,await r.text()));}catch(e){warnLog('Storyloom knowledge:',e);}}
  return storyloomChunks=out;
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
    const full=new Map(entries.map(e=>[e.comment,String(e.content||'')]));
    entryTexts=picked.slice(0,5).map(e=>({comment:e.title,content:e.content,shortened:e.content.length<(full.get(e.title)||'').length}));
  }
  let novel='';
  try{const d=data(); if(d.book)novel=`lorebook “${d.book}”, template ${tpl(d).name}, ${d.interview?.phase==='done'?`planned, now on ${tpl(d).unit} ${d.chapter||1}`:`planning (${d.interview?.phase||'not started'})`}`;}catch{}
  const md=c.chatMetadata||{};
  const {managed,memory}=await storyloomManaged();
  let writing=null;
  try {
    const pm=c.mainApi==='openai'?c.getPresetManager('openai'):null, presetName=pm?.getSelectedPresetName()||'';
    let n=1; try{n=data().chapter||1;}catch{}
    writing={preset:presetName,isNovel:presetName===PRESET_NAME,hasNovel:pm?.getPresetList().preset_names?.[PRESET_NAME]!==undefined,prompts:c.mainApi==='openai'?presetPrompts(getChatCompletionPreset()):null,general:usesGeneralNarrator(c),values:readValues(c),chapter:n};
  } catch(e){warnLog('Storyloom snapshot (writing setup):',e);}
  return formatSnapshot({managed,memory,writing,
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
const PROMPT_IDS={main:'main','post-history':'jailbreak',auxiliary:'nsfw','enhance-definitions':'enhanceDefinitions'};
/** Change the Storyloom Novel preset (never the writer's own). Backs it up first; returns the old preset. */
async function changeNovelPreset(mutate,label) {
  const c=context(); if(c.mainApi!=='openai')throw Error('Preset changes need a Chat Completion connection.');
  const pm=c.getPresetManager('openai'), list=pm.getPresetList();
  if(list.preset_names?.[PRESET_NAME]===undefined)throw Error(`There is no “${PRESET_NAME}” preset yet. Use Writing setup… on the Memory tab to make it.`);
  const selected=pm.getSelectedPresetName()===PRESET_NAME;
  const before=selected?getChatCompletionPreset():structuredClone(pm.getCompletionPresetByName(PRESET_NAME));
  const after=structuredClone(before); mutate(after);
  backup({kind:'preset',label:`Preset “${PRESET_NAME}” (before: ${label})`,target:{name:PRESET_NAME},before});
  await pm.savePreset(PRESET_NAME,after,{skipUpdate:!selected});
  if(!selected)list.presets[list.preset_names[PRESET_NAME]]=after;
  return before;
}
async function applySetupAction(a) {
  const c=context();
  if(a.type==='set-preset-prompt'||a.type==='toggle-prompt') {
    const before=await changeNovelPreset(p=>{
      if(a.type==='set-preset-prompt') {
        if(a.prompt==='continue-nudge')p.continue_nudge_prompt=a.content;
        else if(a.prompt==='new-chat')p.new_chat_prompt=a.content;
        else {p.prompts ??= []; let x=p.prompts.find(q=>q.identifier===PROMPT_IDS[a.prompt]); if(!x){x={identifier:PROMPT_IDS[a.prompt],name:a.prompt,system_prompt:true,role:'system'};p.prompts.push(x);} x.content=a.content;}
      } else for(const o of p.prompt_order||[])for(const i of o.order||[])if(i.identifier===PROMPT_IDS[a.prompt])i.enabled=a.enabled;
    },describeAction(a));
    return {kind:'preset',before};
  }
  if(a.type==='set-book-setting') {
    const d=data(), n=d.chapter||1, prevValues=readValues(c), prevChapter=structuredClone(d.chapterValues?.[n]||{});
    const values={...prevValues,[a.name]:a.content};
    d.chapterValues ??= {}; d.chapterValues[n]={...(d.chapterValues[n]||{}),[a.name]:a.content};
    if(a.name==='pov'||a.name==='tense'){d.chapterNotes ??= {}; d.chapterNotes[n]={...(d.chapterNotes[n]||{}),[a.name]:a.content};}
    let bookUndo=null;
    if(a.scope==='book' && ['pov','tense','tone','voice','rules'].includes(a.name)) {
      const label={pov:'POV',tense:'TENSE',tone:'TONE',voice:'REGISTER',rules:'ALWAYS OR NEVER'}[a.name];
      const before=await freshBook(d.book), book=structuredClone(before);
      const e=Object.values(book.entries||{}).find(x=>/^[\s*_#-]*(POV|POINT OF VIEW)\s*:/mi.test(String(x.content||'').replace(/^\(Storyloom:[^\n]*\)\n?/,'')) && !/^Current Writing Directive$/i.test(x.comment||''));
      if(!e)throw Error('This book has no “Voice and Boundaries” entry to save it in.');
      const re=new RegExp(`^([\\s*_#-]*${label}\\s*:).*$`,'mi');
      e.content=re.test(e.content)?e.content.replace(re,`$1 ${a.content}`):`${e.content}\n${label}: ${a.content}`;
      await c.saveWorldInfo(d.book,book,true); refreshEditor(d.book);
      d.history ??= []; d.history.push({id:crypto.randomUUID(),book:d.book,changes:buildChange(before,book),source:`assistant: ${a.name}`,at:new Date().toISOString()});
      bookUndo={uid:e.uid,before:before.entries[e.uid],after:book.entries[e.uid]};
      delete d.chapterValues[n][a.name];
    }
    await persist(); await writeValues(values); await applyMemory(); renderTeam();
    return {kind:'value',prevValues,prevChapter,chapter:n,bookUndo};
  }
  if(a.type==='set-narrator-card') {
    const ch=c.characters.find(x=>isGeneralNarrator(x.description)); if(!ch)throw Error(`There is no general narrator yet. Use Writing setup… on the Memory tab to make “${NARRATOR_NAME}”.`);
    const before=charSnapshot(ch);
    backup({kind:'character',label:`${ch.name} (before the Assistant’s change)`,target:{avatar:ch.avatar},before});
    await writeCharacter(ch.avatar,{description:a.content});
    return {kind:'narrator',avatar:ch.avatar,before};
  }
  throw Error(`Unknown change “${a.type}”.`);
}
async function undoSetupAction(a) {
  const c=context(), u=a.undo;
  if(u.kind==='preset'){await changeNovelPreset(p=>{for(const k of Object.keys(p))delete p[k]; Object.assign(p,structuredClone(u.before));},'undo');}
  else if(u.kind==='narrator'){await writeCharacter(u.avatar,{description:u.before.description});}
  else if(u.kind==='value') {
    const d=data(); d.chapterValues ??= {}; d.chapterValues[u.chapter]=u.prevChapter;
    if(u.bookUndo){const book=await freshBook(d.book); if(JSON.stringify(book.entries?.[u.bookUndo.uid])!==JSON.stringify(u.bookUndo.after))throw Error('“Voice and Boundaries” changed since; edit it in the lorebook instead.'); book.entries[u.bookUndo.uid]=u.bookUndo.before; await c.saveWorldInfo(d.book,book,true); refreshEditor(d.book);}
    await persist(); await writeValues(u.prevValues); await applyMemory(); renderTeam();
  }
}
async function applyAssistantAction(mi,id) {
  const st=assistantState(), a=st.messages[mi]?.actions?.find(x=>x.id===id); if(!a)return;
  if(!a.book) {
    requireIdle();
    try {a.undo=await applySetupAction(a); a.status='applied'; a.error=''; saveAssistant(); renderAssistant(); status(`Applied: ${describeAction(a)}`); logEvent('info','Assistant',`applied: ${describeAction(a)}`);}
    catch(e){a.error=e.message; saveAssistant(); renderAssistant(); throw e;}
    return;
  }
  requireIdle(); syncing=true;
  try {
    const c=context();
    if(!c.getWorldInfoNames().includes(a.book))throw Error(`There is no lorebook called “${a.book}”.`);
    const before=await freshBook(a.book);
    const {managed}=a.book===(()=>{try{return data().book;}catch{return '';}})()?await storyloomManaged():{managed:[]};
    const {book,uid}=applyAction(before,a,b=>createWorldInfoEntry(a.book,b),managed);
    await c.saveWorldInfo(a.book,book,true); refreshEditor(a.book);
    if(JSON.stringify(await freshBook(a.book))!==JSON.stringify(book))throw Error('The save could not be verified; check the lorebook.');
    a.status='applied'; a.error=''; a.undo={uid,before:before.entries?.[uid]??null,after:book.entries[uid]};
    saveAssistant(); renderAssistant(); status(`Applied: ${describeAction(a)}`);
  } catch(e) {a.error=e.message; saveAssistant(); renderAssistant(); throw e;}
  finally {syncing=false;queueSync();}
}
async function undoAssistantAction(mi,id) {
  const st=assistantState(), a=st.messages[mi]?.actions?.find(x=>x.id===id); if(!a?.undo)return;
  if(!a.book){requireIdle(); await undoSetupAction(a); a.status='pending'; delete a.undo; saveAssistant(); renderAssistant(); status(`Undone: ${describeAction(a)}. The card can be applied again.`); logEvent('info','Assistant',`undone: ${describeAction(a)}`); return;}
  requireIdle(); syncing=true;
  try {
    const c=context(), book=await freshBook(a.book), {uid,before,after}=a.undo;
    if(JSON.stringify(book.entries?.[uid]??null)!==JSON.stringify(after))throw Error(`“${a.title}” was changed after you applied this, so it can’t be undone safely. Edit it in the World Info editor instead.`);
    if(before===null)delete book.entries[uid]; else book.entries[uid]=before;
    await c.saveWorldInfo(a.book,book,true); refreshEditor(a.book);
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
    let results=[],method='keywords',terms=[];
    try {
      const chunks=await ensureDocs();
      const idx=docsIndexState(), src=vectorSource(c.extensionSettings.vectors);
      const indexed=src && idx.source===src.source && idx.count===chunks.length;
      const prior=st.messages.slice(-3,-1).map(m=>m.content).join(' ').slice(-600);
      // Questions use story words; the docs use SillyTavern's. A short request translates first.
      terms=[];
      try {status('Working out which SillyTavern features this is about…');terms=parseSearchTerms(await llm(c,searchTermsPrompt(`${prior}\n${text}`.trim()),profile,controller.signal,600,'You map questions to SillyTavern documentation search terms.',direct));}
      catch(e){if(controller.signal.aborted)throw e;warnLog('Storyloom search terms:',e);}
      status('Reading the SillyTavern docs…');
      ({results,method}=await searchDocsMany({fetchFn:fetch,headers:c.getRequestHeaders(),source:indexed?src:null,chunks},[...terms,text],6));
    } catch(e) {warnLog('Storyloom docs:',e); docsLabel(`SillyTavern docs unavailable (${e.message}).`);}
    let known=[];
    try {const sl=await loadStoryloomDocs(); if(sl.length)known=(await searchDocsMany({fetchFn:fetch,headers:c.getRequestHeaders(),source:null,chunks:sl},[text,...terms],4)).results;} catch(e){warnLog('Storyloom knowledge search:',e);}
    status('Reading your setup…');
    const snapshot=await gatherSnapshot(text);
    const recent=st.messages.slice(-15,-1).map(m=>`${m.role==='user'?'Writer':'Assistant'}: ${m.content}`).join('\n\n');
    const prompt=`SETUP SNAPSHOT\n${snapshot}\n\nSILLYTAVERN DOCS EXCERPTS (found by ${method})\n${results.map(r=>r.text).join('\n\n---\n\n')||'(none found)'}\n\nSTORYLOOM KNOWLEDGE (research behind Storyloom's writing setup)\n${known.map(r=>r.text).join('\n\n---\n\n')||'(none found)'}\n\n${st.summary?`EARLIER CONVERSATION SUMMARY\n${st.summary}\n\n`:''}RECENT CONVERSATION\n${recent||'(this is the first message)'}\n\nWriter: ${text}`;
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
      } catch(e) {warnLog('Storyloom assistant summary:',e);}
    }
  } finally {assistantBusy=false;renderModelWork(null);}
}
function renderTabs() {
  const panel=document.getElementById('na-panel'); if(!panel)return;
  for(const tab of ['story','memory','assistant'])document.querySelector('#na-tab-'+tab).classList.toggle('is-active',activeTab===tab);
  document.querySelector('#na-assistant').hidden=settingsOpen || activeTab!=='assistant';
  document.querySelector('#na-memory').hidden=settingsOpen || activeTab!=='memory';
  if(activeTab==='memory' && !noChatOpen())renderMemory().catch(fail);
  if(activeTab==='assistant'){renderAssistant();renderDocsStatus();}
}

/* ---------- Memory tab ---------- */
/** Books arranged before the Memory tab still send Current Chapter through the lorebook: re-arrange once. */
async function upgradeLayout(d=null,book=null) {
  try {
    d ??= data();
    if(!d?.book || d.interview?.phase!=='done' || context().chatMetadata?.world_info!==d.book)return false;
    book ??= await freshBook(d.book);
    const cc=findEntry(book,'Current Chapter');
    if(!cc || (cc.disable && /Still to come|final [a-z]+: bring the story/i.test(String(cc.content||''))))return false;
    await organizeBook();
    return true;
  } catch(e) {warnLog('Storyloom layout upgrade:',e); return false;}
}
/** The lorebook entry behind a memory item (the outline item uses the template's outline entry). */
const memoryTitle=(item,d)=>item.fromOutline?tpl(d).outline.title:item.title;
const memoryText=(item,e)=>item.fromOutline?outlineBody(e?.content):String(e?.content||'');
/** Send each memory item into the main chat's prompt with its chosen placement (or clear it). */
async function applyMemory() {
  const c=context();
  let book=null, d=null;
  try {d=data(); if(d.book && c.chatMetadata?.world_info===d.book && c.getWorldInfoNames().includes(d.book))book=await freshBook(d.book);} catch {}
  const vars={chapter:d?.chapter||1,unit:d?tpl(d).unit:'Chapter'};
  for(const item of MEMORY_ITEMS) {
    const e=book&&d?findEntry(book,memoryTitle(item,d)):null;
    const inj=injection(item,book?memoryText(item,e):'',e?.storyloom_memory||item.place,vars);
    c.setExtensionPrompt(memoryKey(item),inj.value,inj.position,inj.depth,false,inj.role);
  }
  const note=book&&d?chapterNote(d):{}, u=vars.unit;
  const narration=(note.pov||note.tense)?`NARRATION FOR THIS ${u.toUpperCase()} (this overrides the writing directive's point of view and tense): ${[note.pov&&`POV: ${note.pov}`,note.tense&&`Tense: ${note.tense}`].filter(Boolean).join('; ')}`:'';
  c.setExtensionPrompt('storyloom_narration',narration,1,2,false,0);
}
let memoryTimer;
const queueMemory=()=>{clearTimeout(memoryTimer);memoryTimer=setTimeout(()=>applyMemory().catch(e=>warnLog('Storyloom memory:',e)),400);};
/** Save one memory item's text and placement into its (switched-off) lorebook entry. */
async function saveMemoryItem(item,content,place) {
  requireIdle();
  const c=context(), d=data();
  if(!d.book || c.chatMetadata.world_info!==d.book)throw Error('Link this novel’s lorebook to the chat first.');
  syncing=true;
  try {
    const before=await freshBook(d.book), book=structuredClone(before);
    const title=memoryTitle(item,d);
    let entry=findEntry(book,title);
    if(!entry){if(item.fromOutline)throw Error('This novel has no outline entry yet.'); entry=createWorldInfoEntry(d.book,book); if(!entry)throw Error('Could not create the memory entry.'); entry.comment=title; entry.key=[];}
    if(content!==undefined && !item.fromOutline)entry.content=content;
    if(place)entry.storyloom_memory=place;
    entry.disable=true; entry.constant=false;
    await c.saveWorldInfo(d.book,book,true); refreshEditor(d.book);
    if(JSON.stringify(await freshBook(d.book))!==JSON.stringify(book))throw Error('The save could not be verified.');
    d.history ??= []; d.history.push({id:crypto.randomUUID(),book:d.book,changes:buildChange(before,book),source:`memory: ${item.label}`,at:new Date().toISOString()}); if(d.history.length>30)d.history.shift();
    await persist();
  } finally {syncing=false;queueSync();}
  await applyMemory();
}
const WHERE_SHORT={top:'top of the prompt','system-end':'end of the system prompt','chat-start':'start of the chat'};
/** Memory tab: the chapter team, then a plain list of what the story AI remembers. Placement lives in Extensions → Storyloom. */
async function renderMemory() {
  renderPlacement().catch(e=>warnLog('Storyloom placement:',e));
  const root_=document.getElementById('na-memory'); if(!root_ || root_.hidden)return;
  let d=null,book=null;
  try{d=data(); if(d.book && context().getWorldInfoNames().includes(d.book))book=await freshBook(d.book);}catch{}
  const ready=!!(d?.book && d.interview?.phase==='done');
  root_.querySelector('#na-memory-empty').hidden=ready;
  root_.querySelector('#na-team').hidden=!ready;
  root_.querySelector('#na-remembers').hidden=!ready;
  if(!ready)return;
  if(await upgradeLayout(d,book))book=await freshBook(d.book);
  renderTeam(d);
  const list=root_.querySelector('#na-remember-list');
  list.replaceChildren(...MEMORY_ITEMS.map(item=>{
    const e=book?findEntry(book,memoryTitle(item,d)):null, place=e?.storyloom_memory||item.place, text=memoryText(item,e), words=(text.match(/\S+/g)||[]).length;
    const where=place.where==='off'?'not sent':place.where==='chat-depth'?`sent ${place.depth} messages from the end`:`sent at the ${WHERE_SHORT[place.where]||place.where}`;
    const btn=el('button',{type:'button',textContent:'View / edit'}), area=el('div',{className:'storyloom-remember-body',hidden:true});
    const ta=el('textarea',{rows:8,readOnly:!!item.fromOutline}); ta.value=text;
    area.append(el('p',{className:'storyloom-hint',textContent:item.hint}),ta);
    if(item.fromOutline)area.append(el('p',{className:'storyloom-hint',textContent:'The outline itself is edited in the lorebook (View entries on the Story tab).'}));
    else {const sv=el('button',{type:'button',textContent:'Save'}); sv.onclick=async()=>{lastAction=`Save ${item.label}`;try{await saveMemoryItem(item,ta.value);status(`${item.label} saved and in place for the next reply.`);renderMemory();}catch(err){fail(err);}}; area.append(el('div',{className:'storyloom-row'},sv));}
    btn.onclick=()=>{area.hidden=!area.hidden;btn.textContent=area.hidden?'View / edit':'Close';};
    return el('li',{className:'storyloom-remember'},el('div',{className:'storyloom-remember-head'},el('span',{},el('strong',{textContent:item.label}),el('small',{textContent:` — ${words?`${words.toLocaleString()} words`:'empty'}, ${where}`})),btn),area);
  }));
}
/** Extensions → Storyloom → Memory placement: where each memory item goes and the instruction around it. */
function placementMarkup() {
  const opts=(o)=>Object.entries(o).map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
  return MEMORY_ITEMS.map(item=>`<div class="storyloom-memory-item" data-memory="${item.key}">
    <strong>${item.label}</strong>
    <label>Instruction around it <small>({chapter}, {Unit}, {units} are filled in)</small><textarea class="text_pole na-mem-header" rows="2"></textarea></label>
    <div class="storyloom-row">
      <label>Where <select class="text_pole na-mem-where">${opts(WHERE)}</select></label>
      <label class="na-mem-depth-label">Messages from the end <input class="text_pole na-mem-depth" type="number" min="0" max="${CHAT_START_DEPTH}" step="1"></label>
      <label class="na-mem-role-label">Sent as <select class="text_pole na-mem-role"><option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option></select></label>
      <button class="menu_button na-mem-save" type="button">Save placement</button>
    </div></div>`).join('');
}
async function renderPlacement() {
  const box=document.getElementById('sl-placement'); if(!box)return;
  let d=null,book=null;
  try{d=data(); if(d.book && context().getWorldInfoNames().includes(d.book))book=await freshBook(d.book);}catch{}
  const ready=!!(d?.book && d.interview?.phase==='done');
  box.querySelector('.sl-placement-empty').hidden=ready; box.querySelector('.sl-placement-items').hidden=!ready;
  box.querySelector('.sl-placement-book').textContent=ready?`For “${d.book}” (the novel in the open chat).`:'';
  if(!ready)return;
  for(const item of MEMORY_ITEMS) {
    const b=box.querySelector(`[data-memory="${item.key}"]`), e=book?findEntry(book,memoryTitle(item,d)):null, place=e?.storyloom_memory||item.place;
    if(b.contains(document.activeElement))continue;
    b.querySelector('.na-mem-header').value=place.header ?? item.header;
    b.querySelector('.na-mem-where').value=place.where;
    b.querySelector('.na-mem-depth').value=String(place.depth??3);
    b.querySelector('.na-mem-role').value=place.role||'system';
    b.querySelector('.na-mem-depth-label').hidden=place.where!=='chat-depth';
    b.querySelector('.na-mem-role-label').hidden=place.where==='off';
  }
}
/** Open a fresh chat for the chapter — with the chosen narrator — and carry the novel over: lorebook link, directive, memory. */
async function startChapterChat(narrator=null) {
  const c=context(), d=data(), bookName=d.book, previous=c.chatId, t=tpl(d), n=d.chapter||1;
  if(narrator) {
    d.chapterNotes ??= {}; d.chapterNotes[n]={...(narrator.notes||{})};
    if(narrator.values && Object.keys(narrator.values).length){d.chapterValues ??= {}; d.chapterValues[n]={...narrator.values};}
    const reg=narratorRegistry(d).find(x=>x.avatar===narrator.avatar); if(reg && !reg.chapters.includes(n))reg.chapters.push(n);
  }
  const copy=structuredClone(d);
  for(const k of ['directive','pending','processed','review','queueError','pendingContinuity','pendingWrite','team','pendingFresh'])delete copy[k];
  const curAvatar=c.characters?.[c.characterId]?.avatar;
  if(narrator && narrator.avatar!==curAvatar) {
    const idx=c.characters.findIndex(x=>x.avatar===narrator.avatar);
    if(idx<0)throw Error('The narrator character could not be found. It may have been deleted.');
    await c.selectCharacterById(idx);
    const switched=()=>context().characters?.[context().characterId]?.avatar===narrator.avatar && !!context().chatId;
    for(let i=0;i<40 && !switched();i++)await new Promise(r=>setTimeout(r,250));
    if(!switched())throw Error('SillyTavern could not open the narrator’s chat. Close any character editor or stop the main chat’s generation, then try again.');
    const now=context().chat; if(now.length>1 || now.some(m=>m.is_user))await doNewChat();
  } else await doNewChat();
  if(context().chatId===previous && context().characters?.[context().characterId]?.avatar===curAvatar)throw Error('SillyTavern could not open a new chat. Close any character editor or stop the main chat’s generation, then use “Start a new novel”… or open a new chat and choose this lorebook.');
  const state=root();
  Object.defineProperty(state.novels,bookName,{value:copy,writable:true,enumerable:true,configurable:true});
  state.selected=bookName;
  await persist();
  if(!await attachBook(bookName,context()))throw Error('The new chat could not be linked to the novel’s lorebook.');
  await setupNovel();
  try {if(usesGeneralNarrator())await organizeBook(n); await fillBookValues({quiet:true});} catch(e){warnLog('Storyloom book settings:',e);}
  for(let i=0;i<20 && !context().chat.length;i++)await new Promise(r=>setTimeout(r,150)); // the greeting arrives a moment after the chat opens
  const c2=context(), title=(copy.outlineChapters||[]).find(x=>x.number===n)?.title||'', heading=`${t.unit} ${n}${title?` — ${title}`:''}`;
  if(c2.chat.length===1 && !c2.chat[0].is_user && c2.chat[0].mes!==heading) {
    const m=c2.chat[0]; m.mes=heading; if(Array.isArray(m.swipes)){m.swipes=[heading];m.swipe_id=0;m.swipe_info=[m.swipe_info?.[0]||{}];}
    await c2.saveChat(); await c2.reloadCurrentChat();
  }
  await applyMemory();
  try {
    const name=`${bookName} — ${t.unit} ${n}${title?` — ${title}`:''}`.replace(/[\\/:*?"<>|]/g,'-').slice(0,120);
    if(context().chatId!==name)await context().renameChat(context().chatId,name);
  } catch(e){warnLog('Storyloom: could not rename the chapter chat:',e);}
  logEvent('info','Next chapter',`${t.unit} ${n} opened in a fresh chat${narrator?` (narrator ${narrator.avatar})`:''}`);
  options(); renderMemory();
  status(`This is a fresh chat for ${t.unit} ${n}${title?` — ${title}`:''}. Story so far, Previously, the plan and the narrator are in place.`);
}

/* ---------- Export book: the narration of every chapter, in order, as .docx or .txt ---------- */
async function chatFile(avatar,file) {
  const r=await fetch('/api/chats/get',{method:'POST',headers:context().getRequestHeaders(),body:JSON.stringify({avatar_url:avatar,file_name:String(file).replace(/\.jsonl$/,'')}),cache:'no-store'});
  if(!r.ok)return null;
  const lines=await r.json(); return Array.isArray(lines)&&lines.length?lines.slice(1):null;
}
async function chatNames(avatar) {
  try {const r=await fetch('/api/characters/chats',{method:'POST',headers:context().getRequestHeaders(),body:JSON.stringify({avatar_url:avatar,simple:true})}); const v=await r.json(); return Array.isArray(v)?v.map(x=>x.file_id):[];}
  catch{return [];}
}
/** Find each chapter's prose: the chat recorded at seal, else a chat named “Book — Chapter N…”, else this chat for the current chapter. */
async function collectChapters(d,c) {
  const u=tpl(d).unit, outline=d.outlineChapters||[], cur=d.chapter||1, rec=d.chapterChats||{};
  const avatars=[...new Set([c.characters?.[c.characterId]?.avatar,...narratorRegistry(d).map(x=>x.avatar),...Object.values(rec).map(x=>x.avatar)].filter(Boolean))];
  const prefix=`${d.book} — ${u} `.replace(/[\\/:*?"<>|]/g,'-');
  let named=null;
  const byName=async n=>{
    named ??= (await Promise.all(avatars.map(async a=>(await chatNames(a)).map(f=>({avatar:a,file:f}))))).flat();
    return named.filter(x=>x.file.startsWith(prefix) && new RegExp(`^${u}\\s+${n}(\\D|$)`,'i').test(x.file.slice(prefix.length-u.length-1))).sort((a,b)=>a.file.length-b.file.length)[0];
  };
  const chapters=[], numbers=[...new Set([...outline.map(x=>x.number),...Object.keys(rec).map(Number),cur])].filter(Number.isFinite).sort((a,b)=>a-b);
  for(const n of numbers) {
    const title=outline.find(x=>x.number===n)?.title||'', heading=`${u} ${n}${title?` — ${title}`:''}`;
    let text='', where='';
    try {
      const r=rec[n];
      if(r) {
        const msgs=r.chatId===c.chatId?c.chat:await chatFile(r.avatar,r.chatId);
        if(msgs){text=chapterProse(msgs,{start:r.start||0,end:r.chatId===c.chatId&&n===cur?null:r.end,unit:u});where=r.chatId;}
      }
      if(!text && n===cur) {
        const start=d.chapterStart?.chatId===c.chatId && d.chapterStart?.chapter===n ? d.chapterStart.index : (rec[n-1]?.chatId===c.chatId?rec[n-1].end:0);
        text=chapterProse(c.chat,{start,unit:u}); where=c.chatId;
      }
      if(!text) {const f=await byName(n); if(f){const msgs=await chatFile(f.avatar,f.file); if(msgs){text=chapterProse(msgs,{unit:u});where=f.file;}}}
    } catch(e){warnLog(`Storyloom export: ${u} ${n}:`,e);}
    chapters.push({number:n,heading,text,where});
  }
  const last=Math.max(0,...chapters.filter(x=>x.text).map(x=>x.number));
  return chapters.filter(x=>x.number<=last);
}
function saveFile(name,bytes,type) {
  const url=URL.createObjectURL(new Blob([bytes],{type})), a=Object.assign(document.createElement('a'),{href:url,download:name});
  document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function exportBook() {
  const c=context(), d=data(), u=tpl(d).unit;
  if(!d.book)throw Error('Open a chat that has a Storyloom book first.');
  status('Gathering the chapters…');
  const chapters=await collectChapters(d,c);
  if(!chapters.some(x=>x.text))throw Error(`No ${u.toLowerCase()} text was found yet. Write ${u} 1 in the main chat first.`);
  const missing=chapters.filter(x=>!x.text).map(x=>x.number), words=chapters.reduce((n,x)=>n+(x.text.match(/\S+/g)||[]).length,0);
  const R=c.POPUP_RESULT||{};
  const pick=await new c.Popup(`<h3>Export ${escHtml(d.book)}</h3><p>${chapters.length} ${u.toLowerCase()}${chapters.length===1?'':'s'}, about ${words.toLocaleString()} words — the narrator’s text only (the showing swipe), without your directions or the chapter-heading greetings.</p>${missing.length?`<p><b>Not found:</b> ${u} ${missing.join(', ')}. Their chats may have been renamed or deleted; those ${u.toLowerCase()}s get a placeholder line.</p>`:''}<p><b>Word (.docx)</b> opens in Word, Google Docs and LibreOffice, with each ${u.toLowerCase()} on a new page. <b>Text (.txt)</b> is plain text.</p>`,c.POPUP_TYPE.TEXT,'',{okButton:'Word (.docx)',cancelButton:'Cancel',customButtons:[{text:'Text (.txt)',result:2}]}).show();
  const book={title:d.book,chapters};
  if(pick===2)saveFile(fileName(d.book,'txt'),bookText(book),'text/plain;charset=utf-8');
  else if(pick===(R.AFFIRMATIVE??1))saveFile(fileName(d.book,'docx'),bookDocx(book),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  else return status('Nothing was exported.');
  logEvent('info','Export book',`${chapters.length} ${u.toLowerCase()}s, ${words} words${missing.length?`; not found: ${missing.join(', ')}`:''}`,chapters.map(x=>`${x.heading}: ${x.where||'not found'}`).join('\n'));
  status(`Exported ${chapters.length} ${u.toLowerCase()}${chapters.length===1?'':'s'} (${words.toLocaleString()} words). Check your browser’s downloads.`);
}

/* ---------- Log: what Storyloom did, what failed and why (Extensions → Storyloom → Log) ---------- */
const LOG_KEY='storyloom-log';
const fullLog=()=>{try{return !!context().extensionSettings.storyloom?.logFull;}catch{return false;}};
function readLog(){try{const v=JSON.parse(localStorage.getItem(LOG_KEY)||'[]');return Array.isArray(v)?v:[];}catch{return [];}}
function writeLog(list){try{localStorage.setItem(LOG_KEY,JSON.stringify(list));}catch{try{localStorage.setItem(LOG_KEY,JSON.stringify(list.slice(-Math.ceil(list.length/2)).map(e=>({...e,detail:e.detail?.slice(0,500)}))));}catch{}}}
let logRenderTimer;
function logEvent(level,area,message,detail='') {
  try{writeLog(addEntry(readLog(),{level,area,message,detail},{full:fullLog()}));clearTimeout(logRenderTimer);logRenderTimer=setTimeout(renderLog,200);}
  catch(e){console.warn('Storyloom log:',e);}
}
/** console.warn plus a log entry. */
function warnLog(label,...rest) {
  console.warn(label,...rest);
  logEvent('warn','',String(label).replace(/^Storyloom\s*/,'').replace(/:\s*$/,'')||'warning',rest.map(r=>r?.stack||r?.message||(typeof r==='string'?r:JSON.stringify(r))).join(' '));
}
function renderLog() {
  const box=document.getElementById('sl-log-list'); if(!box)return;
  const list=filterEntries(readLog(),document.getElementById('sl-log-filter')?.value||'all').slice().reverse();
  box.replaceChildren(...(list.length?list.map(e=>{
    const li=document.createElement('li'); li.className=`storyloom-log-${e.level}`;
    const head=document.createElement('div'); head.textContent=`${new Date(e.at).toLocaleString()} · ${e.level.toUpperCase()}${e.area?` · ${e.area}`:''} — ${e.message}`; li.append(head);
    if(e.detail){const pre=document.createElement('pre');pre.textContent=e.detail;li.append(pre);}
    return li;
  }):[Object.assign(document.createElement('li'),{textContent:'Nothing logged yet.'})]));
}
/** Open SillyTavern's Extensions menu at Storyloom's section (and a part of it). */
function openStoryloomSettings(section='') {
  const block=document.getElementById('rm_extensions_block');
  if(block && !block.classList.contains('openDrawer'))document.querySelector('#extensions-settings-button .drawer-toggle')?.click();
  const drawer=document.getElementById('storyloom-ext'), content=drawer?.querySelector('.inline-drawer-content');
  if(content && getComputedStyle(content).display==='none')drawer.querySelector('.inline-drawer-toggle')?.click();
  renderExtSettings();
  const target=section?document.getElementById(section):null; if(target?.tagName==='DETAILS')target.open=true;
  setTimeout(()=>(target||drawer)?.scrollIntoView({block:'start',behavior:'smooth'}),350);
}

/* ---------- The chapter team: Checker → Editor → Reader → Revise → Seal ---------- */
function storedRoles(){const c=context();c.extensionSettings.storyloom ??= {};return c.extensionSettings.storyloom.roles ??= {};}
const teamSettings=()=>roleSettings(storedRoles());
/** The writer's notes for one chapter (narrator, Checker/Editor instructions, POV/tense). */
const chapterNote=(d,n=d.chapter||1)=>d.chapterNotes?.[n]||{};
/** Ask one role. Uses the role's own model if set; if that fails or answers in a form Storyloom can't read, asks Storyloom's connection once. */
async function roleCall(key,prompt,{check=()=>true,signal,tokens}={}) {
  const c=context(), d=data(), rs=teamSettings(), r=rs[key], note=chapterNote(d);
  const system=roleSystem(key,rs,key==='checker'?note.checker:key==='editor'?note.editor:'');
  let base='',direct=null; try{base=d.profile||'';direct=directSnapshot(d,c);}catch{}
  tokens ??= Number(d.responseTokens||12000);
  const opts={sampling:ROLES[key].sampling,label:ROLES[key].label};
  if(!r.profile)return llm(c,prompt,base,signal,tokens,system,direct,opts);
  let raw='', why='';
  try {raw=await llm(c,prompt,r.profile,signal,tokens,system,null,opts); if(check(raw))return raw; why='answered in a form Storyloom couldn’t read';}
  catch(e){if(signal?.aborted)throw e; why=`failed (${e.message})`;}
  logEvent('warn',ROLES[key].label,`${ROLES[key].label}’s own model ${why}; asking Storyloom’s connection instead.`,raw.slice(0,1500));
  status(`${ROLES[key].label}’s model ${why}. Asking Storyloom’s own connection instead…`);
  return llm(c,prompt,base,signal,tokens,system,direct,opts);
}
/** The chapter as the reader sees it: the story's own messages, one part each. */
const storyIndexes=chat=>(chat||[]).map((m,i)=>m && !m.is_user && !m.is_system && String(m.mes||'').trim()?i:-1).filter(i=>i>=0);
const chapterParts=chat=>storyIndexes(chat).map(i=>String(chat[i].mes).trim());
function teamState(d=data()) {const n=d.chapter||1; if(!d.team || d.team.chapter!==n)d.team={chapter:n,done:[]}; d.team.done ??= []; return d.team;}
function markDone(t,key){t.done=[...new Set([...(t.done||[]).filter(k=>STEP_ORDER.indexOf(k)<STEP_ORDER.indexOf(key)),key])];}
const STEP_ORDER=STEPS.map(s=>s.key);
function readyForTeam(d) {
  if(!d.book || d.interview?.phase!=='done')throw Error('Create the outline first.');
  if(!chapterParts(context().chat).length)throw Error('There is nothing written in this chat yet. Write the chapter in the main chat first.');
}
async function teamRun(label,fn) {
  requireIdle();
  const controller=new AbortController(); renderModelWork(controller); busy=true;
  logEvent('info',label,'started');
  try {await fn(controller.signal); logEvent('info',label,'finished');}
  finally {busy=false;renderModelWork(null);try{await persist();}catch(e){warnLog('Storyloom team save:',e);} renderTeam();}
}
async function stepLint() {
  const c=context(), d=data(); readyForTeam(d);
  const parts=chapterParts(c.chat), text=parts.join('\n\n'), f=await bookFacts(d), n=d.chapter||1, note=chapterNote(d);
  const exact=exactLint(text,{tense:note.tense||f.tense,pov:note.pov||f.pov,knownNames:f.knownNames,castNames:f.castNames,targetWords:f.target});
  await teamRun('Lint',async signal=>{
    let ai=[], aiNote='', big='';
    if(teamSettings().checker.enabled) {
      status(`The Checker is reading ${f.unit} ${n}…`);
      try {
        const raw=await roleCall('checker',lintInstruction({unit:f.unit,number:n,chapterText:text,facts:f.facts,chapterNote:note.checker||''}),{signal,check:r=>parseFindings(r).length>0||/no problems found/i.test(r)});
        ai=parseFindings(raw); big=biggestProblem(raw);
        if(!ai.length && !/no problems found/i.test(raw)){aiNote='The Checker’s book check came back in a form Storyloom couldn’t read; only the exact checks are shown.';logEvent('warn','Lint',aiNote,raw.slice(0,2000));}
      } catch(e) {if(signal.aborted)throw e; aiNote=`The Checker’s book check failed (${e.message}); only the exact checks are shown.`; logEvent('error','Lint',aiNote,e?.stack);}
    } else aiNote='The Checker is switched off in Extensions → Storyloom, so only the exact checks ran.';
    const findings=[...ai,...exact].map((x,i)=>({...x,id:`L${i}`}));
    const t=teamState(d);
    Object.assign(t,{lint:{at:new Date().toISOString(),words:(text.match(/\S+/g)||[]).length,findings,note:aiNote,big},picks:findings.map(x=>x.id),markup:null,reader:null,notePicks:null,revision:null,accepted:false});
    markDone(t,'lint');
    status(findings.length?`${findings.length} finding${findings.length===1?'':'s'} in ${f.unit} ${n}. Untick any you don’t want acted on, then send it to the Editor.`:`${f.unit} ${n}: no problems found.`);
  });
}
async function stepMarkup() {
  const c=context(), d=data(); readyForTeam(d);
  const t=teamState(d), parts=chapterParts(c.chat), f=await bookFacts(d), n=d.chapter||1;
  const findings=(t.lint?.findings||[]).filter(x=>(t.picks||[]).includes(x.id));
  await teamRun('Editor',async signal=>{
    status(`The Editor is marking up ${f.unit} ${n}${findings.length?` (${findings.length} approved finding${findings.length===1?'':'s'} first)`:''}…`);
    const raw=await roleCall('editor',markupInstruction({unit:f.unit,number:n,parts,facts:f.facts,findings}),{signal,check:r=>parseNotes(r,'editor').length>0||/OVERALL\s*:/i.test(r)});
    const notes=parseNotes(raw,'editor').map((x,i)=>({...x,id:`E${i}`}));
    if(!notes.length && !overallLine(raw)){logEvent('error','Editor','markup unreadable',raw.slice(0,2000));throw Error('The Editor’s notes came back in a form Storyloom couldn’t read. Nothing was changed; try again (the reply is in the log).');}
    t.markup={at:new Date().toISOString(),notes,overall:overallLine(raw)}; t.notePicks=null; t.revision=null; t.accepted=false; markDone(t,'markup');
    status(`The Editor made ${notes.length} note${notes.length===1?'':'s'}. ${teamSettings().reader.enabled?'Next: the Reader.':'Review the notes, then Revise.'}`);
  });
}
async function stepReader() {
  const c=context(), d=data(); readyForTeam(d);
  const t=teamState(d), parts=chapterParts(c.chat), n=d.chapter||1, u=tpl(d).unit;
  const book=await freshBook(d.book), soFar=findEntry(book,MEMORY_ITEMS[0].title)?.content||'', previously=findEntry(book,MEMORY_ITEMS[1].title)?.content||'';
  await teamRun('Reader',async signal=>{
    status(`The Reader is reading ${u} ${n}…`);
    const raw=await roleCall('reader',readerInstruction({unit:u,number:n,parts,storySoFar:soFar,previously}),{signal,check:r=>parseNotes(r,'reader').length>0||/OVERALL\s*:/i.test(r)});
    const notes=parseNotes(raw,'reader').map((x,i)=>({...x,id:`R${i}`,worked:/^worked\s*:/i.test(x.note)}));
    if(!notes.length && !overallLine(raw)){logEvent('error','Reader','reactions unreadable',raw.slice(0,2000));throw Error('The Reader’s notes came back in a form Storyloom couldn’t read. Nothing was changed; try again (the reply is in the log).');}
    const keptEditor=(t.notePicks||(t.markup?.notes||[]).map(x=>x.id)).filter(id=>id.startsWith('E'));
    t.reader={at:new Date().toISOString(),notes,overall:overallLine(raw)}; t.notePicks=[...keptEditor,...notes.filter(x=>!x.worked).map(x=>x.id)]; t.revision=null; t.accepted=false; markDone(t,'reader');
    status('The Reader is done. Keep or untick the notes below, then Revise.');
  });
}
const allNotes=t=>[...(t.markup?.notes||[]),...(t.reader?.notes||[]).filter(n=>!n.worked)];
async function stepRevise() {
  const c=context(), d=data(); readyForTeam(d);
  const t=teamState(d), parts=chapterParts(c.chat), f=await bookFacts(d), n=d.chapter||1;
  const picks=t.notePicks||allNotes(t).map(x=>x.id), notes=allNotes(t).filter(x=>picks.includes(x.id));
  if(!notes.length)throw Error('Tick at least one note for the Editor to fix — or go straight to Seal.');
  await teamRun('Revise',async signal=>{
    status(`The Editor is revising ${f.unit} ${n} (${notes.length} note${notes.length===1?'':'s'})…`);
    const raw=await roleCall('editor',reviseInstruction({unit:f.unit,number:n,parts,facts:f.facts,notes}),{signal,check:r=>!!parseRevision(r,parts.length),tokens:16000});
    const revised=parseRevision(raw,parts.length);
    if(!revised){logEvent('error','Revise',`revision incomplete (needed ${parts.length} parts)`,raw.slice(0,3000));throw Error(`The Editor’s revision didn’t come back whole (all ${parts.length} part${parts.length===1?'':'s'} are needed). Nothing was changed; try again.`);}
    t.revision={at:new Date().toISOString(),original:parts,parts:revised,notes:notes.map(x=>x.id)}; t.accepted=false;
    status('The revision is ready. Read the changes below, then Accept or Discard.');
  });
}
async function acceptRevision() {
  requireIdle();
  const c=context(), d=data(), t=teamState(d), r=t.revision; if(!r)return;
  const idx=storyIndexes(c.chat);
  if(idx.length!==r.parts.length || idx.some((i,k)=>String(c.chat[i].mes).trim()!==r.original[k]))throw Error('The chapter changed in the chat since the Editor read it. Run Revise again.');
  backup({kind:'chapter',label:`${tpl(d).unit} ${d.chapter||1} before the revision`,target:{chat:c.chatId},before:r.original});
  let changed=0;
  idx.forEach((i,k)=>{
    const m=c.chat[i], next=r.parts[k]; if(next===String(m.mes).trim())return;
    if(!Array.isArray(m.swipes) || !m.swipes.length){m.swipes=[m.mes];m.swipe_info=[{send_date:m.send_date,extra:structuredClone(m.extra||{})}];m.swipe_id=0;}
    else m.swipes[m.swipe_id??0]=m.mes; // keep exactly what was on screen as the original
    m.swipes.push(next); if(Array.isArray(m.swipe_info))m.swipe_info.push({send_date:m.send_date,extra:{}});
    m.swipe_id=m.swipes.length-1; m.mes=next; changed++;
  });
  t.accepted=true; markDone(t,'revise');
  await c.saveChat(); await c.reloadCurrentChat();
  logEvent('info','Revise',`accepted: ${changed} message${changed===1?'':'s'} changed; originals kept as swipes`);
  status(`Revision accepted. ${changed} message${changed===1?'':'s'} changed — the original is kept as the previous swipe on each. Next: Seal.`);
  renderTeam();
}
async function discardRevision() {const t=teamState(); t.revision=null; await persist(); renderTeam(); status('Revision discarded. The chapter is unchanged.');}

/** A chapter's plan from the outline entry: {number, title, text}. */
async function chapterPlan(d,n) {try{const t=tpl(d), book=await freshBook(d.book); return chapterList(outlineBody(findEntry(book,t.outline.title)?.content),t.unit).find(x=>x.number===n)||null;}catch{return null;}}
const shortWho=n=>String(n?.who||n?.name||'').split(/\s[—–-]\s|[,(;]/)[0].trim();
/** Narrators this book has used (character cards), with the chapters each narrated. */
function narratorRegistry(d) {d.narrators ??= []; return d.narrators;}
function currentNarrator(d,c=context(),{record=false}={}) {
  const ch=c.characters?.[c.characterId]; if(!ch)return null;
  const reg=narratorRegistry(d); let n=reg.find(x=>x.avatar===ch.avatar);
  if(!n){n={avatar:ch.avatar,name:ch.name,who:narratorLabel(ch.description)||ch.name,chapters:[],notes:{}};reg.push(n);}
  const num=d.chapter||1; if(record && !n.chapters.includes(num))n.chapters.push(num);
  return n;
}

const LINT_LABELS={GRAMMAR:'Grammar',CHARACTER:'Out of character',VOICE:'Voice',['CHAPTER ORDER']:'Wrong chapter',TIMELINE:'Timeline',PERIOD:'Period / setting',RULE:'Your rules',CONTINUITY:'Sealed facts',PLAN:'Not done yet (from the plan)',UNLISTED:'Not in the book',NAME:'Name spelling',POV:'Point of view',TENSE:'Tense',REPEAT:'Repetition',STOCK:'Stock phrasing',LENGTH:'Length'};
const el=(tag,props={},...kids)=>{const e=Object.assign(document.createElement(tag),props);e.append(...kids.filter(k=>k!=null&&k!==false));return e;};
function checkList(items,picked,onToggle,render) {
  const ul=el('ul',{className:'storyloom-lint-list'});
  for(const it of items) {
    const box=el('input',{type:'checkbox',checked:picked.includes(it.id)}); box.onchange=()=>onToggle(it.id,box.checked);
    ul.append(el('li',{},el('label',{className:'storyloom-pick'},box,el('div',{className:'storyloom-pick-body'},...render(it)))));
  }
  return ul;
}
const noteBits=n=>[el('b',{className:`storyloom-sev is-${n.weight==='must'?'hard':'soft'}`,textContent:n.weight==='must'?'MUST':'SUGGEST'}),el('small',{textContent:` ${n.where} `}),el('q',{textContent:n.quote}),el('div',{textContent:n.note})];
function renderTeam(d=null) {
  const box=document.getElementById('na-team'); if(!box)return;
  try{d ??= data();}catch{return;}
  const t=teamState(d), rs=teamSettings(), steps=activeSteps(rs), u=tpl(d).unit, n=d.chapter||1, total=d.outlineChapters?.length||0;
  const open=context().characters?.[context().characterId], narr=open?((d.narrators||[]).find(x=>x.avatar===open.avatar)||{name:open.name}):null;
  const und=document.getElementById('na-narrator-undo'); if(und)und.hidden=!d.narratorUndo || d.narratorUndo.avatar!==context().characters?.[context().characterId]?.avatar;
  document.getElementById('na-team-label').textContent=`${u} ${n}${total?` of ${total}`:''}${narr?` — narrated by ${shortWho(narr)}`:''}`;
  const row=document.getElementById('na-team-steps'); row.replaceChildren();
  const run={lint:stepLint,markup:stepMarkup,reader:stepReader,revise:stepRevise,seal:sealChapter};
  const nextKey=steps.find(s=>!t.done.includes(s.key))?.key||'seal';
  for(const s of steps) {
    const b=el('button',{type:'button',className:`storyloom-step${t.done.includes(s.key)?' is-done':''}${s.key===nextKey?' is-next':''}`,title:s.hint},el('span',{textContent:t.done.includes(s.key)?'✓ ':''}),s.label);
    b.onclick=()=>{lastAction=s.label;run[s.key]().catch(fail);};
    row.append(el('li',{},b));
  }
  document.getElementById('na-team-hint').textContent=`Next: ${STEPS.find(s=>s.key===nextKey).label} — ${STEPS.find(s=>s.key===nextKey).hint}`;
  const body=document.getElementById('na-team-body'); body.replaceChildren();
  const save=()=>persist().catch(fail);
  // Lint findings
  if(t.lint) {
    const sec=el('details',{className:'storyloom-team-sec',open:!t.markup});
    sec.append(el('summary',{textContent:`Lint — ${t.lint.findings.length} finding${t.lint.findings.length===1?'':'s'}, ${t.lint.words.toLocaleString()} words`}));
    sec.append(el('pre',{className:'storyloom-lint-counts',textContent:countsLine(t.lint.findings)}));
    if(t.lint.note)sec.append(el('p',{className:'storyloom-hint',textContent:t.lint.note}));
    if(t.lint.big)sec.append(el('p',{className:'storyloom-lint-big',textContent:`Biggest problem: ${t.lint.big}`}));
    if(t.lint.findings.length) {
      const all=el('button',{type:'button',textContent:'Approve all'}), none=el('button',{type:'button',textContent:'Untick all'});
      all.onclick=()=>{t.picks=t.lint.findings.map(x=>x.id);save();renderTeam(d);}; none.onclick=()=>{t.picks=[];save();renderTeam(d);};
      sec.append(el('div',{className:'storyloom-row'},all,none));
      const groups=new Map(); for(const f of t.lint.findings){if(!groups.has(f.kind))groups.set(f.kind,[]);groups.get(f.kind).push(f);}
      for(const [kind,list] of groups) {
        sec.append(el('div',{className:'storyloom-sugg-label',textContent:`${LINT_LABELS[kind]||kind} (${list.length})`}));
        sec.append(checkList(list,t.picks||[],(id,on)=>{t.picks=on?[...new Set([...(t.picks||[]),id])]:(t.picks||[]).filter(x=>x!==id);save();const c=sec.querySelector('.storyloom-pick-count');if(c)c.textContent=`${t.picks.length} of ${t.lint.findings.length} will go to the Editor. Nothing in the chapter has been changed.`;},f=>[el('b',{className:`storyloom-sev is-${f.severity}`,textContent:f.severity.toUpperCase()}),el('small',{textContent:f.where?` ${f.where} `:' '}),el('q',{textContent:f.quote}),el('div',{textContent:f.rule})]));
      }
      sec.append(el('p',{className:'storyloom-hint storyloom-pick-count',textContent:`${(t.picks||[]).length} of ${t.lint.findings.length} will go to the Editor. Nothing in the chapter has been changed.`}));
    }
    body.append(sec);
  }
  // Editor's markup and Reader's reactions: the writer keeps or unticks each
  const notes=allNotes(t);
  if(t.markup || t.reader) {
    const picks=t.notePicks||notes.map(x=>x.id);
    const toggle=(id,on)=>{const p=new Set(t.notePicks||notes.map(x=>x.id)); on?p.add(id):p.delete(id); t.notePicks=[...p]; save(); sec.querySelector('summary').textContent=`Notes to fix — ${p.size} of ${notes.length} kept`;};
    const sec=el('details',{className:'storyloom-team-sec',open:!t.revision});
    sec.append(el('summary',{textContent:`Notes to fix — ${picks.length} of ${notes.length} kept`}));
    if(t.markup){sec.append(el('div',{className:'storyloom-sugg-label',textContent:`The Editor’s markup (${t.markup.notes.length})`})); if(t.markup.overall)sec.append(el('p',{className:'storyloom-hint',textContent:`Editor: ${t.markup.overall}`})); sec.append(checkList(t.markup.notes,picks,toggle,noteBits));}
    if(t.reader){
      sec.append(el('div',{className:'storyloom-sugg-label',textContent:`The Reader’s reactions (${t.reader.notes.length})`})); if(t.reader.overall)sec.append(el('p',{className:'storyloom-hint',textContent:`Reader: ${t.reader.overall}`}));
      sec.append(checkList(t.reader.notes.filter(x=>!x.worked),picks,toggle,noteBits));
      const worked=t.reader.notes.filter(x=>x.worked); if(worked.length)sec.append(el('ul',{className:'storyloom-lint-list storyloom-worked'},...worked.map(x=>el('li',{},el('small',{textContent:`${x.where} `}),el('q',{textContent:x.quote}),el('div',{textContent:x.note})))));
    }
    body.append(sec);
  }
  // Revision: what changed, accept or discard
  if(t.revision && !t.accepted) {
    const sec=el('section',{className:'storyloom-team-sec storyloom-revision'});
    sec.append(el('strong',{textContent:'The Editor’s revision'}),el('p',{className:'storyloom-hint',textContent:'Struck-through words are removed, highlighted words are new. Accepting puts this into the chat; the original stays as the previous swipe on each message.'}));
    t.revision.parts.forEach((p,k)=>{
      const before=t.revision.original[k];
      if(p===before){sec.append(el('p',{className:'storyloom-hint',textContent:`Part ${k+1}: unchanged.`}));return;}
      const div=el('div',{className:'storyloom-diff'}); div.append(el('small',{textContent:`Part ${k+1}`}));
      const para=el('p'); for(const x of wordDiff(before,p))para.append(x.op==='same'?document.createTextNode(x.text):el(x.op==='add'?'ins':'del',{textContent:x.text}));
      div.append(para); sec.append(div);
    });
    const ok=el('button',{type:'button',textContent:'Accept revision'}), no=el('button',{type:'button',textContent:'Discard'});
    ok.onclick=()=>{lastAction='Accept revision';acceptRevision().catch(fail);}; no.onclick=()=>{lastAction='Discard';discardRevision().catch(fail);};
    sec.append(el('div',{className:'storyloom-row'},ok,no));
    body.append(sec);
  } else if(t.accepted) body.append(el('p',{className:'storyloom-hint',textContent:'The revision is in the chat (originals kept as swipes). Next: Seal.'}));
  const next=document.getElementById('na-team-next'); const s=STEPS.find(x=>x.key===nextKey);
  if(d.pendingFresh===n && !t.done.length) {
    next.textContent=`Open ${u} ${n} in a fresh chat →`;
    body.prepend(el('p',{className:'storyloom-hint',textContent:`${u} ${n} is set up, but its fresh chat didn’t open last time. Open it now — you’ll pick the narrator again.`}));
    next.onclick=()=>{lastAction=next.textContent;openFreshChapter(n).catch(fail);};
  } else if(t.done.includes('seal') && n<total) {
    next.textContent=`What next? (${u} ${n+1}) →`;
    next.onclick=()=>{lastAction=next.textContent;whatNext().catch(fail);};
  } else {
    next.textContent=`${nextKey==='seal'?`Seal ${u} ${n}`:`Next: ${s.label}`} →`;
    next.onclick=()=>{lastAction=next.textContent;run[nextKey]().catch(fail);};
  }
}

/** SillyTavern's World Info editor doesn't redraw when an extension saves; reload it so it never shows (or re-saves) an old copy. */
const refreshEditor=name=>{try{reloadEditor(name);}catch(e){warnLog('Storyloom editor refresh:',e);}};
/* ---------- Writing setup: the Storyloom Novel preset, the general narrator, and this chat's book settings ---------- */
const usesGeneralNarrator=(c=context())=>isGeneralNarrator(c.characters?.[c.characterId]?.description);
/** This book's settings for the chapter: read from the story lore, then this chapter's own changes on top. */
async function bookValuesFor(d,n=d.chapter||1) {
  const t=tpl(d), book=await freshBook(d.book), entries=Object.values(book.entries||{});
  const find=title=>entries.find(e=>String(e.comment||'').trim().toLocaleLowerCase()===String(title).toLocaleLowerCase());
  const voice=entries.find(e=>/^[\s*_#-]*(POV|POINT OF VIEW)\s*:/mi.test(String(e.content||'').replace(/^\(Storyloom:[^\n]*\)\n?/,'')) && !/^Current Writing Directive$/i.test(e.comment||''));
  let focus=''; try{focus=(await bookFacts(d)).focus||'';}catch{}
  const v=bookValues({voice:String(voice?.content||'').replace(/^\(Storyloom:[^\n]*\)\n?/,''),summary:find(t.summary.title)?.content,directive:find('Current Writing Directive')?.content,focus});
  const note=chapterNote(d,n), over=d.chapterValues?.[n]||{};
  if(note.pov)v.pov=note.pov; if(note.tense)v.tense=note.tense;
  for(const [k,x] of Object.entries(over))if(x)v[k]=x;
  return v;
}
const readValues=(c=context())=>Object.fromEntries(VALUES.map(v=>[v.key,String(c.variables?.local?.get?.(varName(v.key))??'')]));
async function writeValues(values) {
  const c=context();
  for(const {key} of VALUES)c.variables.local.set(varName(key),values[key]??'');
  await c.saveMetadata();
}
/** Fill this chat's book settings (the narrator's blanks) from the story lore. */
async function fillBookValues({quiet=false}={}) {
  const d=data(); if(!d.book || d.interview?.phase!=='done')return null;
  const v=await bookValuesFor(d); await writeValues(v);
  logEvent('info','Book settings',`filled this chat’s book settings from the story lore (${d.book}, ${tpl(d).unit} ${d.chapter||1})`);
  if(!quiet)status('This chat’s book settings are filled in from the story lore.');
  return v;
}
/** Make (or rebuild) the "Storyloom Novel" preset from the preset in use now, and switch to it. The writer's preset is not changed. */
async function createNovelPreset() {
  const c=context();
  if(c.mainApi!=='openai')throw Error('The Storyloom Novel preset is for Chat Completion. Switch the API (plug icon) to Chat Completion first.');
  const pm=c.getPresetManager('openai'), from=pm.getSelectedPresetName();
  const existing=pm.getPresetList().preset_names?.[PRESET_NAME]!==undefined?pm.getCompletionPresetByName(PRESET_NAME):null;
  if(existing)backup({kind:'preset',label:`Preset “${PRESET_NAME}” (before it was rebuilt)`,target:{name:PRESET_NAME},before:existing});
  await pm.savePreset(PRESET_NAME,novelPreset(getChatCompletionPreset()));
  logEvent('info','Writing setup',`made the “${PRESET_NAME}” preset from “${from}” and switched to it`);
  return from;
}
/** The general narrator character: found by its blanks, or created. Returns its avatar file name. */
async function ensureNarrator() {
  const c=context(), found=c.characters.find(x=>isGeneralNarrator(x.description));
  if(found)return found.avatar;
  const fd=new FormData();
  for(const [k,v] of Object.entries({ch_name:NARRATOR_NAME,description:NARRATOR_CARD,first_mes:'Chapter 1',personality:'',scenario:'',mes_example:'',creator_notes:'Made by Storyloom. One narrator for every book: its blanks are filled per chat from the book (Storyloom → Book settings). Edit the text around the blanks freely.',talkativeness:'0.5',fav:'false',tags:'Storyloom',extensions:'{}'}))fd.append(k,v);
  const h=c.getRequestHeaders(); delete h['Content-Type'];
  const r=await fetch('/api/characters/create',{method:'POST',headers:h,body:fd});
  if(!r.ok)throw Error('SillyTavern couldn’t create the Storyloom Narrator character.');
  const avatar=(await r.text()).trim(); await c.getCharacters();
  logEvent('info','Writing setup',`created the “${NARRATOR_NAME}” character`);
  return avatar;
}
/** After the plan changes in the Storyloom chat: rebuild what depends on it — chapter list, current chapter plan, word budget, memory, book settings. */
async function afterPlanChange(d) {
  if(d.interview?.phase!=='done' || data()!==d)return;
  try {
    await organizeBook(d.chapter||1);
    const book=await freshBook(d.book), t=tpl(d);
    const scale=Object.values(book.entries||{}).find(e=>/WORDS PER/i.test(String(e.content||'')));
    const per=(String(scale?.content||'').match(/WORDS PER [A-Z]+\s*:\s*([^\n]+)/i)||[])[1];
    const b=wordBudget({chapters:(d.outlineChapters||[]).length||d.budget?.chapters,wordsPerChapter:per||d.budget?.perChapter,coreText:`${d.proposal?.fields?.coreShare||''} ${d.proposal?.fields?.core||''}`,namedCast:d.budget?.namedCast||[]});
    if(b.total){const was=d.budget?.total; d.budget={...b,unit:t.unit}; await persist(); if(was!==b.total)logEvent('info','Budget',`recalculated: ${(d.outlineChapters||[]).length} ${t.unit.toLowerCase()}s, about ${b.total.toLocaleString()} words`);}
    await applyMemory(); try{await fillBookValues({quiet:true});}catch{}
    options();
  } catch(e){warnLog('Storyloom refresh after a change:',e);}
}
/** Start a book from nothing: the general narrator (made if needed), a fresh chat with it, the Novel preset if wanted, then the usual start screen. */
async function startNewBook() {
  requireIdle();
  const c=context(), avatar=await ensureNarrator();
  const idx=context().characters.findIndex(x=>x.avatar===avatar); if(idx<0)throw Error('The Storyloom Narrator could not be found.');
  const before=c.chatId;
  await context().selectCharacterById(idx);
  for(let i=0;i<40 && !(context().chatId && context().characters?.[context().characterId]?.avatar===avatar);i++)await new Promise(r=>setTimeout(r,250));
  if(context().characters?.[context().characterId]?.avatar!==avatar)throw Error('SillyTavern could not open the narrator’s chat. Close any open editor and try again.');
  // Reuse the narrator's chat only if it is empty; otherwise open a fresh one so books never share a chat.
  const used=()=>{const x=context(); return x.chat.some(m=>m.is_user) || x.chat.length>1 || Object.values(x.chatMetadata?.[KEY]?.novels||{}).some(n=>n.book);};
  if(used() || context().chatId===before)await doNewChat();
  const c2=context();
  if(c2.mainApi==='openai') {
    const pm=c2.getPresetManager('openai');
    if(pm.getSelectedPresetName()!==PRESET_NAME && await c2.Popup.show.confirm('Use the Storyloom Novel preset?',`<p>For writing, Storyloom can make a “${PRESET_NAME}” preset from your “${escHtml(pm.getSelectedPresetName())}” preset and switch to it: its Main Prompt teaches the model how to write a book, and a short reminder goes last. Your sliders and your own preset stay as they are, and you can switch back any time.</p>`))await createNovelPreset();
  }
  logEvent('info','Start a new book',`opened a fresh chat with ${NARRATOR_NAME}`);
  activeTab='story'; settingsOpen=false; options(); renderPanelView();
  status('New book. Pick a template, then choose Simple or Deep. When the outline is done, the narrator’s settings fill in from the book.');
}
/** Writing setup: the preset, the general narrator for this book, and this chat's book settings. */
async function writingSetup() {
  requireIdle();
  const c=context(), d=data(), u=tpl(d).unit, n=d.chapter||1;
  if(!d.book || d.interview?.phase!=='done')throw Error('Create the outline first, so Storyloom knows the book.');
  const general=usesGeneralNarrator(c), chat=c.mainApi==='openai', pm=chat?c.getPresetManager('openai'):null, onNovel=pm?.getSelectedPresetName()===PRESET_NAME;
  const form=document.createElement('div'); form.className='storyloom-narrator-form';
  form.innerHTML=`<h3>Writing setup</h3>
    <p class="storyloom-hint">Three layers, each in its own place (why: docs/novel-setups.md in Storyloom). Everything Storyloom changes is backed up first, and the Assistant can talk any of it through with you.</p>
    <label class="checkbox_label"><input type="checkbox" data-c="preset" ${chat?'checked':'disabled'}> <b>How to write a book</b> — ${chat?(onNovel?'rebuild the “Storyloom Novel” preset from this one':`make a “Storyloom Novel” preset from your “${escHtml(pm.getSelectedPresetName())}” preset and switch to it`):'needs a Chat Completion connection'}. <small>Its Main Prompt teaches the craft; a short reminder goes last; your sliders and your own preset stay as they are.</small></label>
    ${general?`<p class="storyloom-hint">This chat already uses the general narrator (“${escHtml(c.characters[c.characterId].name)}”).</p>`:`<label class="checkbox_label"><input type="checkbox" data-c="narrator" checked> <b>The narrator</b> — use the general “${NARRATOR_NAME}” for this book <small>(made if you don’t have it). ${u} ${n} opens in a fresh chat with it, with everything carried over; this chat stays.</small></label>`}
    ${chat&&((c.chatCompletionSettings?.openai_max_tokens||0)<1000||(c.chatCompletionSettings?.openai_max_context||0)<16000)?`<p class="storyloom-hint is-warning">Your preset’s Max Response Length is ${c.chatCompletionSettings.openai_max_tokens} tokens and its Context Size ${c.chatCompletionSettings.openai_max_context}. That’s very small for a book: a reply of a few paragraphs needs about 1,000–2,000 tokens (more with a thinking model, which thinks before it writes), and a chapter needs a large context. Storyloom doesn’t change your sliders — raise them in the left panel (AI Response Configuration), or ask the Assistant what suits your model.</p>`:''}
    <label class="checkbox_label"><input type="checkbox" data-c="values" checked> <b>This book’s settings</b> — fill the narrator’s blanks (point of view, tense, voice, tone, genre, your rules) from the story lore. <small>“Voice and Boundaries” stays saved in the story lore; it is switched off while the narrator carries it, so a chapter can change it.</small></label>`;
  const ok=await new c.Popup(form,c.POPUP_TYPE.CONFIRM,'',{okButton:'Set it up',cancelButton:'Cancel',wide:true}).show();
  if(ok!==(c.POPUP_RESULT?.AFFIRMATIVE??1))return;
  const on=k=>form.querySelector(`[data-c="${k}"]`)?.checked;
  const done=[];
  if(on('preset')){const from=await createNovelPreset(); done.push(`the “${PRESET_NAME}” preset (from “${from}”, which is unchanged)`);}
  if(!general && on('narrator')) {
    const avatar=await ensureNarrator();
    await startChapterChat({avatar,notes:chapterNote(d)});
    done.push(`the ${NARRATOR_NAME} in a fresh ${u} ${n} chat`);
  } else if(on('values')) {
    if(usesGeneralNarrator())await organizeBook(n);
    await fillBookValues({quiet:true}); done.push('this chat’s book settings');
  }
  status(`Set up: ${done.join(', ')||'nothing ticked'}.`);
  renderTeam();
}
/** Book settings: view and change the narrator's blanks for this chapter (or the whole book). */
async function editBookSettings() {
  requireIdle();
  const c=context(), d=data(), u=tpl(d).unit, n=d.chapter||1;
  if(!d.book || d.interview?.phase!=='done')throw Error('Create the outline first.');
  const fromBook=await bookValuesFor({...d,chapterValues:{},chapterNotes:{}},n), now={...fromBook,...Object.fromEntries(Object.entries(readValues(c)).filter(([,x])=>x))};
  const form=document.createElement('div'); form.className='storyloom-narrator-form';
  form.innerHTML=`<h3>Book settings — ${escHtml(u)} ${n}</h3><p class="storyloom-hint">${usesGeneralNarrator(c)?'These fill the narrator’s blanks in this chat.':'This chat’s character isn’t the general narrator, so these are kept for when it is (Writing setup…).'} Changes here apply to ${u.toLowerCase()} ${n}; the book’s own record stays in “Voice and Boundaries”.</p>${VALUES.map(v=>`<label>${v.label} <small>— ${escHtml(v.hint)}</small><textarea class="text_pole" rows="2" data-k="${v.key}"></textarea></label>`).join('')}`;
  for(const ta of form.querySelectorAll('textarea'))ta.value=now[ta.dataset.k]||'';
  const pick=await new c.Popup(form,c.POPUP_TYPE.CONFIRM,'',{okButton:'Save',cancelButton:'Cancel',wide:true,customButtons:[{text:'Back to the book’s settings',result:2}]}).show();
  if(pick===2){d.chapterValues ??= {}; delete d.chapterValues[n]; await persist(); await writeValues(fromBook); renderTeam(); return status(`${u} ${n} uses the book’s own settings again.`);}
  if(pick!==(c.POPUP_RESULT?.AFFIRMATIVE??1))return;
  const vals=Object.fromEntries(VALUES.map(v=>[v.key,form.querySelector(`[data-k="${v.key}"]`).value.trim()]));
  d.chapterValues ??= {}; d.chapterValues[n]=Object.fromEntries(Object.entries(vals).filter(([k,x])=>x!==(fromBook[k]||'')));
  d.chapterNotes ??= {}; d.chapterNotes[n]={...(d.chapterNotes[n]||{}),pov:vals.pov!==(fromBook.pov||'')?vals.pov:'',tense:vals.tense!==(fromBook.tense||'')?vals.tense:''};
  await persist(); await writeValues(vals); await applyMemory(); renderTeam();
  logEvent('info','Book settings',`${u} ${n}: ${Object.keys(d.chapterValues[n]).join(', ')||'no'} changes from the book`);
  status(`Book settings saved for ${u} ${n}.`);
}
/** A different narration for a chapter with the general narrator: same card, different settings. */
async function newNarration(next,cur) {
  const c=context(), d=data(), u=tpl(d).unit, plan=await chapterPlan(d,next);
  const wish=await c.Popup.show.input(`Narration for ${u} ${next}`,`<p>How should ${u} ${next} be told? For example “Danny, first person, rough and short”. ${plan?`The outline for ${u} ${next} is “${escHtml(plan.title)}”.`:''}</p>`,'',{okButton:'Next',cancelButton:'Cancel'});
  if(wish===null || wish===undefined || wish===false)return null;
  const again=suggestNarrators(narratorRegistry(d).filter(x=>x.values),{wish:String(wish),current:''})[0];
  if(again && await c.Popup.show.confirm(`Use ${escHtml(shortWho(again))}’s narration again?`,`${escHtml(shortWho(again))} already narrated ${u} ${again.chapters.join(', ')||'before'}. Use the same settings (and Checker and Editor notes)?`))return {avatar:cur?.avatar,notes:again.notes||{},values:again.values};
  const base=await bookValuesFor(d,next);
  let draft={values:base,checkerNote:'',editorNote:''};
  if(await c.Popup.show.confirm('Want help with the settings?','Storyloom suggests this chapter’s settings from the book and the outline. You edit them before anything is saved.')) {
    const f=await bookFacts(d), ctl=new AbortController(); renderModelWork(ctl); busy=true;
    try {
      status('Storyloom is suggesting the narration…');
      let b='',direct=null; try{b=d.profile||'';direct=directSnapshot(d,c);}catch{}
      const raw=await llm(c,narrationInstruction({unit:u,number:next,wish:String(wish),facts:`${plan?`THIS ${u.toUpperCase()}'S PLAN\n${plan.text}\n\n`:''}${f.facts}`,current:base}),b,ctl.signal,Number(d.responseTokens||12000),'You help a writer set up how a chapter of their book is narrated. You never write the story.',direct,{label:'Narration'});
      const p=parseNarration(raw); if(!p){logEvent('error','Narration','suggestion unreadable',raw.slice(0,2000));throw Error('The suggestion came back in a form Storyloom couldn’t read. Try again, or skip the help.');}
      draft={values:{...base,...Object.fromEntries(Object.entries(p.values).filter(([,x])=>x))},checkerNote:p.checkerNote,editorNote:p.editorNote};
    } finally {busy=false;renderModelWork(null);}
  }
  const form=document.createElement('div'); form.className='storyloom-narrator-form';
  form.innerHTML=`<h3>Narration for ${escHtml(u)} ${next}</h3>${VALUES.map(v=>`<label>${v.label}<textarea class="text_pole" rows="2" data-k="${v.key}"></textarea></label>`).join('')}<label>Checker note <small>(what to accept as intended)</small><textarea class="text_pole" rows="2" data-n="checker"></textarea></label><label>Editor note <small>(what to preserve)</small><textarea class="text_pole" rows="2" data-n="editor"></textarea></label>`;
  for(const ta of form.querySelectorAll('[data-k]'))ta.value=draft.values[ta.dataset.k]||'';
  form.querySelector('[data-n="checker"]').value=draft.checkerNote||''; form.querySelector('[data-n="editor"]').value=draft.editorNote||'';
  if(await new c.Popup(form,c.POPUP_TYPE.CONFIRM,'',{okButton:'Use these',cancelButton:'Cancel',wide:true}).show()!==(c.POPUP_RESULT?.AFFIRMATIVE??1))return null;
  const values=Object.fromEntries(VALUES.map(v=>[v.key,form.querySelector(`[data-k="${v.key}"]`).value.trim()]));
  const changed=Object.fromEntries(Object.entries(values).filter(([k,x])=>x!==(base[k]||'')));
  const notes={checker:form.querySelector('[data-n="checker"]').value.trim(),editor:form.querySelector('[data-n="editor"]').value.trim(),pov:changed.pov||'',tense:changed.tense||''};
  narratorRegistry(d).push({avatar:cur?.avatar,name:values.narrator||String(wish),who:values.narrator||String(wish).split(/[,.;]/)[0].trim(),chapters:[],notes,values:changed});
  await persist();
  return {avatar:cur?.avatar,notes,values:changed};
}

/* ---------- Seal and what comes next ---------- */
const escHtml=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
async function sealChapter() {
  requireIdle();
  const c=context(), d=data(), t=tpl(d);
  if(!d.book || d.interview?.phase!=='done')throw Error('Create the outline first.');
  const n=d.chapter||1, total=d.outlineChapters?.length||0;
  const {text,messages}=transcriptOf(c.chat);
  if(messages<1)throw Error(`This chat has nothing in it yet. Write ${t.unit} ${n} in the main chat first.`);
  const team=teamState(d);
  if(team.revision && !team.accepted && !await c.Popup.show.confirm('Seal without the revision?','The Editor’s revision hasn’t been accepted. Seal the chapter as it is in the chat now?'))return;
  if(!await c.Popup.show.confirm(`Seal ${t.unit} ${n}?`,`<p>Seal will:</p><ol><li>Read this chat and write the ${t.unit.toLowerCase()}’s seal note (summary, what changed, what the narrator now knows, what must not drift, open threads).</li><li>Add it to <b>Story so far</b> and make it <b>Previously</b> for the next ${t.unit.toLowerCase()}.</li><li>Offer any character changes as Suggestions for you to approve.</li></ol><p>Then you choose what’s next. This chat is not changed.</p>`))return;
  const book=await freshBook(d.book), rs=teamSettings();
  const sofarTitle=MEMORY_ITEMS[0].title, sumTitle=summaryTitle(t.unit,n);
  const castTitles=Object.values(book.entries||{}).map(e=>String(e.comment||'')).filter(x=>/^character\s*[—–-]/i.test(x));
  const facts=await bookFacts(d), narr=currentNarrator(d,c,{record:true}), note=chapterNote(d);
  const sealedNotes=facts.seals.filter(e=>e.comment!==sumTitle).map(e=>e.content).join('\n\n');
  status(`Seal is reading ${t.unit} ${n} and writing its seal note…`);
  logEvent('info','Seal',`${t.unit} ${n}: started`);
  const result=await interact(chapterEndInstruction({unit:t.unit,number:n,transcript:text,storySoFar:findEntry(book,sofarTitle)?.content||'',castTitles,sealedNotes,focus:facts.focus||'the focus character',narrator:`${narr?.who||'the narrator'}${note.pov?` (${note.pov})`:facts.pov?` (${facts.pov})`:''}`,title:facts.chapterTitle}),false,null,null,'chapter-end',false,{silentUser:true,mergeState:true,holdForAuthor:'allExcept',keep:[sumTitle,sofarTitle],as:{profile:rs.seal.profile,persona:rs.seal.persona,sampling:ROLES.seal.sampling,label:'Seal'}});
  const summary=(result.updates||[]).find(u=>u.title.trim().toLocaleLowerCase()===sumTitle.toLocaleLowerCase());
  if(!summary){logEvent('error','Seal','no seal note came back');throw Error(`Seal didn’t return the ${t.unit.toLowerCase()} seal note. Nothing was moved on; try again.`);}
  await saveMemoryItem(MEMORY_ITEMS[1],summary.content);
  markDone(teamState(d),'seal'); recordChapterChat(d,n,c); await persist();
  logEvent('info','Seal',`${t.unit} ${n} sealed`);
  status(`${t.unit} ${n} is sealed.${result.held?.length?' Character updates are waiting under Suggestions.':''}`);
  renderMemory();
  if(n<total)await whatNext();
  else {
    status(`${t.unit} ${n} is sealed. That was the last ${t.unit.toLowerCase()} in the outline.`);
    if(await c.Popup.show.confirm('The book is finished','<p>That was the last chapter in the outline. Save the whole book as a file now? (You can do it any time with <b>Export book…</b> on the Memory tab.)</p>'))await exportBook();
  }
}
/** Remember which chat (and which part of it) a chapter was written in, for Export book. */
function recordChapterChat(d,n,c) {
  const start=d.chapterStart?.chatId===c.chatId && d.chapterStart?.chapter===n ? d.chapterStart.index : 0;
  d.chapterChats ??= {}; d.chapterChats[n]={avatar:c.characters?.[c.characterId]?.avatar||'',chatId:c.chatId,start,end:c.chat.length};
}
/** After a seal: stay, go on in this chat, or go on in a fresh session. */
async function whatNext() {
  const c=context(), d=data(), t=tpl(d), n=d.chapter||1, u=t.unit, nextTitle=(d.outlineChapters||[]).find(x=>x.number===n+1)?.title||'';
  const P=c.Popup, R=c.POPUP_RESULT||{};
  const pick=await new P(`<h3>${u} ${n} is sealed. What next?</h3><p><b>Keep working on ${u} ${n}</b> — stay here; nothing moves on.<br><b>${u} ${n+1} in this chat</b> — memory moves forward; you keep writing in this session.<br><b>${u} ${n+1} in a fresh session</b> — a new chat whose narrator hasn’t seen this one, already connected to the lorebook, directive and memory. This chat is kept.</p>`,c.POPUP_TYPE.TEXT,'',{okButton:`${u} ${n+1} in a fresh session`,cancelButton:`Keep working on ${u} ${n}`,customButtons:[{text:`${u} ${n+1} in this chat`,result:2}]}).show();
  if(pick===2) {
    d.chapterStart={chapter:n+1,chatId:c.chatId,index:c.chat.length}; await persist();
    await organizeBook(n+1); await applyMemory(); options(); renderMemory();
    status(`Now on ${u} ${n+1}${nextTitle?` — ${nextTitle}`:''}, in this chat. Memory has moved forward.`);
    logEvent('info','Next chapter',`${u} ${n+1} in the same chat`);
    return;
  }
  if(pick!==(R.AFFIRMATIVE??1)){status(`Still on ${u} ${n}. Use Seal again when you’re done.`);return;}
  await openFreshChapter(n+1);
}
/** Choose the narrator and open the fresh chapter chat. If opening fails, the Memory tab offers to try again. */
async function openFreshChapter(next) {
  const d=data(), u=tpl(d).unit;
  const narrator=await chooseNarrator(next);
  if(!narrator)return status(`Nothing was changed. ${d.pendingFresh?`Use “Open ${u} ${next} in a fresh chat” on the Memory tab when you’re ready.`:''}`);
  if((d.chapter||1)!==next)await organizeBook(next);
  d.pendingFresh=next; await persist();
  try {await startChapterChat(narrator);}
  catch(e){renderTeam(); throw e;}
}
/** Ask who narrates the next chapter. Returns {avatar, notes} or null if cancelled. */
async function chooseNarrator(next) {
  const c=context(), d=data(), t=tpl(d), u=t.unit, cur=currentNarrator(d,c), reg=narratorRegistry(d);
  const plan=(await chapterPlan(d,next))?.text||'';
  const earlier=suggestNarrators(reg,{chapterPlan:plan,current:cur?.avatar});
  const buttons=earlier.slice(0,2).map((x,i)=>({text:`Use ${shortWho(x)}${x.chapters.length?` (${u} ${x.chapters.join(', ')})`:''}`,result:10+i}));
  const pick=await new c.Popup(`<h3>Who narrates ${u} ${next}?</h3><p><b>Keep the current narrator</b> — ${escHtml(shortWho(cur)||'the current character')}.</p>${earlier.length?`<p>The outline for ${u} ${next} looks like it follows <b>${escHtml(shortWho(earlier[0]))}</b>, ${earlier[0].chapters.length?`who narrated ${u} ${earlier[0].chapters.join(', ')}`:'who is already set up as a narrator'} — reusing them brings their Checker and Editor notes too.</p>`:''}<p><b>New narrator</b> — a copy of the current narrator for you (or Storyloom) to rewrite: a different character’s point of view, a new register, first person instead of third…</p>`,c.POPUP_TYPE.TEXT,'',{okButton:'Keep the current narrator',cancelButton:'Cancel',customButtons:[...buttons,{text:'New narrator…',result:3}]}).show();
  if(pick===(c.POPUP_RESULT?.AFFIRMATIVE??1)) {
    if(!cur)return null;
    const diff=await c.Popup.show.input(`Anything different in ${u} ${next}?`,`<p>Same narrator. If the narration changes in this ${u.toLowerCase()} — a rougher register, a time jump, a different mood — say so, and Storyloom adds it as a note for the Checker and Editor so they don’t “fix” it. Leave it empty if nothing changes.</p>`,'',{okButton:'Next',cancelButton:'Nothing changes'});
    const extra=typeof diff==='string'?diff.trim():'', notes={...(cur.notes||{})};
    if(extra){notes.checker=`In this ${u.toLowerCase()}: ${extra} — this is intended.`;notes.editor=`In this ${u.toLowerCase()}: ${extra} — preserve it.`;}
    return {avatar:cur.avatar,notes};
  }
  if(pick>=10){const x=earlier[pick-10];return {avatar:x.avatar||cur?.avatar,notes:x.notes||{},values:x.values};}
  if(pick!==3)return null;
  return usesGeneralNarrator(c)?newNarration(next,cur):newNarrator(next,cur);
}
/** The writer's narrator template (Extensions → Storyloom → Narrator template), or the default. */
const narratorTemplate=()=>parseNarratorTemplate(context().extensionSettings.storyloom?.narratorTemplate||'');
/** Draft (optional) and review a narrator. Returns the reviewed fields or null if cancelled. */
async function draftNarrator({number,wish,title,okLabel,mode}) {
  const c=context(), d=data(), u=tpl(d).unit, ch=c.characters?.[c.characterId];
  const plan=await chapterPlan(d,number), prevText=ch?.description||'', prevMain=ch?.data?.system_prompt||'';
  const help=await new c.Popup(`<h3>Want help writing the narrator?</h3><p>Storyloom drafts the narrator’s instructions from the book — the outline for this ${u.toLowerCase()}, the cast, ${mode==='current'?'what the narrator says now':'the previous narrator'}, your rules — using the narrator template as a guide (Extensions → Storyloom → Narrator template). You read and edit the draft before anything is saved.</p>`,c.POPUP_TYPE.TEXT,'',{okButton:'Yes, draft it',cancelButton:'I’ll write it myself'}).show();
  const prevNote=ch?.data?.extensions?.depth_prompt?.prompt||'', prevPost=ch?.data?.post_history_instructions||'';
  let draft={instructions:prevText,mainPrompt:String(prevMain).replace(/^\{\{original\}\}\s*/,'')||defaultMainPrompt(d.book),charNote:prevNote,postHistory:prevPost,checkerNote:'',editorNote:''};
  if(help===(c.POPUP_RESULT?.AFFIRMATIVE??1)) {
    const f=await bookFacts(d);
    const ctl=new AbortController(); renderModelWork(ctl); busy=true;
    try {
      status('Storyloom is drafting the narrator…');
      let base='',direct=null; try{base=d.profile||'';direct=directSnapshot(d,c);}catch{}
      const raw=await llm(c,narratorInstruction({unit:u,number,wish:String(wish||''),facts:`${plan?`THIS ${u.toUpperCase()}'S PLAN\n${plan.text}\n\n`:''}${f.facts}`,previous:prevText,template:narratorTemplate(),roleplay:tpl(d).name!==NOVEL.name}),base,ctl.signal,Number(d.responseTokens||12000),'You help a writer set up the AI that narrates their book. You brief the narrator; you never write the story.',direct,{label:'Narrator builder'});
      const p=parseNarrator(raw); if(!p){logEvent('error','Narrator','draft unreadable',raw.slice(0,2000));throw Error('The narrator draft came back in a form Storyloom couldn’t read. Try again, or choose “I’ll write it myself”.');}
      draft={...p,mainPrompt:p.mainPrompt||draft.mainPrompt,charNote:p.charNote||draft.charNote,postHistory:p.postHistory||draft.postHistory};
    } finally {busy=false;renderModelWork(null);}
  }
  const form=document.createElement('div'); form.className='storyloom-narrator-form';
  const preset=(()=>{try{return c.mainApi==='openai'?(c.getPresetManager?.('openai')?.getSelectedPresetName?.()||'your current preset'):'your System Prompt (Advanced Formatting)';}catch{return 'your current preset';}})();
  form.innerHTML=`<h3>${escHtml(title)}</h3>
    <p class="storyloom-hint">Each part goes in its own place. Untick any place you want left alone. Whatever is there now is kept under Extensions → Storyloom → Backups first. Why each place gets what it gets: docs/prompt-slots.md in Storyloom.</p>
    <label class="checkbox_label"><input type="checkbox" data-c="toDesc" checked> <b>Description</b> <small>— the narrator’s always-present reference: who tells it, how, what they know, a short sample of the voice</small></label>
    <textarea class="text_pole" rows="12" data-k="instructions"></textarea>
    <label class="checkbox_label"><input type="checkbox" data-c="toMain" checked> <b>Character’s Main Prompt</b> <small>— the narrator’s standing role; replaces the preset’s Main Prompt in this character’s chats (“Prefer Char. Prompt”, on by default). Saved after {{original}} so your preset’s Main Prompt stays in front of it.</small></label>
    <textarea class="text_pole" rows="4" data-k="mainPrompt"></textarea>
    <label class="checkbox_label"><input type="checkbox" data-c="toGlobal"> Also put the Main Prompt above into the <b>global Main Prompt of ${escHtml(preset)}</b> <small>— used in chats on that preset whose character has no Main Prompt of its own. SillyTavern keeps the change in your settings; save the preset to make it permanent there.</small></label>
    <label class="checkbox_label"><input type="checkbox" data-c="toNote" checked> <b>Character’s Note</b> <small>— a short reminder of point of view, tense and voice, sent 4 messages from the end so the narrator doesn’t drift</small></label>
    <textarea class="text_pole" rows="2" data-k="charNote"></textarea>
    <label class="checkbox_label"><input type="checkbox" data-c="toPost" checked> <b>Post-History Instructions</b> <small>— read last, just before each reply: the few rules most likely to slip (needs “Prefer Char. Instructions”, on by default)</small></label>
    <textarea class="text_pole" rows="3" data-k="postHistory"></textarea>
    <label>Checker note for this ${u.toLowerCase()} <small>(what to accept as intended)</small><textarea class="text_pole" rows="2" data-k="checkerNote"></textarea></label>
    <label>Editor note for this ${u.toLowerCase()} <small>(what to preserve)</small><textarea class="text_pole" rows="2" data-k="editorNote"></textarea></label>`;
  for(const ta of form.querySelectorAll('textarea'))ta.value=draft[ta.dataset.k]||'';
  const ok=await new c.Popup(form,c.POPUP_TYPE.CONFIRM,'',{okButton:okLabel,cancelButton:'Cancel',wide:true,large:true}).show();
  if(ok!==(c.POPUP_RESULT?.AFFIRMATIVE??1))return null;
  const val=k=>form.querySelector(`[data-k="${k}"]`).value.trim(), on=k=>form.querySelector(`[data-c="${k}"]`).checked;
  const instructions=val('instructions');
  return {instructions,mainPrompt:val('mainPrompt'),charNote:val('charNote'),postHistory:val('postHistory'),toDesc:on('toDesc'),toMain:on('toMain'),toGlobal:on('toGlobal'),toNote:on('toNote'),toPost:on('toPost'),plan,
    notes:{checker:val('checkerNote'),editor:val('editorNote'),pov:sectionOf(instructions,'POINT OF VIEW')||sectionOf(instructions,'POV'),tense:sectionOf(instructions,'TENSE')}};
}
async function newNarrator(next,cur) {
  const c=context(), d=data(), t=tpl(d), u=t.unit;
  const plan=await chapterPlan(d,next);
  const wish=await c.Popup.show.input(`New narrator for ${u} ${next}`,`<p>Who should narrate, and how? For example “Danny, first person, rough and short”. ${plan?`The outline for ${u} ${next} is “${escHtml(plan.title)}”.`:''}</p><p>Next you can let Storyloom draft the narrator’s instructions, or write them yourself.</p>`,'',{okButton:'Next',cancelButton:'Cancel'});
  if(wish===null || wish===undefined || wish===false)return null;
  const again=suggestNarrators(narratorRegistry(d),{wish:String(wish),current:cur?.avatar})[0];
  if(again && await c.Popup.show.confirm(`Use ${escHtml(shortWho(again))} again?`,`${escHtml(shortWho(again))} ${again.chapters.length?`already narrated ${u} ${again.chapters.join(', ')}`:'is already set up as a narrator'}. Use that narrator (with its Checker and Editor notes) instead of making a new one?`))return {avatar:again.avatar,notes:again.notes||{}};
  const r=await draftNarrator({number:next,wish,title:`Narrator for ${u} ${next}`,okLabel:'Create narrator',mode:'new'});
  if(!r)return null;
  const who=narratorLabel(r.instructions)||String(wish).split(/[,.;]/)[0].trim()||`${u} ${next} narrator`;
  const name=`${d.book} — ${who.split(/\s[—–-]\s|[,(;]/)[0].trim().slice(0,40)}`;
  const prev=c.characters?.[c.characterId];
  const avatar=await cloneNarrator(cur?.avatar,{name,description:r.toDesc?r.instructions:(prev?.description||''),mainPrompt:null,greeting:`${u} ${next}${r.plan?.title?` — ${r.plan.title}`:''}`});
  const extra=narratorFields(r); delete extra.description; if(Object.keys(extra).length)await writeCharacter(avatar,extra);
  if(r.toGlobal){const g=readGlobalMain(); backup({kind:'globalMain',label:`Global Main Prompt (${presetName()})`,target:{api:g.api},before:g.text}); writeGlobalMain(r.mainPrompt,g.api);}
  narratorRegistry(d).push({avatar,name,who,chapters:[],notes:r.notes});
  await persist();
  logEvent('info','Narrator',`created “${name}” for ${u} ${next}${r.toGlobal?' (and set the global Main Prompt)':''}`);
  return {avatar,notes:r.notes};
}
/** Write or rewrite the narrator of the chat you are in (any chapter, including the first). The old text is kept for Undo. */
async function setupNarrator() {
  requireIdle();
  const c=context(), d=data(), t=tpl(d), u=t.unit, n=d.chapter||1, ch=c.characters?.[c.characterId];
  if(!d.book || d.interview?.phase!=='done')throw Error('Create the outline first, so Storyloom knows the book.');
  if(!ch)throw Error('Open the narrator character’s chat first.');
  const wish=await c.Popup.show.input(`Narrator: ${escHtml(ch.name)}`,`<p>How should this narrator tell the story? For example “Ruth, close third person, past tense, dry and exact”. Leave it empty and Storyloom works it out from the book.</p><p>This changes the character card <b>${escHtml(ch.name)}</b>, so it applies to every chat with this character.</p>`,'',{okButton:'Next',cancelButton:'Cancel'});
  if(wish===null || wish===undefined || wish===false)return;
  const r=await draftNarrator({number:n,wish,title:`Narrator: ${ch.name}`,okLabel:'Save narrator',mode:'current'});
  if(!r)return;
  if(!r.toDesc && !r.toMain && !r.toGlobal && !r.toNote && !r.toPost && !r.notes.checker && !r.notes.editor)return status('Nothing was ticked, so nothing was changed.');
  const group=crypto.randomUUID();
  const fields=narratorFields(r);
  if(Object.keys(fields).length) {
    backup({kind:'character',label:ch.name,target:{avatar:ch.avatar},before:charSnapshot(ch),group});
    await writeCharacter(ch.avatar,fields);
  }

  if(r.toGlobal){const g=readGlobalMain(); backup({kind:'globalMain',label:`Global Main Prompt (${presetName()})`,target:{api:g.api},before:g.text,group}); writeGlobalMain(r.mainPrompt,g.api);}
  d.narratorUndo={group,avatar:ch.avatar,name:ch.name,at:new Date().toISOString()};
  d.chapterNotes ??= {}; d.chapterNotes[n]={...(d.chapterNotes[n]||{}),...r.notes};
  const reg=currentNarrator(d,c); reg.who=narratorLabel(r.instructions)||reg.who; reg.notes={...r.notes};
  await persist(); await applyMemory(); renderTeam();
  logEvent('info','Narrator',`updated “${ch.name}”: ${['description','Main Prompt','Character’s Note','Post-History Instructions'].filter((x,k)=>[r.toDesc,r.toMain,r.toNote,r.toPost][k]).join(', ')||'notes only'}${r.toGlobal?' + global Main Prompt':''}`);
  status(`Narrator saved${r.toGlobal?' (and the global Main Prompt)':''}. The old versions are in Extensions → Storyloom → Backups; “Undo narrator change” puts them back.`);
}
async function undoNarrator() {
  requireIdle();
  const c=context(), d=data(), u=d.narratorUndo; if(!u)return;
  const group=storedBackups().filter(b=>b.group===u.group);
  if(!group.length)throw Error('The backup for that change is gone (only the newest 200 are kept).');
  if(!await c.Popup.show.confirm('Undo the narrator change?',`Put back ${group.map(b=>`“${escHtml(b.label)}”`).join(' and ')} as they were on ${new Date(u.at).toLocaleString()}?`))return;
  for(const b of group)await restoreBackup(b);
  delete d.narratorUndo; await persist(); renderTeam();
  status('The narrator change is undone.');
}
/** Copy a character card and give it new instructions, name and greeting. Returns the new avatar file name. */
async function cloneNarrator(fromAvatar,{name,description,greeting,mainPrompt=null}) {
  const c=context(); if(!fromAvatar)throw Error('Open the narrator character’s chat first.');
  const r=await fetch('/api/characters/duplicate',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({avatar_url:fromAvatar})});
  const out=await r.json().catch(()=>({})); if(!r.ok || !out.path)throw Error('SillyTavern couldn’t copy the narrator character.');
  const m=await fetch('/api/characters/merge-attributes',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({avatar:out.path,name,description,first_mes:greeting,chat:`${name} - ${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}`,data:{name,description,first_mes:greeting,alternate_greetings:[],...(mainPrompt!=null?{system_prompt:mainPrompt}:{})}})});
  if(!m.ok)throw Error(`SillyTavern couldn’t save the new narrator (${(await m.text()).slice(0,200)}).`);
  await c.getCharacters();
  return out.path;
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
  } catch(e) {warnLog('Storyloom update check:',e);}
}
async function updateStoryloom() {
  if(!await context().Popup.show.confirm('Update Storyloom?','Download the newest Storyloom from GitHub and reload SillyTavern. Your novels, lorebooks and settings are not touched.'))return;
  status('Updating Storyloom from GitHub…');
  const r=await fetch('/api/extensions/update',{method:'POST',headers:context().getRequestHeaders(),body:JSON.stringify({extensionName:EXTENSION_FOLDER,global:updateGlobal})});
  if(!r.ok)throw Error(`SillyTavern could not update the extension (${r.status}). Try Extensions → Manage extensions.`);
  status('Updated. Reloading…');
  setTimeout(()=>location.reload(),800);
}
/* ---------- Proposal (approved before anything is built) and word budget ---------- */
/** Approved cast = the people the writer named, plus added people only while they fit the word budget's room. */
function allowedCast(d) {
  const all=(d.proposal?.fields?.cast||[]).map(c=>c.name), named=new Set(d.budget?.namedCast||[]);
  const added=all.filter(n=>!named.has(n)), room=Number.isFinite(d.budget?.room)?d.budget.room:added.length;
  return [...all.filter(n=>named.has(n)),...added.slice(0,room)];
}
/** Names in the proposal that the writer actually named in their answers. */
function writerNamed(d,cast) {
  const said=Object.values(d.interview?.answers||{}).flat().filter(Boolean).join('\n').toLocaleLowerCase();
  return cast.filter(c=>{const first=c.name.split(/\s+/)[0].toLocaleLowerCase();return first && new RegExp(`(^|[^\\p{L}])${first.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^\\p{L}]|$)`,'u').test(said);}).map(c=>c.name);
}
function proposalBudget(d) {
  const f=d.proposal?.fields; if(!f)return null;
  return wordBudget({chapters:f.chapters,wordsPerChapter:f.wordsPerChapter,coreText:`${f.coreShare} ${f.core}`,namedCast:writerNamed(d,f.cast)});
}
async function makeProposal(feedback='') {
  requireIdle();
  const d=data(), t=tpl(d), previous=d.proposal?.text||'';
  const opts={silentUser:true,capture:[PROPOSAL_TITLE],dropTitles:[PROPOSAL_TITLE],loreBudget:20000,check:v=>validateProposal(v,t.unit),guidance:'Write a brief proposal for the writer to approve. Do not build the plan yet.'};
  status(feedback?'Revising the proposal…':'Writing a short proposal for you to approve…');
  await interact(proposalInstruction(d.interview.mode,d.interview.answers,t,feedback?{feedback,previous}:{}),false,null,null,'proposal',false,opts);
  const block=opts.captured?.[0];
  if(!block)throw Error('No proposal came back. Try “Create outline” again.');
  d.proposal={text:block.content,fields:parseProposal(block.content,t.unit),at:new Date().toISOString(),feedback};
  await persist(); options();
  status('Here’s what I’d build. Approve it, or say what to change — nothing is built until you approve.');
}
function renderProposal() {
  const box=document.getElementById('na-proposal'); if(!box)return;
  let d; try{d=data();}catch{box.hidden=true;return;}
  const show=d.interview?.phase==='outline' && d.proposal && !d.interview.proposalApproved;
  box.hidden=!show; if(!show)return;
  const f=d.proposal.fields, t=tpl(d), b=proposalBudget(d), fit=castFit(b,f.cast.map(c=>c.name));
  const body=box.querySelector('.storyloom-proposal-body'); body.replaceChildren();
  const add=(label,text,cls='')=>{if(!text)return;const l=document.createElement('div');l.className='storyloom-sugg-label';l.textContent=label;const p=document.createElement('p');p.className='storyloom-proposal-text '+cls;p.textContent=text;body.append(l,p);};
  add('What it’s about',`${f.core}${f.coreShare?` (about ${Math.round(coreShare(f.coreShare).share*100)}% of the words)`:''}`);
  add('Timeline',f.timeline);
  add('What happens',f.happens);
  const perN=parseNumber(f.wordsPerChapter), chN=parseNumber(f.chapters);
  add('Length',[chN&&`${chN} ${t.unit.toLowerCase()}${chN===1?'':'s'}`,perN&&`about ${perN.toLocaleString()} words each`].filter(Boolean).join(', ')||[f.chapters,f.wordsPerChapter].filter(Boolean).join(', '));
  if(perN && perN<300)add('Check the length',`The proposal says about ${perN.toLocaleString()} words per ${t.unit.toLowerCase()} (it wrote “${f.wordsPerChapter}”). That’s far too short for a ${t.unit.toLowerCase()} — say the length you want below (e.g. “2,000 words a chapter”) and Revise.`,'is-warning');
  const named=new Set(b.namedCast||[]);
  add('Who’s in it',f.cast.map(c=>named.has(c.name)?`• ${c.name} — you named them`:`• ${c.name} — added: ${c.why||'no reason given'} (needs ~${SCENE_MIN} words)`).join('\n'));
  add('Word budget (calculated)',budgetLines(b,t.unit).join('\n'),'storyloom-budget');
  if(!fit.fits)add('Doesn’t fit',`This adds ${fit.added.length} character${fit.added.length===1?'':'s'} (${fit.added.join(', ')}), but there is room for ${fit.room}. Ask to drop them below, or approve anyway — extras beyond the room will wait as Suggestions.`,'is-warning');
}
async function approveProposal() {
  const d=data(), t=tpl(d), b=proposalBudget(d);
  d.interview={...d.interview,proposalApproved:true};
  d.budget={...b,unit:t.unit};
  await persist(); options();
  await finishInterview();
}
function renderBudget(d) {
  const box=document.getElementById('na-budget'); if(!box)return;
  const show=!!d?.budget?.total && d.interview?.phase==='done';
  box.hidden=!show; if(!show)return;
  box.querySelector('pre').textContent=budgetLines(d.budget,d.budget.unit||tpl(d).unit).join('\n');
}

/* ---------- Lint: check the current chapter against the book ---------- */
const sectionOf=(text,label)=>{const m=String(text||'').match(new RegExp(`^[\\s*_#-]*${label}\\s*:\\s*([\\s\\S]*?)(?=^[\\s*_#-]*[A-Z][A-Z &/'-]{2,40}:|$(?![\\s\\S]))`,'mi'));return m?m[1].trim():'';};
/** Everything lint needs from the lorebook, gathered once. */
async function bookFacts(d) {
  const t=tpl(d), book=await freshBook(d.book), entries=Object.values(book.entries||{});
  const find=title=>entries.find(e=>String(e.comment||'').trim().toLocaleLowerCase()===String(title).toLocaleLowerCase());
  const voice=entries.find(e=>/^POV\s*:/mi.test(String(e.content||'')) && !/^Current Writing Directive$/i.test(e.comment||''));
  const directive=find('Current Writing Directive');
  const pov=sectionOf(voice?.content,'POV')||sectionOf(directive?.content,'POV');
  const tense=sectionOf(voice?.content,'TENSE')||sectionOf(directive?.content,'Tense');
  const characters=entries.filter(e=>/^character\s*[—–-]/i.test(String(e.comment||'')));
  const cast=castNames(find(t.cast)?.content);
  const castNamesAll=[...new Set([...cast,...characters.map(e=>String(e.comment).replace(/^character\s*[—–-]\s*/i,''))])];
  const knownNames=[...castNamesAll,...entries.flatMap(e=>[e.comment,...(e.key||[])]).filter(Boolean)];
  const seals=entries.filter(e=>/^storyloom memory\s*[—–-].*seal$/i.test(String(e.comment||''))).sort((a,b)=>String(a.comment).localeCompare(String(b.comment),undefined,{numeric:true}));
  const outline=find(t.outline.title)?.content||'';
  const n=d.chapter||1;
  const focusLine=String(find(t.cast)?.content||'').split('\n').find(l=>/^\s*\*\*/.test(l));
  const focus=focusLine?focusLine.replace(/\*\*/g,'').split('|')[0].trim():'';
  const target=d.budget?.perChapter || (Number(String(sectionOf(entries.find(e=>/WORDS PER/i.test(String(e.content||'')))?.content,`WORDS PER ${t.unit.toUpperCase()}`)).replace(/[^\d]/g,''))||null);
  const answers=Object.entries(d.interview?.answers||{}).filter(([,v])=>v).map(([k,v])=>`${k}: ${[].concat(v).join(' ')}`).join('\n');
  const facts=[
    `SETTING AND PERIOD (${t.summary.title}): ${sectionOf(find(t.summary.title)?.content,'SETTING')||'(not stated)'}`,
    `VOICE: ${String(voice?.content||'').replace(/^\(Storyloom:[^\n]*\)\n?/,'').slice(0,1500)}`,
    `WRITING DIRECTIVE: ${String(directive?.content||'').slice(0,1500)}`,
    d.proposal?.fields?`APPROVED PROPOSAL — core: ${d.proposal.fields.core}\nTimeline: ${d.proposal.fields.timeline}`:'',
    (()=>{const plan=chapterList(outlineBody(outline),t.unit).find(x=>x.number===n); return plan?`THIS ${t.unit.toUpperCase()}'S PLAN (${t.unit} ${n} — what it should contain and where it should end):\n${plan.text}`:'';})(),
    `THE OUTLINE AROUND ${t.unit.toUpperCase()} ${n} (events planned for other ${t.unit.toLowerCase()}s must not happen here):\n${laterChapters(outlineBody(outline),n,t.unit)}`,
    `CHARACTERS (only these people exist on the page):\n${characters.map(e=>`${e.comment}\nPERSONALITY: ${sectionOf(e.content,'PERSONALITY').slice(0,600)}\nVOICE AND MANNERISMS: ${sectionOf(e.content,'VOICE AND MANNERISMS').slice(0,600)}\nCURRENT STATE: ${sectionOf(e.content,'CURRENT STATE').slice(0,400)}`).join('\n\n').slice(0,9000)}`,
    `THE WRITER'S RULES AND ANSWERS:\n${answers.slice(0,3000)}`,
    seals.length?`SEALED ${t.unit.toUpperCase()}S — MUST NOT DRIFT:\n${seals.map(e=>`${e.comment}: ${sectionOf(e.content,'MUST NOT DRIFT')}`).join('\n').slice(0,5000)}`:'',
  ].filter(Boolean).join('\n\n');
  return {pov,tense,castNames:castNamesAll,knownNames,target,facts,seals,focus,unit:t.unit,chapterTitle:(d.outlineChapters||[]).find(c=>c.number===n)?.title||''};
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
  const panel=document.getElementById('na-panel'), root=document.querySelector('#na-direct'), direct=d.direct||{};
  root.hidden=d.profile!=='__direct__'; if(root.hidden)return;
  document.querySelector('#na-provider').value=direct.provider||'custom';
  document.querySelector('#na-model').value=direct.model||'';
  document.querySelector('#na-direct-url').value=direct.url||'';
  const scoped=sessionKey?.chatId===context().chatId && sessionKey?.book===d.book;
  if(!scoped)document.querySelector('#na-session-key').value='';
  const custom=direct.provider==='custom';
  document.querySelector('#na-url-label').hidden=!custom;
  document.querySelector('#na-session-label').hidden=!(custom || PROVIDERS.find(x=>x.id===direct.provider)?.sessionUrl);
  const key=document.querySelector('#na-key');
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
const ANSWER_NOW='Your last reply was only reasoning, with no answer. Keep your thinking brief this time and write the answer itself, in the format asked for above.';
async function llm(c,prompt,profile,signal,tokens,systemPrompt,direct,{sampling=null,label:roleLabel=''}={}) {
  const t0=Date.now(), who=roleLabel||'Storyloom';
  logEvent('info','Model',`${who}: request sent${profile&&profile!=='__direct__'?' (connection profile)':profile==='__direct__'?' (Storyloom’s own provider)':''}`, fullLog()?`SYSTEM:\n${systemPrompt||''}\n\nPROMPT:\n${prompt}`:'');
  const progress=data=>showLive(data);
  showLive({text:'',reasoning:''});
  const started=Date.now(), label=document.getElementById('na-status')?.textContent?.replace(/\s*\(\d+s\)$/,'') || 'Waiting for the AI…';
  const ticker=setInterval(()=>{const el=document.getElementById('na-status');if(el && busyLabel(el.textContent,label))el.textContent=`${label} (${Math.round((Date.now()-started)/1000)}s)`;},1000);
  try {
    return await requestModel(async requestSignal=>{
      try {
        try {const r=await generate(c,prompt,profile,requestSignal,tokens,systemPrompt,direct,progress,sampling);logEvent('info','Model',`${who}: answered in ${Math.round((Date.now()-t0)/1000)}s (${String(r||'').length.toLocaleString()} characters)`,fullLog()?String(r||''):'');return r;}
        catch(error) {
          if(!error?.emptyReply || requestSignal.aborted)throw error;
          // Empty answers are usually a one-off from the provider; ask once more before failing.
          logEvent('warn','Model',`${who}: empty reply, asking once more`,error.message);
          const el=document.getElementById('na-status'); if(el)el.textContent=`The model answered with nothing (${error.message.replace(/^the model /,'')}); asking once more…`;
          showLive({text:'',reasoning:''});
          // The second try asks for the answer directly, so a model that only reasoned last time writes it out.
          return await generate(c,`${prompt}\n\n${ANSWER_NOW}`,profile,requestSignal,Math.min(16000,Math.max(tokens,Math.round(tokens*1.5))),systemPrompt,direct,progress,sampling); // more room: the first try ran out while thinking
        }
      } catch(error) {
        logEvent(requestSignal.aborted?'info':'error','Model',`${who}: ${requestSignal.aborted?'stopped':'failed'} after ${Math.round((Date.now()-t0)/1000)}s`,String(error?.stack||error?.message||error));
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
  document.querySelector('#na-cancel-model').hidden=!controller;
  for (const id of ['na-send','na-skip','na-next','na-outline']) document.querySelector('#'+id).disabled=!!controller;
}
const noChatOpen=()=>!context().chatId;
function renderPanelView() {
  const panel=document.getElementById('na-panel'), none=noChatOpen();
  document.querySelector('#na-settings').hidden=!settingsOpen;
  document.querySelector('#na-nochat').hidden=!none || settingsOpen || activeTab==='assistant';
  document.querySelector('#na-workspace').hidden=none || settingsOpen || activeTab!=='story';
  renderTabs();
  if(none) {
    document.querySelector('#na-memory').hidden=true;
    document.querySelector('#na-back').hidden=true;
    const toggle=document.querySelector('#na-settings-toggle'); toggle.textContent=settingsOpen?'Done':'Settings'; toggle.setAttribute('aria-expanded',String(settingsOpen));
    return;
  }
  const toggle=document.querySelector('#na-settings-toggle');
  toggle.textContent=settingsOpen?'Done':'Settings';
  toggle.setAttribute('aria-expanded',String(settingsOpen));
  const novel=data();
  document.querySelector('#na-undo-area').hidden=!novel.history?.length;
  document.querySelector('#na-retry-area').hidden=!(novel.pendingContinuity || novel.queueError);
  document.querySelector('#na-resume-area').hidden=!novel.review;
  const back=document.querySelector('#na-back');
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
    const budget=planningBudget(c.maxContext); // Storyloom's own request — not limited by the story chat's Context Size
    const history=(interview?.sourceOnly || (interview?.requireOutline && d.interview?.mode==='deep')) ? [] : recentConversation(d.messages,Math.floor(budget*.25));
    const query=history.map(x=>x.content).join(' ')+input;
    const targetEntries=synopsis(before);
    const loreBudget=interview?.loreBudget || Math.floor(budget*.6);
    const current=interview?.sourceOnly ? selectLore(targetEntries.filter(x=>x.title.trim().toLocaleLowerCase()===interview.requiredCharacterTitle.toLocaleLowerCase()),query,loreBudget,tpl(d).summary.title) : selectLore(targetEntries,query,loreBudget,tpl(d).summary.title,d.interview?.phase==='done'?[tpl(d).outline.title,...tpl(d).entries.map(e=>e.title)]:[]);
    const reference=interview?.sourceOnly ? selectCharacterSource(ref?synopsis(ref):[],interview.sourceCharacter,Math.floor(budget*.5)) : selectLore(ref?synopsis(ref):[],query,Math.floor(budget*.25));
    const prompt = `Use the available lore for continuity. For an existing fact you can see, carry it forward unless the writer changes it. Blank interview fields in Simple mode are yours to complete.\nCurrent novel entries: ${JSON.stringify(current)}\nReference material from ${referenceName || 'no linked book'} (do not treat as current canon without relevance): ${JSON.stringify(reference)}\nConversation: ${JSON.stringify(history)}\n${fromMain ? 'New main story chat text; record only established developments and do not address the user: ' : 'Writer: '}${input}`;
    if(context().chatId!==chatId || data()!==d || d.profile!==profile || d.reference!==referenceName || !sameDirect(d,direct)) throw Error('Chat or novel changed; request stopped.');
    const mode=fromMain?'background':(d.interview?.phase==='done'?'ongoing':d.interview?.mode || 'ongoing');
    const system=(interview?.as?.persona?`${interview.as.persona}\n\n`:'')+planningSystem(mode,tpl(d))+(interview?.guidance ? `\n${interview.guidance}` : '');
    const allowProse=!fromMain && !interview?.requireOutline && !interview?.requiredCharacterTitle && !interview?.requireCharacters;
    const as=interview?.as, useProfile=as?.profile||profile, useDirect=as?.profile?null:direct;
    const ask=(request,instructions)=>llm(c,request,useProfile,controller.signal,tokens,instructions,useDirect,{sampling:as?.sampling,label:as?.label});
    const raw=await ask(prompt,system);
    let result;
    try {result=parseAssistant(raw,{allowProse});}
    catch(error) {
      if(context().chatId!==chatId || context().chatMetadata.world_info!==bookName || data()!==d)throw Error('Chat or lorebook changed; nothing saved.');
      warnLog('Storyloom: could not read the model reply ('+error.message+'). Start:',String(raw).slice(0,500),'… End:',String(raw).slice(-500));
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
    if(interview?.check) result=await repairOutline(result,v=>interview.check(v),async (previous,issue)=>{
      if(context().chatId!==chatId || data()!==d)throw Error('Chat changed; nothing saved.');
      status('Fixing the answer’s format…');
      return parseAssistant(await ask(`${prompt}\n\nYour previous answer needs correction: ${issue} Return it again in full.`,system));
    });
    if(interview?.capture) {const want=new Set(interview.capture.map(x=>x.toLocaleLowerCase()));interview.captured=(result.updates||[]).filter(u=>want.has(String(u.title).trim().toLocaleLowerCase()));}
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
    const approvedCast=d.interview?.proposalApproved?allowedCast(d).join(', '):'';
    const writerPeople=approvedCast || (d.interview?.answers?.people||[]).join('\n');
    if(interview?.part==='plan' && writerPeople.trim()) {
      const castUpdate=(result.updates||[]).find(u=>String(u.title).trim().toLocaleLowerCase()===tpl(d).cast.toLocaleLowerCase());
      if(castUpdate) {
        const {kept,extras}=splitExtraCast(castUpdate.content,writerPeople);
        if(extras.length && kept.includes('|')) {
          castHeld={title:castUpdate.title.trim(),content:`${kept}\n${extras.join('\n')}`,keys:castUpdate.keys||[castUpdate.title],kind:'change',source:'cast',reason:`${approvedCast?'The approved proposal fixed the cast':'You named the characters'}, so the cast list was saved with only them. The AI also wants to add (each needs ~${SCENE_MIN} words of the budget): ${extras.map(l=>l.split('|')[0].replace(/\*\*/g,'').trim()).join(', ')}. Approve to add them (each gets a full profile); skip to keep the cast as you wrote it.`};
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
    let skippedFoundation=false, skippedPartial=[];
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
    // Outline edits come back chapter by chapter; merge them so untouched chapters stay exactly as they were.
    const outlineTitle=tpl(d).outline.title.toLocaleLowerCase(), oldOutline=Object.values(fresh.entries||{}).find(e=>String(e.comment||'').trim().toLocaleLowerCase()===outlineTitle);
    const merged=new Set();
    if(oldOutline && d.interview?.phase==='done')for(const u of result.updates||[])if(u.title.trim().toLocaleLowerCase()===outlineTitle){const before=chapterList(outlineBody(oldOutline.content),tpl(d).unit).length; u.content=mergeOutline(oldOutline.content,u.content,tpl(d).unit); merged.add(u); logEvent('info','Save',`outline merged by ${tpl(d).unit.toLowerCase()}: ${before} → ${chapterList(u.content,tpl(d).unit).length}`);}
    let writes = planWrites(fresh, result.updates, {...tpl(d).summary,required:requiredOf(tpl(d).summary,true)});
    // The model rewrote entries it only saw part of. Instead of dropping the change, show it the complete entry and ask for the whole updated text.
    let unsafe=unsafeUpdates(writes.filter(w=>w.update.storyloomKind!=='interview_notes' && !merged.has(w.update)),current);
    for(const w of [...unsafe]) {
      const full=String(fresh.entries[w.uid]?.content||'');
      try {
        status(`“${w.update.title}” is long; showing the AI the whole entry so the change keeps everything else…`);
        const fix=await ask(`The writer asked: ${input}\n\nYou proposed a new version of the entry “${w.update.title}”, but you only saw part of the current entry, so your version would lose the rest. Here is the COMPLETE current entry, then your proposed version. Return the complete updated entry — every part of it, with the writer's change applied and consistently carried through, and everything the change doesn't touch kept as it is. Return only this one entry.\n\nCOMPLETE CURRENT ENTRY “${w.update.title}”:\n${full}\n\nYOUR PROPOSED VERSION:\n${w.update.content}`,system);
        const got=parseAssistant(fix,{allowProse:false}).updates?.find(u=>u.title.trim().toLocaleLowerCase()===w.update.title.trim().toLocaleLowerCase());
        if(got && String(got.content||'').trim().length>=full.trim().length*0.6){w.update.content=got.content; if(got.keys?.length)w.update.keys=got.keys; unsafe=unsafe.filter(x=>x!==w); logEvent('info','Save',`“${w.update.title}”: rewrote it with the whole entry in view`);}
        else logEvent('warn','Save',`“${w.update.title}”: the full-entry rewrite came back ${got?'much shorter than the entry':'unreadable'}`,String(fix).slice(0,1500));
      } catch(e){if(controller.signal.aborted)throw e; logEvent('warn','Save',`“${w.update.title}”: full-entry rewrite failed (${e.message})`);}
    }
    if(unsafe.length){writes=writes.filter(w=>!unsafe.includes(w)); logEvent('warn','Save',`kept ${unsafe.map(w=>`“${w.update.title}”`).join(', ')} as ${unsafe.length===1?'it was':'they were'} — couldn’t get a complete rewrite`); skippedPartial=unsafe.map(w=>w.update.title);}
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
      await c.saveWorldInfo(bookName,fresh,true); refreshEditor(bookName);
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
    status((result.ignoredUpdates?'Reply received. The proposed lorebook updates could not be read.':skippedFoundation?'Reply received. Storyloom kept the existing foundation because the proposed update could not be read.':writes.length ? `Saved ${writes.length} World Info ${writes.length === 1 ? 'entry' : 'entries'}.` : 'No entry changes.')+(skippedPartial.length?` Kept ${skippedPartial.map(t=>`“${t}”`).join(', ')} unchanged — the AI couldn’t return a complete version of it. Try asking again, or see the Log.`:'')+heldNote);
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
  await c.saveWorldInfo(name,book,true); refreshEditor(name);
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
    await c.saveWorldInfo(d.book,book,true); refreshEditor(d.book);
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
    if (entry.content !== result.book) { const latest=await freshBook(link.book); if(JSON.stringify(latest)!==JSON.stringify(book)) throw Error('Lorebook changed during sync; please retry.'); if(context().chatId!==chatId || context().chatMetadata.world_info!==link.book || note.value!==originalNote) throw Error('Chat, lorebook or note changed; sync stopped.'); entry.content=result.book; await c.saveWorldInfo(link.book,book,true); refreshEditor(link.book); if(JSON.stringify(await freshBook(link.book))!==JSON.stringify(book)) throw Error('Lorebook save could not be verified; directive sync paused.'); }
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
      entry.content=result.book; await c.saveWorldInfo(link.book,book,true); refreshEditor(link.book);
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
  document.querySelector('#na-messages').hidden=atStart;
  document.querySelector('#na-resume-chat').hidden=!(atStart && savedInterview);
  document.querySelector('#na-start-new-chat').hidden=!(atStart && savedInterview);
  document.querySelector('#na-welcome').hidden=!!interview || !!savedInterview;
  document.querySelector('#na-mode-choices').hidden=!!savedInterview;
  document.querySelector('#na-composer').hidden=!interview || interview.phase==='outline';
  const progress=document.querySelector('#na-progress');
  progress.hidden=interview?.phase!=='asking';
  if(interview?.phase==='asking') {document.querySelector('#na-step-label').textContent=`${interview.mode==='simple'?'SIMPLE':'DEEP'} · ${interview.step+1} OF ${questionCount(interview)}`;document.querySelector('#na-question').textContent=currentQuestion(interview);}
  document.querySelector('#na-interview-controls').hidden=!interview || interview.phase==='done';
  document.querySelector('#na-skip').hidden=!(interview?.phase==='asking' && interview.mode==='simple');
  document.querySelector('#na-next').hidden=!(interview?.phase==='asking' && interview.mode==='deep');
  document.querySelector('#na-outline').hidden=interview?.phase!=='outline';
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
    await c.saveWorldInfo(name,book,true); refreshEditor(name);
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
    // Nothing is built until the writer approves a short proposal (core, timeline, cast, word budget).
    if(!interview.proposalApproved){ if(!d.proposal)await makeProposal(); else {options();status('Approve the proposal, or say what to change.');} return; }
    const brief=d.proposal?approvedBrief({...d.proposal.fields,cast:d.proposal.fields.cast.filter(c=>allowedCast(d).includes(c.name))},budgetLines(d.budget,t.unit),t.unit):'';
    // Two requests so each reply fits the response budget (reasoning models spend part of it thinking).
    if(!interview.planSaved) {
      status(`Step 1 of 2: filling in ${t.summary.title} and the planning entries…`);
      await interact(finalizeInstruction(interview.mode,interview.answers,t,'plan',brief),false,null,null,null,false,{guidance:'Complete the interview as instructed. Return every required planning entry as an entry block.',requireOutline:true,part:'plan',holdForAuthor:'extras',silentUser:true,loreBudget:60000});
      if(data()!==d)throw Error('Chat changed. Return to the novel to finish.');
      d.interview={...d.interview,planSaved:true}; await persist();
    }
    status(`Step 2 of 2: writing the ${t.outline.title}…`);
    const result=await interact(finalizeInstruction(interview.mode,interview.answers,t,'outline',brief),false,null,null,null,false,{guidance:`Return the ${t.outline.title} entry in updates.`,requireOutline:true,holdForAuthor:'extras',part:'outline',silentUser:true,loreBudget:60000});
    if(data()!==d)throw Error('Chat changed. Return to the novel to finish.');
    const outline=result.updates.find(x=>x.title.trim().toLocaleLowerCase()===t.outline.title.toLocaleLowerCase());
    d.messages.push({role:'assistant',content:'Here is your outline:\n\n'+outline.content});
    d.interview={...d.interview,phase:'done'};
    d.outlineChapters=chapterList(outline.content,t.unit).map(({number,title})=>({number,title}));
    await persist();
    let reviewNote='';
    try {reviewNote=(await reviewStory({quiet:true})).note;} catch(e) {warnLog('Storyloom review:',e); reviewNote='The fresh-eyes review could not run; use “Check what’s missing” later.';}
    let bookMessage='';
    try {bookMessage=await nameFinishedLorebook(d);}
    catch {bookMessage=' The outline is saved in the draft lorebook. Storyloom could not switch it to a titled book.';}
    try {await organizeBook(1);} catch(e) {warnLog('Storyloom layout:',e);}
    try {await fillBookValues({quiet:true});} catch(e) {warnLog('Storyloom book settings:',e);}
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
    const after=layoutBook(before,{chapter:n,create:book=>createWorldInfoEntry(name,book),template:t,voiceViaNarrator:usesGeneralNarrator(c)});
    const directive=Object.values(after.entries).find(e=>e.comment==='Current Writing Directive');
    if(directive)directive.content=directiveForChapter(directive.content,n);
    const changes=buildChange(before,after);
    if(!changes.length){d.chapter=n;await persist();return;}
    if(context().chatId!==chatId || data()!==d || JSON.stringify(await freshBook(name))!==JSON.stringify(before))throw Error('The chat or lorebook changed; try again.');
    await c.saveWorldInfo(name,after,true); refreshEditor(name);
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
/* ---------- Backups: the old version of anything Storyloom changes outside the lorebook ---------- */
function storedBackups(){const s=(context().extensionSettings.storyloom ??= {}); return s.backups ??= [];}
function backup(item) {
  const s=(context().extensionSettings.storyloom ??= {});
  const {list,entry}=addBackup(s.backups||[],item); s.backups=list; context().saveSettingsDebounced();
  logEvent('info','Backup',`kept the old version: ${entry.label}`); renderBackups(); return entry;
}
const presetName=()=>{try{const c=context();return c.mainApi==='openai'?(c.getPresetManager?.('openai')?.getSelectedPresetName?.()||'current preset'):'System Prompt';}catch{return 'current preset';}};
/** The global Main Prompt: Chat Completion's “Main Prompt”, or the System Prompt for text-completion APIs. */
function readGlobalMain() {
  const c=context();
  if(c.mainApi==='openai'){const p=(c.chatCompletionSettings?.prompts||[]).find(x=>x.identifier==='main'); return {api:'chat',text:p?.content??''};}
  return {api:'text',text:c.powerUserSettings?.sysprompt?.content??''};
}
function writeGlobalMain(text,api=readGlobalMain().api) {
  const c=context();
  if(api==='chat'){const p=(c.chatCompletionSettings?.prompts||[]).find(x=>x.identifier==='main'); if(!p)throw Error('This preset has no Main Prompt entry.'); p.content=text; try{promptManager?.render?.(false);}catch{}}
  else {if(!c.powerUserSettings?.sysprompt)throw Error('SillyTavern’s System Prompt isn’t available.'); c.powerUserSettings.sysprompt.content=text; const ta=document.getElementById('sysprompt_content'); if(ta)ta.value=text;}
  c.saveSettingsDebounced();
}
/** The narrator fields of a character card, as they are now (for backups). */
const charSnapshot=ch=>({description:ch?.description||'',system_prompt:ch?.data?.system_prompt||'',post_history_instructions:ch?.data?.post_history_instructions||'',depth_prompt:{prompt:ch?.data?.extensions?.depth_prompt?.prompt||'',depth:ch?.data?.extensions?.depth_prompt?.depth??4,role:ch?.data?.extensions?.depth_prompt?.role||'system'}});
/** Change only the given narrator fields of a character card. */
async function writeCharacter(avatar,{description,system_prompt,post_history_instructions,depth_prompt}) {
  const c=context(), patch={avatar,data:{}};
  if(description!==undefined){patch.description=description;patch.data.description=description;}
  if(system_prompt!==undefined)patch.data.system_prompt=system_prompt;
  if(post_history_instructions!==undefined)patch.data.post_history_instructions=post_history_instructions;
  if(depth_prompt!==undefined)patch.data.extensions={depth_prompt:{prompt:depth_prompt.prompt??'',depth:Number(depth_prompt.depth??4),role:depth_prompt.role||'system'}};
  const m=await fetch('/api/characters/merge-attributes',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify(patch)});
  if(!m.ok)throw Error(`SillyTavern couldn’t save the character (${(await m.text()).slice(0,200)}).`);
  await c.getCharacters();
}
/** The fields a reviewed narrator writes to its card (only the ticked places). */
function narratorFields(r) {
  const f={};
  if(r.toDesc)f.description=r.instructions;
  if(r.toMain)f.system_prompt=r.toGlobal?r.mainPrompt:`{{original}}\n\n${r.mainPrompt}`;
  if(r.toNote)f.depth_prompt={prompt:r.charNote,depth:4,role:'system'};
  if(r.toPost)f.post_history_instructions=r.postHistory;
  return f;
}
/** Put a backup back. The current version is backed up first, so a restore can itself be undone. */
async function restoreBackup(b) {
  const c=context();
  if(b.kind==='globalMain'){const cur=readGlobalMain(); backup({kind:'globalMain',label:'Global Main Prompt (before a restore)',target:{api:cur.api},before:cur.text}); writeGlobalMain(b.before??'',b.target?.api||cur.api);}
  else if(b.kind==='character'){const ch=c.characters.find(x=>x.avatar===b.target?.avatar); if(!ch)throw Error('That character no longer exists.'); backup({kind:'character',label:`${ch.name} (before a restore)`,target:{avatar:ch.avatar},before:charSnapshot(ch)}); await writeCharacter(ch.avatar,b.before||{});}
  else if(b.kind==='prompt'){const all=storedPrompts(), key=b.target?.key; backup({kind:'prompt',label:`${b.label} (before a restore)`,target:{key},before:all[key]??null}); if(b.before==null)delete all[key]; else all[key]=b.before; setPromptOverrides(all); c.saveSettingsDebounced(); renderPromptEditor();}
  else if(b.kind==='persona'){const roles=storedRoles(), k=b.target?.role; backup({kind:'persona',label:`${b.label} (before a restore)`,target:{role:k},before:roles[k]?.persona||null}); roles[k]={...roles[k],persona:b.before||''}; c.saveSettingsDebounced(); renderTeamSettings();}
  else if(b.kind==='narratorTemplate'){const st=(c.extensionSettings.storyloom ??= {}); backup({kind:'narratorTemplate',label:'Narrator template (before a restore)',before:st.narratorTemplate??null}); if(b.before==null)delete st.narratorTemplate; else st.narratorTemplate=b.before; c.saveSettingsDebounced(); const t=document.getElementById('sl-narrator-template-text'); if(t)t.value=narratorTemplateText(narratorTemplate());}
  else if(b.kind==='preset'){const pm=c.getPresetManager('openai'), name=b.target?.name||PRESET_NAME, cur=pm.getPresetList().preset_names?.[name]!==undefined?pm.getCompletionPresetByName(name):null; if(cur)backup({kind:'preset',label:`Preset “${name}” (before a restore)`,target:{name},before:cur}); await pm.savePreset(name,b.before,{skipUpdate:pm.getSelectedPresetName()!==name}); if(pm.getSelectedPresetName()!==name){const l=pm.getPresetList(); if(l.preset_names?.[name]!==undefined)l.presets[l.preset_names[name]]=b.before;}}
  else if(b.kind==='template'){const list=storedTemplates(), name=b.before?.name, i=list.findIndex(x=>{try{return parseTemplate(x).name===name}catch{return false}}); if(i>=0){backup({kind:'template',label:`Template “${name}” (before a restore)`,target:{name},before:{name,text:list[i]}}); list[i]=b.before.text;} else list.push(b.before.text); c.saveSettingsDebounced(); try{renderTemplates(data());}catch{}}
  else throw Error('Chapter text comes back from the message’s swipes (the arrows on the message). Use Copy to take this backup’s text.');
  logEvent('info','Backup',`restored: ${b.label}`);
}
function renderBackups() {
  const box=document.getElementById('sl-backup-list'); if(!box)return;
  const list=[...storedBackups()].reverse();
  box.replaceChildren(...(list.length?list.map(b=>{
    const pre=el('pre',{hidden:true,textContent:backupText(b)});
    const view=el('button',{type:'button',className:'menu_button',textContent:'View'}); view.onclick=()=>{pre.hidden=!pre.hidden;view.textContent=pre.hidden?'View':'Hide';};
    const copy=el('button',{type:'button',className:'menu_button',textContent:'Copy'}); copy.onclick=async()=>{try{await navigator.clipboard.writeText(backupText(b));toastr?.success?.('Backup copied.');}catch(e){toastr?.error?.(e.message);}};
    const row=el('div',{className:'storyloom-row'},view,copy);
    if(b.kind!=='chapter'){const r=el('button',{type:'button',className:'menu_button',textContent:'Restore'}); r.onclick=async()=>{if(!await context().Popup.show.confirm('Restore this backup?',`Put back “${escHtml(b.label)}” as it was on ${new Date(b.at).toLocaleString()}? What’s there now is backed up first.`))return; try{await restoreBackup(b);toastr?.success?.(`Restored: ${b.label}`);renderTeam();}catch(e){fail(e);toastr?.error?.(e.message);}}; row.append(r);}
    return el('li',{},el('div',{textContent:`${new Date(b.at).toLocaleString()} · ${BACKUP_KINDS[b.kind]||b.kind} · ${b.label}`}),row,pre);
  }):[el('li',{textContent:'No backups yet. Storyloom keeps one here every time it changes something of yours outside the lorebook.'})]));
}

/* ---------- SillyTavern Extensions menu → Storyloom: chapter team, memory placement, prompts, templates, repair, log ---------- */
function teamMarkup() {
  return ROLE_KEYS.map(k=>{const r=ROLES[k];return `<div class="storyloom-role" data-role="${k}">
    <label class="checkbox_label"><input type="checkbox" class="sl-role-on"${k==='seal'?' disabled':''}> <b>${r.label}</b> <small>— ${r.model}${k==='seal'?' (always on: it’s how a chapter is finished)':k==='checker'?' (off: only the exact checks run, no model)':''}</small></label>
    <label>Model <select class="text_pole sl-role-profile"></select></label>
    <details><summary>What they do</summary><p class="storyloom-hint"><b>Job (fixed):</b> ${r.job}</p><label>Personality <small class="sl-role-edited"></small><textarea class="text_pole sl-role-persona" rows="6"></textarea></label><div class="storyloom-row"><button type="button" class="menu_button sl-role-save">Save</button><button type="button" class="menu_button sl-role-reset">Reset to original</button></div></details>
  </div>`;}).join('');
}
function renderTeamSettings() {
  const c=context(), rs=teamSettings();
  for(const k of ROLE_KEYS) {
    const box=document.querySelector(`#storyloom-ext [data-role="${k}"]`); if(!box)continue;
    box.querySelector('.sl-role-on').checked=k==='seal'||rs[k].enabled;
    const sel=box.querySelector('.sl-role-profile'); sel.replaceChildren(new Option('Same as Storyloom',''));
    for(const p of profileOptions(c.extensionSettings.connectionManager?.profiles||[],c.ConnectionManagerRequestService,rs[k].profile))sel.add(new Option(p.name,p.id));
    sel.value=rs[k].profile||'';
    const ta=box.querySelector('.sl-role-persona'); if(document.activeElement!==ta)ta.value=rs[k].persona;
    box.querySelector('.sl-role-edited').textContent=rs[k].edited?'(edited)':'(original)';
  }
}
function renderExtSettings() {
  renderBackups(); renderTeamSettings(); renderPlacement().catch(e=>warnLog('Storyloom placement:',e)); renderLog();
  try{renderPromptEditor();}catch(e){warnLog('Storyloom prompts:',e);} let d={}; try{d=data();}catch{} try{renderTemplates(d);}catch(e){warnLog('Storyloom templates:',e);}
  const full=document.getElementById('sl-log-full'); if(full)full.checked=fullLog();
}
function buildExtSettings(openButton,panel) {
  const host=document.querySelector('#extensions_settings2, #extensions_settings'); if(!host)return;
  const wrap=document.createElement('div'); wrap.id='storyloom-ext'; wrap.className='storyloom-ext';
  wrap.innerHTML=`<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Storyloom</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content">
    <div class="sl-open-row"></div>
    <details id="sl-team" open><summary>Chapter team</summary><p class="storyloom-hint">The people who work on each chapter after it’s written: Lint → Editor → Reader → Revise → Seal (Memory tab). Switch a role off to skip its step. Each can use its own model — a fast, cheap one for the Checker, a stronger one for the Editor. If a role’s model fails or answers in a form Storyloom can’t read, Storyloom asks its own connection once and says so in the log. Their jobs are fixed so the steps can’t break; their personalities are yours to change.</p>${teamMarkup()}</details>
    <details id="sl-narrator-template"><summary>Narrator template</summary><p class="storyloom-hint">The headings Storyloom uses as a guide when it drafts a narrator — one “HEADING: what it covers” per line. It’s a guide, not a form: Storyloom skips headings that don’t fit the story and adds its own when the story needs them.</p><textarea id="sl-narrator-template-text" class="text_pole" rows="10" spellcheck="false"></textarea><div class="storyloom-row"><button id="sl-narrator-template-save" type="button" class="menu_button">Save</button><button id="sl-narrator-template-reset" type="button" class="menu_button">Reset to original</button></div></details>
    <details id="sl-placement"><summary>Memory placement</summary><p class="storyloom-hint">Where each piece of memory goes in the main chat’s prompt, who it is sent as, and the instruction wrapped around it. The text itself is on the Memory tab.</p><p class="storyloom-hint sl-placement-book"></p><p class="storyloom-hint sl-placement-empty">Open a novel’s chat (with its outline done) to set placement.</p><div class="sl-placement-items">${placementMarkup()}</div></details>
    <div id="sl-moved"></div>
    <details id="sl-backups"><summary>Backups</summary><p class="storyloom-hint">Before Storyloom changes anything of yours outside the lorebook — the global Main Prompt, a character’s description or Main Prompt, a Storyloom prompt, a role’s personality, the narrator template, chapter text before a revision — it keeps the old version here (newest 200). Restore puts it back; what’s there now is backed up first. Lorebook changes have their own undo under Repair and more.</p><ul id="sl-backup-list" class="storyloom-log"></ul></details>
    <details id="sl-log"><summary>Log</summary><p class="storyloom-hint">What Storyloom did, what failed and why. Kept in this browser (newest 500 entries). API keys are never recorded.</p>
      <div class="storyloom-row"><label>Show <select id="sl-log-filter" class="text_pole"><option value="all">Everything</option><option value="warn">Errors and warnings</option><option value="error">Errors only</option></select></label><button id="sl-log-copy" type="button" class="menu_button">Copy</button><button id="sl-log-download" type="button" class="menu_button">Download</button><button id="sl-log-clear" type="button" class="menu_button">Clear</button></div>
      <label class="checkbox_label"><input id="sl-log-full" type="checkbox"> Keep full prompts and replies (for debugging; makes the log much bigger)</label>
      <ul id="sl-log-list" class="storyloom-log"></ul></details>
  </div></div>`;
  host.append(wrap);
  openButton.textContent='Open Storyloom panel'; wrap.querySelector('.sl-open-row').append(openButton);
  const moved=wrap.querySelector('#sl-moved');
  for(const sel of ['details.storyloom-prompts','details.storyloom-templates']){const n=panel.querySelector(`#na-settings ${sel}`);if(n)moved.append(n);}
  const more=[...panel.querySelectorAll('#na-settings details.storyloom-advanced')].find(x=>/More options/.test(x.querySelector('summary')?.textContent||''));
  if(more){more.querySelector('summary').firstChild.textContent='Repair and more ';moved.append(more);}
  const saveSettings=()=>context().saveSettingsDebounced();
  for(const k of ROLE_KEYS) {
    const box=wrap.querySelector(`[data-role="${k}"]`), roles=()=>storedRoles();
    box.querySelector('.sl-role-on').onchange=e=>{roles()[k]={...roles()[k],enabled:e.target.checked};saveSettings();renderTeam();logEvent('info','Settings',`${ROLES[k].label} ${e.target.checked?'on':'off'}`);};
    box.querySelector('.sl-role-profile').onchange=e=>{roles()[k]={...roles()[k],profile:e.target.value};saveSettings();logEvent('info','Settings',`${ROLES[k].label} model: ${e.target.selectedOptions[0]?.textContent||'Same as Storyloom'}`);};
    box.querySelector('.sl-role-save').onclick=()=>{const v=box.querySelector('.sl-role-persona').value.trim();if((roles()[k]?.persona||'')!==(v===ROLES[k].persona?'':v))backup({kind:'persona',label:`${ROLES[k].label}’s personality`,target:{role:k},before:roles()[k]?.persona||null});roles()[k]={...roles()[k],persona:v===ROLES[k].persona?'':v};saveSettings();renderTeamSettings();toastr?.success?.(`${ROLES[k].label}’s personality saved.`);};
    box.querySelector('.sl-role-reset').onclick=()=>{if(roles()[k]?.persona)backup({kind:'persona',label:`${ROLES[k].label}’s personality`,target:{role:k},before:roles()[k].persona});roles()[k]={...roles()[k],persona:''};saveSettings();box.querySelector('.sl-role-persona').value=ROLES[k].persona;renderTeamSettings();};
  }
  for(const item of MEMORY_ITEMS) {
    const box=wrap.querySelector(`[data-memory="${item.key}"]`);
    const place=()=>({where:box.querySelector('.na-mem-where').value,depth:Number(box.querySelector('.na-mem-depth').value)||0,role:box.querySelector('.na-mem-role').value,header:box.querySelector('.na-mem-header').value});
    box.querySelector('.na-mem-where').onchange=()=>{const p=place();box.querySelector('.na-mem-depth-label').hidden=p.where!=='chat-depth';box.querySelector('.na-mem-role-label').hidden=p.where==='off';};
    box.querySelector('.na-mem-save').onclick=async()=>{lastAction=`Save ${item.label} placement`;try{await saveMemoryItem(item,undefined,place());toastr?.success?.(`${item.label}: placement saved.`);renderMemory();}catch(e){fail(e);toastr?.error?.(e.message);}};
  }
  const tplBox=wrap.querySelector('#sl-narrator-template-text'), st=()=>(context().extensionSettings.storyloom ??= {});
  tplBox.value=narratorTemplateText(narratorTemplate());
  wrap.querySelector('#sl-narrator-template-save').onclick=()=>{const rows=parseNarratorTemplate(tplBox.value);if((st().narratorTemplate??null)!==narratorTemplateText(rows))backup({kind:'narratorTemplate',label:'Narrator template',before:st().narratorTemplate??null});st().narratorTemplate=narratorTemplateText(rows);saveSettings();tplBox.value=st().narratorTemplate;toastr?.success?.(`Narrator template saved (${rows.length} headings).`);logEvent('info','Settings','narrator template saved');};
  wrap.querySelector('#sl-narrator-template-reset').onclick=()=>{if(st().narratorTemplate!=null)backup({kind:'narratorTemplate',label:'Narrator template',before:st().narratorTemplate});delete st().narratorTemplate;saveSettings();tplBox.value=narratorTemplateText();toastr?.success?.('Narrator template reset.');};
  wrap.querySelector('#sl-log-filter').onchange=renderLog;
  wrap.querySelector('#sl-log-full').onchange=e=>{const c=context();c.extensionSettings.storyloom ??= {};c.extensionSettings.storyloom.logFull=e.target.checked;saveSettings();};
  wrap.querySelector('#sl-log-copy').onclick=async()=>{try{await navigator.clipboard.writeText(logText(readLog()));toastr?.success?.('Storyloom log copied.');}catch(e){toastr?.error?.('Could not copy: '+e.message);}};
  wrap.querySelector('#sl-log-download').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([logText(readLog())],{type:'text/plain'}));a.download=`storyloom-log-${new Date().toISOString().slice(0,10)}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);};
  wrap.querySelector('#sl-log-clear').onclick=async()=>{if(await context().Popup.show.confirm('Clear the Storyloom log?','This removes every log entry in this browser.')){localStorage.removeItem(LOG_KEY);renderLog();}};
  wrap.querySelector('.inline-drawer-toggle').addEventListener('click',()=>setTimeout(renderExtSettings,50));
  renderExtSettings();
}

/* ---------- Dictation: speak instead of typing (browser speech recognition) ---------- */
const SpeechRec=window.SpeechRecognition||window.webkitSpeechRecognition;
let dictation=null;
const MIC_TIP=SpeechRec?'Dictate: speak instead of typing. Click again to stop. Your browser turns the speech into text (Chrome and Edge use Google’s speech service for this).':'Dictation isn’t available in this browser — it works in Chrome and Edge. SillyTavern’s Speech Recognition extension is another option.';
function addMic(textarea,host,before=null) {
  if(!textarea || !host)return;
  const b=document.createElement('button'); b.type='button'; b.className='storyloom-mic'; b.title=MIC_TIP; b.setAttribute('aria-label','Dictate'); b.setAttribute('aria-pressed','false');
  b.innerHTML='<i class="fa-solid fa-microphone" aria-hidden="true"></i>'; b.disabled=!SpeechRec;
  b.onclick=()=>toggleDictation(textarea,b).catch(fail);
  host.insertBefore(b,before);
}
async function toggleDictation(textarea,button) {
  if(dictation){const same=dictation.button===button; dictation.rec.stop(); if(same)return;}
  const c=context(), s=(c.extensionSettings.storyloom ??= {});
  if(!s.dictationOk) {
    if(!await c.Popup.show.confirm('Use dictation?','<p>Your browser turns what you say into text in this box. In Chrome and Edge the audio is sent to Google’s speech service to do that. Storyloom doesn’t record or keep any audio.</p><p>The browser will ask for microphone access the first time.</p>'))return;
    s.dictationOk=true; c.saveSettingsDebounced();
  }
  const rec=new SpeechRec(); rec.lang=navigator.language||'en-US'; rec.continuous=true; rec.interimResults=true;
  const base=textarea.value, gap=base && !/\s$/.test(base)?' ':''; let done='';
  rec.onresult=e=>{let live='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)done+=t;else live+=t;} textarea.value=base+gap+(done+live).replace(/^\s+/,''); textarea.dispatchEvent(new Event('input',{bubbles:true}));};
  rec.onerror=e=>{logEvent(e.error==='no-speech'||e.error==='aborted'?'info':'warn','Dictation',e.error); if(e.error==='not-allowed'||e.error==='service-not-allowed')status('Microphone access is blocked. Allow it for this site in the browser’s settings, then try again.'); else if(e.error==='network')status('Dictation needs an internet connection (the browser’s speech service).'); else if(e.error!=='no-speech'&&e.error!=='aborted')status(`Dictation stopped: ${e.error}.`);};
  rec.onend=()=>{if(dictation?.rec===rec)dictation=null; button.classList.remove('is-on'); button.setAttribute('aria-pressed','false'); textarea.focus();};
  dictation={rec,button}; button.classList.add('is-on'); button.setAttribute('aria-pressed','true');
  rec.start(); logEvent('info','Dictation','started'); status('Listening… click the microphone again to stop.');
}

function init() {
  const button = document.createElement('button'); button.className='menu_button'; button.textContent='Storyloom';
  const openPanel=()=>{checkForUpdate().catch(()=>{});setTimeout(()=>upgradeLayout().then(done=>{if(done)status('Storyloom updated this book’s setup: the chapter plan is now sent from the Memory tab instead of the lorebook.');}),300);try{if(noChatOpen()){document.getElementById('na-panel').hidden=false;renderPanelView();status('No book is open. Start a new book, or open a book’s chat.');return;}options();document.getElementById('na-panel').hidden=false;const log=document.getElementById('na-messages');log.scrollTop=log.scrollHeight;if(data().profile==='__direct__')refreshKeys().catch(e=>fail(e));}catch(e){toastr.warning(e.message)}};
  button.addEventListener('click',()=>{openPanel();document.querySelector('#extensions-settings-button .drawer-toggle')?.click();});
  const shortcut=document.createElement('button');shortcut.type='button';shortcut.id='storyloom-chat-shortcut';shortcut.title='Open Storyloom';shortcut.setAttribute('aria-label','Open Storyloom');shortcut.innerHTML='<i class="fa-solid fa-feather-pointed" aria-hidden="true"></i>';shortcut.addEventListener('click',openPanel);document.getElementById('leftSendForm')?.append(shortcut);
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
        <label class="storyloom-check"><input id="na-watch" type="checkbox"> Follow the main chat</label><p class="storyloom-hint">When on, Storyloom reads new messages in your main SillyTavern chat and adds anything that happens in the story (new people, events, changes) to the lorebook.</p><p class="storyloom-hint">More settings — the chapter team and their models, prompts, templates, memory placement, repair tools and the log — are in SillyTavern’s Extensions menu → Storyloom.</p><button id="na-open-ext" type="button">Open those settings</button>
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
    <section id="na-nochat" class="storyloom-welcome storyloom-nochat" hidden><span class="storyloom-eyebrow">NO BOOK OPEN</span><h2>Start a new book<br><em>or open one you’re writing.</em></h2><p>Each book lives in its own chat with the narrator. Start a new one here — Storyloom makes the Storyloom Narrator if you don’t have it, opens a fresh chat with it, offers the Storyloom Novel preset, and then asks how you’d like to begin. To carry on a book, open its chat. The Assistant tab works without a book.</p><button id="na-start-book" type="button" class="storyloom-team-next">Start a new book →</button></section>
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
    <details id="na-budget" class="storyloom-budget-box" hidden><summary>Story budget</summary><pre></pre><p class="storyloom-hint">Calculated from the approved proposal: length categories from SFWA, scene length ~750–2,000 words from writing-craft guides, core written as scene and the rest as summary (Genette).</p></details>
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
    <section id="na-proposal" class="storyloom-proposal" hidden><strong>Here’s what I’d build</strong><p class="storyloom-hint">Nothing is built until you approve. To change something, say it below and I’ll revise the proposal.</p><div class="storyloom-proposal-body"></div><textarea id="na-proposal-feedback" rows="2" placeholder="What should change? e.g. “no other people”, “make it one night”"></textarea><div class="storyloom-row"><button id="na-proposal-approve" type="button">Approve and build</button><button id="na-proposal-revise" type="button">Revise</button></div></section>
    <div id="na-messages" role="log" aria-live="polite" aria-label="Storyloom conversation"></div>
    <div id="na-interview-controls" class="storyloom-flow"><button id="na-skip" type="button">Skip for now <span aria-hidden="true">→</span></button><button id="na-next" type="button">Next topic <span aria-hidden="true">→</span></button><button id="na-outline" type="button">Create outline <span aria-hidden="true">→</span></button></div>
    <div id="na-composer" class="storyloom-composer"><label class="storyloom-sr-only" for="na-input">Message Storyloom</label><textarea id="na-input" placeholder="Tell me what you’re thinking…"></textarea><div class="storyloom-compose-footer"><span>YOUR STORY, YOUR WAY</span><button id="na-send" type="button">Send <span aria-hidden="true">↗</span></button></div></div>
    </div>
    <section id="na-memory" class="storyloom-memory" hidden>
      <p id="na-memory-empty" class="storyloom-hint">Memory starts once your outline exists. It carries what has happened from one chapter chat to the next.</p>
      <div id="na-team" class="storyloom-team" hidden>
        <p id="na-team-label" class="storyloom-team-label"></p>
        <div class="storyloom-row"><button id="na-writing-setup" type="button" title="The Storyloom Novel preset (how to write a book), the general narrator, and this book’s settings — in one step.">Writing setup…</button><button id="na-book-settings" type="button" title="This chapter’s point of view, tense, voice, tone, genre and rules — the narrator’s blanks.">Book settings…</button><button id="na-narrator-undo" type="button" hidden>Undo narrator change</button><button id="na-export" type="button" title="Save the story — every chapter’s narration, in order, without your directions — as a Word (.docx) or text (.txt) file.">Export book…</button></div>
        <ol id="na-team-steps" class="storyloom-steps"></ol>
        <p id="na-team-hint" class="storyloom-hint"></p>
        <button id="na-team-next" type="button" class="storyloom-team-next">Next →</button>
        <div id="na-team-body"></div>
        <p class="storyloom-hint">Lint checks, the Editor marks up, the Reader reacts, you keep or untick notes, the Editor revises, and Seal signs the chapter off. Nothing in the chat changes until you accept a revision. Who does each step, and with which model, is set in SillyTavern’s Extensions menu → Storyloom.</p>
      </div>
      <div id="na-remembers" class="storyloom-remembers" hidden><strong>What the story AI remembers</strong><p class="storyloom-hint">Sent with every reply in the main chat. Where each piece goes is set in Extensions → Storyloom → Memory placement.</p><ul id="na-remember-list"></ul></div>
    </section>
    <section id="na-assistant" class="storyloom-assistant" hidden>
      <div class="storyloom-assistant-bar"><small id="na-docs-status" class="storyloom-hint"></small><div class="storyloom-row"><button id="na-docs-update" type="button">Update docs</button><button id="na-assistant-new" type="button">New conversation</button></div></div>
      <div id="na-assistant-log" role="log" aria-live="polite" aria-label="Assistant conversation"></div>
      <div class="storyloom-composer"><label class="storyloom-sr-only" for="na-assistant-input">Ask the assistant</label><textarea id="na-assistant-input" placeholder="Ask about SillyTavern, your lorebook, or where something should go…"></textarea><div class="storyloom-compose-footer"><span>CTRL+ENTER TO SEND</span><button id="na-assistant-send" type="button">Ask <span aria-hidden="true">↗</span></button></div></div>
    </section>
    <div id="na-live" class="storyloom-live" hidden aria-live="off"><div class="storyloom-live-head"></div><div class="storyloom-live-body"></div></div>
    <div class="storyloom-feedback"><div id="na-status" role="status" aria-live="polite"></div><button id="na-cancel-model" type="button" hidden>Stop</button></div>`;
  document.body.append(panel);
  for(const [id,tip] of Object.entries(TIPS)){const el=document.querySelector('#'+id);if(el)el.title=tip;}
  panel.addEventListener('click',event=>{const b=event.target.closest('button');if(b && b.id!=='na-cancel-model')lastAction=b.textContent.replace(/[↗→⌄×]/g,'').trim()||b.getAttribute('aria-label')||'';},true);
  panel.addEventListener('change',event=>{const l=event.target.closest('label')?.childNodes[0]?.textContent?.trim();const f=event.target.id==='na-book'?'Lorebook for this chat':event.target.id==='na-reference'?'Reference lorebook':l;if(f)lastAction=f;},true);
  for(const provider of PROVIDERS)document.querySelector('#na-provider').add(new Option(provider.name,provider.id));
  document.querySelector('#na-close').onclick=()=>{panel.hidden=true;settingsOpen=false;};
  document.querySelector('#na-settings-toggle').onclick=()=>{settingsOpen=!settingsOpen;renderPanelView();};
  document.querySelector('#na-back').onclick=()=>{atStart=!atStart;settingsOpen=false;renderInterview();renderPanelView();};
  document.querySelector('#na-resume-chat').onclick=()=>{atStart=false;renderInterview();renderPanelView();};
  const startNewNovel=async()=>{
    const button=document.querySelector('#na-start-new-chat');
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
  document.querySelector('#na-start-new-chat').onclick=startNewNovel;
  document.querySelector('#na-cancel-model').onclick=()=>modelController?.abort();
  panel.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    event.stopPropagation();
    if(settingsOpen){settingsOpen=false;renderPanelView();}else panel.hidden=true;
  });
  document.querySelector('#na-retry').onclick=async()=>{try{await flushContinuity(); const d=data(); delete d.queueError; await persist(); status('Pending updates ready to retry.');scheduleDrain();}catch(e){fail(e)}};
  for(const [id,choice] of [['na-use-book','book'],['na-use-note','note']]) document.querySelector('#'+id).onclick=async()=>{try{if(await context().Popup.show.confirm('Resolve directive difference?', 'Use the selected version for both the lorebook and Author’s Note?'))await resolveDirective(choice);}catch(e){fail(e)}};
  document.querySelector('#na-resume').onclick=async()=>{try{const d=data(); if(!d.review){status('Tracking is not paused.');return;} if(!await context().Popup.show.confirm('Resume tracking?', 'Confirm that you reviewed the changed chat and affected lore. Stale queued updates will be discarded.'))return; const c=context(); d.pending=(d.pending||[]).filter(j=>c.chat[j.index]?.mes===j.raw && (j.previous===undefined || c.chat[j.index-1]?.mes===j.previous)); delete d.review; d.processed=[]; await persist(); status('Tracking resumed.'); scheduleDrain();}catch(e){fail(e)}};
  document.querySelector('#na-undo').onclick=async()=>{let ownsLock=false;try {
    requireIdle(); syncing=true; ownsLock=true;
    const c=context(), d=data(); await recoverPending(d); const history=d.history?.at(-1);
    if (!history || history.book!==d.book) throw Error('No saved entry change to undo for this book.');
    const current=await freshBook(history.book), reverted=undoChange(current,history.changes);
    if(context().chatId!==c.chatId || data()!==d) throw Error('Chat changed; undo stopped.');
    if(JSON.stringify(await freshBook(history.book))!==JSON.stringify(current)) throw Error('The lorebook changed; try undo again.');
    await c.saveWorldInfo(history.book,reverted,true); refreshEditor(history.book);
    if (JSON.stringify(await freshBook(history.book))!==JSON.stringify(reverted)) throw Error('Undo could not be verified.');
    d.history.pop(); await persist(); options(); status('Last entry changes undone.');
  }catch(e){fail(e)}finally{if(ownsLock){syncing=false;queueSync();scheduleDrain()}}};
  document.querySelector('#na-attach').onclick=async()=>{try {
    requireIdle(); const c=context(), name=data().book || c.chatMetadata.world_info; if(!name) throw Error('Choose a lorebook first.');
    if(await attachBook(name,c)){options();status('Lorebook linked to this chat.');}
  }catch(e){fail(e)}};
  document.querySelector('#na-setup').onclick=async()=>{try{await setupNovel();}catch(e){fail(e)}};
  document.getElementById('extension_floating_prompt')?.addEventListener('input',queueSync);
  document.querySelector('#na-book').onchange=async e=>{try{
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
  for (const [id,field] of [['na-reference','reference'],['na-profile','profile']]) document.querySelector('#'+id).onchange=async e=>{try{
    requireIdle();const d=data(),value=e.target.value;
    if(field==='profile' && value==='__direct__' && !d.direct){
      const c=context(), current=c.chatCompletionSettings?.chat_completion_source;
      const provider=PROVIDERS.some(x=>x.id===current)?current:'custom';
      d.direct={provider,model:c.mainApi==='openai'?(c.getChatCompletionModel?.()||''):'',url:provider==='custom'?(c.chatCompletionSettings?.custom_url||''):'',keyId:''};
    }
    d[field]=value;await persist();options();if(field==='profile' && value==='__direct__')await refreshKeys();
  }catch(err){options();fail(err)}};
  document.querySelector('#na-import-character').onclick=async()=>{try {
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
        await c.saveWorldInfo(name,book,true); refreshEditor(name);
        if(!findCharacterEntry(await freshBook(name),title))throw Error(`Saving “${title}” to “${name}” could not be verified.`);
      }
      storedLinks().push({id:crypto.randomUUID(),title,books:[source,target,shared],base:linkValue(original),conflict:null,missing:[]});
      c.saveSettingsDebounced();
      renderLinks();
      status(`“${title}” is now in this novel and in “${shared}”. Edit it in any of the three books and the others follow.`);
    } finally {syncing=false;queueSync();scheduleDrain();}
  };
  document.querySelector('#na-link-character').onclick=async()=>{try {
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
  document.querySelector('#na-provider').onchange=async e=>{try{requireIdle();const d=data();d.direct={...(d.direct||{}),provider:e.target.value,keyId:'',model:'',url:'',sessionRequired:false};sessionKey=null;document.querySelector('#na-session-key').value='';await persist();options();await refreshKeys();}catch(err){options();fail(err)}};
  for(const [id,field] of [['na-model','model'],['na-direct-url','url'],['na-key','keyId']])document.querySelector('#'+id).onchange=async e=>{try{requireIdle();const d=data();d.direct ??={provider:'custom'};d.direct[field]=e.target.value;if(field==='keyId'){d.direct.sessionRequired=false;sessionKey=null;document.querySelector('#na-session-key').value='';}await persist();}catch(err){options();fail(err)}};
  document.querySelector('#na-session-key').onchange=async e=>{try{requireIdle();const d=data();const value=e.target.value;sessionKey=value?{chatId:context().chatId,book:d.book,value}:null;d.direct.sessionRequired=!!value;if(value)d.direct.keyId='';await persist();}catch(err){e.target.value='';sessionKey=null;fail(err)}};
  document.querySelector('#na-refresh-keys').onclick=()=>refreshKeys().catch(e=>fail(e));
  document.querySelector('#na-load-models').onclick=async()=>{try{requireIdle();const d=data(),c=context(),snapshot=directSnapshot(d,c),provider=snapshot?.provider;status('Finding models…');const models=await readModels(fetch,c.getRequestHeaders(),snapshot);if(data()!==d || d.direct?.provider!==provider)throw Error('Connection changed while loading models.');const list=document.querySelector('#na-model-list');list.replaceChildren(...models.map(x=>new Option(x,x)));status(models.length?`Found ${models.length} models. Choose or type one.`:'No models returned. Enter a model name.');}catch(e){fail(e)}};
  document.querySelector('#na-tokens').onchange=async e=>{try{requireIdle();const n=Number(e.target.value);if(!Number.isInteger(n)||n<256||n>16000)throw Error('Response budget must be between 256 and 16000 tokens.');data().responseTokens=n;await persist();}catch(err){options();fail(err)}};
  document.querySelector('#na-watch').onchange=async e=>{try{const d=data();d.watch=e.target.checked;if(d.watch && changedProcessed(d.processed||[],context().chat||[])){d.review={reason:'Tracked chat changed while tracking was off.'};status('Tracked chat changed. Review the lore before resuming.');}await persist();if(d.watch)scheduleDrain();}catch(err){fail(err)}};
  document.querySelector('#na-view-book').onclick=()=>{
    try {
      const c=context(), name=data().book || c.chatMetadata.world_info;
      if(!name || !c.getWorldInfoNames().includes(name))throw Error('The selected lorebook is unavailable.');
      openWorldInfoEditor(name);
      panel.hidden=true;
    } catch(error) {fail(error);}
  };
  document.querySelector('#na-use-title').onclick=async()=>{
    try {
      status('Naming the lorebook…');
      const message=await nameFinishedLorebook(data());
      options();
      status(message.trim() || `Set a title in ${tpl().summary.title} first.`);
    } catch(error) {fail(error);}
  };
  document.querySelector('#na-new').onclick=async()=>{try {
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
  document.querySelector('#na-profiles').onclick=()=>writeProfiles();
  document.querySelector('#na-proposal-approve').onclick=async()=>{lastAction='Approve and build';try{await approveProposal();}catch(e){fail(e);}};
  document.querySelector('#na-proposal-revise').onclick=async()=>{lastAction='Revise';const box=document.querySelector('#na-proposal-feedback'),v=box.value.trim();if(!v){status('Say what should change first.');return;}try{await makeProposal(v);box.value='';}catch(e){fail(e);}};
  document.querySelector('#na-update').onclick=()=>updateStoryloom().catch(fail);
  document.querySelector('#na-tab-story').onclick=()=>{activeTab='story';settingsOpen=false;renderPanelView();};
  document.querySelector('#na-tab-assistant').onclick=()=>{activeTab='assistant';settingsOpen=false;renderPanelView();};
  document.querySelector('#na-tab-memory').onclick=()=>{activeTab='memory';settingsOpen=false;renderPanelView();};
  document.querySelector('#na-open-ext').onclick=()=>openStoryloomSettings();
  document.querySelector('#na-start-book').onclick=()=>{lastAction='Start a new book';startNewBook().catch(fail);};
  document.querySelector('#na-writing-setup').onclick=()=>{lastAction='Writing setup';writingSetup().catch(fail);};
  document.querySelector('#na-book-settings').onclick=()=>{lastAction='Book settings';editBookSettings().catch(fail);};
  document.querySelector('#na-export').onclick=()=>{lastAction='Export book';exportBook().catch(fail);};
  document.querySelector('#na-narrator-undo').onclick=()=>{lastAction='Undo narrator change';undoNarrator().catch(fail);};
  const sendAssistant=async()=>{const input=document.querySelector('#na-assistant-input'),v=input.value.trim();if(!v)return;input.value='';try{await askAssistant(v);}catch(e){fail(e);if(!input.value)input.value=v;}};
  document.querySelector('#na-assistant-send').onclick=sendAssistant;
  document.querySelector('#na-assistant-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();sendAssistant();}});
  document.querySelector('#na-assistant-new').onclick=async()=>{try{if(!await context().Popup.show.confirm('Start a new conversation?','The assistant forgets this conversation and its summary. Changes you already applied stay.'))return;const st=assistantState();st.messages=[];st.summary='';saveAssistant();renderAssistant();}catch(e){fail(e);}};
  document.querySelector('#na-docs-update').onclick=async()=>{try{await ensureDocs({force:true});status('SillyTavern docs updated.');}catch(e){fail(e);}};
  document.querySelector('#na-review').onclick=async()=>{try{await reviewStory();options();}catch(e){fail(e);}};
  document.querySelector('#na-template-edit').onchange=()=>showTemplateText();
  document.querySelector('#na-prompt-key').onchange=()=>renderPromptEditor();
  document.querySelector('#na-prompt-save').onclick=()=>{try{const key=document.querySelector('#na-prompt-key').value,text=document.querySelector('#na-prompt-text').value.trim();if(!text)throw Error('The prompt is empty. Use “Reset to default” to go back to the original.');const all=storedPrompts();if((all[key]??null)!==(text===PROMPT_DEFAULTS[key].text?null:text))backup({kind:'prompt',label:`Prompt: ${PROMPT_DEFAULTS[key].label}`,target:{key},before:all[key]??null});if(text===PROMPT_DEFAULTS[key].text)delete all[key];else all[key]=text;setPromptOverrides(all);context().saveSettingsDebounced();renderPromptEditor();status(`“${PROMPT_DEFAULTS[key].label}” saved. It applies from the next request.`);}catch(e){fail(e);}};
  document.querySelector('#na-prompt-reset').onclick=async()=>{try{const key=document.querySelector('#na-prompt-key').value;if(!await context().Popup.show.confirm('Reset this prompt?',`Put “${PROMPT_DEFAULTS[key].label}” back to Storyloom’s original wording?`))return;const all=storedPrompts();if(all[key]!=null)backup({kind:'prompt',label:`Prompt: ${PROMPT_DEFAULTS[key].label}`,target:{key},before:all[key]});delete all[key];setPromptOverrides(all);context().saveSettingsDebounced();renderPromptEditor();status(`“${PROMPT_DEFAULTS[key].label}” is back to the default.`);}catch(e){fail(e);}};
  document.querySelector('#na-template-save').onclick=()=>{try{saveTemplate(false);}catch(e){fail(e);}};
  document.querySelector('#na-template-copy').onclick=()=>{try{saveTemplate(true);}catch(e){fail(e);}};
  document.querySelector('#na-template-delete').onclick=async()=>{try{
    const name=document.querySelector('#na-template-edit').value, list=storedTemplates();
    const i=list.findIndex(x=>{try{return parseTemplate(x).name===name}catch{return false}});
    if(i<0)throw Error('Built-in templates can’t be deleted.');
    if(!await context().Popup.show.confirm('Delete template?',`Delete the template “${name}”? Novels already started with it keep working.`))return;
    backup({kind:'template',label:`Template “${name}” (deleted)`,target:{name},before:{name,text:list[i]}});
    list.splice(i,1);context().saveSettingsDebounced();document.querySelector('#na-template-edit').value=NOVEL.name;renderTemplates(data());status(`Template “${name}” deleted.`);
  }catch(e){fail(e);}};
  document.querySelector('#na-chapter').onchange=async e=>{try{const n=Number(e.target.value);status('Moving to chapter '+n+'…');await organizeBook(n);options();status(`Now on Chapter ${n}. The main chat gets this chapter’s plan, and the writing directive says Chapter ${n}.`);}catch(err){options();fail(err,'Now on chapter');}};
  document.querySelector('#na-simple').onclick=()=>beginInterview('simple');
  document.querySelector('#na-deep').onclick=()=>beginInterview('deep');
  document.querySelector('#na-skip').onclick=()=>nextInterview(true);
  document.querySelector('#na-next').onclick=()=>nextInterview(false);
  document.querySelector('#na-outline').onclick=()=>finishInterview();
  document.querySelector('#na-send').onclick=async()=>{
    const input=document.querySelector('#na-input'), v=input.value.trim(); if(!v)return;
    try {
      const d=data(), interview=d.interview;
      if(!interview)throw Error('Choose Simple or Deep to begin.');
      if(interview?.phase==='outline')throw Error('Create the outline before continuing.');
      if(interview?.phase==='asking') {
        await interact(v,false,null,null,null,false,{guidance:answerInstruction(interview),collaborative:interview.mode==='deep',holdForAuthor:'extras'});
        if(data()!==d)throw Error('Chat changed; return to this novel.');
        d.interview=recordAnswer(d.interview,v); await persist(); input.value='';
        if(interview.mode==='simple') await nextInterview(false);
      } else {await interact(v,false,null,null,null,false,{collaborative:interview.mode==='deep',holdForAuthor:'extras'});input.value=''; await afterPlanChange(d);}
    } catch(e){fail(e)}
  };
  const c=context();
  setPromptOverrides(c.extensionSettings.storyloom?.prompts);
  c.eventSource.on(c.event_types.WORLDINFO_UPDATED,queueSync);
  c.eventSource.on(c.event_types.WORLDINFO_UPDATED,queueMemory);
  setTimeout(()=>applyMemory().catch(e=>warnLog('Storyloom memory:',e)),2500);
  showVersion();
  setTimeout(()=>checkForUpdate(true),8000);
  c.eventSource.on(c.event_types.WORLDINFO_UPDATED,name=>{if(linkRunning)return;clearTimeout(linkTimer);linkTimer=setTimeout(()=>syncLinks(typeof name==='string'?name:null),1000);});
  setTimeout(()=>{if(storedLinks().length)syncLinks();},4000);
  c.eventSource.on(c.event_types.CHAT_CHANGED,()=>{queueMemory();try{renderExtSettings();}catch{}modelController?.abort();atStart=false;settingsOpen=false;sessionKey=null;document.querySelector('#na-session-key').value='';if(!panel.hidden){try{if(noChatOpen())renderPanelView(); else {options();status('');}}catch(e){warnLog('Storyloom chat change:',e);}} queueSync(); scheduleDrain();});
  buildExtSettings(button,panel);
  addMic(document.getElementById('na-input'),document.querySelector('#na-composer .storyloom-compose-footer'),document.getElementById('na-send'));
  addMic(document.getElementById('na-assistant-input'),document.querySelector('#na-assistant .storyloom-compose-footer'),document.getElementById('na-assistant-send'));
  addMic(document.getElementById('na-proposal-feedback'),document.querySelector('#na-proposal .storyloom-row'));
  const sourceChanged=(id,deleted=false)=>{try {const d=data(); if(d.watch && (requiresReview(d.processed||[],id) || requiresReview(d.pending||[],id) || (deleted && [...(d.processed||[]),...(d.pending||[])].some(x=>x.index>=id)))) {d.review={index:id}; persist(); status('A previously processed chat message changed. Review your lore before resuming tracking.');}}catch(e){warnLog('Storyloom:',e.message)}};
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

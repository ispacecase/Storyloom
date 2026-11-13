import {NOVEL, titleField, voiceEntry, unitCountField, requiredOf} from './templates.mjs';
import {P} from './prompt-texts.mjs';
export const QUESTIONS = Object.freeze(NOVEL.questions.map(q=>Object.freeze({...q})));
const questionsOf=interview=>interview?.questions?.length ? interview.questions : QUESTIONS;
export function startInterview(mode,template=NOVEL) {
  if(!['simple','deep'].includes(mode)) throw Error('Choose Simple or Deep mode.');
  return {mode,step:0,phase:'asking',answers:{},questions:template.questions.map(q=>({...q}))};
}
export function currentQuestion(interview) {return interview?.phase==='asking' ? questionsOf(interview)[interview.step]?.text ?? null : null;}
export function questionCount(interview) {return questionsOf(interview).length;}
export function advanceInterview(interview) {
  const questions=questionsOf(interview);
  if(interview?.phase!=='asking' || !questions[interview.step]) throw Error('There is no current question.');
  const step=interview.step+1;
  return {...interview,step,phase:step>=questions.length?'outline':'asking'};
}
export function answerInstruction(interview) {
  const q=questionsOf(interview)[interview.step];if(!q)throw Error('No active interview question.');
  if(interview.mode==='simple') return `Simple mode, topic ${q.id} (“${q.text}”). Use the answer to update the plan. Treat skipped or undecided details as gaps to fill later; never change an explicit answer. Reply briefly without asking the next interview question: the app will ask it.`;
  return `Deep mode, topic ${q.id} (“${q.text}”). Collaborate with the writer on this topic; discuss possibilities, offer suggestions and ask a relevant follow-up. Treat suggestions as proposals until accepted. During this interview the extension records the writer’s exact answer, so do not claim your unaccepted proposals were added to the lorebook. If the writer states something that fits none of the planned topics or entries (a system, an object, an organisation, a history…), you may create a new entry for it containing only what the writer actually said. Stay on this topic until the writer chooses Next topic.`;
}
export function recordAnswer(interview,text) {
  const topic=questionsOf(interview)[interview?.step]; if(!topic || interview.phase!=='asking')throw Error('No active interview question.');
  const answers={...(interview.answers||{})};
  if(text===null) answers[topic.id]=null;
  else {const value=String(text).trim();if(!value)throw Error('Enter an answer or skip.'); answers[topic.id]=[...(Array.isArray(answers[topic.id])?answers[topic.id]:[]),value];}
  return {...interview,answers};
}
const quote=x=>`"${x}"`;
const lineList=fields=>fields.map(f=>f+':').join(', ');
export function requiredTitles(t=NOVEL,part='all') {
  const plan=[t.summary.title,...t.entries.map(e=>e.title),t.cast,'Current Writing Directive'];
  return part==='plan'?plan:part==='outline'?[t.outline.title]:[...plan.slice(0,-1),t.outline.title,plan.at(-1)];
}
/**
 * The final step is split so each reply fits the response budget:
 * part 'plan' = summary, planning entries, cast, directive; part 'outline' = the outline alone.
 */
export function finalizeInstruction(mode,answers={},t=NOVEL,part='all') {
  const unit=t.unit, units=unit.toLowerCase()+'s', count=unitCountField(t), voice=voiceEntry(t);
  const source=mode==='deep'?'The writer’s answers and the ideas they agreed to in the conversation':'The writer’s answers';
  const fill=`${source} are fixed facts; never contradict them. ${P('fill')}${count?` If the writer did not specify how many ${units}, use six as an AI-suggested starting point, which they can change.`:''}`;
  const titles=requiredTitles(t,part);
  const headingRule=(part,isSummary=false)=>{const req=requiredOf(part,isSummary), opt=part.fields.filter(f=>!req.includes(f));return `${req.length?`must contain nonempty lines ${lineList(req)}`:'has no required headings'}${opt.length?`; suggested headings: ${lineList(opt)} — use the ones that fit this story, leave out any that don’t apply, and add your own`:''}`;};
  const entryRules=t.entries.map(e=>`${e.title} ${headingRule(e)}.`).join(' ')+' Every entry may also have extra capitalised headings for anything specific the writer wants recorded there.';
  const keys='Keys decide when an entry is shown in the story chat, so give every entry keys that are the specific names it covers — people, places, factions, objects — never the entry’s own title or generic words.';
  const outlineRules=`${t.outline.title} must have one heading for each ${unit.toLowerCase()} in the form ${unit} 1 — Title, followed by nonempty lines ${lineList(t.outline.lines)}. ${P('outlineStyle')}${count?` If ${count.entry} specifies a numeric ${count.field.toLowerCase()} count, create exactly that many numbered ${units}.`:''} The outline must be a saved entry, not merely ${unit.toLowerCase()} titles.`;
  const planRules=`${t.summary.title} ${headingRule(t.summary,true)}. It also keeps its consistency instruction. ${entryRules} ${t.cast} is the cast list: every named character the story needs (at least three), one person per line in this format: **Name | Age: value | Pronouns: value | Relationships: value | Wants: value. Mark the focus character with **. Full character profiles are written in a later step, so keep ${t.cast} to the cast list. These are characters in a story, not chatbot personas: never include chatbot greetings, roleplay directions or {{user}}/{{char}} placeholders. Include Current Writing Directive as an update, preserving its existing chapter, scene, pacing and prose instructions.${voice?` Its POV, Tense and Tone values must exactly match ${voice.title}. If the writer did not choose POV, tense or tone, retain the current directive defaults.`:''}`;
  const ask=`Return the following ${titles.length} complete ${titles.length===1?'entry':'entries'} as entry blocks, even if ${titles.length===1?'it already exists':'they already exist'}: ${titles.map(quote).join(', ')}.`;
  const extra='If the writer asked for something specific that an entry has no heading for, add a new capitalised heading line of your own for it in that entry rather than squeezing it under another heading. These entries are a starting point, not a limit: only if the story has something important that fits none of them, invent a new entry for it with your own title and name keys; otherwise do not add entries. ';
  const tail=`${extra}${keys} Reply conversationally. Answers by topic (null means skipped): ${JSON.stringify(answers)}`;
  if(part==='plan')return `The interview is complete. ${fill} ${ask} ${planRules} The ${t.outline.title} is written in the next step; do not include it now. ${tail}`;
  if(part==='outline')return `The plan is saved in the current entries (${t.summary.title}, ${t.entries.map(e=>e.title).join(', ')}, ${t.cast}). Now write the ${t.outline.title} from it, keeping every saved fact. ${ask} ${outlineRules} Return the outline entry; if writing it reveals something the story needs that no entry covers yet, add that as a new entry too. ${tail}`;
  return `The interview is complete. ${fill} ${ask} ${planRules} ${outlineRules} ${tail}`;
}
/**
 * Second pass with no template in view: an editor's read of the saved story that adds what this story
 * needs and trims what doesn't fit. Templates prime the model to fill only their own headings; this pass doesn't show them.
 */
export const REVIEW_PROTECTED=['Current Writing Directive','Current Chapter','Storyloom Interview Notes'];
export function reviewInstruction(answers={},protectedTitles=REVIEW_PROTECTED) {
  return `${P('review')}
For every change, your reply must point to the specific part of the story that requires it; if you cannot point to one, do not make the change. Never change: ${protectedTitles.join(', ')}. Never contradict established facts or the writer's answers.
If nothing needs changing, reply with one sentence saying so and write no entry blocks. Writer's answers by topic (null means skipped): ${JSON.stringify(answers)}`;
}
function fieldValue(content,label) {
  const lines=String(content).split('\n');const expected=label.toLocaleLowerCase()+':';
  const i=lines.findIndex(x=>x.trim().toLocaleLowerCase().startsWith(expected));if(i<0)return '';
  const value=lines[i].trim().slice(expected.length).trim();if(value)return value;
  for(let j=i+1;j<lines.length;j++) {const next=lines[j].trim();if(!next)continue;if(/^[A-Za-z][A-Za-z /-]*:/.test(next) || /^All established events and character histories must remain consistent/i.test(next))return '';return next;}
  return '';
}
function labeled(content,labels,title) {
  for(const label of labels) if(!fieldValue(content,label))throw Error(`${title} is missing ${label}.`);
}
export function compatibleVoice(left,right) {
 const normalize=x=>String(x||'').toLocaleLowerCase().replace(/[-–—]/g,' ').replace(/\btense\b/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
 const a=normalize(left),b=normalize(right);return !!a && !!b && (a===b || a.startsWith(b+' ') || b.startsWith(a+' '));
}
export function validateOutline(result,mode='simple',t=NOVEL,part='all',saved=null) {
  const required=requiredTitles(t,part);
  const updates=Array.isArray(result?.updates)?result.updates:[];
  const find=title=>updates.find(x=>String(x.title).trim().toLocaleLowerCase()===title.toLocaleLowerCase());
  const missing=required.filter(title=>!String(find(title)?.content||'').trim());
  if(missing.length)throw Error(`The model did not return required outline or planning entries: ${missing.join(', ')}. Retry outline creation.`);
  if(part!=='outline') {
  const foundation=find(t.summary.title).content;
  for(const field of requiredOf(t.summary,true)){
    const value=fieldValue(foundation,field);
    if(!value || /^\(?\s*(?:untitled|undecided|tbd|to be chosen|not yet decided)(?:\s*[—-].*)?\)?$/i.test(value)) throw Error(`${t.summary.title} needs a completed ${field}.`);
  }
  for(const e of t.entries)labeled(find(e.title).content,requiredOf(e),e.title);
  const directive=find('Current Writing Directive').content;
  labeled(directive,['Chapter','Scene','POV','Tense','Tone','Pacing'],'Current Writing Directive');
  const voice=voiceEntry(t);
  if(voice)for(const field of ['POV','TENSE','TONE']) {
    const get=(text)=>fieldValue(text,field).toLocaleLowerCase();
    if(!compatibleVoice(get(find(voice.title).content),get(directive)))throw Error(`${field} must match between ${voice.title} and the writing directive.`);
  }
  const cast=t.cast, people=find(cast).content.trim();
  {
    const lines=people.split('\n').map(x=>x.trim()).filter(x=>x.includes('|'));
    if(!lines.length)throw Error(`${cast} needs character details, including age, pronouns, relationships and wants.`);
    if(lines.filter(x=>/^(?:[-*]\s*)?\*\*/.test(x)).length!==1)throw Error(`${cast} needs exactly one focus character marked with **.`);
    for(const line of lines) {
      if(!line.includes('|') || !/\bAge\s*:\s*[^|\n]+/i.test(line) || !/\bPronouns\s*:\s*[^|\n]+/i.test(line) || !/\bRelationships?\s*:\s*[^|\n]+/i.test(line) || !/\bWants?\s*:\s*[^|\n]+/i.test(line))throw Error(`Each ${cast} line needs a name, age, pronouns, relationships and wants.`);
    }
  }
  }
  if(part==='plan')return;
  const unit=t.unit, outline=find(t.outline.title).content;
  const headings=[...outline.matchAll(new RegExp(`^\\s*(?:#{1,6}\\s*)?[*_]*${unit}\\s+(\\d+)\\s*[-—–:][^\\n]+`,'gmi'))];
  if(!headings.length)throw Error(`The outline needs ${unit.toLowerCase()} headings and ${unit.toLowerCase()} details.`);
  const count=unitCountField(t);
  const scaleText=count ? (find(count.entry)?.content ?? saved?.[count.entry] ?? '') : '';
  const declared=count && fieldValue(scaleText,count.field).match(/^(\d+)\s*(?:[a-z]+)?(?:\s*\([^\n]*\))?\s*$/i);
  if(declared && Number(declared[1])!==headings.length)throw Error(`The outline has ${headings.length} ${unit.toLowerCase()}s but ${count.entry} specifies ${declared[1]}.`);
  headings.forEach((heading,i)=>{
    if(Number(heading[1])!==i+1)throw Error(`Outline ${unit.toLowerCase()}s must be numbered in order.`);
    const part=outline.slice(heading.index+heading[0].length,headings[i+1]?.index ?? outline.length);
    labeled(part,t.outline.lines,`${unit} ${i+1}`);
  });
}
export function isCollaborativeReply(reply) {
  const text=String(reply||'').trim();
  return text.length>=90 && /[?？]/u.test(text);
}
/** Record only the writer's actual words; generated proposals are explicitly labeled. */
export function deepNotesUpdate(book,interview,answer,priorReply='') {
 const title='Storyloom Interview Notes';
 const matches=Object.values(book?.entries||{}).filter(x=>String(x.comment||'').trim().toLocaleLowerCase()===title.toLocaleLowerCase());
 if(matches.length>1 || (matches.length===1 && matches[0].storyloom_kind!=='interview_notes')) throw Error('An unrelated Interview Notes entry already exists. Rename it before continuing.');
 const prior=String(matches[0]?.content||'').trim();
 const topic=questionsOf(interview)[interview?.step];if(!topic)throw Error('No active interview topic.');
 const proposal=priorReply ? `\nPrevious assistant reply (proposal or question, not confirmed): ${priorReply}` : '';
 const addition=`Topic: ${topic.id}${proposal}\nWriter: ${answer}`;
 return {title,content:prior?`${prior}\n\n${addition}`:addition,keys:[],storyloomKind:'interview_notes'};
}
export function requireSelectedBook(novel) {
 const name=typeof novel?.book==='string'?novel.book.trim():'';
 if(!name)throw Error('Choose a lorebook in Settings before starting.');
 return name;
}

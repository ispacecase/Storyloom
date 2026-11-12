import {FOUNDATION_FIELDS} from './template.mjs';
export const QUESTIONS = Object.freeze([
  {id:'idea', text:'What is the premise in two or three sentences? What pressure is driving the story, and what is wanted?'},
  {id:'scale', text:'What scale do you want: the span of the story, number of chapters, words per chapter, and target total words?'},
  {id:'voice', text:'What voice should it have: POV and tense, register, tone, and roughness policy? Is there an age the subject must never read as?'},
  {id:'people', text:'Who are the people? Give one per line: name, age, pronouns, who they are to each other, and what they want. Mark the focus character with **.'},
  {id:'place', text:'Where does it take place? Which rooms matter, and what sensory details should ground the setting?'},
  {id:'foundation', text:'What else have you decided about the title, genre, central conflict, and relationship arcs?'},
  {id:'plot', text:'What major plot milestones or ending direction do you have in mind?'}
]);
export function startInterview(mode) {
  if(!['simple','deep'].includes(mode)) throw Error('Choose Simple or Deep mode.');
  return {mode,step:0,phase:'asking',answers:{}};
}
export function currentQuestion(interview) {return interview?.phase==='asking' ? QUESTIONS[interview.step]?.text ?? null : null;}
export function advanceInterview(interview) {
  if(interview?.phase!=='asking' || !QUESTIONS[interview.step]) throw Error('There is no current question.');
  const step=interview.step+1;
  return {...interview,step,phase:step>=QUESTIONS.length?'outline':'asking'};
}
export function answerInstruction(interview) {
  const q=QUESTIONS[interview.step];if(!q)throw Error('No active interview question.');
  if(interview.mode==='simple') return `Simple mode, topic ${q.id}. Use the answer to update the novel. Treat skipped or undecided details as gaps to fill later; never change an explicit answer. Reply briefly without asking the next interview question: the app will ask it.`;
  return `Deep mode, topic ${q.id}. Collaborate with the writer on this topic; discuss possibilities, offer suggestions and ask a relevant follow-up. Treat suggestions as proposals until accepted. During this interview the extension records the writer’s exact answer, so do not claim your unaccepted proposals were added to the lorebook. Stay on this topic until the writer chooses Next topic.`;
}
export function recordAnswer(interview,text) {
  const topic=QUESTIONS[interview?.step]; if(!topic || interview.phase!=='asking')throw Error('No active interview question.');
  const answers={...(interview.answers||{})};
  if(text===null) answers[topic.id]=null;
  else {const value=String(text).trim();if(!value)throw Error('Enter an answer or skip.'); answers[topic.id]=[...(Array.isArray(answers[topic.id])?answers[topic.id]:[]),value];}
  return {...interview,answers};
}
export function finalizeInstruction(mode,answers={}) {
  const fill=mode==='simple'?'Fill in every skipped or undecided detail, including the novel title, with your own coherent choices; identify those choices as AI-suggested so the writer can revise them. Do not leave placeholders such as untitled or to be chosen. If the writer did not specify a chapter count, use six chapters as an AI-suggested starting point, which they can change.':'Treat only the writer’s statements as established facts. Mark every new invented detail within the entry itself as AI-suggested or leave it undecided, including character names, ages, motivations, backstories, plot events, and changes in relationships. Do not present any suggestion as an established fact.';
  return `The interview is complete. ${fill} Return the following seven complete entries in updates, even if they already exist: \"Novel Foundation\", \"Story Scale\", \"Voice and Boundaries\", \"People\", \"Place and Sensory Details\", \"Novel Outline\", and \"Current Writing Directive\". Keep the Novel Foundation's required headings and consistency instruction. Story Scale must contain nonempty lines SPAN:, CHAPTERS:, WORDS PER CHAPTER:, TARGET WORDS:. Voice and Boundaries must contain nonempty lines POV:, TENSE:, REGISTER:, TONE:, ROUGHNESS POLICY:, AGE THE SUBJECT MUST NEVER READ AS:. People are novel characters, not chatbot personas: capture their histories, motivations, relationships and roles in the story; never include chatbot greetings, roleplay directions or {{user}}/{{char}} placeholders. People must have one person per line in this format: **Name | Age: value | Pronouns: value | Relationships: value | Wants: value. Mark the focus character with **. If Deep mode has no people established, People may be exactly Undecided; do not invent decisions. Place and Sensory Details must contain nonempty lines LOCATION:, IMPORTANT ROOMS:, SENSORY DETAILS:. Novel Outline must have one heading for each chapter in the form Chapter 1 — Title, followed by nonempty lines Events:, Characters and relationships:, and Consequences and threads:. Explain what actually happens, how characters and relationships change, and what results or remains unresolved. Keep each of these three lines to one or two substantive sentences so the entire plan fits in one response. If Story Scale specifies a numeric chapter count, create exactly that many numbered chapters. Include Current Writing Directive as an update, preserving its existing chapter, scene, pacing and prose instructions. Its POV, Tense and Tone values must exactly match Voice and Boundaries. If the writer did not choose POV, tense or tone, retain the current directive defaults. The outline must be a saved entry, not merely chapter titles. Reply conversationally. Answers by topic (null means skipped): ${JSON.stringify(answers)}`;
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
export function validateOutline(result,mode='simple') {
  const required=['Novel Foundation','Story Scale','Voice and Boundaries','People','Place and Sensory Details','Novel Outline','Current Writing Directive'];
  const updates=Array.isArray(result?.updates)?result.updates:[];
  const find=title=>updates.find(x=>String(x.title).trim().toLocaleLowerCase()===title.toLocaleLowerCase());
  const missing=required.filter(title=>!String(find(title)?.content||'').trim());
  if(missing.length)throw Error(`The model did not return required outline or planning entries: ${missing.join(', ')}. Retry outline creation.`);
  const foundation=find('Novel Foundation').content;
  if(mode==='simple')for(const field of FOUNDATION_FIELDS){
    const value=fieldValue(foundation,field);
    if(!value || /^\(?\s*(?:untitled|undecided|tbd|to be chosen|not yet decided)(?:\s*[—-].*)?\)?$/i.test(value)) throw Error(`Novel Foundation needs a completed ${field} in Simple mode.`);
  }
  const scale=find('Story Scale').content, voice=find('Voice and Boundaries').content, place=find('Place and Sensory Details').content;
  labeled(scale,['SPAN','CHAPTERS','WORDS PER CHAPTER','TARGET WORDS'],'Story Scale');
  labeled(voice,['POV','TENSE','REGISTER','TONE','ROUGHNESS POLICY','AGE THE SUBJECT MUST NEVER READ AS'],'Voice and Boundaries');
  labeled(place,['LOCATION','IMPORTANT ROOMS','SENSORY DETAILS'],'Place and Sensory Details');
  const directive=find('Current Writing Directive').content;
  labeled(directive,['Chapter','Scene','POV','Tense','Tone','Pacing'],'Current Writing Directive');
  for(const field of ['POV','TENSE','TONE']) {
    const get=(text)=>fieldValue(text,field).toLocaleLowerCase();
    if(!compatibleVoice(get(voice),get(directive)))throw Error(`${field} must match between Voice and the writing directive.`);
  }
  const people=find('People').content.trim();
  if(!(mode==='deep' && /^undecided[.!]?$/i.test(people))) {
    const lines=people.split('\n').map(x=>x.trim()).filter(x=>x.includes('|'));
    if(!lines.length)throw Error('People needs character details, including age, pronouns, relationships and wants.');
    if(lines.filter(x=>/^(?:[-*]\s*)?\*\*/.test(x)).length!==1)throw Error('People needs exactly one focus character marked with **.');
    for(const line of lines) {
      if(!line.includes('|') || !/\bAge\s*:\s*[^|\n]+/i.test(line) || !/\bPronouns\s*:\s*[^|\n]+/i.test(line) || !/\bRelationships?\s*:\s*[^|\n]+/i.test(line) || !/\bWants?\s*:\s*[^|\n]+/i.test(line))throw Error('Each People line needs a name, age, pronouns, relationships and wants.');
    }
  }
  const outline=find('Novel Outline').content;
  const headings=[...outline.matchAll(/^\s*Chapter\s+(\d+)\s*[-—:][^\n]+/gmi)];
  if(!headings.length)throw Error('The outline needs chapter headings and chapter details.');
  const declared=fieldValue(scale,'CHAPTERS').match(/^(\d+)\s*(?:chapters?)?(?:\s*\([^\n]*\))?\s*$/i);
  if(declared && Number(declared[1])!==headings.length)throw Error(`The outline has ${headings.length} chapters but Story Scale specifies ${declared[1]}.`);
  headings.forEach((heading,i)=>{
    if(Number(heading[1])!==i+1)throw Error('Outline chapters must be numbered in order.');
    const part=outline.slice(heading.index+heading[0].length,headings[i+1]?.index ?? outline.length);
    labeled(part,['Events','Characters and relationships','Consequences and threads'],`Chapter ${i+1}`);
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
 const topic=QUESTIONS[interview?.step];if(!topic)throw Error('No active interview topic.');
 const proposal=priorReply ? `\nPrevious assistant reply (proposal or question, not confirmed): ${priorReply}` : '';
 const addition=`Topic: ${topic.id}${proposal}\nWriter: ${answer}`;
 return {title,content:prior?`${prior}\n\n${addition}`:addition,keys:[],storyloomKind:'interview_notes'};
}
export function requireSelectedBook(novel) {
 const name=typeof novel?.book==='string'?novel.book.trim():'';
 if(!name)throw Error('Choose a lorebook in Settings before starting.');
 return name;
}

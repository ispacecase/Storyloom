import {foundationTemplate,FOUNDATION_FIELDS} from '../template.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {startInterview,currentQuestion,advanceInterview,finalizeInstruction,answerInstruction,validateOutline} from '../interview.mjs';

test('both modes begin with the idea and use an ordered set of questions',()=>{
 for(const mode of ['simple','deep']){let x=startInterview(mode); assert.match(currentQuestion(x),/premise/i);let all=[];while(x.phase==='asking'){all.push(currentQuestion(x));x=advanceInterview(x)}assert.ok(all.length>=6);const text=all.join(' ');for(const word of ['chapters','words','POV','tense','pronouns','sensory','ending'])assert.match(text,new RegExp(word,'i'));assert.equal(x.phase,'outline');}
});
test('simple allows skipped answers and deep retains collaborative guidance',()=>{
 assert.match(answerInstruction(startInterview('simple')),/fill.*gaps|undecided/i);
 assert.match(answerInstruction(startInterview('deep')),/collaborat/i);
 assert.match(finalizeInstruction('simple'),/outline/i);assert.match(finalizeInstruction('deep'),/outline/i);
});
test('finalization cannot complete without an actual outline entry',()=>{
 assert.throws(()=>validateOutline({updates:[{title:'Novel Foundation',content:'x'}]}),/outline/i);
 assert.throws(()=>validateOutline({updates:['Novel Foundation','Story Scale','Voice and Boundaries','People','Place and Sensory Details','Novel Outline'].map(title=>({title,content:'A complete entry.'}))}),/missing|did not return/i);
 assert.throws(()=>validateOutline({updates:[{title:'Novel Outline',content:'Chapter 1'}]}),/foundation|missing/i);
});

test('answers and skipped topics remain available for the final outline', async()=>{
 const {recordAnswer}=await import('../interview.mjs');let x=startInterview('simple');x=recordAnswer(x,'A woman inherits an island house.');x=advanceInterview(x);x=recordAnswer(x,null);assert.equal(x.answers.idea[0],'A woman inherits an island house.');assert.equal(x.answers.scale,null);assert.match(finalizeInstruction('simple',x.answers),/island house/);
});

test('Deep mode rejects empty acknowledgements instead of treating them as collaboration',async()=>{
 const {isCollaborativeReply}=await import('../interview.mjs');
 assert.equal(isCollaborativeReply('Got it.'),false);
 assert.equal(isCollaborativeReply('That premise gives the archivist a personal reason to investigate. Would you rather the letter lead her toward a family secret, or toward someone she has never met?'),true);
});

test('a real outline and complete people details are required, not labels alone',async()=>{
 const {validateOutline}=await import('../interview.mjs');
 const base=['Novel Foundation','Story Scale','Voice and Boundaries','People','Place and Sensory Details','Novel Outline'].map(title=>({title,content:'placeholder'}));
 assert.throws(()=>validateOutline({updates:base}),/scale|people|outline|voice|place/i);
});
test('accepts a substantive structured planning result',async()=>{
 const updates=[
  {title:'Novel Foundation',content:FOUNDATION_FIELDS.map(x=>x+': A story detail').join('\n')},
  {title:'Story Scale',content:'SPAN: One month\nCHAPTERS: 2\nWORDS PER CHAPTER: 2000\nTARGET WORDS: 4000'},
  {title:'Voice and Boundaries',content:'POV: Third-person limited\nTENSE: Past\nREGISTER: Literary\nTONE: Atmospheric\nROUGHNESS POLICY: Restrained\nAGE THE SUBJECT MUST NEVER READ AS: A child'},
  {title:'People',content:'**Mara | Age: 32 | Pronouns: she/her | Relationships: niece of Iris | Wants: find Iris\nIris | Age: 60 | Pronouns: she/her | Relationships: aunt of Mara | Wants: protect her secret'},
  {title:'Place and Sensory Details',content:'LOCATION: An island\nIMPORTANT ROOMS: The study\nSENSORY DETAILS: Damp wood and salt air'},
  {title:'Current Writing Directive',content:'Chapter: 1\nScene: 1\nPOV: Third-person limited\nTense: Past\nTone: Atmospheric\nPacing: Slow'},
  {title:'Novel Outline',content:'Chapter 1 — Arrival\nEvents: Mara reaches the island and finds a letter.\nCharacters and relationships: Mara questions her memory of her aunt.\nConsequences and threads: The letter points to the locked study.\n\nChapter 2 — Discovery\nEvents: Mara enters the study and finds the hidden record.\nCharacters and relationships: Mara understands Iris made a sacrifice.\nConsequences and threads: The revelation resolves the disappearance.'}
 ];assert.doesNotThrow(()=>validateOutline({updates}));
});

test('final voice and writing directive must agree',async()=>{
 const {validateOutline}=await import('../interview.mjs');
 const updates=[{title:'Novel Foundation',content:FOUNDATION_FIELDS.map(x=>x+': A story detail').join('\n')},
 {title:'Story Scale',content:'SPAN: One month\nCHAPTERS: 1\nWORDS PER CHAPTER: 2000\nTARGET WORDS: 2000'},
 {title:'Voice and Boundaries',content:'POV: Third-person limited\nTENSE: Past\nREGISTER: Literary\nTONE: Atmospheric\nROUGHNESS POLICY: Restrained\nAGE THE SUBJECT MUST NEVER READ AS: A child'},
 {title:'People',content:'**Mara | Age: 32 | Pronouns: she/her | Relationships: niece of Iris | Wants: find Iris'},
 {title:'Place and Sensory Details',content:'LOCATION: An island\nIMPORTANT ROOMS: The study\nSENSORY DETAILS: Salt air'},
 {title:'Novel Outline',content:'Chapter 1 — Arrival\nEvents: Mara reaches the island.\nCharacters and relationships: Mara questions her aunt.\nConsequences and threads: The letter points to the study.'},
 {title:'Current Writing Directive',content:'Chapter: 1\nScene: 1\nPOV: First person\nTense: Past\nTone: Atmospheric\nPacing: Slow'}];
 assert.throws(()=>validateOutline({updates}),/POV|match/i);
 updates.at(-1).content=updates.at(-1).content.replace('First person','Third-person limited');assert.doesNotThrow(()=>validateOutline({updates}));
});

test('accepts real-model formatting with values below headings and the consistency footer',async()=>{
 const updates=[
 {title:'Novel Foundation',content:FOUNDATION_FIELDS.map(x=>x+': A story detail').join('\n')},
 {title:'Story Scale',content:'SPAN:\nOne month\n\nCHAPTERS:\n1\n\nWORDS PER CHAPTER:\n2000\n\nTARGET WORDS:\n2000'},
 {title:'Voice and Boundaries',content:'POV:\nThird-person limited\n\nTENSE:\nPast\n\nREGISTER:\nLiterary\n\nTONE:\nAtmospheric\n\nROUGHNESS POLICY:\nRestrained\n\nAGE THE SUBJECT MUST NEVER READ AS:\nA child'},
 {title:'People',content:'PEOPLE (AI-suggested; open to revision)\n\n**Mara | Age: 32 | Pronouns: she/her | Relationships: niece of Iris | Wants: find Iris\n\nAll established events and character histories must remain consistent unless explicitly revised.'},
 {title:'Place and Sensory Details',content:'LOCATION:\nAn island\n\nIMPORTANT ROOMS:\nStudy\n\nSENSORY DETAILS:\nSalt air'},
 {title:'Novel Outline',content:'Chapter 1 — Arrival\nEvents: Mara reaches the island.\nCharacters and relationships: Mara questions her aunt.\nConsequences and threads: The letter points to the study.'},
 {title:'Current Writing Directive',content:'Chapter: 1\nScene: 1\nPOV: Third-person limited\nTense: Past\nTone: Atmospheric\nPacing: Slow'}];
 assert.doesNotThrow(()=>validateOutline({updates}));
});

test('Simple mode cannot finish with an unfilled foundation',async()=>{
 const f=foundationTemplate();const updates=[{title:'Novel Foundation',content:f},...['Story Scale','Voice and Boundaries','People','Place and Sensory Details','Novel Outline','Current Writing Directive'].map(title=>({title,content:'placeholder'}))];
 assert.throws(()=>validateOutline({updates},'simple'),/foundation|title/i);
});

test('equivalent POV descriptions are not rejected as contradictions',async()=>{
 const {compatibleVoice}=await import('../interview.mjs');
 assert.equal(compatibleVoice('Third-person limited, close on Mara','Third-person limited'),true);
 assert.equal(compatibleVoice('First-person','Third-person limited'),false);
 assert.equal(compatibleVoice('Past tense','Past'),true);
});

test('Deep interview notes preserve the writer answer without adopting AI proposals',async()=>{
 const {deepNotesUpdate}=await import('../interview.mjs');const x=startInterview('deep');
 const update=deepNotesUpdate({entries:{}},x,'The island has a village.','Perhaps the aunt is secretly the mayor.');
 assert.match(update.content,/Writer: The island has a village\./);assert.match(update.content,/proposal.*not confirmed/i);assert.match(update.content,/Perhaps the aunt/);
 assert.throws(()=>deepNotesUpdate({entries:{1:{uid:1,comment:'Storyloom Interview Notes',content:'personal'}}},x,'answer',''),/already exists/i);
});

test('starting an interview requires a lorebook explicitly selected in Storyloom',async()=>{
 const {requireSelectedBook}=await import('../interview.mjs');
 assert.throws(()=>requireSelectedBook({book:''}),/choose.*lorebook/i);
 assert.throws(()=>requireSelectedBook({}),/choose.*lorebook/i);
 assert.equal(requireSelectedBook({book:'My Novel'}),'My Novel');
});

test('the final step can be split into a plan request and an outline request', async () => {
  const {finalizeInstruction, requiredTitles} = await import('../interview.mjs');
  const plan = finalizeInstruction('simple', {}, undefined, 'plan');
  assert.doesNotMatch(plan, /"Novel Outline"/);
  assert.match(plan, /written in the next step/);
  const outline = finalizeInstruction('simple', {}, undefined, 'outline');
  assert.match(outline, /Return the following 1 complete entry/);
  assert.match(outline, /"Novel Outline"/);
  assert.deepEqual(requiredTitles(undefined, 'outline'), ['Novel Outline']);
  assert.ok(!requiredTitles(undefined, 'plan').includes('Novel Outline'));
});

test('every final step invites new entries for things no planned entry covers', async () => {
  const {finalizeInstruction, answerInstruction, startInterview} = await import('../interview.mjs');
  for (const part of ['all', 'plan', 'outline']) assert.match(finalizeInstruction('simple', {}, undefined, part), /invent a new entry for it/);
  assert.match(finalizeInstruction('deep', {}, undefined, 'outline'), /add that as a new entry too/);
  assert.match(answerInstruction(startInterview('deep')), /create a new entry for it containing only what the writer actually said/);
});

test('the review pass shows no template and makes "no change" the default', async () => {
  const {reviewInstruction} = await import('../interview.mjs');
  const text = reviewInstruction({idea: ['x']}, ['Current Writing Directive', 'Novel Outline']);
  assert.match(text, /Your job is to judge, not to add/);
  assert.match(text, /right answer is to change nothing/);
  assert.match(text, /if you cannot point to one, do not make the change/);
  assert.match(text, /Never change: Current Writing Directive, Novel Outline/);
  assert.doesNotMatch(text, /NOVEL TITLE|GENRE|REGISTER|Story Scale/, 'no template headings are shown');
});

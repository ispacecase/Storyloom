import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWritingPrompt, validateScene } from '../writing.mjs';
test('writing prompt includes directive, relevant lore and last scene', () => {
  const prompt=makeWritingPrompt({directive:'Past tense',lore:[{title:'Mara',content:'Lives at the estate'}],previous:'The door opened.',request:'Continue chapter 1'});
  assert.match(prompt,/Past tense/); assert.match(prompt,/Mara/); assert.match(prompt,/The door opened/); assert.match(prompt,/Continue chapter 1/);
});
test('empty generated prose is not saved', () => {assert.throws(()=>validateScene('  '),/empty/i); assert.equal(validateScene(' A scene. '),'A scene.');});

test('writing sessions stay bounded', async () => {
  const { sceneCount } = await import('../writing.mjs');
  assert.equal(sceneCount('3'),3); assert.throws(()=>sceneCount('0')); assert.throws(()=>sceneCount('11')); assert.throws(()=>sceneCount('1.5'));
});

test('writing includes the current main scene and linked reference',()=>{
 const p=makeWritingPrompt({directive:'Past',lore:[],previous:'Earlier draft',request:'Continue',mainChat:'Mara opens the gate',reference:'The estate belongs to her aunt'});
 assert.match(p,/Mara opens the gate/);assert.match(p,/estate belongs to her aunt/);
});

test('chapter writing requests a closing segment near its target and remains bounded',async()=>{
 const {chapterStep,wordCount}=await import('../writing.mjs');
 assert.equal(wordCount('One two\nthree'),3);assert.equal(chapterStep(0,3000,0).final,false);
 assert.equal(chapterStep(2000,3000,2).final,true);assert.equal(chapterStep(1,3000,9).final,true);
 assert.throws(()=>chapterStep(0,3000,10));assert.throws(()=>chapterStep(0,20,0));
});

test('chapter writing includes the exact matching chapter outline',async()=>{
 const {currentChapterOutline}=await import('../writing.mjs');
 const book={entries:{1:{comment:'Novel Foundation',content:'x'.repeat(30000)},2:{comment:'Novel Outline',content:'Chapter 1 — Begin\nEvents: Arrive.\nCharacters and relationships: Meet.\nConsequences and threads: A clue.\nChapter 2 — Find\nEvents: Search.\nCharacters and relationships: Disagree.\nConsequences and threads: Lose access.'}}};
 const outline=currentChapterOutline(book,'Chapter: 2\nScene: 1');assert.match(outline,/Chapter 2 — Find/);assert.doesNotMatch(outline,/Chapter 1/);
 assert.throws(()=>currentChapterOutline(book,'Chapter: 3'),/does not contain/);
 assert.throws(()=>currentChapterOutline({entries:{}},'Chapter: 1'),/Novel Outline/);
});

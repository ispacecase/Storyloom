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

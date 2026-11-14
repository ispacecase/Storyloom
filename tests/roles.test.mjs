import test from 'node:test';
import assert from 'node:assert/strict';
import {roleSettings, roleSystem, activeSteps, numberedParts, parseNotes, overallLine, markupInstruction, readerInstruction, reviseInstruction, parseRevision, wordDiff, narratorInstruction, parseNarrator, suggestNarrators, ROLES} from '../roles.mjs';

test('role settings default on, keep the default personality until edited', () => {
  const s = roleSettings({reader: {enabled: false}, editor: {persona: 'Be brutal.', profile: 'p1'}});
  assert.equal(s.reader.enabled, false);
  assert.equal(s.checker.persona, ROLES.checker.persona);
  assert.equal(s.editor.persona, 'Be brutal.');
  assert.equal(s.editor.profile, 'p1');
  assert.deepEqual(activeSteps(s).map(x => x.key), ['lint', 'markup', 'revise', 'seal']);
  assert.match(roleSystem('checker', s, 'Danny, first person'), /FOR THIS CHAPTER ONLY[\s\S]*Danny/);
});

test('parts are numbered continuously with part headers', () => {
  assert.equal(numberedParts(['A.\n\nB.', 'C.']), '--- PART 1 ---\n1| A.\n2| B.\n--- PART 2 ---\n3| C.');
});

test('notes are read back strictly', () => {
  const n = parseNotes('Intro\n- [must] line 3: "Arthur died" — move this to Chapter 4\n- [suggest] line 5: “said brightly” — Ruth is flat, not bright\n- line 9 no quote\nOVERALL: solid', 'editor');
  assert.deepEqual(n.map(x => [x.weight, x.where, x.quote]), [['must', 'line 3', 'Arthur died'], ['suggest', 'line 5', 'said brightly']]);
  assert.equal(overallLine('x\nOVERALL: solid'), 'solid');
});

test('the reader is not shown the plan; the editor gets the approved findings', () => {
  const r = readerInstruction({number: 2, parts: ['Text.'], storySoFar: 'SO FAR'});
  assert.doesNotMatch(r, /OUTLINE|BOOK'S FACTS/);
  assert.match(r, /SO FAR/);
  const m = markupInstruction({parts: ['Text.'], facts: 'F', findings: [{where: 'line 1', kind: 'VOICE', quote: 'Text', rule: 'off voice'}]});
  assert.match(m, /approved these findings[\s\S]*off voice/);
});

test('a revision is accepted only when every part comes back', () => {
  const ask = reviseInstruction({parts: ['a', 'b'], notes: [{where: 'line 1', quote: 'a', note: 'fix'}]});
  assert.match(ask, /There are 2 parts/);
  assert.deepEqual(parseRevision('=== PART 1\nNew a\n=== PART 2\n2| New b\n=== END', 2), ['New a', 'New b']);
  assert.equal(parseRevision('=== PART 1\nNew a\n=== END', 2), null);
});

test('word diff marks what changed', () => {
  const d = wordDiff('Ruth said brightly.', 'Ruth said flatly.');
  assert.deepEqual(d.filter(x => x.op !== 'same').map(x => [x.op, x.text]), [['del', 'brightly.'], ['add', 'flatly.']]);
});

test('narrator instructions and chapter notes are read back', () => {
  assert.match(narratorInstruction({number: 5, wish: 'Danny, first person'}), /add your own where this story needs it[\s\S]*REGISTER AND VOICE/);
  const p = parseNarrator('=== NARRATOR\nWHO NARRATES: Danny\nPOV: first\n=== NOTES\nCHECKER NOTE: first person is intended\nEDITOR NOTE: none\n=== END');
  assert.equal(p.instructions, 'WHO NARRATES: Danny\nPOV: first');
  assert.equal(p.checkerNote, 'first person is intended');
  assert.equal(p.editorNote, '');
});

test('an earlier narrator is suggested when the chapter follows them again', () => {
  const reg = [{avatar: 'a.png', name: 'Book — Ruth', who: 'Ruth Aldiss, close third'}, {avatar: 'b.png', name: 'Book — Danny', who: 'Danny, first person'}];
  assert.deepEqual(suggestNarrators(reg, {chapterPlan: 'Ruth returns to the lifeboat station.', current: 'b.png'}).map(n => n.avatar), ['a.png']);
  assert.deepEqual(suggestNarrators(reg, {wish: 'someone new: Priya'}), []);
});

test('notes are read whether or not the model brackets the weight', () => {
  assert.deepEqual(parseNotes('- must line 3: "Arthur died" — move it\n- suggest: line 4 "Marge" — cut her', 'editor').map(x => [x.weight, x.where]), [['must', 'line 3'], ['suggest', 'line 4']]);
});

test('a rewritten phrase shows as one removal and one addition', () => {
  const d = wordDiff('Her father was asleep in the chair by the window.', 'Her father was awake in the hospital bed by the window.');
  assert.deepEqual(d.filter(x => x.op !== 'same').map(x => [x.op, x.text.trim()]), [['del', 'asleep in the chair'], ['add', 'awake in the hospital bed']]);
});

test('narrator draft includes a main prompt; the template is editable text', async () => {
  const {parseNarrator, narratorTemplateText, parseNarratorTemplate, NARRATOR_TEMPLATE, narratorInstruction} = await import('../roles.mjs');
  const p = parseNarrator('=== NARRATOR\nWHO NARRATES: Ruth\n=== MAIN PROMPT\nYou narrate A Small Weather.\n=== NOTES\nCHECKER NOTE: none\nEDITOR NOTE: none\n=== END');
  assert.equal(p.mainPrompt, 'You narrate A Small Weather.');
  assert.equal(p.instructions, 'WHO NARRATES: Ruth');
  assert.deepEqual(parseNarratorTemplate(narratorTemplateText()), NARRATOR_TEMPLATE.map(x => [...x]));
  const custom = parseNarratorTemplate('WHO NARRATES: who\nSMELLS: what they notice by smell\nnot a heading');
  assert.deepEqual(custom.map(x => x[0]), ['WHO NARRATES', 'SMELLS']);
  assert.match(narratorInstruction({template: custom}), /- SMELLS: what they notice by smell/);
  assert.deepEqual(parseNarratorTemplate(''), NARRATOR_TEMPLATE);
});

test('the narrator draft comes back in five parts, each for its place', () => {
  const ask = narratorInstruction({number: 2, wish: 'Danny, first person'});
  for (const part of ['=== DESCRIPTION', '=== MAIN PROMPT', '=== CHARACTER NOTE', '=== POST-HISTORY', 'SAMPLE OF THE VOICE']) assert.ok(ask.includes(part), part);
  assert.match(ask, /This is a novel: the narrator writes every character/);
  assert.match(narratorInstruction({roleplay: true}), /never writes that character/);
  const p = parseNarrator('=== DESCRIPTION\nWHO NARRATES: Danny\n=== MAIN PROMPT\nYou narrate.\n=== CHARACTER NOTE\nFirst person, past.\n=== POST-HISTORY\nStop at a beat.\n=== NOTES\nCHECKER NOTE: none\nEDITOR NOTE: keep it rough\n=== END');
  assert.deepEqual([p.instructions, p.mainPrompt, p.charNote, p.postHistory, p.checkerNote, p.editorNote], ['WHO NARRATES: Danny', 'You narrate.', 'First person, past.', 'Stop at a beat.', '', 'keep it rough']);
});

test('missing planned events reach the Editor as “still to write”, not as notes to fix', () => {
  const m = markupInstruction({parts: ['x'], findings: [{kind: 'PLAN', quote: 'Tom arrives', rule: 'planned'}, {kind: 'VOICE', where: 'line 1', quote: 'x', rule: 'off'}]});
  assert.match(m, /Still to write[^\n]*"Tom arrives"/);
  assert.doesNotMatch(m, /- line 1 PLAN/);
  assert.match(m, /VOICE: "x"/);
});

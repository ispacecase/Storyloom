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
  assert.match(ask, /=== EDIT 1\nNOTE:/);
  assert.match(ask, /smallest change that fixes each note/);
  assert.match(ask, /Never add a new event, person or fact/);
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

test('a revision that was cut off, shortened or never finished is refused', () => {
  const orig = ['She went to the door.', 'He said, "There is ice cream in the freezer, if she asks. Not before tea." Then he left the room quietly.'];
  assert.deepEqual(parseRevision('=== PART 1\nUNCHANGED\n=== PART 2\nHe said, "There is ice cream in the freezer, if she asks. Not before tea." Then he left quietly.\n=== END', orig),
    [orig[0], 'He said, "There is ice cream in the freezer, if she asks. Not before tea." Then he left quietly.']);
  assert.equal(parseRevision('=== PART 1\nUNCHANGED\n=== PART 2\nHe said, "There is ice cream in the freezer, if she asks. Not before tea', orig), null, 'cut off mid-quote, no END');
  assert.equal(parseRevision('=== PART 1\nUNCHANGED\n=== PART 2\nHe said, "There is ice cream."\n=== END', orig), null, 'much shorter');
  assert.equal(parseRevision('=== PART 1\nUNCHANGED\n=== PART 2\nHe said, "There is ice cream in the freezer, if she asks." Then he went out.', orig), null, 'no END and the last part is short');
  assert.equal(parseRevision('=== PART 1\nUNCHANGED\n=== END', 1), null, 'UNCHANGED needs the originals');
});

test('Revise edits exact passages; an edit that isn\'t found exactly once is left out and reported', async () => {
  const {parseEdits, applyEdits} = await import('../roles.mjs');
  const parts = ['Dev came on at half six with his coat still on.', '“It’s on the chart,” Dev said. It was. It was.'];
  const raw = '=== EDIT 1\nNOTE: line 1\nFIND: Dev came on at half six with his coat still on.\nREPLACE: Dev came back from the drug fridge at half six.\n=== EDIT 2\nNOTE: line 2\nFIND: "It\'s on the chart," Dev said.\nREPLACE: “Then it\'s on the chart,” Dev said.\n=== EDIT 3\nFIND: It was.\nREPLACE: It is.\n=== EDIT 4\nFIND: not in the text\nREPLACE: x\n=== END\nSKIPPED: none';
  const p = parseEdits(raw);
  assert.equal(p.edits.length, 4);
  assert.equal(p.skipped, 'none');
  const r = applyEdits(parts, p.edits);
  assert.equal(r.parts[0], 'Dev came back from the drug fridge at half six.');
  assert.match(r.parts[1], /^“Then it's on the chart,” Dev said\. It was\. It was\.$/, 'curly/straight quotes still match');
  assert.deepEqual(r.missed.map(m => m.why), ['found 2 times', 'not found in the chapter']);
  assert.equal(parseEdits('just some text'), null);
  assert.deepEqual(parseEdits('=== END\nSKIPPED: all — nothing needed').edits, []);
});

test('Revise never doubles or drops quotation marks', async () => {
  const {applyEdits} = await import('../roles.mjs');
  const parts = ['“It is the coin thing.” He put the sheets away.\n\n“The ring.” Good, she thought. Straight in. “Will she want it?”'];
  const r = applyEdits(parts, [
    {find: 'It is the coin thing.” He put the sheets away.', replace: '“It is the coin thing.” He put the sheets in the cupboard.'},
    {find: 'The ring.” Good, she thought. Straight in. “Will', replace: 'The ring. “Will'},
  ]);
  assert.equal(r.parts[0].split('\n\n')[0], '“It is the coin thing.” He put the sheets in the cupboard.');
  assert.deepEqual(r.missed.map(m => m.why), ['would break the quotation marks']);
});

test('Editor notes that ask for no change are left out', async () => {
  const {notesAskingForChange} = await import('../roles.mjs');
  const n = [
    {note: 'Kenmore is a brand, not a person, so it needs no cast slot; confirm it’s the stove’s make and leave it.'},
    {note: 'Cabin is the pattern word, not a place; no change needed beyond the pattern note above.'},
    {note: 'Keys reads as an object, not a person; fine as is, but the line is doing two jobs and could be split.'},
    {note: 'Echoes line 17. Give him something new: the pair count, a condition note, or a dodge.'},
    {note: 'The “not X but Y” construction; line 72 already made the point. Keep one, trim the other.'},
    {note: 'Log Cabin is a quilt pattern, not a person; keep, but say “a Log Cabin pattern” so it doesn’t read as a place.'},
  ];
  assert.deepEqual(notesAskingForChange(n).map(x => x.note.slice(0, 6)), ['Echoes', 'The “n', 'Log Ca']);
});

test('Reader praise without the Worked: label is still kept away from Revise', async () => {
  const {isPraise} = await import('../roles.mjs');
  const yes = ['nice, I know exactly what kind of driver this is', 'quiet and effective, I felt the dead man without being told', 'best moment in the chapter, and it arrives with no setup', 'flat and funny, and it lands because he\'s right', 'Worked: the porch'];
  const no = ['good detail, but I had to reread to be sure', 'nice, but the narrator explains the symbolism a touch more than needed', 'I tripped here; the door is being shoved from inside', 'strong close, though the window knocking felt like a second ending'];
  assert.ok(yes.every(isPraise)); assert.ok(no.every(n => !isPraise(n)));
});

test('a doubled REPLACE label never reaches the chapter; a repeated FIND is placed by its note\'s line', async () => {
  const {parseEdits, applyEdits} = await import('../roles.mjs');
  const r = parseEdits('=== EDIT 1\nNOTE: line 3 — boots\nFIND: Clem takes his boots off, in the middle of it.\nREPLACE: Clem takes his boots off, in the middle of it.\nREPLACE: Clem takes his boots off where he stands.\n=== END\nSKIPPED: none');
  assert.equal(r.edits[0].replace, 'Clem takes his boots off where he stands.');
  const parts = ['Chapter 1', '“Sunday night.”\n\n“So I’m writing it. Sunday night.”\n\n“Sunday night.”\n\nClem takes his boots off, in the middle of it.'];
  const e = parseEdits('=== EDIT 1\nNOTE: line 4 — echo of line 3\nFIND: Sunday night.\nREPLACE: Then I’ll need the drawers done by noon.\n=== END');
  const out = applyEdits(parts, e.edits);
  assert.equal(out.applied.length, 1);
  assert.match(out.parts[1], /“Sunday night\.”\n\n“So I’m writing it\. Sunday night\.”\n\n“Then I’ll need the drawers done by noon\.”/);
});

test('the Editor marks tense slips, repeated gestures and and-chains from the check as must', () => {
  const m = markupInstruction({parts: ['x'], findings: [{kind: 'GESTURE', where: 'lines 4, 9', quote: 'dries her hands', rule: 'The same bit of business 2 times.'}]});
  assert.match(m, /a tense slip, a line copied from a profile, a gesture repeated from earlier in the chapter or a sentence chained with "and… and…"/);
  assert.match(m, /one note for each repeat after the first/);
  assert.match(m, /GESTURE: "dries her hands"/);
});

test('an edit that cuts most of a passage without being asked to is left out', async () => {
  const {applyEdits} = await import('../roles.mjs');
  const part = '“It gets in everywhere.”\n\n“It gets in the cars, too.” Denise set the folder down and squared it with the edge of the counter. “I won’t keep you. You’ve got a lesson at nine, I expect.”';
  const bad = applyEdits([part], [{note: 'line 2: echo — answer with something new', find: '“It gets in the cars, too.” Denise set the folder down and squared it with the edge of the counter. “I won’t keep you. You’ve got a lesson at nine, I expect.”', replace: '“It will be.”'}]);
  assert.equal(bad.applied.length, 0); assert.match(bad.missed[0].why, /would cut/);
  const ok = applyEdits([part], [{note: 'line 2: echo — answer with something new', find: '“It gets in the cars, too.”', replace: '“Salt’s the least of it.”'}]);
  assert.equal(ok.applied.length, 1);
  const asked = applyEdits([part], [{note: 'line 2: cut the folder business, it is redundant', find: 'Denise set the folder down and squared it with the edge of the counter. “I won’t keep you.', replace: '“I won’t keep you.'}]);
  assert.equal(asked.applied.length, 1, 'a note that asks for a cut may cut');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {MEMORY_ITEMS, injection, transcriptOf, chapterEndInstruction, summaryTitle, CHAT_START_DEPTH} from '../memory.mjs';
const [sofar, previously, chapter, outline] = ['sofar', 'previously', 'chapter', 'outline'].map(k => MEMORY_ITEMS.find(x => x.key === k));

test('placements map to SillyTavern injection positions', () => {
  assert.deepEqual(injection(sofar, 'Ruth found the folio.'), {value: `${sofar.header}\nRuth found the folio.`, position: 1, depth: CHAT_START_DEPTH, role: 0});
  assert.deepEqual(injection(chapter, 'Plan', {where: 'chat-depth', depth: 4, role: 'assistant'}, {unit: 'Session'}), {value: 'THIS SESSION — the plan for the session you are writing now:\nPlan', position: 1, depth: 4, role: 2});
  assert.equal(injection(chapter, 'Plan').role, 1, 'the plan goes in as the author\'s, near the end');
  assert.equal(injection(outline, 'x').value, '', 'the whole outline is off by default (models foreshadow what they can see)');
  assert.equal(injection(chapter, 'Plan', {where: 'chat-depth', depth: 4, header: ''}).value, 'Plan', 'an emptied instruction sends just the text');
  assert.match(injection(outline, 'Chapter 1 — x', {where: 'system-end'}, {chapter: 2}).value, /^FULL OUTLINE — for orientation only\. You are writing Chapter 2\./);
  assert.match(injection(outline, 'x', {where: 'top', header: 'Custom for {units} after {chapter}:'}, {chapter: 3}).value, /^Custom for chapters after 3:/);
  assert.equal(injection(previously, 'x', {where: 'top', role: 'user'}).position, 2);
  assert.equal(injection(previously, 'x', {where: 'system-end'}).position, 0);
  assert.equal(injection(sofar, 'x', {where: 'off'}).value, '');
  assert.equal(injection(sofar, '   ').value, '', 'empty memory sends nothing');
  assert.equal(injection(chapter, 'x', {where: 'chat-depth', depth: 99999}).depth, CHAT_START_DEPTH);
});

test('the chapter transcript skips system messages and keeps the newest part', () => {
  const chat = [{is_system: true, mes: 'sys'}, {is_user: true, mes: 'I open the door.'}, {name: 'Narrator', mes: 'The hinge screams.'}];
  assert.deepEqual(transcriptOf(chat), {text: 'USER: I open the door.\n\nNarrator: The hinge screams.', messages: 2});
  const long = transcriptOf([{mes: 'a'.repeat(100)}, {mes: 'b'.repeat(100)}], 120);
  assert.match(long.text, /omitted/);
  assert.match(long.text, /b{100}$/);
});

test('the chapter-end request names its outputs and keeps earlier ledger items', () => {
  const text = chapterEndInstruction({unit: 'Chapter', number: 2, transcript: 'USER: hi', storySoFar: '- Ch1: Ruth arrives.', castTitles: ['Character — Ruth Aldiss']});
  assert.match(text, new RegExp(summaryTitle('Chapter', 2)));
  assert.match(text, /Storyloom Memory — Story So Far/);
  assert.match(text, /Never drop or shorten earlier items/); assert.match(text, /what is done and finished/);
  assert.match(text, /- Ch1: Ruth arrives\./);
  assert.match(text, /Character — Ruth Aldiss/);
  for (const h of ['SUMMARY:', 'WHAT CHANGED:', 'WHAT THE NARRATOR NOW KNOWS:', 'MUST NOT DRIFT:', 'OPEN THREADS:', 'CONTRADICTION:']) assert.ok(text.includes(h), h);
  assert.match(text, /never silently choose, never repair canon/);
  assert.match(chapterEndInstruction({number: 2, transcript: 'x', sealedNotes: 'CHAPTER 1 — …'}), /Earlier sealed notes:\nCHAPTER 1/);
  // Details drifted between chapters (a truck became a car, oil on board became canvas): the hand-off keeps how things look.
  const look = chapterEndInstruction({number: 1, transcript: 'x'});
  assert.match(look, /- how things look:/);
  assert.match(look, /what kind of vehicle someone drives/);
  assert.match(look, /how things look \(the kind of vehicle/);
});

test('a character update only adds or replaces CURRENT STATE; the profile stays', async () => {
  const {mergeCurrentState} = await import('../memory.mjs');
  const profile = 'ROLE IN THE STORY: The daughter.\n\nPERSONALITY: Guarded.';
  const once = mergeCurrentState(profile, 'CURRENT STATE:\n- Has the razor blade.');
  assert.equal(once, 'ROLE IN THE STORY: The daughter.\n\nPERSONALITY: Guarded.\n\nCURRENT STATE:\n- Has the razor blade.');
  const twice = mergeCurrentState(once + '\n\nSECRETS: none', '- Told Ollie about the blade.');
  assert.match(twice, /^ROLE IN THE STORY: The daughter\./);
  assert.match(twice, /CURRENT STATE:\n- Told Ollie about the blade\.\n\nSECRETS: none$/);
  assert.doesNotMatch(twice, /Has the razor blade/);
  assert.equal(mergeCurrentState(profile, '   '), profile);
});

test('prose transcript drops speaker labels and the writer’s own messages', async () => {
  const {transcriptOf} = await import('../memory.mjs');
  const chat = [{name: 'Novel Engine', mes: 'Ruth came home.'}, {is_user: true, name: 'Me', mes: 'continue'}, {name: 'Novel Engine', mes: 'It rained.'}];
  assert.deepEqual(transcriptOf(chat, 60000, {prose: true}), {text: 'Ruth came home.\n\nIt rained.', messages: 2});
  assert.match(transcriptOf(chat).text, /^Novel Engine: Ruth/);
});

test('the narrator is told how much fits in one reply', async () => {
  const {replyWords, replyLengthNote} = await import('../memory.mjs');
  assert.equal(replyWords(2000), 1100);
  assert.equal(replyWords(300), 100);
  assert.equal(replyWords(0), 0);
  assert.equal(replyWords(8196), 4900);
  assert.match(replyLengthNote(2000), /about 1100 words/);
  assert.match(replyLengthNote(2000), /ending its plan describes/);
  assert.equal(replyLengthNote(undefined), '');
});

test('the seal asks for where things stand and everything that happened', () => {
  const p = chapterEndInstruction({unit: 'Chapter', number: 1, transcript: 'x'});
  assert.match(p, /WHERE THINGS STAND/);
  assert.match(p, /conditions: weather, light/);
  assert.match(p, /WHAT HAPPENED: every significant moment/);
  assert.match(p, /if in doubt, include it/);
  assert.doesNotMatch(p, /Do not include: the sequence of events \(that is SUMMARY\)/);
  assert.match(MEMORY_ITEMS[1].header, /WHERE THINGS STAND is still true/);
});

test('the last page is the chapter’s final paragraphs, word for word', async () => {
  const {lastPage} = await import('../memory.mjs');
  const long = Array.from({length: 160}, (_, i) => `w${i}`).join(' ');
  assert.equal(lastPage(`First.\n\n${long}\n\nIt was still raining when she shut the door.`), `${long}\n\nIt was still raining when she shut the door.`);
  assert.equal(lastPage('Only one short paragraph.'), 'Only one short paragraph.');
  assert.match(lastPage(Array.from({length: 600}, (_, i) => `w${i}`).join(' ')), /^…w150 /);
  assert.equal(lastPage(''), '');
});

test('hand-off sections are read back whole, lower-case labels included', async () => {
  const {capsSection} = await import('../memory.mjs');
  const prev = 'SUMMARY: s\nWHERE THINGS STAND:\n- when: Day 1\n- Mara: kitchen\nWHAT HAPPENED:\n- Woke.\n- Mara: cut thumb.\nCONTRADICTION: none.\n\nLAST PAGE (the chapter’s final words, exactly):\nOut past the glass.\n\nHer thumb had stopped.';
  assert.equal(capsSection(prev, 'WHERE THINGS STAND'), '- when: Day 1\n- Mara: kitchen');
  assert.equal(capsSection(prev, 'WHAT HAPPENED'), '- Woke.\n- Mara: cut thumb.');
  assert.equal(capsSection(prev, 'LAST PAGE'), 'Out past the glass.\n\nHer thumb had stopped.');
  assert.equal(capsSection(prev, 'MISSING'), '');
});

test('a chosen words-per-reply is asked for, not capped', async () => {
  const {replyLengthNote, tokensFor} = await import('../memory.mjs');
  assert.match(replyLengthNote(8196, 'Chapter', 3000), /about 3000 words/);
  assert.doesNotMatch(replyLengthNote(8196, 'Chapter', 3000), /no more/);
  assert.match(replyLengthNote(2000, 'Chapter', 0), /about 1100 words \(what fits in this reply\)/);
  assert.match(replyLengthNote(8196, 'Chapter', 3000, {number: 2}), /WHAT TO WRITE NOW: Chapter 2 — the whole chapter, in this reply, about 3000 words/);
  assert.match(replyLengthNote(8196, 'Chapter', 3000), /\[END OF CHAPTER\]/, 'the end signal is part of the request');
  assert.match(replyLengthNote(8196, 'Chapter', 3000, {written: 1200, planned: 3000}), /carry on this chapter from exactly where the text stops — don't repeat/);
  assert.match(replyLengthNote(8196, 'Chapter', 3000, {written: 1200, planned: 3000}), /up to about 1800 more words/);
  assert.match(replyLengthNote(8196, 'Chapter', 3000, {written: 1200, planned: 3000}), /already reached the ending this chapter's plan describes, the chapter is finished: write nothing else but the line \[END OF CHAPTER\]/);
  assert.match(replyLengthNote(8196, 'Chapter', 3000, {written: 1200, planned: 3000}), /Never move the story past that ending/);
  assert.match(replyLengthNote(2000, 'Chapter', 1100, {planned: 3000}), /as much of it as fits in this reply — about 1100 words \(the chapter is planned at 3000\)/);
  assert.equal(tokensFor(3000), 5550);
});

test('in roleplay a reply is one turn, not a whole session', async () => {
  const {replyLengthNote} = await import('../memory.mjs');
  const n = replyLengthNote(8196, 'Session', 0, {roleplay: true});
  assert.match(n, /stop where it's their move/);
  assert.doesNotMatch(n, /whole session/);
  assert.match(replyLengthNote(8196, 'Chapter', 3000), /the whole chapter, in this reply/);
});

test('bit by bit: the passage knows its place in the chapter and only ends it near its length', async () => {
  const {replyLengthNote} = await import('../memory.mjs');
  const first = replyLengthNote(8196, 'Chapter', 800, {passages: true, planned: 3000, written: 0, number: 2});
  assert.match(first, /the next passage of Chapter 2, about 800 words/);
  assert.match(first, /planned at about 3000 words and has about 0 so far/);
  assert.match(first, /isn't near its end yet: don't end it in this passage/);
  assert.doesNotMatch(first, /add one last line on its own/);
  const last = replyLengthNote(8196, 'Chapter', 800, {passages: true, planned: 3000, written: 2300});
  assert.match(last, /add one last line on its own: \[END OF CHAPTER\]/);
});

test('the seal is written for the next model and flags rule breaks instead of making them canon', () => {
  const p = chapterEndInstruction({unit: 'Chapter', number: 2, transcript: 'x', rules: 'Never put a third person on the page.', castNames: ['Mara', 'Tom']});
  assert.match(p, /read by another language model at the start of the next chapter/);
  assert.match(p, /mark it "\(inferred\)"/);
  assert.match(p, /a named person on the page who isn't in the book \(the book's people: Mara, Tom\)/);
  assert.match(p, /THE AUTHOR'S RULES \(check the page against them\): Never put a third person on the page\./);
  assert.doesNotMatch(p, /where that reading was wrong/);
});

test('bit by bit: each passage is told which of the plan\'s events it covers', async () => {
  const {planBeats, replyLengthNote} = await import('../memory.mjs');
  const plan = 'This is Chapter 3 of 3. Write it to this plan.\n\nCHAPTER 3 — THE BACK OF THE PAINTING\nEvents: Sunday morning Wynn needs the back of the canvas for his report, and Teodora helps him lift the painting down off its hook over the piano; on the reverse is the date 1971, and Wynn knows. He sends her to sit down and she admits it alone in the front room. Wynn finishes the inventory and writes the report at the kitchen table while Clem waits on the total. He takes his fee, loads the car and leaves for Regina.\nCharacters and relationships: Teodora and Wynn end as confederates.\n\nThis is the last chapter: bring the story to the ending its plan describes.';
  const beats = planBeats(plan);
  assert.equal(beats.length, 4);
  assert.match(beats[0], /^Sunday morning/); assert.match(beats[3], /leaves for Regina\.$/);
  const n = replyLengthNote(12000, 'Chapter', 800, {passages: true, number: 3, planned: 3000, written: 0, beats});
  assert.match(n, /1\. Sunday morning/); assert.match(n, /covers about one of these events: the next one the text hasn't reached yet/);
  assert.match(replyLengthNote(12000, 'Chapter', 1600, {passages: true, number: 3, planned: 3000, written: 0, beats}), /about 2 of these events/);
  assert.doesNotMatch(replyLengthNote(12000, 'Chapter', 800, {passages: true, number: 3, planned: 3000, written: 0, beats: []}), /planned events/);
  assert.deepEqual(planBeats('CHAPTER 1\nEvents:\n- Ann arrives at the cabin in the snow.\n- Ben is asleep by the stove and wakes.\nUnrevealed: x'), ['Ann arrives at the cabin in the snow.', 'Ben is asleep by the stove and wakes.']);
});

test('bit by bit near the end: a text that already reached the ending gets only the end mark', async () => {
  const {replyLengthNote} = await import('../memory.mjs');
  assert.match(replyLengthNote(12000, 'Chapter', 800, {passages: true, number: 3, planned: 3000, written: 3147}), /already reached that ending, the chapter is finished: write nothing else but the line \[END OF CHAPTER\]/);
});

test('the room a reply needs counts the thinking this narrator actually does', async () => {
  const {replyWords} = await import('../memory.mjs');
  assert.equal(replyWords(12000), 7700, 'default: 1,500 tokens kept for thinking');
  assert.equal(replyWords(12000, 9500), 1800, 'a narrator that thought 9,500 tokens leaves room for far fewer words');
});

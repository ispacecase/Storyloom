import test from 'node:test';
import assert from 'node:assert/strict';
import {chapterList, currentChapterContent, cleanCharacterKeys, layoutBook, directiveForChapter, CURRENT_CHAPTER} from '../lorebook-layout.mjs';

const outline = `Chapter 1 — Salt Film\nEvents: Wren arrives.\nCharacters and relationships: tense.\nConsequences and threads: she stays.\n\n**Chapter 2 — The Word for It**\nEvents: The clinic.\nCharacters and relationships: humiliation.\nConsequences and threads: notebook.`;

test('chapters are read from the outline headings', () => {
  const list = chapterList(outline);
  assert.deepEqual(list.map(c => [c.number, c.title]), [[1, 'Salt Film'], [2, 'The Word for It']]);
  assert.match(list[0].text, /Wren arrives/);
  assert.doesNotMatch(list[0].text, /clinic/);
});

test('current chapter text carries only that chapter plus what comes next', () => {
  const one = currentChapterContent(outline, 1);
  assert.match(one, /Chapter 1 of 2/);
  assert.match(one, /Wren arrives/);
  assert.doesNotMatch(one, /humiliation|notebook/, 'later chapters appear as one line, not their full plan');
  assert.match(one, /Still to come — do not write any of this yet[\s\S]*- Chapter 2: The Word for It — The clinic\./);
  assert.match(currentChapterContent(outline, 2), /final chapter: bring the story to its ending/);
  assert.match(currentChapterContent(outline, 1, 'Chapter', {wordsPerChapter: 'approximately 2,500 (fixed by the writer)'}), /should run about 2,500 words in total/);
  assert.equal(currentChapterContent(outline, 9), '');
});

test('character keys keep names, drop generic words and shared surnames', () => {
  const entries = [
    {comment: 'Character — Nell Ashworth', key: ['Nell', 'Ashworth', 'the girl', "Nell's"]},
    {comment: 'Character — Ray Ashworth', key: ['Ray', 'Ashworth', 'her father', 'dad']},
    {comment: 'Character — Bramble', key: ['Bramble', 'dog', 'the big lad', 'deerhound']},
  ];
  cleanCharacterKeys(entries);
  assert.deepEqual(entries[0].key, ['Nell Ashworth', 'Nell']);
  assert.deepEqual(entries[1].key, ['Ray Ashworth', 'Ray']);
  assert.deepEqual(entries[2].key, ['Bramble', 'deerhound']);
});

test('layout switches planning entries off and adds an always-on current chapter', () => {
  const book = {entries: {
    0: {uid: 0, comment: 'Novel Foundation', content: 'x', constant: false},
    1: {uid: 1, comment: 'Novel Outline', content: outline},
    2: {uid: 2, comment: 'Story Scale', content: 'x'},
    3: {uid: 3, comment: 'Voice and Boundaries', content: 'x'},
    4: {uid: 4, comment: 'People', content: 'x'},
    5: {uid: 5, comment: 'Character — Wren', content: 'x', key: ['Wren', 'mother']},
  }};
  const create = b => (b.entries[9] = {uid: 9});
  const out = layoutBook(book, {chapter: 2, create});
  assert.equal(book.entries[1].disable, undefined, 'source untouched');
  assert.equal(out.entries[0].constant, true);
  assert.equal(out.entries[1].disable, true);
  assert.equal(out.entries[2].disable, true);
  assert.equal(out.entries[3].constant, true);
  assert.equal(out.entries[4].disable, true);
  assert.deepEqual(out.entries[5].key, ['Wren']);
  assert.equal(out.entries[9].comment, CURRENT_CHAPTER);
  assert.equal(out.entries[9].disable, true, 'Current Chapter is sent by the Memory tab, not the lorebook');
  assert.equal(out.entries[5].excludeRecursion, true, 'characters are not triggered by other entries');
  assert.match(out.entries[9].content, /Chapter 2 of 2/);
  const again = layoutBook(out, {chapter: 1, create});
  assert.equal(Object.keys(again.entries).length, 7, 'reuses the existing Current Chapter entry');
  assert.match(again.entries[9].content, /Chapter 1 of 2/);
});

test('directive chapter line moves and scene resets', () => {
  assert.equal(directiveForChapter('X\nChapter: 1\nScene: 4\nPOV: Third', 3), 'X\nChapter: 3\nScene: 1\nPOV: Third');
});

test('the cast list is labelled as an index, once', async () => {
  const {castNames} = await import('../characters.mjs');
  const book = {entries: {1: {uid: 1, comment: 'People', content: '**Lily | Age: 7 | Pronouns: she/her | Relationships: x | Wants: y'}, 2: {uid: 2, comment: 'Character — Lily', content: 'x'}}};
  const once = layoutBook(book, {});
  const twice = layoutBook(once, {});
  assert.match(twice.entries[1].content, /^\(Cast index for Storyloom/);
  assert.equal(twice.entries[1].content.match(/Cast index/g).length, 1);
  assert.deepEqual(castNames(twice.entries[1].content), ['Lily'], 'the label does not become a cast member');
});

test('switched-off planning entries say why, once, without breaking the chapter list', () => {
  const book = {entries: {1: {uid: 1, comment: 'Novel Outline', content: outline}, 2: {uid: 2, comment: 'Story Scale', content: 'CHAPTERS: 2'}}};
  const out = layoutBook(layoutBook(book, {create: b => (b.entries[9] = {uid: 9})}), {create: () => null});
  assert.match(out.entries[1].content, /^\(Storyloom: switched off here on purpose\. The Memory tab sends it as “Whole outline”/);
  assert.equal(out.entries[1].content.match(/\(Storyloom:/g).length, 1);
  assert.match(out.entries[2].content, /^\(Storyloom: planning notes, switched off on purpose/);
  assert.deepEqual(chapterList(out.entries[1].content).map(c => c.number), [1, 2]);
});

test('with the general narrator, the voice entry stays saved but is switched off with a note', async () => {
  const {layoutBook} = await import('../lorebook-layout.mjs');
  const {NOVEL} = await import('../templates.mjs');
  const voiceTitle = NOVEL.entries.find(e => e.show === 'always').title;
  const book = {entries: {0: {uid: 0, comment: voiceTitle, content: 'POV: Third person, Mara.\nTENSE: Past.', constant: true, disable: false, key: []}}};
  const on = layoutBook(book, {template: NOVEL});
  assert.equal(on.entries[0].disable, false);
  const off = layoutBook(book, {template: NOVEL, voiceViaNarrator: true});
  assert.equal(off.entries[0].disable, true);
  assert.match(off.entries[0].content, /^\(Storyloom: kept here[\s\S]*POV: Third person, Mara\.\nTENSE: Past\.$/);
  const back = layoutBook(off, {template: NOVEL});
  assert.equal(back.entries[0].content, 'POV: Third person, Mara.\nTENSE: Past.');
});

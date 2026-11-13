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
  assert.doesNotMatch(one, /The clinic/);
  assert.match(one, /Coming next.*Chapter 2 — The Word for It/);
  assert.match(currentChapterContent(outline, 2), /final chapter/);
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
  assert.equal(out.entries[9].constant, true);
  assert.match(out.entries[9].content, /Chapter 2 of 2/);
  const again = layoutBook(out, {chapter: 1, create});
  assert.equal(Object.keys(again.entries).length, 7, 'reuses the existing Current Chapter entry');
  assert.match(again.entries[9].content, /Chapter 1 of 2/);
});

test('directive chapter line moves and scene resets', () => {
  assert.equal(directiveForChapter('X\nChapter: 1\nScene: 4\nPOV: Third', 3), 'X\nChapter: 3\nScene: 1\nPOV: Third');
});

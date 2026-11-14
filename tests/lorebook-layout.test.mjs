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
  assert.match(one, /Later chapters — listed only so you don't use their events up here\. Never hint at or foreshadow them:[\s\S]*- Chapter 2: The Word for It — The clinic\./);
  assert.match(currentChapterContent(outline, 2), /last chapter: bring the story to the ending its plan describes/);
  assert.match(currentChapterContent(outline, 1, 'Chapter', {wordsPerChapter: 'approximately 2,500 (fixed by the writer)'}), /It runs about 2,500 words in total/);
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
  assert.equal(out.entries[0].disable, true, 'the foundation reaches the narrator through Storyloom, without the ending');
  assert.match(out.entries[0].content, /^\(Storyloom: kept here as the full record/);
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
  assert.match(out.entries[1].content, /^\(Storyloom: switched off here on purpose\. The narrator gets this chapter’s plan from it/);
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
  assert.equal(back.entries[0].content, `[${voiceTitle}]\nPOV: Third person, Mara.\nTENSE: Past.`, 'sent again, labelled');
});

test('outline edits merge by chapter: changed and new chapters replace or add, the rest stay', async () => {
  const {mergeOutline, chapterList} = await import('../lorebook-layout.mjs');
  const old = '(Storyloom: note)\nChapter 1 — A\n\nEvents: a.\n\nChapter 2 — B\n\nEvents: b.\n\nChapter 3 — C\n\nEvents: c.';
  const merged = mergeOutline(old, 'Chapter 2 — B2\n\nEvents: b changed.\n\nChapter 4 — D\n\nEvents: d.');
  assert.deepEqual(chapterList(merged).map(c => [c.number, c.title]), [[1, 'A'], [2, 'B2'], [3, 'C'], [4, 'D']]);
  assert.match(merged, /Events: a\./);
  assert.doesNotMatch(merged, /\(Storyloom/);
  assert.deepEqual(chapterList(mergeOutline(old, 'REMOVE Chapter 3')).map(c => c.number), [1, 2]);
  assert.equal(mergeOutline(old, 'nothing structured'), 'nothing structured');
});

test('lint sees every later chapter, in full while it fits and as gists after that', async () => {
  const {laterChapters} = await import('../lorebook-layout.mjs');
  const outline = Array.from({length: 20}, (_, i) => `Chapter ${i + 1} — T${i + 1}\n\nEvents: Event ${i + 1} happens. ${'x'.repeat(800)}`).join('\n\n');
  const text = laterChapters(outline, 3, 'Chapter', 3000);
  assert.match(text, /EARLIER CHAPTERS[\s\S]*- Chapter 1: T1/);
  assert.match(text, /LATER CHAPTERS — none of this may happen[\s\S]*Chapter 4 — T4\n\nEvents: Event 4 happens/);
  assert.match(text, /Chapter 20 — T20 — Event 20 happens\./);
  assert.doesNotMatch(text, /Event 3 happens/);
});

test('the chapter length reads cleanly even with a stray full stop', async () => {
  const {currentChapterContent} = await import('../lorebook-layout.mjs');
  const c = currentChapterContent('Chapter 1 — A\nEvents: x\n\nChapter 2 — B\nEvents: y', 1, 'Chapter', {wordsPerChapter: '1,250.'});
  assert.match(c, /about 1,250 words in total/);
});

test('a chapter length without a number is left out of the plan', async () => {
  const {currentChapterContent} = await import('../lorebook-layout.mjs');
  assert.doesNotMatch(currentChapterContent('Session 1 — A\nEvents: x', 1, 'Session', {wordsPerChapter: "one evening's worth"}), /should run about/);
});

test('what the narrator reads names its subject, has no review marks, and gives nothing away', async () => {
  const {foundationForNarrator, labelled, stripAiMarks, ARCS_TITLE} = await import('../lorebook-layout.mjs');
  const f = '(Storyloom: kept here)\nNOVEL TITLE: Small Hours\nPREMISE: A nurse finds out.\nRELATIONSHIP ARCS: From friends to a standoff.\nMAJOR PLOT MILESTONES: Monday: the ring.\nThursday: she tells him.\nENDING DIRECTION: The book ends before she speaks.\nTHE KEEPSAKES (AI-suggested): Brown paper.\n\nAll established events and character histories must remain consistent unless explicitly revised.\n\nAll established events and character histories must remain consistent unless explicitly revised.';
  const n = foundationForNarrator(f);
  assert.match(n, /^NOVEL TITLE: Small Hours\nPREMISE: A nurse finds out\./);
  assert.doesNotMatch(n, /Monday|Thursday|ends before|standoff|AI-suggested|Storyloom:/);
  assert.match(n, /THE KEEPSAKES: Brown paper\./);
  assert.equal(n.match(/must remain consistent/g).length, 1);
  assert.equal(labelled('Character — Walter', 'ROLE: porter.'), '[Character — Walter]\nROLE: porter.');
  assert.equal(labelled('Character — Walter', labelled('Character — Walter', 'x')), '[Character — Walter]\nx', 'once');
  assert.equal(stripAiMarks('BASICS: 67. AI-suggested: he lives alone. (AI-suggested) Quiet.'), 'BASICS: 67. he lives alone. Quiet.');
  const book = {entries: {
    1: {uid: 1, comment: 'Character — Walter Bray', content: 'ROLE IN THE STORY: The porter.\nARC THROUGH THE NOVEL: In Chapter 4 he does not argue.\nVOICE AND MANNERISMS: Short sentences.', key: ['Walter']},
  }};
  const out = layoutBook(book, {create: b => (b.entries[9] = {uid: 9})});
  assert.equal(out.entries[1].content, '[Character — Walter Bray]\nROLE IN THE STORY: The porter.\nVOICE AND MANNERISMS: Short sentences.');
  assert.equal(out.entries[9].comment, ARCS_TITLE);
  assert.equal(out.entries[9].disable, true);
  assert.match(out.entries[9].content, /WALTER BRAY: In Chapter 4 he does not argue\./);
});

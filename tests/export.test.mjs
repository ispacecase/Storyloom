import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chapterProse, paragraphsOf, bookText, bookDocx, documentXml, crc32, fileName} from '../export.mjs';

const chat = [
  {name: 'Narrator', mes: 'Chapter 2 — Ebb'},
  {is_user: true, mes: 'Begin: Tom comes back at dusk.'},
  {name: 'Narrator', mes: 'He came up the track at dusk.\n\nShe did not look up.'},
  {is_system: true, mes: 'note'},
  {name: 'Narrator', mes: 'The kettle went on.'},
];

test('a chapter’s prose is the narrator’s text only, without the heading greeting or directions', () => {
  assert.equal(chapterProse(chat), 'He came up the track at dusk.\n\nShe did not look up.\n\nThe kettle went on.');
  assert.equal(chapterProse(chat, {start: 3}), 'The kettle went on.');
  assert.deepEqual(paragraphsOf('One\nline.\n\nTwo.'), ['One line.', 'Two.']);
});

test('the text manuscript has the title, chapter headings and paragraphs; missing chapters are marked', () => {
  const t = bookText({title: 'Fixed Light', chapters: [{heading: 'Chapter 1 — The Letter', text: 'A.\n\nB.'}, {heading: 'Chapter 2 — Ebb', text: ''}]});
  assert.equal(t, 'FIXED LIGHT\n\n\nChapter 1 — The Letter\n\nA.\n\nB.\n\nChapter 2 — Ebb\n\n(This chapter was not found.)\n');
});

test('the docx is a valid zip that unzip can read, with the story inside', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const bytes = bookDocx({title: 'Fixed <Light>', chapters: [{heading: 'Chapter 1', text: 'She & he.'}]});
  const dir = mkdtempSync(join(tmpdir(), 'sl-')), file = join(dir, 'b.docx');
  writeFileSync(file, bytes);
  const list = execFileSync('unzip', ['-l', file]).toString();
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) assert.ok(list.includes(n), n);
  const doc = execFileSync('unzip', ['-p', file, 'word/document.xml']).toString();
  assert.match(doc, /Fixed &lt;Light&gt;/);
  assert.match(doc, /She &amp; he\./);
  execFileSync('unzip', ['-t', file]);
  assert.match(documentXml({chapters: [{heading: 'C1', text: 'x'}, {heading: 'C2', text: 'y'}]}), /<w:pageBreakBefore\/>[\s\S]*C2/);
  assert.equal(fileName('A/B: "C"', 'docx'), 'A-B- -C-.docx');
});

test('a reply cut off by the response limit loses its unfinished end on export', async () => {
  const {cropCutOff} = await import('../export.mjs');
  assert.equal(cropCutOff('She pulled her coat straight. "There\'s ice cream in the little freezer, if she asks. Not before tea'), 'She pulled her coat straight.');
  assert.equal(cropCutOff('One.\n\nShe went to the door and got her'), 'One.\n\nShe went to the door and got her'.slice(0, 4));
  assert.equal(cropCutOff('“Fine,” she said. And then the'), '“Fine,” she said.');
  assert.equal(cropCutOff('All done.'), 'All done.');
  assert.equal(chapterProse([{mes: 'A whole line.'}, {mes: 'Half a sen'}]), 'A whole line.');
});

test('provider junk like <ds_safety> is removed from replies', async () => {
  const {cleanReply} = await import('../export.mjs');
  assert.equal(cleanReply('<ds_safety>[Internal thinking]\n\nShe went to the window.'), 'She went to the window.');
  assert.equal(cleanReply('<ds_safety>checking</ds_safety>\nShe went.'), 'She went.');
  assert.equal(cleanReply('She went. <ds_safety>'), 'She went. ');
  assert.equal(cleanReply('Nothing odd [here].'), 'Nothing odd [here].');
});

test('the end-of-chapter signal is never part of the book', async () => {
  const {splitEndMark, cleanReply, chapterProse} = await import('../export.mjs');
  assert.deepEqual(splitEndMark('She shut the door.\n\n[END OF CHAPTER]'), {done: true, text: 'She shut the door.'});
  assert.deepEqual(splitEndMark('She shut the door. [End of Chapter 2]'), {done: true, text: 'She shut the door.'});
  assert.deepEqual(splitEndMark('She shut the door.'), {done: false, text: 'She shut the door.'});
  assert.equal(cleanReply('The end.\n[END OF CHAPTER]'), 'The end.');
  assert.equal(chapterProse([{mes: 'One.'}, {mes: 'Two.\n\n[END OF CHAPTER]'}]), 'One.\n\nTwo.');
  assert.equal(splitEndMark('He talked about the end of the chapter in his book.').done, false, 'ordinary words are not the signal');
});

test('the narrator’s working notes written into a reply are removed, prose is kept', async () => {
  const {stripNotes, cleanReply} = await import('../export.mjs');
  const reply = 'Ostap said, “Ammar’s got a test <analysis>\nLet me assess where the text stands.\n</analysis>\n\n<summary>\n1. Primary Request and Intent:\n   The user is writing a novel.\n</summary>';
  const r = stripNotes(reply);
  assert.equal(r.text.trim(), 'Ostap said, “Ammar’s got a test');
  assert.ok(r.removed > 10);
  assert.equal(stripNotes('Prose.\n<thinking>never closed').text.trim(), 'Prose.');
  assert.equal(cleanReply('He said <b>no</b>, and meant it.'), 'He said <b>no</b>, and meant it.', 'other tags are left alone');
});

test('a continuation that came back in pieces is repaired mechanically', async () => {
  const {repairContinuation} = await import('../export.mjs');
  const before = '"You had me counting to a Friday that was hers. Ammar\'s got a test';
  const added = ' ### Ammar\'s got a test, and you\'re the instructor in the car." "I\'m the instructor in the car." "Sunday\'s the thirtieth." "It is." "And Monday\'s April." "Monday is April, yes." ' + 'He went quiet then and stayed quiet long enough that she heard the kettle settle. '.repeat(10);
  const r = repairContinuation(before, added);
  assert.ok(r.text.startsWith(', and you\'re the instructor'), r.text.slice(0, 60));
  assert.match(r.text, /in the car\."\n\n"I'm the instructor/);
  assert.ok(!r.text.includes('###'));
  assert.equal(r.fixed.length, 3);
  const fine = repairContinuation('He said nothing', ' and went out.\n\nShe followed.');
  assert.equal(fine.text, ' and went out.\n\nShe followed.'); assert.equal(fine.fixed.length, 0);
});

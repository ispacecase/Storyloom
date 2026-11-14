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

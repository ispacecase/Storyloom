import test from 'node:test';
import assert from 'node:assert/strict';
import {chunkMarkdown, keywordSearch, hashText, vectorSource, indexChunks, searchDocs, DOCS_COLLECTION} from '../docs-rag.mjs';

const page = `---\ntitle: x\n---\n# World Info\nIntro text.\n\n## Recursion\nEntries can activate other entries.\n\n![img](a.png)\n\n## Scan Depth\nHow many messages are scanned.\n\n\`\`\`\n# not a heading\n\`\`\``;

test('docs are split by section with a readable label on every piece', () => {
  const chunks = chunkMarkdown('Usage/worldinfo.md', page);
  assert.equal(chunks.length, 3);
  assert.match(chunks[1].text, /^\[SillyTavern docs: Usage › worldinfo › World Info › Recursion\]\nEntries can activate/);
  assert.match(chunks[2].text, /# not a heading/, 'code blocks are not split as headings');
  assert.ok(chunks.every(c => Number.isInteger(c.hash) && c.hash >= 0));
  assert.doesNotMatch(chunks.map(c => c.text).join(), /img|title: x/);
  const long = chunkMarkdown('a.md', '# A\n' + Array.from({length: 20}, (_, i) => `Paragraph ${i} ` + 'word '.repeat(40)).join('\n\n'), 600);
  assert.ok(long.length > 3 && long.every(c => c.text.length < 900 && c.text.startsWith('[SillyTavern docs: a › A]')));
});

test('keyword fallback ranks heading matches first', () => {
  const chunks = chunkMarkdown('Usage/worldinfo.md', page);
  assert.match(keywordSearch(chunks, 'why does recursion pull everyone in?', 2)[0].text, /Recursion/);
  assert.deepEqual(keywordSearch(chunks, 'the and', 2), []);
  assert.equal(hashText('a'), hashText('a'));
  assert.notEqual(hashText('a'), hashText('b'));
});

test('embedding sources mirror Vector Storage, unsupported ones fall back', () => {
  assert.deepEqual(vectorSource({source: 'palm', google_model: 'gemini-embedding-001'}), {source: 'palm', model: 'gemini-embedding-001', api: 'makersuite'});
  assert.equal(vectorSource({source: 'webllm'}), null);
});

function fakeStore() {
  const store = new Map(); const calls = [];
  const fetchFn = async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push({url, body});
    assert.equal(body.collectionId, DOCS_COLLECTION);
    assert.equal(body.source, 'palm');
    if (url.endsWith('/list')) return {ok: true, json: async () => [...store.keys()]};
    if (url.endsWith('/delete')) { body.hashes.forEach(h => store.delete(h)); return {ok: true}; }
    if (url.endsWith('/insert')) { body.items.forEach(i => store.set(i.hash, i)); return {ok: true}; }
    if (url.endsWith('/query')) return {ok: true, json: async () => ({metadata: [...store.values()].filter(i => i.text.includes('Recursion'))})};
  };
  return {store, calls, fetchFn};
}

test('indexing only sends new pieces and removes stale ones, always in its own collection', async () => {
  const {store, fetchFn} = fakeStore();
  const source = vectorSource({source: 'palm', google_model: 'g'});
  const chunks = chunkMarkdown('Usage/worldinfo.md', page);
  assert.deepEqual(await indexChunks({fetchFn, headers: {}, source, chunks, batch: 2}), {added: 3, removed: 0, total: 3});
  assert.deepEqual(await indexChunks({fetchFn, headers: {}, source, chunks}), {added: 0, removed: 0, total: 3});
  const fewer = chunks.slice(0, 2);
  assert.deepEqual(await indexChunks({fetchFn, headers: {}, source, chunks: fewer}), {added: 0, removed: 1, total: 2});
  assert.equal(store.size, 2);
});

test('search uses meaning when available and keywords otherwise', async () => {
  const {fetchFn} = fakeStore();
  const source = vectorSource({source: 'palm', google_model: 'g'});
  const chunks = chunkMarkdown('Usage/worldinfo.md', page);
  await indexChunks({fetchFn, headers: {}, source, chunks});
  const byMeaning = await searchDocs({fetchFn, headers: {}, source, chunks, query: 'x'});
  assert.equal(byMeaning.method, 'meaning');
  assert.match(byMeaning.results[0].page, /Recursion/);
  const byWords = await searchDocs({fetchFn, headers: {}, source: null, chunks, query: 'scan depth'});
  assert.equal(byWords.method, 'keywords');
  assert.match(byWords.results[0].text, /Scan Depth/);
});

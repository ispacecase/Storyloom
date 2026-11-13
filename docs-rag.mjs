/**
 * SillyTavern documentation as a private RAG for the Storyloom assistant.
 * Docs are downloaded from GitHub at runtime (not bundled), split by section, and indexed
 * into Storyloom's own vector collection. SillyTavern's story replies only ever query the
 * chat, its attached files and active lorebooks, so this collection never reaches the story.
 */
export const DOCS_REPO = 'SillyTavern/SillyTavern-Docs';
export const DOCS_COLLECTION = 'storyloom-docs';
const RAW = `https://raw.githubusercontent.com/${DOCS_REPO}/main/`;
const TREE = `https://api.github.com/repos/${DOCS_REPO}/git/trees/main?recursive=1`;

/** Stable positive 32-bit hash (vector items are keyed by number). */
export function hashText(text) {
  let h = 5381;
  for (const ch of String(text)) h = ((h << 5) + h + ch.codePointAt(0)) | 0;
  return h >>> 0;
}

const pageName = path => path.replace(/\.md$/i, '').split('/').map(x => x.replace(/[-_]/g, ' ')).join(' › ');

/** Split one markdown page into section chunks of at most `max` characters. */
export function chunkMarkdown(path, markdown, max = 1800) {
  let text = String(markdown || '')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/\r\n?/g, '\n');
  const page = pageName(path);
  const sections = [];
  let heads = [], body = [];
  const flush = () => {
    const content = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (content) sections.push({section: heads.filter(Boolean).join(' › ') || 'Overview', content});
    body = [];
  };
  let fence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    const h = !fence && line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (h) { flush(); heads = heads.slice(0, h[1].length - 1); heads[h[1].length - 1] = h[2].replace(/[*_`]/g, ''); continue; }
    body.push(line);
  }
  flush();
  const chunks = [];
  for (const {section, content} of sections) {
    const label = `[SillyTavern docs: ${page} › ${section}]`;
    let piece = '';
    for (const para of content.split(/\n\n+/)) {
      if (piece && (piece.length + para.length + 2) > max) { chunks.push(piece); piece = ''; }
      piece = piece ? `${piece}\n\n${para}` : para.slice(0, max * 2);
    }
    if (piece) chunks.push(piece);
    for (let i = chunks.length - 1; i >= 0 && !chunks[i].startsWith('[SillyTavern docs:'); i--) chunks[i] = `${label}\n${chunks[i]}`;
  }
  return chunks.map((text, index) => ({path, page, text, hash: hashText(`${path}\n${text}`), index}));
}

const words = text => (String(text).toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
const STOP = new Set(['the', 'and', 'for', 'you', 'are', 'can', 'with', 'this', 'that', 'what', 'how', 'does', 'from', 'your', 'have', 'not', 'but', 'when', 'where', 'which', 'will', 'its', 'into', 'there', 'they', 'then', 'than', 'about', 'should', 'would', 'could', 'just', 'like', 'make', 'need', 'want']);

/** Fallback when no embedding source is available: rank chunks by shared words, headings weighted. */
export function keywordSearch(chunks, query, k = 6) {
  const terms = [...new Set(words(query).filter(w => !STOP.has(w)))];
  if (!terms.length) return [];
  return (chunks || []).map(chunk => {
    const head = chunk.text.slice(0, chunk.text.indexOf('\n') + 1).toLocaleLowerCase();
    const body = chunk.text.toLocaleLowerCase();
    const score = terms.reduce((n, t) => n + (head.includes(t) ? 3 : 0) + (body.includes(t) ? 1 : 0), 0);
    return {chunk, score};
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map(x => x.chunk);
}

/** Request fields for the user's embedding source, mirroring SillyTavern's Vector Storage. Null = unsupported here. */
export function vectorSource(vectors) {
  const s = vectors?.source;
  const model = key => ({model: vectors?.[key]});
  switch (s) {
    case 'transformers': return {source: s};
    case 'palm': return {source: s, ...model('google_model'), api: 'makersuite'};
    case 'openai': return {source: s, ...model('openai_model')};
    case 'openrouter': return {source: s, ...model('openrouter_model')};
    case 'cohere': return {source: s, ...model('cohere_model')};
    case 'togetherai': return {source: s, ...model('togetherai_model')};
    case 'electronhub': return {source: s, ...model('electronhub_model')};
    case 'nanogpt': return {source: s, ...model('nanogpt_model')};
    case 'chutes': return {source: s, ...model('chutes_model')};
    case 'mistral': return {source: s};
    case 'nomicai': return {source: s};
    default: return null;
  }
}

/** Download every docs page. `onProgress(done, total)`. */
export async function downloadDocs(fetchFn, onProgress = () => {}) {
  const tree = await fetchFn(TREE, {cache: 'no-store'});
  if (!tree.ok) throw Error(`Could not list the SillyTavern docs on GitHub (${tree.status}).`);
  const files = (await tree.json()).tree.filter(x => x.type === 'blob' && /\.md$/i.test(x.path) && !/^(\.|node_modules|blog)/i.test(x.path));
  const out = [];
  let done = 0;
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const r = await fetchFn(RAW + f.path.split('/').map(encodeURIComponent).join('/'), {cache: 'no-store'});
      if (r.ok) out.push({path: f.path, sha: f.sha, text: await r.text()});
      onProgress(++done, files.length);
    }
  };
  await Promise.all(Array.from({length: 6}, worker));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const post = (fetchFn, headers, url, body) => fetchFn(url, {method: 'POST', headers, body: JSON.stringify(body)});

/** Make the vector collection match `chunks`: insert new, delete stale. Returns counts. */
export async function indexChunks({fetchFn, headers, source, chunks, onProgress = () => {}, batch = 40}) {
  const base = {...source, collectionId: DOCS_COLLECTION};
  const listed = await post(fetchFn, headers, '/api/vector/list', base);
  if (!listed.ok) throw Error(`The vector store did not answer (${listed.status}). Check Vector Storage settings.`);
  const have = new Set((await listed.json()).map(Number));
  const want = new Map(chunks.map(c => [c.hash, c]));
  const stale = [...have].filter(h => !want.has(h));
  const missing = chunks.filter(c => !have.has(c.hash));
  if (stale.length) await post(fetchFn, headers, '/api/vector/delete', {...base, hashes: stale});
  for (let i = 0; i < missing.length; i += batch) {
    const items = missing.slice(i, i + batch).map(c => ({hash: c.hash, text: c.text, index: c.index}));
    const r = await post(fetchFn, headers, '/api/vector/insert', {...base, items});
    if (!r.ok) throw Error(`Indexing failed at piece ${i + 1} of ${missing.length} (${r.status}). Your embedding source may be out of quota or misconfigured.`);
    onProgress(Math.min(i + batch, missing.length), missing.length);
  }
  return {added: missing.length, removed: stale.length, total: chunks.length};
}

/**
 * Docs sections for a question: by meaning (vector store) merged with keyword matches,
 * since questions often use story words ("Ruth", "every message") rather than SillyTavern terms.
 */
export async function searchDocs({fetchFn, headers, source, chunks, query, k = 6}) {
  const byWords = keywordSearch(chunks, query, k).map(c => ({text: c.text, page: c.page}));
  let byMeaning = [];
  if (source) {
    try {
      const r = await post(fetchFn, headers, '/api/vector/query', {...source, collectionId: DOCS_COLLECTION, searchText: String(query).slice(0, 2000), topK: k, threshold: 0});
      if (r.ok) {
        const {metadata = []} = await r.json();
        byMeaning = metadata.filter(m => m?.text).map(m => ({text: m.text, page: (m.text.match(/^\[SillyTavern docs: ([^\]]+)\]/) || [])[1] || ''}));
      }
    } catch {}
  }
  if (!byMeaning.length) return {results: byWords, method: 'keywords'};
  const seen = new Set(), results = [];
  for (let i = 0; results.length < k && (i < byMeaning.length || i < byWords.length); i++) {
    for (const r of [byMeaning[i], byWords[i]]) if (r && !seen.has(r.text) && results.length < k) { seen.add(r.text); results.push(r); }
  }
  return {results, method: byWords.length ? 'meaning + keywords' : 'meaning'};
}

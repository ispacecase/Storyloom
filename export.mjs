/**
 * Export the finished book: the story text of every chapter, in order, as .txt or .docx.
 * Pure helpers (no SillyTavern calls): picking the prose out of a chapter's chat, building the manuscript,
 * and writing a minimal .docx (a zip of XML files; stored, not compressed — Word and Google Docs open it).
 */

import {endsCutOff} from './lint.mjs';

/** Provider junk that leaks into a reply, e.g. Venice's uncensored deepseek: "<ds_safety>[Internal thinking]" at the start, or a whole <ds_safety>…</ds_safety> block. */
export function cleanReply(text) {
  return String(text || '')
    .replace(/<ds_safety>[\s\S]*?<\/ds_safety>\s*/gi, '')
    .replace(/^\s*<\/?ds_safety>\s*(?:\[[^\]\n]{0,40}\]\s*)?/i, '')
    .replace(/<\/?ds_safety>/gi, '');
}

/** Drop the unfinished end of a reply that was cut off by the response limit: an unclosed line of dialogue, then any half sentence. */
export function cropCutOff(text) {
  let t = String(text || '').trim();
  if (!endsCutOff(t)) return t;
  const paras = t.split(/\n\s*\n/), last = paras.pop();
  let p = last;
  const open = (() => { // the opening quote that is never closed
    let curly = -1, straight = -1;
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      if (ch === '“') curly = i; else if (ch === '”') curly = -1;
      else if (ch === '"') straight = straight < 0 ? i : -1;
    }
    return Math.max(curly, straight);
  })();
  if (open >= 0) p = p.slice(0, open).trimEnd();
  if (endsCutOff(p)) { const m = p.match(/^[\s\S]*[.!?…][”"’')\]]*/); p = m ? m[0] : ''; }
  return [...paras, p].filter(x => x.trim()).join('\n\n').trim();
}

/** The story prose of one chapter's chat: the narrator's messages (the swipe that's showing), without the chapter heading greeting. */
export function chapterProse(chat, {start = 0, end = null, unit = 'Chapter', includeUser = false, userName = ''} = {}) {
  if (includeUser) { // roleplay: the session log, both sides, the player's turns marked with their name
    const msgs = (chat || []).slice(start, end ?? undefined).filter(m => m && !m.is_system && String(m.mes || '').trim());
    const heading = new RegExp(`^\\s*${unit}\\s+\\d+\\b[^\\n]{0,120}$`, 'i');
    return msgs.filter((m, i) => !(i === 0 && !m.is_user && heading.test(String(m.mes).trim())))
      .map(m => m.is_user ? `${userName || m.name || 'Player'}: ${String(m.mes).trim()}` : cropCutOff(cleanReply(m.mes).trim()))
      .filter(Boolean).join('\n\n');
  }
  const msgs = (chat || []).slice(start, end ?? undefined);
  const heading = new RegExp(`^\\s*${unit}\\s+\\d+\\b[^\\n]{0,120}$`, 'i');
  return msgs
    .filter(m => m && !m.is_user && !m.is_system && String(m.mes || '').trim())
    .map(m => cropCutOff(cleanReply(m.mes).trim()))
    .filter(Boolean)
    .filter((t, i) => !(i === 0 && heading.test(t)))
    .join('\n\n');
}

/** Split prose into paragraphs (blank lines; single newlines inside a paragraph become spaces). */
export const paragraphsOf = text => String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n+/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);

/** Plain-text manuscript. */
export function bookText({title = '', chapters = []}) {
  const out = [];
  if (title) out.push(title.toUpperCase(), '');
  for (const c of chapters) {
    out.push('', c.heading, '');
    out.push(c.text ? paragraphsOf(c.text).join('\n\n') : '(This chapter was not found.)');
  }
  return out.join('\n').replace(/^\n+/, '') + '\n';
}

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** WordprocessingML for the manuscript: title, then each chapter heading on a new page, then its paragraphs. */
export function documentXml({title = '', chapters = []}) {
  const para = (text, {bold = false, size = 24, center = false, pageBreak = false, indent = true, after = 0} = {}) =>
    `<w:p><w:pPr>${pageBreak ? '<w:pageBreakBefore/>' : ''}${center ? '<w:jc w:val="center"/>' : ''}<w:spacing w:after="${after}" w:line="360" w:lineRule="auto"/>${indent && !center ? '<w:ind w:firstLine="432"/>' : ''}</w:pPr><w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
  const body = [];
  if (title) body.push(para(title, {bold: true, size: 40, center: true, after: 480}));
  chapters.forEach((c, i) => {
    body.push(para(c.heading, {bold: true, size: 32, center: true, pageBreak: i > 0 || !!title, after: 360}));
    for (const p of c.text ? paragraphsOf(c.text) : ['(This chapter was not found.)']) body.push(para(p));
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xFFFFFFFF; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/** A zip archive with stored (uncompressed) entries. files: [{name, data: string|Uint8Array}]. Returns Uint8Array. */
export function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF], u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    parts.push(Uint8Array.from(local), name, data);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + data.length;
  }
  const cdSize = central.reduce((n, a) => n + a.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let at = 0; for (const a of all) { out.set(a, at); at += a.length; }
  return out;
}

/** The .docx file for a manuscript, as bytes. */
export function bookDocx(book) {
  return zipStore([
    {name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'},
    {name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},
    {name: 'word/document.xml', data: documentXml(book)},
  ]);
}

/** A safe file name from the book's title. */
export const fileName = (title, ext) => `${String(title || 'Book').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Book'}.${ext}`;

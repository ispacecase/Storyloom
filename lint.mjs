/**
 * Lint a written chapter against the book. Two layers:
 * - exact checks here (no model): tense, POV, names not in the book, name drift, repetition, stock phrasing, length;
 * - a book-facts check by the model (characters, voice, chapter order, timeline, period, the writer's rules, sealed facts),
 *   requested with lintInstruction and read back with parseFindings.
 * Lint only reports. It never changes the text.
 */

/** Paragraphs with dialogue removed, for checks that concern the narration only. */
export function paragraphs(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean)
    .map((p, i) => ({n: i + 1, text: p, narration: p.replace(/[“"][^”"]*[”"]/g, ' ').replace(/\s+/g, ' ').trim()}));
}
export const quote = (s, max = 90) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };

const PRESENT = /\b(is|are|am|does|has|says|asks|looks|walks|turns|feels|knows|thinks|sees|stands|sits|takes|comes|goes|smiles|laughs|watches|waits|reaches|pulls|opens|shakes|nods)\b/gi;
const PAST = /\b(was|were|did|had|said|asked|looked|walked|turned|felt|knew|thought|saw|stood|sat|took|came|went|smiled|laughed|watched|waited|reached|pulled|opened|shook|nodded)\b/gi;
const count = (s, re) => (s.match(re) || []).length;

/** Narration paragraphs whose tense goes against the book's tense. */
export function tenseSlips(paras, tense) {
  const wantPast = /past/i.test(tense || ''), wantPresent = /present/i.test(tense || '');
  if (!wantPast && !wantPresent) return [];
  return paras.filter(p => {
    const pr = count(p.narration, PRESENT), pa = count(p.narration, PAST);
    return wantPast ? pr >= 3 && pr > pa * 2 : pa >= 3 && pa > pr * 2;
  }).map(p => ({kind: 'TENSE', where: `line ${p.n}`, quote: quote(p.narration), rule: `The book is in ${wantPast ? 'past' : 'present'} tense; this paragraph reads as ${wantPast ? 'present' : 'past'}.`}));
}

/** Narration that slips out of the book's person (first vs third). */
export function povSlips(paras, pov) {
  const first = /first/i.test(pov || ''), third = /third/i.test(pov || '');
  if (!first && !third) return [];
  return paras.filter(p => {
    const i = count(p.narration, /\b(I|me|my|mine|myself)\b/g);
    const words = (p.narration.match(/\S+/g) || []).length;
    return third ? i >= 2 : (words >= 40 && i === 0);
  }).map(p => ({kind: 'POV', where: `line ${p.n}`, quote: quote(p.narration), rule: third ? 'The book is in third person; the narration says “I/my” here.' : 'The book is in first person; this paragraph of narration has no “I” at all — check whose head it is in.'}));
}

const NOT_NAMES = new Set(('I A An The And But Or So Then When While If As At In On Of To For From With By Into Over Under After Before Behind Inside Outside Up Down Out Off No Not Yes Yeah Oh Ah Mm Hm Okay OK Well Still Just Even Only Now Here There This That These Those It Its He She They We You Me My Her His Their Our Your Him Them Us What Who Why How Where Which Whatever Whoever Everyone Someone Anyone Nobody Something Nothing Everything Maybe Perhaps Please Thanks Sorry God Lord Mr Mrs Ms Miss Dr Sir Madam Mum Mom Dad Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Christmas Easter English French God Chapter Darling Honey Sweetheart Sweetie Love Dear Babe Baby Mate Pal Buddy Kid Son').split(' '));

/** Capitalised words mid-sentence that the book doesn't know: possible extra characters or places. */
export function unknownNames(paras, known = []) {
  const knownSet = new Set(known.flatMap(k => String(k).toLocaleLowerCase().split(/[\s—–-]+/)).filter(Boolean));
  const seen = new Map();
  // Ordinary words also appear in lowercase somewhere ("Snow" / "snow"); names don't.
  const lower = new Set((paras.map(p => p.text).join(' ').match(/\b[a-z][a-z']+\b/g) || []));
  // Narration only: someone merely named in dialogue is mentioned, not on the page.
  for (const p of paras) {
    for (const m of p.narration.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
      const w = m[1];
      if (NOT_NAMES.has(w) || knownSet.has(w.toLocaleLowerCase()) || lower.has(w.toLocaleLowerCase())) continue;
      if (!seen.has(w)) seen.set(w, {n: p.n, count: 0});
      seen.get(w).count++;
    }
  }
  return [...seen].map(([w, v]) => ({kind: 'UNLISTED', where: `line ${v.n}${v.count > 1 ? ` (+${v.count - 1} more)` : ''}`, quote: w, rule: 'This name is not in the cast list, any character entry, or any place entry. If it is a person on the page, the story budget may not have room for them.'}));
}

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
/** Words one letter away from a known name (Ann / Anne). */
export function nameDrift(paras, names = []) {
  const firsts = [...new Set(names.map(n => String(n).split(/\s+/)[0]).filter(n => n.length >= 3))];
  const out = new Map();
  for (const p of paras) for (const m of p.text.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
    const w = m[1];
    if (firsts.includes(w)) continue;
    const near = firsts.find(n => distance(n.toLowerCase(), w.toLowerCase()) === 1 && !NOT_NAMES.has(w));
    if (near && !out.has(w)) out.set(w, {kind: 'NAME', where: `line ${p.n}`, quote: w, rule: `Looks like a misspelling of “${near}”.`});
  }
  return [...out.values()];
}

/** Three-word phrases used three or more times, and the same sentence opening three times in a row. */
export function repetition(paras) {
  const words = paras.map(p => p.narration).join(' ').toLocaleLowerCase().match(/[\p{L}']+/gu) || [];
  const counts = new Map();
  for (let i = 0; i + 2 < words.length; i++) {
    const g = words.slice(i, i + 3);
    if (g.every(w => w.length <= 3)) continue;
    const k = g.join(' ');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const out = [...counts].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, n]) => ({kind: 'REPEAT', where: `${n} times`, quote: k, rule: 'The same phrase keeps coming back.'}));
  const sentences = paras.flatMap(p => p.narration.split(/(?<=[.!?])\s+/).map(s => ({n: p.n, first: (s.match(/^[\p{L}']+/u) || [''])[0].toLowerCase()})));
  for (let i = 2; i < sentences.length; i++) {
    const f = sentences[i].first;
    if (f && f === sentences[i - 1].first && f === sentences[i - 2].first) { out.push({kind: 'REPEAT', where: `line ${sentences[i].n}`, quote: `three sentences in a row start with “${f}”`, rule: 'Repeated sentence openings.'}); i += 2; }
  }
  return out;
}

export const STOCK_PHRASES = Object.freeze(['a testament to', 'shiver down (her|his|my|their) spine', 'breath (she|he|I|they) didn.t know (she|he|I|they) (was|were) holding', 'tapestry of', 'a dance of', 'electric(ity)? (between|in the air)', 'eyes (that )?sparkl', 'ministrations', 'wave of (emotion|desire|relief)', 'in that moment', 'little did (she|he|they) know', 'the weight of (it all|the world)', 'unspoken', 'palpable', 'barely above a whisper', 'smirk(ed)?']);
/** Stock phrasing models lean on; the list is editable by the caller. */
export function stockPhrases(paras, list = STOCK_PHRASES) {
  const out = [];
  for (const pattern of list) {
    const re = new RegExp(`\\b${pattern}`, 'i');
    const p = paras.find(x => re.test(x.text));
    if (p) out.push({kind: 'STOCK', where: `line ${p.n}`, quote: (p.text.match(re) || [''])[0], rule: 'Stock phrasing — say it the way this book would.'});
  }
  return out;
}

export function lengthCheck(text, target) {
  const words = (String(text || '').match(/\S+/g) || []).length;
  if (!target) return [];
  const ratio = words / target;
  if (ratio > 1.3) return [{kind: 'LENGTH', where: 'whole chapter', quote: `${words.toLocaleString('en-US')} words`, rule: `The budget for this chapter is about ${target.toLocaleString('en-US')} words; this is ${Math.round((ratio - 1) * 100)}% over.`}];
  if (ratio < 0.5) return [{kind: 'LENGTH', where: 'whole chapter', quote: `${words.toLocaleString('en-US')} words`, rule: `The budget for this chapter is about ${target.toLocaleString('en-US')} words; this is well under half.`}];
  return [];
}

/** True when text stops mid-sentence: no closing punctuation, or a quote left open (a reply cut off by the response length). */
export function endsCutOff(text) {
  const t = String(text || '').trim().replace(/[*_~`]+$/, '');
  if (!t) return false;
  const last = t.split(/\n\s*\n/).pop();
  const curlyOpen = (last.match(/“/g) || []).length, curlyClose = (last.match(/”/g) || []).length, straight = (last.match(/"/g) || []).length;
  if (curlyOpen > curlyClose || straight % 2) return true;
  return !/[.!?…”"’')\]—–-]$/.test(t);
}
export function cutOffCheck(text) {
  if (!endsCutOff(text)) return [];
  const tail = String(text).trim().split(/\s+/).slice(-8).join(' ');
  return [{kind: 'CUT OFF', where: 'last line', quote: tail, rule: 'The chapter stops mid-sentence — the narrator’s reply was probably cut off by the response length. Press Continue in the chat (or raise Max Response Length) before revising or sealing.'}];
}

/** hard = contradicts the book (canon, POV, tense, names); soft = taste. */
export const SEVERITY = Object.freeze({TENSE: 'hard', POV: 'hard', UNLISTED: 'hard', NAME: 'hard', REPEAT: 'soft', STOCK: 'soft', LENGTH: 'soft', 'CUT OFF': 'hard'});
/** All exact checks. `book` = {tense, pov, knownNames, castNames, targetWords, stock}. */
export function exactLint(text, book = {}) {
  const paras = paragraphs(text);
  return [
    ...povSlips(paras, book.pov), ...tenseSlips(paras, book.tense),
    ...unknownNames(paras, book.knownNames || []), ...nameDrift(paras, book.castNames || []),
    ...repetition(paras), ...stockPhrases(paras, book.stock || STOCK_PHRASES), ...lengthCheck(text, book.targetWords), ...cutOffCheck(text),
  ].map(f => ({...f, severity: SEVERITY[f.kind] || 'soft'}));
}

export const LINT_KINDS = Object.freeze(['GRAMMAR', 'CHARACTER', 'VOICE', 'CHAPTER ORDER', 'TIMELINE', 'PERIOD', 'RULE', 'CONTINUITY', 'PLAN']);
/** The chapter with line numbers, matching the exact checks' line numbers. */
export const numbered = text => paragraphs(text).map(p => `${p.n}| ${p.text}`).join('\n');
/** Ask the model to check the chapter against the book's facts. */
export function lintInstruction({unit = 'Chapter', number = 1, chapterText = '', facts = '', chapterNote = ''}) {
  return `Check ${unit} ${number} below against the book's own facts and rules. Report problems; do not rewrite, do not praise.
Check for exactly these kinds of problem:
- GRAMMAR: spelling, punctuation, grammar, agreement, missing or doubled words in the narration (not deliberate voice in dialogue or in a narrator whose voice is meant to be rough).
- CHARACTER: someone acts against their established personality, wants or history.
- VOICE: someone's dialogue does not sound like the VOICE AND MANNERISMS in their profile.
- CHAPTER ORDER: events, reveals or knowledge that the outline puts in a different ${unit.toLowerCase()} (later or earlier).
- TIMELINE: times, days, durations or order of events that do not fit the timeline or this ${unit.toLowerCase()}'s place in it.
- PERIOD: things that do not exist or fit in the story's time and setting (technology, money, slang, brands, customs).
- RULE: anything the writer said the story must or must never do.
- CONTINUITY: anything that contradicts a sealed note's MUST NOT DRIFT or another established fact.
- PLAN: what the outline plans for THIS ${unit.toLowerCase()} that the text has not done yet — each planned event or turn that hasn't happened, and whether the text reaches the ${unit.toLowerCase()}'s planned ending. For these there is no line to quote: quote the planned event from the outline instead and leave out the line number, e.g. - [PLAN] [hard] "<the planned event, quoted from the outline>" — planned for this ${unit.toLowerCase()}, hasn't happened yet (the outline). Use hard for a missing event, soft for an ending that is close but not reached. If everything planned has happened, write no PLAN lines.
Each line of the chapter is numbered ("12| …"). Write one line per problem, exactly like this:
- [KIND] [hard|soft] line N: "exact quote from that line, under 20 words" — what it breaks, naming the source (e.g. Ben's profile, the outline for Chapter 3, the writer's rule, the Chapter 1 seal)
Mark it hard if it contradicts canon (the book's facts, the outline, a seal, the writer's rules), soft if it is a matter of taste.
Quote exactly — no paraphrasing. Measure, don't rewrite: no replacement sentences, at most one short clause of fix.
Only real problems you can quote. After the findings, write one line: BIGGEST PROBLEM: the single biggest problem in the chapter (or "none"). If there are no problems, write exactly: No problems found.

${chapterNote ? `FOR THIS ${unit.toUpperCase()} ONLY (the writer's instruction; it overrides the book-wide voice rules where they differ):\n${chapterNote}\n\n` : ''}THE BOOK'S FACTS
${facts}

${unit.toUpperCase()} ${number} TEXT
${numbered(chapterText)}`;
}
/** Read the model's findings back; unknown kinds and unquoted lines are dropped. */
export function parseFindings(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*[-*•]?\s*\[([A-Z ]+)\]\s*(?:\[?(hard|soft)\]?\s*[:,-]?\s*)?(?:line\s*(\d+)\s*:?\s*)?[“"](.+?)[”"]\s*[—–-]+\s*(.+)$/i);
    if (m && LINT_KINDS.includes(m[1].trim())) out.push({kind: m[1].trim(), severity: (m[2] || 'hard').toLowerCase(), where: m[3] ? `line ${m[3]}` : '', quote: m[4].trim(), rule: m[5].trim()});
  }
  return out;
}

export const biggestProblem = text => (String(text || '').match(/^\s*BIGGEST PROBLEM\s*:\s*(.+)$/mi) || [])[1]?.trim() || '';
export const ALL_BUCKETS = Object.freeze([...LINT_KINDS, 'UNLISTED', 'NAME', 'POV', 'TENSE', 'REPEAT', 'STOCK', 'LENGTH']);
/** Counts line: every bucket, then the hard total. */
export function countsLine(findings) {
  const c = k => findings.filter(f => f.kind === k).length;
  return `${ALL_BUCKETS.map(k => `${k} ${c(k)}`).join(' / ')}, hard ${findings.filter(f => f.severity === 'hard').length}`;
}

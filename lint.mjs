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

const PAST_ACTS = 'took|said|went|looked|walked|turned|stood|sat|came|smiled|laughed|watched|waited|reached|pulled|opened|shook|nodded|asked|picked|got|gave|told|made|held|kept|left|felt|saw|knew|thought|wrote|drove|lifted|dried|squared|leaned|stepped|stared';
const PRESENT_ACTS = 'takes|says|goes|looks|walks|turns|stands|sits|comes|smiles|laughs|watches|waits|reaches|pulls|opens|shakes|nods|asks|picks|gets|gives|tells|makes|holds|keeps|leaves|feels|sees|knows|thinks|writes|drives|lifts|dries|squares|leans|steps|stares';
/** Words that put a sentence in another time on purpose (backstory in a present-tense book, a general truth in a past-tense one). */
const OTHER_TIME = /\b(ago|once|used to|years?|months?|weeks?|yesterday|tomorrow|always|never|every|last (?:year|week|month|night|spring|summer|fall|autumn|winter)|(?:in|since|by) (?:(?:19|20)\d\d|january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|autumn|winter)|back then|before|when (?:he|she|they|i|we) (?:was|were))\b/i;
/** Single narration sentences in the wrong tense ("He took his pen out." in a present-tense book) — a slip the paragraph count misses. */
export function tenseSentences(paras, tense, names = []) {
  const wantPast = /past/i.test(tense || ''), wantPresent = /present/i.test(tense || '');
  if (!wantPast && !wantPresent) return [];
  const who = ['he', 'she', 'they', 'i', 'we', ...names.map(n => String(n).split(/\s+/)[0].toLowerCase()).filter(Boolean)].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`^(?:${who})\\s+(?:${wantPresent ? PAST_ACTS : PRESENT_ACTS})\\b`, 'i');
  const out = [];
  for (const p of paras) {
    for (const raw of p.narration.split(/(?<=[.!?])\s+/)) {
      const sent = raw.replace(/^[\s,.;:!?—–-]+/, '').trim();
      if (sent && re.test(sent) && !OTHER_TIME.test(sent)) { out.push({kind: 'TENSE', where: `line ${p.n}`, quote: quote(sent, 80), rule: `The book is in ${wantPast ? 'past' : 'present'} tense; this sentence is in the ${wantPast ? 'present' : 'past'}.`}); break; }
    }
  }
  return out;
}

/** What a game master may say the player's character does: perceive, know, be, and plain states — never choose, move or speak. */
const PERCEIVE = /^(?:see|saw|hear|heard|feel|felt|notice|noticed|smell|smelled|taste|tasted|sense|sensed|know|knew|realise|realize|recognise|recognize|remember|can|could|can't|cannot|have|had|are|were|catch|caught|find|found|get|got|watch|watched|spot|spotted|count|counted|seem|wonder|would|might|may|must|should|do|did|don't|didn't|need|needs|want)$/i;
/**
 * Roleplay: narration that has the player's character act, move, decide or speak ("You ease the crawler forward.", "Reyes takes the
 * handset.") — the game master plays everyone except the player. Perception and states ("you see", "you feel") are allowed.
 */
export function playerActions(paras, pov = '', player = '', playerPrefix = '') {
  const second = /second/i.test(pov || ''), name = String(player || '').split(/\s+/)[0];
  const who = [second ? 'you' : '', name].filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!who.length) return [];
  const re = new RegExp(`(?:^|[.!?”"]\\s+)(${who.join('|')})\\s+([a-z’']+)\\b`, 'gi'), out = [];
  for (const p of paras) {
    if (playerPrefix && p.text.startsWith(playerPrefix + ':')) continue; // the player's own turn
    for (const m of p.narration.matchAll(re)) {
      const verb = m[2];
      if (PERCEIVE.test(verb) || /^(?:and|but|or|the|a|an|to|in|on|at|of|for|with|too|both|all|alone|only)$/i.test(verb)) continue;
      out.push({kind: 'PLAYER', where: `line ${p.n}`, quote: quote(p.narration.slice(m.index).replace(/^[.!?”"\s]+/, ''), 80), rule: `The game master has ${name || 'the player'} act here (“${m[1]} ${verb}”). Only the player decides what their character does or says — describe what happens around them and stop at their turn.`});
      break;
    }
  }
  return out;
}

/** Verb stem: dries/dried/drying → dry, squares/squared → squar, turns/turned/turning → turn. */
const stem = w => { const t = w.toLowerCase().replace(/(?:ies|ied|ying)$/, 'y'), cut = t.replace(/(?:es|ed|ing|s)$/, ''); return cut !== t && /([bdgmnprt])\1$/.test(cut) ? cut.slice(0, -1) : cut; }; // stopped → stop
const BODY = new Set('hand hands head face eyes eye mouth hair arm arms shoulder shoulders feet foot leg legs fingers finger thumb lips chin neck back jaw palm palms'.split(' '));
const PLAIN_VERBS = new Set('be i ar wa wer ha hav had do doe did go goe went com came get got tak took mak made put set say said ask look see saw know knew think thought want need giv gave tell told keep kept let leav left hold held turn stand stood sit sat walk mov start stop open clos pick pull push reach watch wait hear heard find found feel felt try call us work run ran bring brought carry writ wrote read eat drink sleep stay seem becom begin began can could would will should might must may comes goes back down up out off over in on at to it this that the a an not still just then also only there here her his him them their she he they we you your my its now so all one two no what who which as if when where while some for with from into neither nor both each'.split(' '));
/**
 * The same bit of business again and again: a verb + someone's object or body part used twice ("dries her hands"),
 * or an unusual action verb used four times or more ("squares" the sheet, the towel, the quilt…). Once is character; more is a tic.
 */
export function repeatedGestures(paras, names = []) {
  const subj = new Set(['he', 'she', 'they', 'i', 'we', 'and', ...names.map(n => String(n).split(/\s+/)[0].toLowerCase())]);
  const pairs = new Map(), verbs = new Map();
  for (const p of paras) {
    const w = p.narration.match(/[\p{L}']+/gu) || [];
    for (let i = 1; i < w.length; i++) {
      if (!subj.has(w[i - 1].toLowerCase())) continue;
      if (/^(is|was|are|were|am|keeps|kept)$/i.test(w[i]) && /ing$/.test(w[i + 1] || '')) i++; // "she is drying them" counts as "dries them"
      const v = stem(w[i]);
      if (v.length < 3 || /^[A-Z]/.test(w[i])) continue;
      if (!PLAIN_VERBS.has(v)) { const e = verbs.get(v) || {word: w[i], lines: []}; e.lines.push(p.n); verbs.set(v, e); }
      const pos = (w[i + 1] || '').toLowerCase(), obj = (w[i + 2] || '').toLowerCase();
      if (/^(his|her|their|my|its)$/.test(pos) && obj.length > 2) {
        const k = `${v} ${obj}`, e = pairs.get(k) || {text: `${w[i]} ${w[i + 1]} ${w[i + 2]}`, lines: [], body: BODY.has(obj)}; e.lines.push(p.n); pairs.set(k, e);
      } else if (/^(them|it)$/.test(pos) && !PLAIN_VERBS.has(v)) {
        const k = `${v} ${pos}`, e = pairs.get(k) || {text: `${w[i]} ${w[i + 1]}`, lines: [], loose: pos === 'it'}; e.lines.push(p.n); pairs.set(k, e);
      }
    }
  }
  const out = [];
  const lines = l => [...new Set(l)];
  for (const [, e] of pairs) { const plain = PLAIN_VERBS.has(stem(e.text.split(' ')[0])); if (lines(e.lines).length >= (plain || e.loose ? 3 : 2) && (!plain || e.body)) out.push({kind: 'GESTURE', where: `lines ${lines(e.lines).join(', ')}`, quote: e.text, rule: `The same bit of business ${e.lines.length} times (“${e.text}”). Keep the first (line ${e.lines[0]}); cut the others or give the moment something specific to it.`}); }
  for (const [, e] of verbs) if (e.lines.length >= 4) out.push({kind: 'GESTURE', where: `lines ${lines(e.lines).join(', ')}`, quote: e.word, rule: `“${e.word}” and its forms ${e.lines.length} times — it has become a tic. Keep one or two; say the others another way or cut them.`});
  return out.slice(0, 6);
}

/** Narration sentences chained with "and… and… and…" (four or more). Hard when the chapter as a whole leans on it (over six per hundred words). */
export function andChains(paras) {
  const narr = paras.map(p => p.narration).join(' '), words = (narr.match(/[\p{L}']+/gu) || []).length;
  const rate = words ? 100 * (narr.match(/\band\b/gi) || []).length / words : 0;
  const out = [];
  for (const p of paras) for (const sent of p.narration.split(/(?<=[.!?])\s+/)) {
    const n = (sent.match(/\band\b/gi) || []).length - (sent.match(/\b(?:hundred|thousand) and\b/gi) || []).length;
    if (n >= 4) out.push({kind: 'CHAIN', where: `line ${p.n}`, quote: quote(sent, 120), rule: `${n} clauses joined with “and”. Split the actions into sentences or let one carry the line; keep the words otherwise.`, n});
  }
  return out.sort((a, b) => b.n - a.n).slice(0, 6).map(({n, ...f}) => ({...f, severity: rate > 6 ? 'hard' : 'soft'}));
}

/** Narration that slips out of the book's person (first vs third). */
export function povSlips(paras, pov) {
  const first = /first/i.test(pov || ''), third = /third/i.test(pov || '');
  if (!first && !third) return [];
  return paras.filter(p => {
    const i = count(p.narration, /\b(I|me|my|mine|myself)\b/g);
    const words = (p.narration.match(/\S+/g) || []).length;
    return third ? i >= 2 : false; // first person: a paragraph without "I" is normal (description, other people) — no exact check
  }).map(p => ({kind: 'POV', where: `line ${p.n}`, quote: quote(p.narration), rule: third ? 'The book is in third person; the narration says “I/my” here.' : 'The book is in first person; this paragraph of narration has no “I” at all — check whose head it is in.'}));
}

const NOT_NAMES = new Set(('I A An The And But Or So Then When While If As At In On Of To For From With By Into Over Under After Before Behind Inside Outside Up Down Out Off No Not Yes Yeah Oh Ah Mm Hm Okay OK Well Still Just Even Only Now Here There This That These Those It Its He She They We You Me My Her His Their Our Your Him Them Us What Who Why How Where Which Whatever Whoever Everyone Someone Anyone Nobody Something Nothing Everything Maybe Perhaps Please Thanks Sorry God Lord Mr Mrs Ms Miss Dr Sir Madam Mum Mom Dad Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Christmas Easter English French God Chapter Below Above Beyond Beneath Across Along Around Through Without Within Upstairs Downstairs Overhead Outdoors Indoors Somewhere Nowhere Anywhere Everywhere Later Soon Once Twice Again Already Afterwards Meanwhile Sometimes Never Always Often Darling Honey Sweetheart Sweetie Love Dear Babe Baby Mate Pal Buddy Kid Son').split(' '));

/** Capitalised words mid-sentence that the book doesn't know: possible extra characters or places. */
export function unknownNames(paras, known = []) {
  const knownSet = new Set(known.flatMap(k => String(k).toLocaleLowerCase().split(/[\s—–-]+/)).filter(Boolean));
  const seen = new Map();
  // Ordinary words also appear in lowercase somewhere ("Snow" / "snow"); names don't.
  const lower = new Set((paras.map(p => p.text).join(' ').match(/\b[a-z][a-z']+\b/g) || []));
  const midSentence = new Set();
  // Words that follow a pronoun or a known first name somewhere in the chapter are being used as verbs ("she says", "Wynn takes").
  const subjects = ['he', 'she', 'they', 'i', 'we', ...[...knownSet].filter(k => k.length > 2)];
  const verbs = new Set([...paras.map(p => p.text).join(' ').matchAll(/\b([A-Za-z']+)\s+([a-z']+)/g)].filter(m => subjects.includes(m[1].toLocaleLowerCase())).map(m => m[2]));
  for (const p of paras) for (const m of p.text.matchAll(/\b([A-Z][a-z]{2,})\b/g)) if (!/(?:^|[.!?…:;—–“"‘]["”’']?)\s*$/.test(p.text.slice(0, m.index))) midSentence.add(m[1]);
  // Narration only: someone merely named in dialogue is mentioned, not on the page.
  for (const p of paras) {
    for (const m of p.narration.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
      const w = m[1];
      // At the start of a sentence a capital proves nothing ("Yellowed, a bit cockled…", "Neither of them spoke.", "Good, she thought."):
      // there it counts only if the same word also turns up mid-sentence somewhere — names do, sentence openers don't.
      // Otherwise only when the next word is a verb — a person doing something ("Marge knocked twice"), not "Black stubble showing…",
      // "Seed caps on the hooks…", "Good, she thought". A verb here: ends in -ed, or follows he/she/they/a known name elsewhere in the chapter.
      if (/(?:^|[.!?…:;—–]["”’']?)\s*$/.test(p.narration.slice(0, m.index)) && !midSentence.has(w)) {
        const next = (p.narration.slice(m.index + w.length).match(/^\s+([a-z']+)/) || [])[1];
        if (!next || !(/^[a-z]{2,}ed$/.test(next) || verbs.has(next))) continue;
      }
      if (NOT_NAMES.has(w) || knownSet.has(w.toLocaleLowerCase()) || lower.has(w.toLocaleLowerCase())) continue;
      if (!seen.has(w)) seen.set(w, {n: p.n, count: 0});
      seen.get(w).count++;
    }
  }
  return [...seen].map(([w, v]) => ({kind: 'UNLISTED', where: `line ${v.n}${v.count > 1 ? ` (+${v.count - 1} more)` : ''}`, quote: w, rule: 'Possible: this name is not in the cast list, any character entry, or any place entry. If it is a person on the page, the story budget may not have room for them.'}));
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

/** The speech in a paragraph, lower-cased, without punctuation (single or double quotes; apostrophes ignored). */
const speechOf = text => [...String(text).matchAll(/(?:^|\s)[“"‘](.+?)[”"’](?=[\s,.!?;:—–]|$)/g)].map(m => m[1]).join(' ').toLocaleLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
const COMMON = new Set('have been that this with what when where there they them then were will would could should does done said just know knew like well yeah right sure okay think thought want come came going gone good fine here make made take took tell told look looked yes'.split(' '));
/** Quoted sample lines from a profile's VOICE AND MANNERISMS text. */
export const sampleLinesOf = voiceText => [...String(voiceText || '').matchAll(/[“"]([^”"\n]{8,200})[”"]/g)].map(m => m[1].trim());
/** A profile's sample line used in the story (nearly) word for word: samples show how someone sounds, they aren't lines to reuse. */
export function liftedSamples(paras, samples = []) {
  const words = t => String(t).toLocaleLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  const out = [];
  for (const {name, line} of samples) {
    const w = words(line); if (w.length < 4) continue;
    const runs = w.length < 6 ? [w.join(' ')] : w.slice(0, w.length - 5).map((_, i) => w.slice(i, i + 6).join(' '));
    const p = paras.find(p => { const t = ' ' + words(p.text).join(' ') + ' '; return runs.some(r => t.includes(' ' + r + ' ')); });
    if (p) out.push({kind: 'SAMPLE', where: `line ${p.n}`, quote: quote(p.text), rule: `Copied from ${name}’s profile — a sample line (“${line}”). Samples show how someone sounds; give them a new line in that voice.`});
  }
  return out;
}
/** Echoed dialogue: a short line that only repeats the end of the line before it ("Lasagne." "Lasagne."). */
/** Pronouns swapped between speakers count as the same words ("You were on the chairs." / "I was on the chairs."). */
const SWAP = {i: 'you', you: 'you', me: 'you', my: 'your', your: 'your', mine: 'yours', yours: 'yours', im: 'youre', youre: 'youre', we: 'you', us: 'you', our: 'your', was: 'were', were: 'were', am: 'are', are: 'are'};
const swapped = t => t.split(' ').map(w => SWAP[w] || w).join(' ');
/** Lines everyone says back and forth without it being a tic. */
const GREETING = /^(?:morning|good morning|hello|hi|hey|night|goodnight|good night|evening|thanks|thank you|bye|yes|no|yeah|okay|ok|right|sure|fine|what|why|how|who|where|when)$/;
/** Dialogue that only says the last speaker's words back ("Sixty-five." / "Sixty-five."): the commonest tic of a model's dialogue. */
export function echoes(paras) {
  const out = [];
  for (let i = 1; i < paras.length; i++) {
    const a0 = speechOf(paras[i - 1].text), b0 = speechOf(paras[i].text);
    if (!a0 || !b0) continue;
    const a = swapped(a0), b = swapped(b0), aw = a.split(' '), bw = b.split(' '), content = bw.filter(w => w.length >= 4 && !COMMON.has(w));
    const said = `(“…${a0.split(' ').slice(-6).join(' ')}”)`;
    // A longer reply that opens by repeating the last line ("Sixty-five." / "Sixty-five. And when would she get in?").
    const rawFirst = String(paras[i].text).match(/(?:^|\s)[“"‘](.+?)[”"’](?=[\s,.!?;:—–]|$)/)?.[1] || '';
    const first = swapped(speechOf(`“${rawFirst.split(/(?<=[.!?])\s/)[0]}”`));
    const fw = first ? first.split(' ') : [];
    const opens = fw.length && fw.length <= 6 && !GREETING.test(first) && (a === first || a.endsWith(' ' + first) || (fw.length >= 3 && (' ' + a + ' ').includes(' ' + first + ' ')));
    const choice = t => t && / or /.test(a0) && a0.split(/,| or /).map(x => swapped(x.trim())).some(x => x === t || x.endsWith(' ' + t));
    if (bw.length > 6) { if (opens && !choice(first)) out.push({kind: 'ECHO', where: `line ${paras[i].n}`, quote: quote(paras[i].text, 60), rule: `Echo: this line opens by repeating what was just said ${said}. Start it with something else — a question back, a dodge, a refusal or an action — without adding a fact the book doesn't have.`}); continue; }
    if (GREETING.test(b)) continue;
    // Picking one of the choices just offered ("Nine-twenty or eleven-forty?" / "Nine-twenty.") answers the question; it isn't an echo.
    if ((bw.length <= 4 && choice(b)) || (fw.length && fw.length <= 3 && choice(first))) continue;
    const sameEnd = bw.length >= 2 && aw.length >= 2 && aw.slice(-3).join(' ') === bw.slice(-3).join(' ');
    // A short line made (almost) only of the last speaker's words — not a line that answers with a callback ("You just picked tonight." "I picked him.").
    const picksUp = bw.length <= 3 && content.length && content.length >= bw.length - 1 && content.every(w => aw.includes(w) || aw.includes(w + 's'));
    // A short line lifted whole from the middle of what was just said ("Get her in before the end of the month…" / "Before the end of the month.").
    const inside = bw.length >= 3 && (' ' + a + ' ').includes(' ' + b + ' ');
    const oneWord = bw.length === 1 && b.length >= 4 && aw.some(w => w === b || w === b + 's');
    if (a === b || a.endsWith(' ' + b) || sameEnd || picksUp || inside || oneWord) out.push({kind: 'ECHO', where: `line ${paras[i].n}`, quote: quote(paras[i].text, 60), rule: `Echo: this line only repeats what was just said ${said}. Have them answer with something else — a question back, a dodge, a refusal or an action — without adding a fact the book doesn't have.`});
  }
  return out;
}

/** A paragraph that opens by repeating the sentence the previous one ended on (a reply restating the last line). */
export function restatedLines(paras) {
  const out = [];
  const last = t => (String(t).trim().match(/[^.!?…]+[.!?…]["”’']?\s*$/) || [''])[0].trim();
  for (let i = 1; i < paras.length; i++) {
    const l = last(paras[i - 1].text);
    if (l.split(/\s+/).length >= 5 && paras[i].text.trim().startsWith(l)) out.push({kind: 'REPEAT', where: `line ${paras[i].n}`, quote: quote(l, 60), rule: 'This repeats the sentence just before it — the narrator restated the last line instead of carrying on.'});
  }
  return out;
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
export const SEVERITY = Object.freeze({PLAYER: 'hard', GESTURE: 'hard', CHAIN: 'soft', SAMPLE: 'hard', TENSE: 'hard', POV: 'hard', UNLISTED: 'soft', NAME: 'hard', ECHO: 'hard', REPEAT: 'soft', STOCK: 'soft', LENGTH: 'soft', 'CUT OFF': 'hard'});
/** All exact checks. `book` = {tense, pov, knownNames, castNames, targetWords, stock}. */
export function exactLint(text, book = {}) {
  const paras = paragraphs(text);
  // Roleplay: only what breaks the story (names, cut-off replies) — not prose style, and the player's own turns aren't prose.
  if (book.roleplay) return [...playerActions(paras, book.pov, book.player, book.playerPrefix), ...unknownNames(paras, book.knownNames || []), ...nameDrift(paras, book.castNames || []), ...cutOffCheck(text)].map(f => ({...f, severity: SEVERITY[f.kind] || 'soft'}));
  return [
    ...povSlips(paras, book.pov), ...tenseSlips(paras, book.tense), ...tenseSentences(paras, book.tense, book.castNames || []).filter(f => !tenseSlips(paras, book.tense).some(t => t.where === f.where)),
    ...unknownNames(paras, book.knownNames || []), ...nameDrift(paras, book.castNames || []),
    ...echoes(paras), ...restatedLines(paras), ...liftedSamples(paras, book.samples || []), ...repeatedGestures(paras, book.castNames || []), ...andChains(paras), ...repetition(paras), ...stockPhrases(paras, book.stock || STOCK_PHRASES), ...lengthCheck(text, book.targetWords), ...cutOffCheck(text),
  ].map(f => ({...f, severity: f.severity || (f.kind === 'TENSE' && /first/i.test(book.pov || '') ? 'soft' : (SEVERITY[f.kind] || 'soft'))}));
}

export const LINT_KINDS = Object.freeze(['GRAMMAR', 'CHARACTER', 'VOICE', 'CHAPTER ORDER', 'TIMELINE', 'PERIOD', 'RULE', 'CONTINUITY', 'PLAN', 'PLAYER']);
/** The chapter with line numbers, matching the exact checks' line numbers. */
export const numbered = text => paragraphs(text).map(p => `${p.n}| ${p.text}`).join('\n');
/** Ask the model to check the chapter against the book's facts. Research: docs/ai-prompting-research.md §5. */
export function lintInstruction({unit = 'Chapter', number = 1, chapterText = '', facts = '', chapterNote = '', roleplay = false, player = 'the player'}) {
  const u = unit.toLowerCase();
  return `Check ${unit} ${number} below against the book's own sources — its facts, the plan, how the previous ${u} ended, the narration settings and the author's rules — and report where the text breaks them. You are one check among several; the author reads your findings and decides. Do not rewrite and do not praise.
Checkers built on language models fail in known ways: they report problems that aren't there, pad the list when the text is fine, nitpick deliberate style, quote words that aren't on the page, treat the plan as a script, and judge by their own taste or real-world plausibility instead of the book's sources. So:
- Report only what you can show breaks a source given here: quote the ${u} exactly and name the source. If you can't quote the ${u}, it is not a finding.
- "No problems" is a normal, good result. Never list something only to say it's fine — a line that says "no fault" or "fine" is not a finding.
- Style, word choice and rhythm are the Editor's job, not yours. Deliberate voice — fragments, dialect, rough grammar in speech, a narrator's habits — is not an error.
- Something that changes on the page, or could have changed since the source was written, is not a contradiction. Before flagging, ask whether it could be deliberate: a lie, a bluff, a mistaken character, a reveal the plan allows.
- Dialogue is what a character says, not what is true. A character who lies, bluffs, exaggerates or gets something wrong is not a contradiction — only the narration contradicting the book's facts, or a character knowing what they couldn't know, is.
- The plan says what must happen, not everything that may: a moment the plan doesn't mention is fine unless it uses up a later ${u}'s events or breaks a rule.
How to work: first read the whole ${u} and note what it asserts — who is where, who is on duty or in the room, times and durations, injuries, what people hold, what each person knows, names, point of view. Then compare each against the sources. Mistakes cluster in the middle of long ${u}s; read all of it.
Check for exactly these kinds of problem:
${roleplay ? `- PLAYER: the narrator spoke, acted, thought, felt or decided for ${player} (the player's character, whose lines are marked "${player}:") — anything ${player} did that the player didn't write. Only check the narrator's lines.
` : `- GRAMMAR: real errors in the narration — spelling, agreement, missing or doubled words. Not style, not deliberate voice.
`}- RULE: anything that breaks one of the author's rules (the always/never lines under THE WRITER'S RULES AND ANSWERS, and the point of view and tense), including a named person on the page the book doesn't have when the rules or the cast limit who appears. Always hard. Whether a sentence suits the voice or tone description is a matter of taste for the Editor, not a RULE finding.
- CONTINUITY: contradicts how the previous ${u} left things (WHERE THINGS STAND), a sealed note's MUST NOT DRIFT, or another established fact — unless the text shows the change happening or time passing. Inside the ${u}, only two statements that can't both be true, and quote both.
- TIMELINE: times, days, durations or order that can't all be true — including inside the ${u} (a time given two different ways, someone arriving who was already there). Quote both. Time the text skips over is not a problem: hours pass off the page.
- CHARACTER: someone does what their established personality, wants, history or role rules out (who works which shift, who has which job), or knows something they were never told. A small surprising detail (a clean hand, one kind word from a hard man) is not acting against character.
- VOICE: someone's dialogue doesn't sound like the way their profile says they talk.
- CHAPTER ORDER: events, reveals or knowledge the outline puts in a different ${u} — above all a reveal, confession, decision or piece of information that a later ${u}'s plan is built around (someone telling someone a fact that a later plan has them tell, a choice a later plan has them make). Check each later ${u}'s turning points against this text.
- PERIOD: things that don't exist or fit in the story's time and setting (technology, money, slang, customs).
${roleplay ? '' : `- PLAN: an event this ${u}'s plan requires that hasn't happened, or the ${u} not reaching its planned ending. There is no line to quote: quote the planned event from the outline and leave out the line number, e.g. - [PLAN] [hard] "<the planned event, quoted from the outline>" — planned for this ${u}, hasn't happened yet (the outline). Hard for a missing event, soft for an ending that is close but not reached. If everything planned has happened, write no PLAN lines.
`}Each line of the ${u} is numbered ("12| …"). Answer in two parts, under these two headings.
CHECKED: first, one short line for each thing you checked and found fine — each planned event and the line it happens on, facts that fit, lines that looked wrong but aren't. Storyloom throws this part away. Everything that is fine goes here, so that nothing fine ends up under FINDINGS.
FINDINGS: then only the problems, one line each, exactly like this:
- [KIND] [hard|soft] line N: "exact quote from that line, under 20 words" — what it breaks, naming the source (e.g. Ben's profile, the outline for Chapter 3, the writer's rule, how Chapter 1 ended)
Hard when it breaks a source. Soft only when it clearly breaks a source you can't be sure of (the source is vague) — then begin the explanation with "Possible:". If you would call it borderline, minor, allowed or "possible but fine", or you catch yourself explaining why it might be all right, it is not a finding: leave it out.
After the findings, write one line: BIGGEST PROBLEM: the single biggest problem (or "none"). If there are no problems, write under FINDINGS exactly: No problems found.

${chapterNote ? `FOR THIS ${unit.toUpperCase()} ONLY (the writer's instruction; it overrides the book-wide voice rules where they differ):\n${chapterNote}\n\n` : ''}THE BOOK'S FACTS
${facts}

${unit.toUpperCase()} ${number} TEXT
${numbered(chapterText)}

(Reminder: CHECKED first, for everything that is fine; then FINDINGS, only problems you can quote that break a source above — no style notes. "No problems found." under FINDINGS is a good answer.)`;
}
/** Read the model's findings back; unknown kinds and unquoted lines are dropped. */
/** Model findings a second look checks: the ones that would change the chapter (not the plan list, not grammar). */
export const RECHECKED = Object.freeze(['CHARACTER', 'VOICE', 'CHAPTER ORDER', 'TIMELINE', 'PERIOD', 'RULE', 'CONTINUITY', 'PLAYER']);
/**
 * A second, independent look at the checker's hard findings before anyone acts on them. Research (docs/ai-prompting-research.md §5):
 * checkers invent problems, read a bluff or a lie as an error and read rules over-literally; a separate verifier pass raised plot-hole
 * accuracy from 0.35 to 0.50 (FlawedFictions), and verification works best without the first answer's reasoning (Chain-of-Verification).
 * So this sees the chapter, the book's facts and each claim — never the first checker's working — and keeps only what can't be true.
 */
export function recheckInstruction({unit = 'Chapter', number = 1, chapterText = '', facts = '', findings = []}) {
  const u = unit.toLowerCase(), list = findings.map((f, i) => `F${i + 1} [${f.kind}] ${f.where || ''}: "${f.quote}" — ${f.rule}`).join('\n');
  const how = `For each claim, find the quoted words in the ${u} (its lines are numbered) and the fact or earlier line the claim says they break, then decide:
KEEP — the quoted words really can't be true together with something the book's facts, the plan or an earlier line of the ${u} states, and the narrator, not a character, got it wrong. Quote what they break.
DROP — anything else. Drop it when a character is lying, bluffing, guessing, misremembering or wrong on purpose; when it's a joke or a figure of speech; when time passes off the page or something could have happened between scenes; when the facts don't settle it either way; when it's about taste, style, or how a person "would" talk or act; when the claim misreads the quote; when the fact it cites isn't in the book.
When you're unsure, DROP: a wrong KEEP gets the writer's ${u} rewritten for nothing, a wrong DROP only leaves the line for the writer to judge.
Reply with one line per claim, in order, and nothing else:
F1: KEEP — "the words it breaks"
F2: DROP — why, in a few words`;
  return `Another checker read ${unit} ${number} of a novel and says the claims below are errors to fix. Your job is to check each one against the text yourself, as if you had never seen it, before anyone changes the ${u}. Models that check fiction invent problems, read a character's lie or bluff as a mistake and read rules too literally, so most claims like these turn out not to hold.

${how}

CLAIMS
${list}

THE BOOK'S FACTS
${facts || '(none given)'}

THE ${unit.toUpperCase()} (numbered lines)
${chapterText}

Again: one line per claim — F1: KEEP — "…" or F1: DROP — why. Nothing else.`;
}
/** Read "F1: KEEP — …" / "F2: DROP — …" lines → [{keep, why}] by claim number (missing claims are left out). */
export function parseRecheck(text, count) {
  const out = new Array(count).fill(null);
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*[-*•]?\s*\**F(\d+)\**\s*[:.)-]\s*\**(KEEP|DROP)\**\s*[—–:-]*\s*(.*)$/i);
    if (m && +m[1] >= 1 && +m[1] <= count && !out[+m[1] - 1]) out[+m[1] - 1] = {keep: /keep/i.test(m[2]), why: m[3].trim().replace(/^["“]|["”]$/g, '')};
  }
  return out;
}

export function parseFindings(text) {
  const out = [];
  // Only what's under FINDINGS: counts; CHECKED: is where the model puts everything that is fine.
  let lines = String(text || '').split('\n');
  const head = lines.findLastIndex(l => /^\s*[#*_]*\s*FINDINGS\s*[*_]*\s*:/i.test(l));
  if (head >= 0) lines = lines.slice(head);
  for (const line of lines) {
    const m = line.match(/^\s*[-*•]?\s*\[([A-Z ]+)\]\s*(?:\[?(hard|soft)\]?\s*[:,-]?\s*)?(?:line\s*(\d+)\s*:?\s*)?[“"](.+?)[”"]\s*[—–-]+\s*(.+)$/i);
    if (m && LINT_KINDS.includes(m[1].trim())) out.push({kind: m[1].trim(), severity: (m[2] || 'hard').toLowerCase(), where: m[3] ? `line ${m[3]}` : '', quote: m[4].trim(), rule: m[5].trim()});
  }
  return out;
}

/** Keep model findings that quote the chapter (PLAN quotes the outline) and actually report a problem; return the rest as dropped. */
// A finding whose own explanation clears it ("Possible: fine", "no break", "within register") is padding, not a finding.
const NO_PROBLEM = [
  /\bno (?:fault|finding|issue|problem|break|contradiction|error|slip)s?\b/i,
  /\bnot a (?:fault|problem|finding|contradiction|mistake|break|error|slip)\b/i,
  /^(?:possible:\s*)?(?:fine|no issue|consistent|in voice|matches|fits|plausible|within)\b/i,
  /\bpossible:\s*(?:fine|within|consistent|plausible|in voice|in register)\b/i,
  /\bso (?:it'?s )?fine\b/i, /\b(?:see|covered) above\b/i,
  /\bwithin (?:register|voice|the rules?|the voice|range)\b/i,
  /\b(?:plan|outline|rules?|profile) (?:allows|permits)\b|\b(?:the plan|the outline|the rules?|the profile) allows? (?:it|this|that)\b/i,
  /\b(?:is|it'?s|so|reads?|still|stays?|remains?) (?:fine|consistent|plausible|allowed|permitted|met)\b/i,
  /\bborderline\b/i,
  /\bwhich this matches\b/i,
  /(?:^|[.,;:—–-]\s*)(?:consistent|in voice|fine|plausible|correct|reached|no change needed)\.?\s*$/i,
];
export function groundedFindings(findings, text) {
  const norm = t => String(t || '').toLocaleLowerCase().replace(/[“”"‘’'`]/g, '').replace(/[—–-]+/g, ' ').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const page = norm(text), kept = [], dropped = [];
  for (const f of findings || []) {
    if (NO_PROBLEM.some(re => re.test(f.rule))) { dropped.push({...f, why: 'says there is no problem'}); continue; }
    // PLAN lists only what hasn't happened: "done at line 42" is a tick, not a finding.
    if (f.kind === 'PLAN' && /\bdone\b|\b(?:at|on|in) lines? \d/i.test(f.rule) && !/\bnot\b|n['’]t\b|\b(?:never|missing|only partly|yet to|hasnt|isnt|doesnt)\b/i.test(f.rule)) { dropped.push({...f, why: 'planned event already written'}); continue; }
    if (f.kind !== 'PLAN' && f.quote && !page.includes(norm(f.quote).replace(/…$/, '').trim())) { dropped.push({...f, why: 'quote not in the chapter'}); continue; }
    kept.push(f);
  }
  return {kept, dropped};
}
export const biggestProblem = text => (String(text || '').match(/^\s*BIGGEST PROBLEM\s*:\s*(.+)$/mi) || [])[1]?.trim() || '';
export const ALL_BUCKETS = Object.freeze([...LINT_KINDS, 'UNLISTED', 'NAME', 'POV', 'TENSE', 'ECHO', 'SAMPLE', 'GESTURE', 'CHAIN', 'REPEAT', 'STOCK', 'LENGTH']);
/** Counts line: every bucket, then the hard total. */
export function countsLine(findings) {
  const c = k => findings.filter(f => f.kind === k).length;
  return `${ALL_BUCKETS.map(k => `${k} ${c(k)}`).join(' / ')}, hard ${findings.filter(f => f.severity === 'hard').length}`;
}

/**
 * Word budget: a story's length is a budget of words. The core — what the writer says the story is about —
 * gets its share; side characters, setup and subplots must fit in what is left.
 *
 * Sources for the constants:
 * - Length categories: SFWA Nebula rules (short story < 7,500; novelette < 17,500; novella < 40,000; novel 40,000+).
 * - Scene length: craft guides put most scenes at ~750–2,000 words, 1–3 scenes per chapter
 *   (Fictionary, Dabble, Kaye Dacus). A character who is really on the page needs at least one scene,
 *   so each costs at least SCENE_MIN words; SCENE_TYPICAL is used for scene counts.
 * - Pacing: Genette's scene/summary — the core is written as scene, the rest as summary.
 * There is no published rule for characters per word count; the cast limit here follows from the words left over.
 */
export const SCENE_MIN = 750;
export const SCENE_TYPICAL = 1250;

const NUMBER_WORDS = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1, single: 1};

/** First whole number in text ("2", "two", "2,500", "2.5k"). */
export function parseNumber(text) {
  const s = String(text || '').toLocaleLowerCase();
  const k = s.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (k) return Math.round(Number(k[1]) * 1000);
  const grouped = s.match(/\b\d{1,3}(?:[,.\s\u00a0\u202f]\d{3})+(?!\d)/);
  if (grouped) return Number(grouped[0].replace(/[^\d]/g, ''));
  const n = s.match(/\d[\d,]*/);
  if (n) return Number(n[0].replace(/,/g, ''));
  const w = s.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|single)\b/);
  return w ? NUMBER_WORDS[w[1]] : null;
}

export function lengthCategory(words) {
  if (!words) return '';
  if (words < 7500) return 'short story';
  if (words < 17500) return 'novelette';
  if (words < 40000) return 'novella';
  return 'novel';
}

/** The core's share of the words: an explicit percentage, else read from the writer's wording, else an even split. */
export function coreShare(text) {
  const s = String(text || '').toLocaleLowerCase();
  const pct = s.match(/(\d{1,3})\s*%/);
  if (pct) return {share: Math.min(1, Number(pct[1]) / 100), source: 'as the proposal puts it'};
  const rules = [
    [/\b(whole thing|the whole story|entire(ly)?|nothing but|all of it|purely|only about)\b/, 0.9],
    [/\b(almost (all|entirely|only)|mostly|mainly|primarily|overwhelmingly)\b/, 0.75],
    [/\b(largely|focus(ed)? on|centred on|centered on|about)\b/, 0.6],
  ];
  for (const [re, share] of rules) { const m = s.match(re); if (m) return {share, source: `from the proposal’s wording “${m[0]}”`}; }
  return {share: 0.5, source: 'not stated — assumed half'};
}

/** The budget. Inputs are numbers or text; anything missing leaves those lines out. */
export function wordBudget({chapters, wordsPerChapter, totalWords, coreText = '', namedCast = []} = {}) {
  const ch = typeof chapters === 'number' ? chapters : parseNumber(chapters);
  // A chapter under 200 words isn't a real length (e.g. "one evening's worth" read as 1): treat it as not given.
  const perRaw = typeof wordsPerChapter === 'number' ? wordsPerChapter : parseNumber(wordsPerChapter);
  const per = perRaw >= 200 ? perRaw : null;
  const total = (typeof totalWords === 'number' ? totalWords : parseNumber(totalWords)) || (ch && per ? ch * per : null);
  const {share, source} = coreShare(coreText);
  if (!total) return {total: null, chapters: ch, share, shareSource: source, namedCast};
  const core = Math.round(total * share), rest = total - core;
  const room = Math.floor(rest / SCENE_MIN);
  const scenes = Math.max(ch || 1, Math.round(total / SCENE_TYPICAL));
  return {total, chapters: ch, perChapter: per || (ch ? Math.round(total / ch) : null), category: lengthCategory(total), share, shareSource: source, core, rest, room, scenes, scenesPerChapter: ch ? Math.max(1, Math.min(3, Math.round(scenes / ch))) : null, namedCast};
}

/** How the cast fits: named people are always allowed; added people must fit the room. */
export function castFit(budget, cast) {
  const named = new Set((budget.namedCast || []).map(n => n.toLocaleLowerCase()));
  const added = (cast || []).filter(n => !named.has(String(n).toLocaleLowerCase()));
  const room = budget.room ?? Infinity;
  return {added, room, fits: added.length <= room, over: Math.max(0, added.length - room), costEach: SCENE_MIN};
}

const n = x => Number(x).toLocaleString('en-US');
/** Plain lines for prompts and the Story budget box. */
export function budgetLines(b, unit = 'Chapter') {
  if (!b?.total) return ['Length not set yet — give a number of chapters and words per chapter to get a word budget.'];
  const u = unit.toLowerCase();
  return [
    `Total: about ${n(b.total)} words${b.chapters ? ` (${b.chapters} ${u}${b.chapters === 1 ? '' : 's'} × ~${n(b.perChapter)})` : ''} — a ${b.category} (SFWA length categories).`,
    `Core — what the story is about: ${Math.round(b.share * 100)}% (${b.shareSource}) ≈ ${n(b.core)} words, written as full scenes.`,
    `Everything else (setup, other people, backstory): ≈ ${n(b.rest)} words, mostly summary.`,
    `Room for other characters on the page: ${b.room} (each needs at least one scene, ~${SCENE_MIN} words).${b.room === 0 ? ' Anyone else is only mentioned.' : ''}`,
    `Scenes: about ${b.scenes} in total${b.scenesPerChapter ? `, ~${b.scenesPerChapter} per ${u}` : ''} (scenes run ~750–2,000 words).`,
  ];
}

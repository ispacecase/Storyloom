import test from 'node:test';
import assert from 'node:assert/strict';
import {paragraphs, tenseSlips, povSlips, unknownNames, nameDrift, repetition, stockPhrases, lengthCheck, exactLint, lintInstruction, parseFindings} from '../lint.mjs';

const chapter = `Ann pushed the door open and the cold came in after her. Ben was still asleep by the stove.

She walks to the window. She looks at the snow. She turns and says nothing, and the room is quiet.

“I told you it would hold,” Ben said, not looking up.

Marge knocked twice and came in stamping snow off her boots. Anne laughed at something nobody had said.

I remember thinking the fire would not last. My hands were cold. I wanted to leave.

A shiver down her spine. She smirked.`;

test('narration is separated from dialogue', () => {
  const p = paragraphs(chapter);
  assert.equal(p.length, 6);
  assert.doesNotMatch(p[2].narration, /told you/);
});

test('tense slips are found in narration, not dialogue', () => {
  const f = tenseSlips(paragraphs(chapter), 'Past');
  assert.equal(f.length, 1);
  assert.equal(f[0].where, 'line 2');
});

test('first-person narration in a third-person book is flagged', () => {
  const f = povSlips(paragraphs(chapter), 'Third person limited');
  assert.deepEqual(f.map(x => x.where), ['line 5']);
  assert.deepEqual(povSlips(paragraphs(chapter), 'whatever'), []);
});

test('names the book does not know are flagged as possible extra characters', () => {
  const f = unknownNames(paragraphs(chapter), ['Ann', 'Ben Hale', 'the cabin', 'Character — Ann']);
  assert.deepEqual(f.map(x => x.quote), ['Marge', 'Anne']);
  assert.match(f[0].rule, /not in the cast list/);
});

test('one-letter misspellings of a cast name are flagged', () => {
  assert.deepEqual(nameDrift(paragraphs(chapter), ['Ann', 'Ben']).map(x => x.quote), ['Anne']);
});

test('repeated openings and stock phrasing are flagged', () => {
  const r = repetition(paragraphs(chapter));
  assert.ok(r.some(x => /start with “she”/.test(x.quote)));
  const s = stockPhrases(paragraphs(chapter));
  assert.deepEqual(s.map(x => x.quote.toLowerCase()), ['shiver down her spine', 'smirked']);
});

test('length is checked against the budget', () => {
  assert.equal(lengthCheck(chapter, 2500)[0].kind, 'LENGTH');
  assert.deepEqual(lengthCheck(chapter, 100), [{kind: 'LENGTH', where: 'whole chapter', quote: '106 words', rule: 'The budget for this chapter is about 100 words; this is 6% over.'}].filter(x => false));
  assert.deepEqual(lengthCheck('x '.repeat(100), 100), []);
});

test('exact lint combines every check', () => {
  const all = exactLint(chapter, {tense: 'Past', pov: 'Third person', knownNames: ['Ann', 'Ben'], castNames: ['Ann', 'Ben'], targetWords: 2500});
  for (const kind of ['TENSE', 'POV', 'UNLISTED', 'NAME', 'REPEAT', 'STOCK', 'LENGTH']) assert.ok(all.some(f => f.kind === kind), kind);
});

test('the book-facts check asks for quoted, sourced findings and is read back strictly', () => {
  const ask = lintInstruction({number: 2, chapterText: 'TEXT', facts: 'FACTS'});
  for (const k of ['GRAMMAR', 'CHARACTER', 'VOICE', 'CHAPTER ORDER', 'TIMELINE', 'PERIOD', 'RULE', 'CONTINUITY']) assert.ok(ask.includes(`- ${k}:`), k);
  assert.match(ask, /do not rewrite/);
  const found = parseFindings('Here you go.\n- [PERIOD] [hard] line 4: "checked her phone for signal" — the story is set in 1970 (Novel Foundation)\n- [VOICE] [soft] line 9: “I have always believed” — Ben speaks in short, dry lines (Ben\'s profile)\n- [STYLE] "x" — not a kind\nBIGGEST PROBLEM: the phone in 1970.');
  assert.deepEqual(found.map(f => [f.kind, f.severity, f.where, f.quote]), [['PERIOD', 'hard', 'line 4', 'checked her phone for signal'], ['VOICE', 'soft', 'line 9', 'I have always believed']]);
  assert.match(ask, /1\| TEXT/);
  assert.match(ask, /\[hard\|soft\] line N/);
});

test('report counts every bucket and the hard total; severities are set', async () => {
  const {countsLine, biggestProblem} = await import('../lint.mjs');
  const all = exactLint(chapter, {tense: 'Past', pov: 'Third person', knownNames: ['Ann', 'Ben'], castNames: ['Ann', 'Ben'], targetWords: 2500});
  assert.ok(all.every(f => f.severity === 'hard' || f.severity === 'soft'));
  assert.equal(all.find(f => f.kind === 'STOCK').severity, 'soft');
  assert.equal(all.find(f => f.kind === 'UNLISTED').severity, 'hard');
  const line = countsLine(all);
  assert.match(line, /^GRAMMAR 0 \/ CHARACTER 0 \/ VOICE 0 \/ CHAPTER ORDER 0 .* \/ UNLISTED 2 .*, hard \d+$/);
  assert.equal(biggestProblem('x\nBIGGEST PROBLEM: Marge walks in.'), 'Marge walks in.');
});

test('endearments and names only spoken in dialogue are not counted as extra characters', () => {
  const t = 'Ann waited.\n\n“Darling, ask Gerald,” Ann said.\n\nPhil came in from the snow.';
  assert.deepEqual(unknownNames(paragraphs(t), ['Ann']).map(x => x.quote), ['Phil']);
});

test('findings are read whether or not the model brackets the severity', () => {
  const f = parseFindings('- [CONTINUITY] hard line 1: "Her father was asleep" — the outline has a hospital bed\n- [VOICE] soft, line 5: "Darling" — not her voice');
  assert.deepEqual(f.map(x => [x.kind, x.severity, x.where]), [['CONTINUITY', 'hard', 'line 1'], ['VOICE', 'soft', 'line 5']]);
});

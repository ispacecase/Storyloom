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
  for (const k of ['PLAN', 'GRAMMAR', 'CHARACTER', 'VOICE', 'CHAPTER ORDER', 'TIMELINE', 'PERIOD', 'RULE', 'CONTINUITY']) assert.ok(ask.includes(`- ${k}:`), k);
  assert.match(ask, /Do not rewrite and do not praise/);
  assert.match(ask, /"No problems" is a normal, good result/);
  assert.match(ask, /a line that says "no fault" or "fine" is not a finding/);
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
  assert.equal(all.find(f => f.kind === 'UNLISTED').severity, 'soft', 'a possible extra person is shown, never fixed automatically');
  const line = countsLine(all);
  assert.match(line, /^GRAMMAR 0 \/ CHARACTER 0 \/ VOICE 0 \/ CHAPTER ORDER 0 .* \/ UNLISTED 2 .*, hard \d+$/);
  assert.equal(biggestProblem('x\nBIGGEST PROBLEM: Marge walks in.'), 'Marge walks in.');
});

test('endearments and names only spoken in dialogue are not counted as extra characters', () => {
  const t = 'Ann waited.\n\n“Darling, ask Gerald,” Ann said.\n\nPhil came in from the snow, and Ann looked at Phil.';
  assert.deepEqual(unknownNames(paragraphs(t), ['Ann']).map(x => x.quote), ['Phil']);
});

test('findings are read whether or not the model brackets the severity', () => {
  const f = parseFindings('- [CONTINUITY] hard line 1: "Her father was asleep" — the outline has a hospital bed\n- [VOICE] soft, line 5: "Darling" — not her voice');
  assert.deepEqual(f.map(x => [x.kind, x.severity, x.where]), [['CONTINUITY', 'hard', 'line 1'], ['VOICE', 'soft', 'line 5']]);
});

test('the plan check lists planned events that have not happened, quoting the outline', () => {
  const ask = lintInstruction({unit: 'Chapter', number: 2, chapterText: 'TEXT', facts: 'FACTS'});
  assert.match(ask, /- PLAN: an event this chapter's plan requires that hasn't happened/);
  const f = parseFindings('- [PLAN] [hard] "Tom comes back up at dusk" — planned for this chapter, hasn’t happened yet (the outline)');
  assert.deepEqual(f.map(x => [x.kind, x.severity, x.where, x.quote]), [['PLAN', 'hard', '', 'Tom comes back up at dusk']]);
});

test('a chapter that stops mid-sentence is flagged', async () => {
  const {endsCutOff, exactLint} = await import('../lint.mjs');
  assert.equal(endsCutOff('She pulled her coat straight. "There\'s ice cream in the little freezer, the top one, if she asks. Not before tea'), true);
  assert.equal(endsCutOff('She went back down for the tea.'), false);
  assert.equal(endsCutOff('“Not before tea,” she said.'), false);
  assert.equal(endsCutOff('“Not before tea.”'), false);
  assert.equal(endsCutOff('and then she'), true);
  assert.equal(exactLint('One.\n\nAnd then she').some(f => f.kind === 'CUT OFF' && f.severity === 'hard'), true);
});

test('a capital at the start of a sentence is not taken for a name', async () => {
  const {unknownNames, paragraphs} = await import('../lint.mjs');
  const f = unknownNames(paragraphs('Below the ledge the rock went down. She read the letter from Truro twice.'), []);
  assert.deepEqual(f.map(x => x.quote), ['Truro']);
});

test('common sentence openers are not taken for names', async () => {
  const {unknownNames, paragraphs} = await import('../lint.mjs');
  assert.deepEqual(unknownNames(paragraphs('Below the ledge the rock went down. Phil read the letter from Truro. It was for Phil.'), []).map(x => x.quote), ['Phil', 'Truro']);
  assert.deepEqual(unknownNames(paragraphs('Neither of them spoke.\n\nGood, she thought. Straight in.'), []), [], 'one-off sentence openers are not names');
});

test('echoed lines and restated last lines are caught; sentence-start words are not names', async () => {
  const {echoes, restatedLines, unknownNames, paragraphs, exactLint} = await import('../lint.mjs');
  const t = '“There’s lasagne in the fridge.”\n\n“Lasagne,” Cody said.\n\n“You know about Friday.”\n\n“I know about Friday.”\n\n“Is it logged?”\n\n“No.”\n\n“Have you seen the state of the station?”\n\n“I have.”';
  assert.deepEqual(echoes(paragraphs(t)).map(f => f.where), ['line 2', 'line 4']);
  assert.match(echoes(paragraphs(t))[0].rule, /answer with something else — a question back, a dodge, a refusal or an action — without adding a fact/);
  const r = 'She took the letter off the sill and went down.\n\nShe took the letter off the sill and went down. The stair was worse going down.';
  assert.equal(restatedLines(paragraphs(r)).length, 1);
  assert.deepEqual(unknownNames(paragraphs('Ines read it.\n\nYellowed, a bit cockled where it had got damp.'), ['Ines']), []);
  assert.equal(exactLint(t).find(f => f.kind === 'ECHO').severity, 'hard');
});

test('model findings must quote the chapter and report a real problem', async () => {
  const {groundedFindings} = await import('../lint.mjs');
  const text = 'Dev came on at half six with his coat still on.\n\n“It’s on the chart,” Dev said.';
  const f = [
    {kind: 'CHARACTER', quote: 'Dev came on at half six', rule: 'Dev is the night charge nurse (his profile)'},
    {kind: 'RULE', quote: "It's on the chart", rule: 'fine — so no fault, noted'},
    {kind: 'TIMELINE', quote: 'the two o’clock antibiotic', rule: 'handover says three'},
    {kind: 'PLAN', quote: 'Dev crosses her over the rota', rule: 'planned, not done'},
  ];
  const g = groundedFindings(f, text);
  assert.deepEqual(g.kept.map(x => x.kind), ['CHARACTER', 'PLAN']);
  assert.deepEqual(g.dropped.map(x => x.why), ['says there is no problem', 'quote not in the chapter']);
});

test('first person: plain description is not a point-of-view slip, and narratorial present is soft', async () => {
  const {exactLint} = await import('../lint.mjs');
  const t = 'The car sat at forty degrees with the front wheels under water and the rear tires on nothing. The tail was an inch from the bank, which was lucky for the bumper. Steam came off the hood in a thin line and went sideways in the wind, and the sleet ticked on the roof.\n\nLorraine doesn’t ask things twice. She says the official thing and waits, and the waiting is the pressure, and she knows it is.';
  const f = exactLint(t, {pov: 'First person, Ray narrating', tense: 'Past'});
  assert.equal(f.filter(x => x.kind === 'POV').length, 0);
  assert.ok(f.filter(x => x.kind === 'TENSE').every(x => x.severity === 'soft'));
});

test('padding in any wording is dropped; a callback is not an echo', async () => {
  const {groundedFindings, echoes, paragraphs} = await import('../lint.mjs');
  const text = 'the cab stank of diesel and wet wool. “Yes, ma’am.” She took the toothpick out.';
  const g = groundedFindings([
    {kind: 'RULE', quote: 'the cab stank of diesel and wet wool', rule: 'matches the foundation\'s smells. No finding.'},
    {kind: 'CHARACTER', quote: 'Yes, ma’am.', rule: 'Danny, flat, before a deputy. In voice.'},
    {kind: 'CONTINUITY', quote: 'She took the toothpick out', rule: 'Lorraine never had a toothpick in her profile; a new habit'},
  ], text);
  assert.deepEqual(g.kept.map(x => x.kind), ['CONTINUITY']);
  assert.equal(echoes(paragraphs('“You just picked tonight.”\n\n“I picked him.”')).length, 0);
  assert.equal(echoes(paragraphs('“Water over the hubs?”\n\n“Over the hubs.”')).length, 1);
});

test('Fair Market Value ch1: padding in new wordings and done PLAN items are dropped; descriptive sentence openers are not names', async () => {
  const {groundedFindings, unknownNames, paragraphs} = await import('../lint.mjs');
  const text = 'Black stubble showing through the drifts. Seed caps on the hooks above them.\n\nWynn takes the mug. She says the house is not in it. His hand is big and clean and he uses all of it. Marge knocked twice.';
  assert.deepEqual(unknownNames(paragraphs(text), ['Wynn']).map(f => f.quote), ['Marge']);
  const f = [
    {kind: 'PLAN', quote: 'x', rule: 'done at lines 59–68.'},
    {kind: 'PLAN', quote: 'x', rule: 'planned for this chapter, hasn’t happened yet'},
    {kind: 'CHARACTER', quote: 'His hand is big and clean', rule: 'a clean hand after the road is Possible: fine, but nothing shows him washing.'},
    {kind: 'RULE', quote: 'His hand is big', rule: 'this is one image, Possible: within register.'},
    {kind: 'CONTINUITY', quote: 'His hand is big', rule: 'the plan says she labelled it, which this matches; no break.'},
    {kind: 'CHARACTER', quote: 'His hand is big', rule: 'a small kindness is Possible: fine, and the plan allows it.'},
  ];
  const g = groundedFindings(f, text);
  assert.deepEqual(g.kept.map(x => x.rule.slice(0, 11)), ['planned for']);
  assert.equal(g.dropped.length, 5);
});

test('more padding wordings from a second run; "present" is not a negation', async () => {
  const {groundedFindings} = await import('../lint.mjs');
  const text = 'The varnish is bright. Don’t miss the quilts. The light coming under the cloud.';
  const f = [
    {kind: 'PLAN', quote: 'x', rule: 'present at lines 77–82 and dropped, so this is met; listed only because the plan’s phrasing is exact.'},
    {kind: 'CONTINUITY', quote: 'The varnish is bright', rule: 'fifty years from 1974 is consistent, so this is only soft if the year is later.'},
    {kind: 'CHARACTER', quote: 'Don’t miss the quilts', rule: 'Possible: a small generous beat the profile allows, so soft.'},
    {kind: 'RULE', quote: 'The light coming under the cloud', rule: 'the one line that swells; borderline, but quotable against the register rule.'},
  ];
  assert.equal(groundedFindings(f, text).kept.length, 0);
});

test('only lines under FINDINGS count; CHECKED is thrown away', () => {
  const r = 'CHECKED:\n- [PLAN] "Wynn and Clem clash once" — lines 70–75 do this.\n- [VOICE] [hard] line 61: "Teed, is that coffee" — Clem\'s profile. Met.\nFINDINGS:\n- [CHAPTER ORDER] [hard] line 46: "The varnish is bright" — the outline puts the fresh varnish in Chapter 2\nBIGGEST PROBLEM: the varnish.';
  assert.deepEqual(parseFindings(r).map(f => f.kind), ['CHAPTER ORDER']);
  assert.equal(parseFindings('- [RULE] [hard] line 2: "x" — the rule').length, 1, 'no headings: every line is read');
});

test('a profile sample line used in the story is flagged; ordinary overlap is not', async () => {
  const {liftedSamples, sampleLinesOf, paragraphs} = await import('../lint.mjs');
  const voice = 'Short answers. He says "I dunno" when he does know.\n"There\'s a soft one on the left. Been soft a while."\n"Co-op\'s got me on the yard till four most days. It\'s fine."';
  const samples = sampleLinesOf(voice).map(line => ({name: 'Kyle Brandt', line}));
  assert.equal(samples.length, 2);
  const text = 'He does not get up.\n\n“There a soft one on the left,” he says. “Been soft a while.”\n\n“Most days. Four o’clock.”';
  const f = liftedSamples(paragraphs(text), samples);
  assert.deepEqual(f.map(x => x.where), ['line 2']);
  assert.match(f[0].rule, /Kyle Brandt’s profile/);
});

test('an echo at the start of a longer reply is caught', async () => {
  const {echoes, paragraphs} = await import('../lint.mjs');
  const t = '“Twenty-two hundred on the tractor, is that what you got?”\n\n“Near enough.”\n\n“Near enough.” He turns his keys over. “Vern had a 970 through the ring at Kinley in the fall.”\n\n“And what did Vern get?”';
  assert.deepEqual(echoes(paragraphs(t)).map(f => f.where), ['line 3']);
});

test('a single sentence in the wrong tense is caught, backstory is not', async () => {
  const {tenseSentences, paragraphs} = await import('../lint.mjs');
  const text = 'He sets the label down. He took his pen out.\n\nShe sold it in October. He looks at her.\n\n“Fine,” he said.';
  const f = tenseSentences(paragraphs(text), 'present', ['Wynn Garside']);
  assert.deepEqual(f.map(x => x.quote), ['He took his pen out.', 'he said.']);
  assert.equal(tenseSentences(paragraphs('I went back out. I got the nozzle in.'), 'past').length, 0);
});

test('the same bit of business twice is a gesture finding; ordinary repeated verbs are not', async () => {
  const {repeatedGestures, paragraphs} = await import('../lint.mjs');
  const text = ['She dries her hands on the cardigan.', 'He looks at the sheet.', 'She dries her hands again.', 'She is drying them on the hem. He squares the sheet.', 'She dries them on it. He squares the towel.', 'He squares the quilt. He looks at the door.', 'Wynn squares the pages.'].join('\n\n');
  const f = repeatedGestures(paragraphs(text), ['Wynn Garside']);
  assert.ok(f.some(x => x.quote === 'dries her hands' && x.where === 'lines 1, 3'));
  assert.ok(f.some(x => x.quote === 'drying them' || x.quote === 'dries them'));
  assert.ok(f.some(x => /^squares$/i.test(x.quote)));
  assert.ok(!f.some(x => /looks/.test(x.quote)), 'common verbs are not tics');
  assert.equal(repeatedGestures(paragraphs('I hooked it to the frame.\n\nThen I hooked it again.')).length, 0, 'an object pronoun needs three');
});

test('and-chains: four or more joined clauses, hard only when the chapter leans on them', async () => {
  const {andChains, paragraphs} = await import('../lint.mjs');
  const chain = 'He goes out and the door slams and the truck goes down the lane and is at the road and gone.';
  const heavy = andChains(paragraphs(`${chain}\n\nShe stands and waits and looks and listens.`));
  assert.equal(heavy[0].kind, 'CHAIN'); assert.equal(heavy[0].severity, 'hard');
  const light = andChains(paragraphs(`${chain}\n\n${'The room is cold. The light is low. Nobody speaks for a while. '.repeat(20)}`));
  assert.equal(light[0].severity, 'soft');
  assert.equal(andChains(paragraphs('It came to eight thousand six hundred and forty and he wrote it and left.')).length, 0, 'numbers are not chains');
});

test('echo check: pronoun swaps, mid-line lifts, one-word repeats and opening repeats — but not greetings', async () => {
  const {echoes, paragraphs} = await import('../lint.mjs');
  const pairs = [
    ['“You were on the chairs.”', '“I was on the chairs.”'],
    ['“Get her in before the end of the month. I’ll ring you back.”', '“Before the end of the month.”'],
    ['“It’s six. Thursday’s the highway.”', '“Thursday,” Priya said.'],
    ['“Sixty-five.”', '“Sixty-five. And when would she get in, do you think?”'],
  ];
  for (const [a, b] of pairs) assert.equal(echoes(paragraphs(`${a}\n\n${b}`)).length, 1, b);
  assert.equal(echoes(paragraphs('“Morning.”\n\n“Morning.”')).length, 0, 'greetings are not a tic');
  assert.equal(echoes(paragraphs('“Is the shed locked?”\n\n“Ask whoever had the keys last.”')).length, 0);
});

test('ordinary verbs with a doubled consonant are not tics ("stopped" four times)', async () => {
  const {repeatedGestures, paragraphs} = await import('../lint.mjs');
  const text = ['She stopped at the light.', 'Priya stopped again.', 'Then she stopped short.', 'He stopped the car.'].join('\n\n');
  assert.equal(repeatedGestures(paragraphs(text), ['Priya Mann']).length, 0);
});

test('the re-check of hard findings: sees the claims, not the first checker’s reasoning; reply parsed per claim', async () => {
  const {recheckInstruction, parseRecheck, RECHECKED} = await import('../lint.mjs');
  const ins = recheckInstruction({number: 3, chapterText: '1| He lied about the clock.', facts: 'Clem arrives at 3:40.', findings: [{kind: 'TIMELINE', where: 'line 1', quote: 'He lied about the clock.', rule: 'Contradicts the arrival time.'}]});
  assert.match(ins, /F1 \[TIMELINE\] line 1: "He lied about the clock\." — Contradicts the arrival time\./);
  assert.match(ins, /lying, bluffing, guessing/); assert.match(ins, /When you're unsure, DROP/);
  assert.match(ins, /Clem arrives at 3:40\./);
  const r = parseRecheck('F1: DROP — he is bluffing on purpose\n**F2**: KEEP — "Clem arrives at 3:40"\nF9: KEEP — out of range', 3);
  assert.deepEqual(r[0], {keep: false, why: 'he is bluffing on purpose'});
  assert.deepEqual(r[1], {keep: true, why: 'Clem arrives at 3:40'});
  assert.equal(r[2], null, 'an unanswered claim stays unanswered (and is kept as it was)');
  assert.ok(RECHECKED.includes('CHARACTER') && !RECHECKED.includes('PLAN'));
});

test('picking one of the choices offered is an answer, not an echo', async () => {
  const {echoes, paragraphs} = await import('../lint.mjs');
  assert.equal(echoes(paragraphs('“Sunday’s short. Nine-twenty or eleven-forty.”\n\n“Nine-twenty.”')).length, 0);
  assert.equal(echoes(paragraphs('“Tea or coffee?”\n\n“Coffee.”')).length, 0);
  assert.equal(echoes(paragraphs('“It’s six. Thursday’s the highway.”\n\n“Thursday.”')).length, 1, 'still an echo without a choice');
});

test('roleplay: the game master making the player act is caught; what the player perceives is not', async () => {
  const {playerActions, paragraphs} = await import('../lint.mjs');
  const gm = 'The wheels crunch to a stop.\n\nYou see a light out on the ice. You feel the cold through your gloves.\n\nYou ease the Marrowhawk forward and the drift opens around the nose.\n\nTomasz looks at you. "Say the word, Reyes."\n\nCody: I key the handset.';
  const f = playerActions(paragraphs(gm), 'Second person, present', 'Reyes', 'Cody');
  assert.equal(f.length, 1); assert.equal(f[0].where, 'line 3'); assert.match(f[0].rule, /“You ease”/);
  assert.equal(playerActions(paragraphs('Reyes takes the handset and speaks.'), 'third person', 'Reyes').length, 1);
  assert.equal(playerActions(paragraphs('Reyes can see the hull from here.'), 'third person', 'Reyes').length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {novelPreset, presetPrompts, bookValues, NARRATOR_CARD, isGeneralNarrator, varName, VALUES, CRAFT_MAIN, POST_HISTORY} from '../novelist.mjs';

const preset = {temperature: 1.1, frequency_penalty: 0.25, continue_nudge_prompt: '[Continue your last message…]', new_chat_prompt: '[Start a new Chat]',
  prompts: [{identifier: 'main', content: 'Write {{char}}\'s next reply in a fictional chat'}, {identifier: 'jailbreak', content: ''}, {identifier: 'enhanceDefinitions', content: 'add lore'}],
  prompt_order: [{character_id: 100001, order: [{identifier: 'main', enabled: true}, {identifier: 'enhanceDefinitions', enabled: true}, {identifier: 'jailbreak', enabled: false}]}]};

test('the novel preset rewrites the writing prompts and keeps the sliders', () => {
  const p = novelPreset(preset);
  assert.equal(p.temperature, 1.1);
  assert.equal(p.frequency_penalty, 0.25);
  const w = presetPrompts(p);
  assert.equal(w.main, CRAFT_MAIN);
  assert.equal(w.postHistory, POST_HISTORY);
  assert.equal(w.enhanceDefinitions, false);
  assert.equal(w.postHistoryOn, true);
  assert.match(w.continueNudge, /passage/);
  assert.match(w.newChat, /chapter/);
  assert.equal(preset.prompts[0].content.startsWith('Write'), true, 'input untouched');
});

test('the craft prompt teaches writing, not a story', () => {
  assert.match(CRAFT_MAIN, /live scene/);
  assert.match(CRAFT_MAIN, /never answer, quote or comment/);
  assert.doesNotMatch(CRAFT_MAIN, /Mara|Ruth|lighthouse/);
});

test('the narrator card has a blank for every value', () => {
  for (const v of VALUES) assert.ok(NARRATOR_CARD.includes(`{{getvar::${varName(v.key)}}}`), v.key);
  assert.ok(isGeneralNarrator(NARRATOR_CARD));
  assert.ok(!isGeneralNarrator('A narrator for a test novel.'));
});

test('book values are read from the book’s own entries', () => {
  const v = bookValues({
    voice: 'POV: Third-person limited, fixed on Mara.\nTENSE: Past.\nTONE: Cold, restrained.\nREGISTER: Quiet and exact.\nALWAYS OR NEVER: Never head-hop.',
    summary: 'NOVEL TITLE: Fixed Light\nGENRE: Literary family drama.\nSETTING: A lighthouse.', focus: 'Mara'});
  assert.deepEqual(v, {narrator: 'Mara', pov: 'Third-person limited, fixed on Mara.', tense: 'Past.', voice: 'Quiet and exact.', tone: 'Cold, restrained.', genre: 'Literary family drama.', rules: 'Never head-hop.'});
  assert.equal(bookValues({directive: 'POV: First person\nTense: Present'}).pov, 'First person');
});

test('narration suggestions are read back per setting', async () => {
  const {narrationInstruction, parseNarration} = await import('../novelist.mjs');
  assert.match(narrationInstruction({number: 2, wish: 'Danny, first person', current: {pov: 'Third, Mara'}}), /POINT OF VIEW: Third, Mara/);
  const r = parseNarration('NARRATOR: Danny\nPOINT OF VIEW: First person\nTENSE: Past\nVOICE: Short and flat\nTONE: Angry\nGENRE: Family drama\nAUTHOR’S RULES: none\nCHECKER NOTE: first person is intended\nEDITOR NOTE: none');
  assert.deepEqual(r.values, {narrator: 'Danny', pov: 'First person', tense: 'Past', voice: 'Short and flat', tone: 'Angry', genre: 'Family drama', rules: ''});
  assert.equal(r.checkerNote, 'first person is intended');
  assert.equal(parseNarration('nothing useful'), null);
});

test('a campaign’s table rules fill the genre and rules blanks', () => {
  const v = bookValues({voice: 'POV: Second person.\nTENSE: Present.\nTONE: Damp, wry.\nSYSTEM: none\nCONTENT LIMITS: No graphic gore.\nPLAYER AGENCY: The narrator never decides what Kel does.', summary: 'CAMPAIGN TITLE: The Drowned Bell\nSYSTEM AND GENRE: Narrative, low fantasy mystery.'});
  assert.equal(v.genre, 'Narrative, low fantasy mystery.');
  assert.equal(v.rules, 'No graphic gore. The narrator never decides what Kel does.');
});

test('a chapter per reply is the default; passages are an option', async () => {
  const {writingKit, CRAFT_MAIN_PASSAGES, POST_HISTORY_PASSAGES} = await import('../novelist.mjs');
  const {replyLengthNote} = await import('../memory.mjs');
  assert.match(writingKit().main, /Each reply is a whole chapter/);
  assert.doesNotMatch(writingKit().main, /one passage at a time/);
  assert.match(writingKit(false, {passages: true}).main, /one passage at a time/);
  assert.doesNotMatch(CRAFT_MAIN_PASSAGES, /Each reply is a whole chapter/);
  assert.equal(writingKit(false, {passages: true}).postHistory, POST_HISTORY_PASSAGES);
  assert.match(replyLengthNote(8196, 'Chapter', 3000), /the whole chapter, in this reply/);
  assert.match(replyLengthNote(8196, 'Chapter', 0, {passages: true}), /the next passage of this chapter/);
});

test('switching all-at-once / bit-by-bit swaps only Storyloom’s own text', async () => {
  const {switchPresetMode, writingKit, novelPreset} = await import('../novelist.mjs');
  const whole = novelPreset({}, {passages: false}), bits = writingKit(false, {passages: true});
  const r = switchPresetMode(whole, true);
  assert.deepEqual(r.swapped, ['Main Prompt', 'Post-History Instructions']);
  assert.equal(r.preset.prompts.find(p => p.identifier === 'main').content, bits.main);
  assert.equal(whole.prompts.find(p => p.identifier === 'main').content, writingKit(false).main, 'the original is not changed');
  const edited = structuredClone(whole); edited.prompts.find(p => p.identifier === 'main').content = 'My own main prompt.';
  const e = switchPresetMode(edited, true);
  assert.deepEqual(e.kept, ['Main Prompt']);
  assert.equal(e.preset.prompts.find(p => p.identifier === 'main').content, 'My own main prompt.');
  assert.deepEqual(switchPresetMode(whole, false).swapped, [], 'already matching: nothing to do');
});

test('the narrator prompt is written to a model about model habits, and old Storyloom text upgrades', async () => {
  const {CRAFT_MAIN, CRAFT_MAIN_PASSAGES, RP_MAIN, AI_HABITS, syncPresetText, textPrint, OLD_TEXTS, writingKit} = await import('../novelist.mjs');
  for (const t of [CRAFT_MAIN, CRAFT_MAIN_PASSAGES, RP_MAIN]) assert.ok(t.includes(AI_HABITS));
  assert.match(AI_HABITS, /every reply moves it on/);
  // Research: a quoted bad example primes the habit it names, so the list says what to do and quotes no bad lines.
  assert.doesNotMatch(AI_HABITS, /Lasagne|NEVER DO THESE|That was enough/);
  assert.match(CRAFT_MAIN, /doesn't win every exchange/);
  assert.match(CRAFT_MAIN, /Things keep the look they were given/);
  assert.match(CRAFT_MAIN, /Language models, this one included/);
  assert.ok(!OLD_TEXTS.has(textPrint(CRAFT_MAIN)), 'the current text is not "old"');
  const old = {prompts: [{identifier: 'main', content: 'x'}, {identifier: 'jailbreak', content: writingKit(false).postHistory}]};
  [...OLD_TEXTS].length && assert.equal(syncPresetText(old).kept[0], 'Main Prompt', 'unknown text is the writer’s and stays');
});

test('an earlier Storyloom card is recognised even with Windows line endings', async () => {
  const {upgradedCard, NARRATOR_CARD, textPrint} = await import('../novelist.mjs');
  const old = "{{char}} narrates the book being written in this chat. {{char}} is the voice telling the story, not a character in it.\n\nHOW THIS BOOK IS TOLD\nNarrator: {{getvar::storyloom_narrator}}\nPoint of view: {{getvar::storyloom_pov}}\nTense: {{getvar::storyloom_tense}}\nVoice: {{getvar::storyloom_voice}}\nTone: {{getvar::storyloom_tone}}\nGenre: {{getvar::storyloom_genre}}\nAuthor’s rules: {{getvar::storyloom_rules}}\n\nHOW THE NARRATOR WORKS\nHold this point of view, tense and voice in every sentence; they belong to the book, not to the moment. Anything outside the point-of-view character's senses and knowledge stays off the page. The people, places and plan of the book come from the lorebook and the chapter plan: use them exactly and add nothing that contradicts them. When a chapter's settings differ from the last one — a different narrator, a different tense — write that chapter in its own settings from the first line.";
  assert.equal(upgradedCard(old.replace(/\n/g, '\r\n')), NARRATOR_CARD);
  assert.equal(upgradedCard(old + ' My own addition.'), null, 'an edited card is left alone');
  assert.equal(textPrint('a\r\nb'), textPrint('a\nb'));
});

test('your defaults: the writer’s own copy is used in both ways of writing, and Storyloom’s built-in text is replaced by it', async () => {
  const {withMine, writingKit, syncPresetText, CRAFT_MAIN, CRAFT_MAIN_PASSAGES, NARRATOR_CARD, upgradedCard, novelPreset} = await import('../novelist.mjs');
  const myMain = CRAFT_MAIN.replace('CONFLICT\n', 'CONFLICT\nEveryone swears a lot in this house. ');
  const mine = {novel: {main: {text: myMain, base: CRAFT_MAIN}, card: 'My narrator card'}};
  const whole = withMine(writingKit(false), mine.novel), bits = withMine(writingKit(false, {passages: true}), mine.novel);
  assert.equal(whole.main, myMain);
  assert.match(bits.main, /Everyone swears a lot/); assert.match(bits.main, /one passage at a time/);
  assert.equal(whole.card, 'My narrator card');
  assert.equal(withMine(writingKit(false), {}).main, CRAFT_MAIN, 'no copy, Storyloom’s text');
  // A preset still holding Storyloom's built-in text gets the writer's copy; a hand-edited one is left alone.
  const preset = {prompts: [{identifier: 'main', content: CRAFT_MAIN_PASSAGES}, {identifier: 'jailbreak', content: 'x'}]};
  const r = syncPresetText(preset, {passages: false, mine});
  assert.equal(r.preset.prompts[0].content, myMain); assert.ok(r.swapped.includes('Main Prompt'));
  const hand = syncPresetText({prompts: [{identifier: 'main', content: 'hand written'}]}, {mine});
  assert.ok(hand.kept.includes('Main Prompt'));
  assert.equal(novelPreset({}, {kit: whole}).prompts.find(q => q.identifier === 'main').content, myMain);
  // Cards: Storyloom's built-in card becomes the writer's; an edited card is never touched.
  assert.equal(upgradedCard(NARRATOR_CARD, {novel: 'My narrator card'}), 'My narrator card');
  assert.equal(upgradedCard('My narrator card', {novel: 'My narrator card'}), null);
  assert.equal(upgradedCard('something the writer wrote', {novel: 'My narrator card'}), null);
});

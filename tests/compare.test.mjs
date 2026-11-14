import test from 'node:test';
import assert from 'node:assert/strict';
import {PLACES, yourPlaces, storyloomPlaces, findProblems, compareInstruction} from '../compare.mjs';
import {CRAFT_MAIN} from '../novelist.mjs';

const rpPreset = {main: "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.", postHistory: '', mainOn: true, postHistoryOn: true, enhanceDefinitions: true, continueNudge: '', newChat: '', auxiliary: ''};

test('the writer’s places are read from the card and preset', () => {
  const y = yourPlaces({description: 'D', system_prompt: 'M', depth_prompt: {prompt: 'N'}, post_history_instructions: 'P'}, rpPreset);
  assert.equal(y.description, 'D'); assert.equal(y.cardMain, 'M'); assert.equal(y.charNote, 'N'); assert.equal(y.cardPost, 'P');
  assert.equal(y.enhanceDefinitions, 'on');
  assert.equal(yourPlaces({}, {...rpPreset, mainOn: false}).main, '');
  assert.equal(Object.keys(storyloomPlaces()).length, PLACES.length);
});

test('roleplay wording, long-reply demands, missing POV and Enhance Definitions are flagged', () => {
  const y = yourPlaces({description: 'Narrate the story of Mara. Write as long as possible.'}, rpPreset);
  const p = findProblems(y, {values: {pov: 'Third-person limited', tense: 'Past'}, names: ['Mara']});
  assert.ok(p.main.some(x => /Roleplay/.test(x.text)));
  assert.ok(p.description.some(x => /open-ended length/.test(x.text)));
  assert.ok(!findProblems(yourPlaces({description: 'Write the whole chapter in each reply, about 4000 words. Close third, past tense.'}, rpPreset), {}).description.some(x => /length/.test(x.text)), 'a whole chapter per reply is the writer’s choice, not a problem');
  assert.ok(p.description.some(x => /No point of view/.test(x.text)));
  assert.ok(p.description.some(x => /No tense/.test(x.text)));
  assert.ok(p.enhanceDefinitions.length);
  assert.ok(p.postHistory.some(x => x.level === 'note'));
});

test('point of view and tense that clash with the book or with each other are flagged', () => {
  const y = yourPlaces({description: 'Told in first person, present tense.', depth_prompt: {prompt: 'Keep to third person.'}}, {...rpPreset, main: CRAFT_MAIN, enhanceDefinitions: false});
  const p = findProblems(y, {values: {pov: 'Third-person limited', tense: 'Past'}});
  assert.ok(p.description.some(x => /this book is set to Third/.test(x.text)));
  assert.ok(p.description.some(x => /this book is set to Past/.test(x.text)));
  assert.ok(p.charNote.some(x => /Narrator card — Description says first person/.test(x.text)));
  assert.equal(p.main.length, 0, 'Storyloom’s craft prompt passes its own checks');
});

test('story names in the craft layer are flagged, Storyloom’s own setup is clean', () => {
  const p = findProblems(yourPlaces({}, {...rpPreset, main: 'Mara is a lighthouse keeper. Write well.'}), {names: ['Mara']});
  assert.ok(p.main.some(x => /Names story people \(Mara\)/.test(x.text)));
  const sl = findProblems(storyloomPlaces(), {values: {pov: 'Third', tense: 'Past'}, names: ['Mara']});
  assert.deepEqual(Object.values(sl).flat(), []);
  assert.match(compareInstruction({yours: yourPlaces({}, rpPreset), storyloom: storyloomPlaces(), problems: p}), /Names story people/);
});

test('roleplay: chat wording is fine, but the setup must leave the player’s character alone', async () => {
  const {RP_MAIN} = await import('../novelist.mjs');
  const rp = findProblems(storyloomPlaces(null, {roleplay: true}), {roleplay: true, values: {pov: 'Second person', tense: 'Present'}});
  assert.deepEqual(Object.values(rp).flat(), [], 'Storyloom’s own game master setup is clean');
  const y = yourPlaces({description: 'You are Mara, talking with {{user}}.'}, {...rpPreset, main: 'Write the next reply in a roleplay with {{user}}.', enhanceDefinitions: false});
  const p = findProblems(y, {roleplay: true});
  assert.ok(!p.main.some(x => /Roleplay wording/.test(x.text)));
  assert.ok(p.main.some(x => /leave your character alone/.test(x.text)));
  assert.match(storyloomPlaces(null, {roleplay: true}).main, /game master/);
  assert.ok(RP_MAIN.includes('Never write {{user}}'));
});

test('a fix keeps the writer’s text and changes only what the problems need', async () => {
  const {fixInstruction, parseFix} = await import('../compare.mjs');
  const p = fixInstruction({place: 'main', yours: 'Write {{char}}\'s next reply in a fictional chat.', storyloom: 'You are a novelist…', problems: [{text: 'Roleplay wording'}], values: {pov: 'Third', tense: 'Past'}});
  assert.match(p, /Keep everything else word for word/);
  assert.match(p, /- Roleplay wording/);
  assert.match(p, /This book is told in: Third, Past/);
  assert.equal(parseFix('Sure.\n=== FIXED\nYou write the next passage of the book.\n=== END'), 'You write the next passage of the book.');
  assert.equal(parseFix('**=== FIXED**\nLine one.\nLine two.'), 'Line one.\nLine two.');
  assert.equal(parseFix('no markers'), null);
});

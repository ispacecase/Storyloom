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
  const y = yourPlaces({description: 'Narrate the story of Mara. Write the whole chapter in each reply, at least 4000 words.'}, rpPreset);
  const p = findProblems(y, {values: {pov: 'Third-person limited', tense: 'Past'}, names: ['Mara']});
  assert.ok(p.main.some(x => /Roleplay/.test(x.text)));
  assert.ok(p.description.some(x => /very long replies/.test(x.text)));
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

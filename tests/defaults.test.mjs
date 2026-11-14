import test from 'node:test';
import assert from 'node:assert/strict';
import {carryEdit, lineHunks, mergeImprovements, ownedText, hasImprovement} from '../defaults.mjs';

test('carryEdit moves one change into another version of the text', () => {
  const whole = 'You are a novelist.\nEach reply is a whole chapter.\nDialogue: people say less than they mean.';
  const bits = 'You are a novelist.\nWrite only the passage asked for.\nDialogue: people say less than they mean.';
  const edited = bits.replace('people say less than they mean.', 'people say less than they mean, and swear.');
  assert.equal(carryEdit(bits, edited, whole), whole.replace('people say less than they mean.', 'people say less than they mean, and swear.'));
  assert.equal(carryEdit(bits, bits, whole), whole, 'no change, nothing to carry');
  assert.equal(carryEdit('a\nb', 'a\nb\nNew rule.', 'z\na\nb'), 'z\na\nb\nNew rule.', 'an addition at the end');
  assert.equal(carryEdit('x one y', 'x two y', 'no such text here'), null, 'not found → null');
  // An addition placed after the words before it, though the words after it differ between the two versions.
  const bitsText = 'Keep the facts straight from first line to last.\nEnd each reply on a finished sentence.', wholeText = 'Keep the facts straight from first line to last.\nEnd the chapter where its plan ends.';
  assert.equal(carryEdit(bitsText, bitsText.replace('last.\n', 'last.\nOpen every reply with something new.\n'), wholeText), 'Keep the facts straight from first line to last.\nOpen every reply with something new.\nEnd the chapter where its plan ends.');
  assert.equal(carryEdit('x', 'y', 'x and x'), null, 'found twice → null');
});

test('lineHunks lists what changed line by line', () => {
  assert.deepEqual(lineHunks('a\nb\nc', 'a\nB\nc'), [{from: 1, to: 2, lines: ['B']}]);
  assert.deepEqual(lineHunks('a\nc', 'a\nb\nc'), [{from: 1, to: 1, lines: ['b']}]);
  assert.deepEqual(lineHunks('a\nb\nc', 'a\nc'), [{from: 1, to: 2, lines: []}]);
});

test('mergeImprovements applies Storyloom’s changes to the writer’s copy and leaves the writer’s own lines alone', () => {
  const base = 'Intro.\nRule one.\nRule two.\nEnd.';
  const mine = 'Intro.\nRule one, my way.\nRule two.\nEnd.';
  const theirs = 'Intro.\nRule one.\nRule two, improved.\nRule three.\nEnd.';
  const r = mergeImprovements(base, mine, theirs);
  assert.equal(r.text, 'Intro.\nRule one, my way.\nRule two, improved.\nRule three.\nEnd.');
  assert.equal(r.conflicts.length, 0);
  const clash = mergeImprovements(base, mine, 'Intro.\nRule one, theirs.\nRule two.\nEnd.');
  assert.equal(clash.text, mine, 'the writer’s line wins');
  assert.equal(clash.conflicts.length, 1);
});

test('ownedText and hasImprovement', () => {
  assert.deepEqual(ownedText('mine'), {text: 'mine', base: ''});
  assert.deepEqual(ownedText({text: 'm', base: 'b'}), {text: 'm', base: 'b'});
  assert.equal(ownedText(null), null);
  assert.equal(hasImprovement({text: 'm', base: 'b'}, 'b'), false, 'built-in unchanged');
  assert.equal(hasImprovement({text: 'm', base: 'b'}, 'b2'), true);
  assert.equal(hasImprovement({text: 'm', base: ''}, 'b2'), false, 'no base, nothing to merge from');
});

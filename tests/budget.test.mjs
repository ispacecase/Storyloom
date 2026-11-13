import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNumber, lengthCategory, coreShare, wordBudget, castFit, budgetLines} from '../budget.mjs';

test('numbers are read from plain writing', () => {
  assert.equal(parseNumber('Two chapters'), 2);
  assert.equal(parseNumber('about 2,500 words'), 2500);
  assert.equal(parseNumber('2.5k'), 2500);
  assert.equal(parseNumber('a single afternoon'), 1);
  assert.equal(parseNumber('none'), null);
});

test('length categories follow the SFWA thresholds', () => {
  assert.deepEqual([7499, 7500, 17499, 17500, 39999, 40000].map(lengthCategory), ['short story', 'novelette', 'novelette', 'novella', 'novella', 'novel']);
});

test('the core share comes from the writer, never silently invented', () => {
  assert.deepEqual(coreShare('the encounter — about 80% of it'), {share: 0.8, source: 'you said 80%'});
  assert.equal(coreShare('the whole thing is their night together').share, 0.9);
  assert.equal(coreShare('mostly the heist').share, 0.75);
  assert.match(coreShare('').source, /not stated/);
});

test('a short two-person story leaves no room for anyone else', () => {
  const b = wordBudget({chapters: 'Two chapters', wordsPerChapter: '2,500 words', coreText: 'the whole thing is the two of them', namedCast: ['Ann', 'Ben']});
  assert.equal(b.total, 5000);
  assert.equal(b.category, 'short story');
  assert.equal(b.core, 4500);
  assert.equal(b.rest, 500);
  assert.equal(b.room, 0);
  const fit = castFit(b, ['Ann', 'Ben', 'Neighbour', 'Sister', 'Boss', 'Ex', 'Friend', 'Landlord', 'Barman']);
  assert.equal(fit.added.length, 7);
  assert.equal(fit.fits, false);
  assert.equal(fit.over, 7);
  assert.match(budgetLines(b).join('\n'), /Room for other characters on the page: 0 .*Anyone else is only mentioned/);
});

test('the same maths gives a longer story room for a crew', () => {
  const b = wordBudget({totalWords: 30000, coreText: 'mostly the heist, about 60%'});
  assert.equal(b.category, 'novella');
  assert.equal(b.core, 18000);
  assert.equal(b.room, 16);
  assert.ok(castFit(b, ['A', 'B', 'C', 'D', 'E']).fits);
});

test('a missing length says so instead of guessing', () => {
  assert.match(budgetLines(wordBudget({}))[0], /Length not set yet/);
});

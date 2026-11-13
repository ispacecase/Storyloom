import test from 'node:test';
import assert from 'node:assert/strict';
import {planLinkSync, resolveLink, linkBookName, findCharacterEntry, linksFor} from '../links.mjs';

test('an edit in one book is copied to the others', () => {
  const r = planLinkSync('old', {A: 'new', B: 'old', Shared: 'old'});
  assert.deepEqual(r.writes, {B: 'new', Shared: 'new'});
  assert.equal(r.base, 'new');
  assert.equal(r.conflict, null);
});

test('nothing changes when all copies match', () => {
  assert.deepEqual(planLinkSync('x', {A: 'x', B: 'x'}).writes, {});
});

test('the same edit made everywhere just moves the base', () => {
  const r = planLinkSync('old', {A: 'new', B: 'new'});
  assert.deepEqual(r.writes, {});
  assert.equal(r.base, 'new');
});

test('different edits in two books are a conflict and nothing is written', () => {
  const r = planLinkSync('old', {A: 'one', B: 'two', Shared: 'old'});
  assert.deepEqual(r.writes, {});
  assert.deepEqual(r.conflict.sort(), ['A', 'B']);
  assert.equal(r.base, 'old');
});

test('a deleted copy is reported, not recreated', () => {
  const r = planLinkSync('old', {A: 'new', B: null});
  assert.deepEqual(r.writes, {});
  assert.deepEqual(r.missing, ['B']);
  assert.equal(r.base, 'new');
});

test('resolving a conflict pushes the chosen copy everywhere', () => {
  const r = resolveLink({A: 'one', B: 'two', Shared: 'old'}, 'B');
  assert.deepEqual(r.writes, {A: 'two', Shared: 'two'});
  assert.equal(r.base, 'two');
  assert.throws(() => resolveLink({A: null}, 'A'), /no longer/);
});

test('helpers', () => {
  assert.equal(linkBookName('Eldoria', 'The Straight'), 'Shared — Eldoria ↔ The Straight');
  assert.equal(linkBookName('a/b', 'c'), 'Shared — a b ↔ c');
  const book = {entries: {1: {comment: 'Character — Mara'}, 2: {comment: 'Place'}}};
  assert.equal(findCharacterEntry(book, 'character — mara').comment, 'Character — Mara');
  assert.equal(findCharacterEntry(book, 'Nobody'), null);
  assert.throws(() => findCharacterEntry({entries: {1: {comment: 'X'}, 2: {comment: 'x'}}}, 'X'), /More than one/);
  assert.equal(linksFor([{books: ['A', 'B']}, {books: ['C']}], 'B').length, 1);
});

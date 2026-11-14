import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneInstruction, parseScene, sceneNames, foldRange, sessionInstruction, parseSession} from '../live.mjs';

test('the scene card is read back in a fixed order, tolerant of markdown', () => {
  const raw = '**WHERE:** the kitchen\n- WHEN: Day 1, dawn\nWHO’S HERE: Mara (at the sink, thumb cut), Tom (in the doorway, wet)\nCONDITIONS: rain, grey light\nIN HAND: the letter\nJUST HAPPENED: Tom came in.';
  assert.equal(parseScene(raw), "WHEN: Day 1, dawn\nWHERE: the kitchen\nWHO'S HERE: Mara (at the sink, thumb cut), Tom (in the doorway, wet)\nCONDITIONS: rain, grey light\nIN HAND: the letter\nJUST HAPPENED: Tom came in.");
  assert.equal(parseScene('just some prose'), null);
  assert.match(sceneInstruction({roleplay: true, player: 'Kel'}), /Include Kel/);
});

test('names on stage are read from WHO’S HERE', () => {
  assert.deepEqual(sceneNames("WHO'S HERE: Mara (at the sink, thumb cut), Tom (wet) and Ruth"), ['Mara', 'Tom', 'Ruth']);
  assert.deepEqual(sceneNames("WHO'S HERE: no one"), []);
  assert.deepEqual(sceneNames('WHERE: x'), []);
});

test('older messages fold into the session record once enough pile up', () => {
  assert.equal(foldRange(30, {keep: 16, every: 20}), null);
  assert.deepEqual(foldRange(40, {keep: 16, every: 20}), {from: 0, to: 24});
  assert.equal(foldRange(50, {upto: 24, keep: 16, every: 20}), null);
  assert.deepEqual(foldRange(60, {upto: 24, keep: 16, every: 20}), {from: 24, to: 44});
  assert.deepEqual(foldRange(40, {start: 2, keep: 16, every: 20}), {from: 2, to: 24});
  assert.match(sessionInstruction({roleplay: true}), /this session/);
  assert.equal(parseSession("Here is the updated record:\n- Mara woke.\n\n- She cut her thumb."), '- Mara woke.\n- She cut her thumb.');
  assert.equal(parseSession('  '), null);
});

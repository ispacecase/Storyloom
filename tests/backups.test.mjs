import test from 'node:test';
import assert from 'node:assert/strict';
import {addBackup, latestGroup, backupText, BACKUP_MAX} from '../backups.mjs';

test('backups keep the old value, newest last, capped', () => {
  let list = [];
  for (let i = 0; i < BACKUP_MAX + 3; i++) list = addBackup(list, {kind: 'globalMain', label: `v${i}`, before: `old ${i}`}, {id: `b${i}`}).list;
  assert.equal(list.length, BACKUP_MAX);
  assert.equal(list.at(-1).label, `v${BACKUP_MAX + 2}`);
  assert.equal(list[0].label, 'v3');
});

test('backup data is copied, not shared; text is readable', () => {
  const before = {description: 'A', system_prompt: ''};
  const {entry} = addBackup([], {kind: 'character', label: 'Danny', target: {avatar: 'x.png'}, before});
  before.description = 'changed';
  assert.equal(entry.before.description, 'A');
  assert.match(backupText(entry), /— description —\nA\n\n— system_prompt —\n\(empty\)/);
  assert.match(backupText({before: null}), /default/);
  assert.match(backupText({before: ['one', 'two']}), /— part 2 —\ntwo/);
});

test('one action’s backups are found together', () => {
  let list = addBackup([], {kind: 'prompt', label: 'p', before: 'x'}).list;
  list = addBackup(list, {kind: 'character', label: 'c', before: {}, group: 'g1'}).list;
  list = addBackup(list, {kind: 'globalMain', label: 'm', before: '', group: 'g1'}).list;
  assert.deepEqual(latestGroup(list).map(b => b.label), ['c', 'm']);
  assert.deepEqual(latestGroup([]), []);
});

test('unknown kinds are refused', () => {
  assert.throws(() => addBackup([], {kind: 'nope', before: 1}), /Unknown backup kind/);
});

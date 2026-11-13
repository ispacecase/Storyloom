import test from 'node:test';
import assert from 'node:assert/strict';
import {redact, addEntry, filterEntries, logText} from '../log.mjs';

test('secrets never reach the log', () => {
  const s = redact('key sk-abcdefghijklmnop1234 and Bearer abc.def-123456789 and {"api_key":"zzz","proxy_password":"p"} url?key=AIza123');
  assert.doesNotMatch(s, /abcdefghijklmnop|abc\.def|zzz|AIza123|"p"/);
});

test('the log keeps the newest entries and shortens long detail unless debug is on', () => {
  let list = [];
  for (let i = 0; i < 7; i++) list = addEntry(list, {message: `m${i}`}, {max: 5});
  assert.deepEqual(list.map(e => e.message), ['m2', 'm3', 'm4', 'm5', 'm6']);
  const long = 'x'.repeat(5000);
  assert.ok(addEntry([], {message: 'a', detail: long})[0].detail.length < 2300);
  assert.equal(addEntry([], {message: 'a', detail: long}, {full: true})[0].detail.length, 5000);
});

test('filters and text export', () => {
  const list = [{at: 't', level: 'error', area: 'Lint', message: 'failed', detail: 'why\nmore'}, {at: 't', level: 'warn', message: 'retry'}, {at: 't', level: 'info', message: 'ok'}];
  assert.equal(filterEntries(list, 'error').length, 1);
  assert.equal(filterEntries(list, 'warn').length, 2);
  assert.equal(filterEntries(list).length, 3);
  assert.match(logText(list), /^\[t\] ERROR Lint: failed\n {4}why\n {4}more/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseActions, applyAction, describeAction, describeEntry, formatSnapshot, assistantSystem, needsCompaction} from '../assistant.mjs';

const reply = `Put the recap at depth 4 as system so it sits near the latest messages (Docs: Usage › worldinfo).

=== ACTION: add-entry
BOOK: A Small Weather
TITLE: Previously
KEYS:
STRATEGY: always
POSITION: depth
DEPTH: 4
ROLE: system
CONTENT:
Ruth found the 1979 folio.
She has not told Arthur.
=== END
=== ACTION: set-placement
BOOK: A Small Weather
TITLE: Character — Ruth Aldiss
RECURSION: no
=== END
=== ACTION: launch-rocket
BOOK: x
TITLE: y
=== END`;

test('reply text and action cards are separated; bad cards are reported, not applied', () => {
  const r = parseActions(reply);
  assert.match(r.reply, /^Put the recap at depth 4/);
  assert.doesNotMatch(r.reply, /ACTION/);
  assert.equal(r.actions.length, 2);
  assert.deepEqual(r.actions[0], {type: 'add-entry', book: 'A Small Weather', title: 'Previously', keys: [], content: 'Ruth found the 1979 folio.\nShe has not told Arthur.', strategy: 'always', position: 'depth', depth: 4, role: 'system'});
  assert.deepEqual(r.actions[1], {type: 'set-placement', book: 'A Small Weather', title: 'Character — Ruth Aldiss', recursion: false});
  assert.match(r.problems[0], /launch-rocket/);
  assert.match(describeAction(r.actions[0]), /Add entry “Previously” in “A Small Weather” — always on; placed at depth 4 as system/);
  assert.match(describeAction(r.actions[1]), /not triggered by other entries/);
});

test('applying an action changes a copy of the book exactly as described', () => {
  const book = {entries: {1: {uid: 1, comment: 'Character — Ruth Aldiss', content: 'x', key: ['Ruth'], position: 0}}};
  const {actions} = parseActions(reply);
  const added = applyAction(book, actions[0], b => (b.entries[2] = {uid: 2}));
  assert.equal(book.entries[2], undefined, 'original untouched');
  assert.deepEqual({c: added.book.entries[2].constant, p: added.book.entries[2].position, d: added.book.entries[2].depth, r: added.book.entries[2].role}, {c: true, p: 4, d: 4, r: 0});
  const placed = applyAction(added.book, actions[1], () => null);
  assert.equal(placed.book.entries[1].excludeRecursion, true);
  assert.throws(() => applyAction(added.book, actions[0], () => ({})), /already has an entry/);
  assert.throws(() => applyAction(book, {type: 'edit-entry', book: 'B', title: 'Nobody'}, () => null), /no entry called/);
});

test('snapshot and system prompt carry setup, docs rules and the action format', () => {
  const text = formatSnapshot({character: {name: 'Novel Engine', description: 'Narrator.'}, chatLorebook: 'A Small Weather', worldInfo: {depth: 2, budget: 25, recursive: true}, vectors: {source: 'palm', enabled_world_info: true, enabled_for_all: true, max_entries: 5, score_threshold: 0.25}, prompts: [{name: 'Main Prompt', enabled: true, content: 'You are a narrator.'}, {name: 'Post-History Instructions', enabled: true, content: ''}], entries: [{comment: 'Novel Foundation', constant: true, position: 0, order: 100, content: 'a b c', key: []}]});
  assert.match(text, /scan depth 2 messages, budget 25% of context, recursive on/);
  assert.match(text, /Vector Storage: source palm; for lorebooks on \(all entries\)/);
  assert.match(text, /Main Prompt → Post-History Instructions/);
  assert.match(text, /“Novel Foundation” — always, before, order 100, 3 words/);
  assert.match(describeEntry({comment: 'X', position: 4, depth: 2, role: 2, excludeRecursion: true}), /depth 2 as assistant.*not triggered by other entries/);
  const sys = assistantSystem();
  assert.match(sys, /=== ACTION: add-entry/);
  assert.match(sys, /Never put documentation text into a story lorebook/);
  assert.match(sys, /name the page you used/);
});

test('long conversations fold older turns into a summary', () => {
  assert.equal(needsCompaction(Array(20).fill({})), 0);
  assert.equal(needsCompaction(Array(31).fill({})), 15);
});

test('the assistant knows what Storyloom delivers itself and cannot switch it on twice', () => {
  const managed = [{title: 'Current Chapter', how: 'sent by the Memory tab as “This chapter”'}, {title: 'Current Writing Directive', how: 'sent through the Author’s Note'}];
  const snap = formatSnapshot({chatLorebook: 'B', managed, memory: [{label: 'This chapter', words: 450, where: '3 messages from the end as system'}, {label: 'Story so far', words: 0}],
    entries: [{comment: 'Current Chapter', disable: true, position: 0, content: 'x'}], entryTexts: [{comment: 'Voice', content: 'psychologica', shortened: true}],
    authorsNote: {text: '<!-- Novel Architect -->\nCURRENT WRITING DIRECTIVE', position: 1, depth: 4, role: 0}});
  assert.match(snap, /“Current Chapter” — off.*managed by Storyloom: sent by the Memory tab/);
  assert.match(snap, /Sent by Storyloom itself each reply \(Memory tab\): This chapter — 450 words, 3 messages from the end as system; Story so far — empty, not sent/);
  assert.match(snap, /contains the Storyloom writing directive/);
  assert.match(snap, /Start of the text of “Voice”:\npsychologica\n\[…shortened here for space/);
  assert.match(assistantSystem(), /switched off in the lorebook ON PURPOSE/);
  const book = {entries: {1: {uid: 1, comment: 'Current Chapter', disable: true}}};
  assert.throws(() => applyAction(book, {type: 'set-placement', book: 'B', title: 'Current Chapter', strategy: 'always'}, () => null, managed), /switched off on purpose.*send it twice/);
  assert.doesNotThrow(() => applyAction(book, {type: 'set-placement', book: 'B', title: 'Current Chapter', strategy: 'off'}, () => null, managed));
});

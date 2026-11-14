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
  assert.throws(() => applyAction(book, {type: 'set-placement', book: 'B', title: 'Current Chapter', strategy: 'always'}, () => null, managed), /managed by Storyloom.*can’t change it/);
  assert.throws(() => applyAction(book, {type: 'edit-entry', book: 'B', title: 'Current Chapter', content: 'x'}, () => null, managed), /managed by Storyloom/);
  const long = {entries: {1: {uid: 1, comment: 'Voice', content: 'POV: First person.\nTone: A slow, psychological unease that builds across the afternoon.'}}};
  assert.throws(() => applyAction(long, {type: 'edit-entry', book: 'B', title: 'Voice', content: 'POV: First person.\nTone: A'}, () => null), /cut “Voice” from .* — it looks like the assistant only saw part of it/);
  assert.doesNotThrow(() => applyAction(long, {type: 'edit-entry', book: 'B', title: 'Voice', content: 'POV: Third person.\nTone: Bright.'}, () => null), 'a genuinely different shorter text is allowed');
});

test('the assistant can propose writing-setup changes, checked strictly', async () => {
  const {parseActions, describeAction, assistantSystem} = await import('../assistant.mjs');
  const r = parseActions('Here.\n=== ACTION: set-preset-prompt\nPROMPT: main\nCONTENT:\nYou are a novelist.\n=== END\n=== ACTION: set-book-setting\nNAME: pov\nSCOPE: book\nCONTENT:\nFirst person, Danny\n=== END\n=== ACTION: set-narrator-card\nCONTENT:\nNo blanks here\n=== END\n=== ACTION: toggle-prompt\nPROMPT: sliders\nENABLED: no\n=== END');
  assert.deepEqual(r.actions.map(a => a.type), ['set-preset-prompt', 'set-book-setting']);
  assert.equal(r.problems.length, 2);
  assert.match(describeAction(r.actions[1]), /book’s pov.*Voice and Boundaries/);
  assert.match(assistantSystem(), /HOW STORYLOOM SETS UP WRITING[\s\S]*Storyloom Novel/);
  assert.match(assistantSystem(), /never the writer's own presets/);
});

test('the Assistant can change Storyloom itself: edit-text, set-option, set-team-member, set-memory cards', async () => {
  const {parseActions, applyTextEdit, describeAction, formatStoryloom, assistantSystem, OPTIONS} = await import('../assistant.mjs');
  const reply = `I'd make the Editor leave dialect alone.
=== ACTION: edit-text
TEXT: team:editor
FIND:
You protect the writer’s voice above everything
REPLACE:
You protect the writer’s voice above everything, dialect and swearing included,
=== END
=== ACTION: set-option
NAME: how-chapters-get-written
VALUE: bit-by-bit
=== END
=== ACTION: set-team-member
ROLE: reader
ENABLED: no
=== END
=== ACTION: set-memory
ITEM: outline
WHERE: chat-depth
DEPTH: 4
ROLE: user
=== END
=== ACTION: set-option
NAME: chapter-length
VALUE: lots
=== END`;
  const {actions, problems, reply: text} = parseActions(reply);
  assert.equal(text, 'I’d make the Editor leave dialect alone.'.replace('’', "'"));
  assert.deepEqual(actions.map(a => a.type), ['edit-text', 'set-option', 'set-team-member', 'set-memory']);
  assert.equal(actions[0].find, 'You protect the writer’s voice above everything');
  assert.equal(actions[0].replace, 'You protect the writer’s voice above everything, dialect and swearing included,');
  assert.equal(actions[1].value, 'bit-by-bit'); assert.equal(actions[2].enabled, false); assert.equal(actions[3].depth, 4);
  assert.equal(problems.length, 1, 'a bad value is a problem, not a card'); assert.match(problems[0], /chapter-length must be a number/);
  assert.match(describeAction(actions[0]), /the editor’s personality/);
  // Edits find their words once, tolerating quote kinds; otherwise they explain.
  assert.equal(applyTextEdit('A "quoted" rule. Another.', 'A “quoted” rule.', 'A new rule.'), 'A new rule. Another.');
  assert.throws(() => applyTextEdit('x and x', 'x', 'y'), /appear 2 times/);
  assert.throws(() => applyTextEdit('abc', 'zzz', 'y'), /aren’t in the current text/);
  assert.equal(applyTextEdit('Rules.', '', 'One more rule.'), 'Rules.\nOne more rule.');
  // The snapshot lists every option with its value, and every text with its wording.
  const snap = formatStoryloom({options: {'how-chapters-get-written': 'all-at-once'}, team: [{role: 'editor', label: 'Editor', enabled: true}], texts: [{id: 'team:editor', label: 'Editor', what: 'x', text: 'You are the Editor.', yours: false}]});
  for (const id of Object.keys(OPTIONS)) assert.ok(snap.includes(`- ${id} (“`), id);
  assert.match(snap, /how-chapters-get-written \(“How chapters get written” in Settings\) = all-at-once \(all-at-once \| bit-by-bit; all books\)/);
  assert.equal(describeAction(actions[1]), 'Settings: “How chapters get written” → bit by bit (all books)');
  assert.match(snap, /--- team:editor — Editor \[Storyloom’s\]/);
  assert.match(assistantSystem(), /You can change anything in Storyloom/);
  assert.match(assistantSystem(), /no quoted sample lines/);
});

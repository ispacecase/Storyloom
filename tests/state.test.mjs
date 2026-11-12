import test from 'node:test';
import assert from 'node:assert/strict';
import { createNovel, applyFact } from '../state.mjs';

test('new novel has blank foundation and requested writing defaults', () => {
  const n = createNovel();
  assert.equal(n.foundation.title, '');
  assert.equal(n.foundation.endingDirection, '');
  assert.equal(n.directive.chapter, 1);
  assert.equal(n.directive.scene, 1);
  assert.equal(n.directive.pov, 'Third-person limited');
  assert.equal(n.directive.tense, 'Past');
  assert.match(n.directive.instructions, /Continue the current scene/);
});

test('additional established facts retain source and do not overwrite earlier canon', () => {
  let n = createNovel();
  n = applyFact(n, { id: 'house', title: 'The house', content: 'Inherited from an aunt.', source: 'side chat' });
  assert.equal(n.entries.house.source, 'side chat');
  assert.throws(() => applyFact(n, { id: 'house', title: 'The house', content: 'Purchased.', source: 'main chat' }), /revision/);
  assert.equal(n.entries.house.content, 'Inherited from an aunt.');
});

test('switching novels isolates conversation, writing and references', async () => {
  const { selectNovel }=await import('../state.mjs');
  let root={}; const a=selectNovel(root,'First'); a.messages.push({content:'First book'}); a.drafts.push('First scene');
  const b=selectNovel(root,'Second'); assert.deepEqual(b.messages,[]); assert.deepEqual(b.drafts,[]);
  assert.equal(selectNovel(root,'First').messages[0].content,'First book');
});

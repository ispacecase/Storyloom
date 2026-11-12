import test from 'node:test';
import assert from 'node:assert/strict';
import { synchronize } from '../sync.mjs';
test('copies note changes back to the book and preserves other note text', () => {
  const r = synchronize({base:'old',book:'old',note:'prefix\n\n<!-- Novel Architect -->\nnew\n<!-- /Novel Architect -->'});
  assert.equal(r.book, 'new'); assert.match(r.note,/prefix/);
});
test('refuses conflicting concurrent edits', () => {
  const r = synchronize({base:'old',book:'book edit',note:'<!-- Novel Architect -->\nnote edit\n<!-- /Novel Architect -->'});
  assert.equal(r.conflict,true);
});

test('conflict resolution preserves unrelated note text', async()=>{
  const {resolveConflict}=await import('../sync.mjs');
  const note='Personal instruction\n\n<!-- Novel Architect -->\nnote version\n<!-- /Novel Architect -->';
  const a=resolveConflict({book:'book version',note},'book');
  assert.equal(a.book,'book version'); assert.match(a.note,/Personal instruction/); assert.match(a.note,/book version/);
  const b=resolveConflict({book:'book version',note},'note'); assert.equal(b.book,'note version');
});

test('setup adopts an existing unmarked directive without duplicating it',async()=>{
 const {planInitialLink}=await import('../sync.mjs');
 const old='CURRENT WRITING DIRECTIVE\nChapter: 4\nContinue the story.';
 const result=planInitialLink(old,null,'default');
 assert.equal(result.book,old);assert.equal(result.note.split('CURRENT WRITING DIRECTIVE').length,2);
});
test('setup preserves unrelated notes and stops on differing existing directives',async()=>{
 const {planInitialLink}=await import('../sync.mjs');
 assert.match(planInitialLink('Personal note',null,'default').note,/Personal note/);
 assert.throws(()=>planInitialLink('CURRENT WRITING DIRECTIVE\nChapter: 4','CURRENT WRITING DIRECTIVE\nChapter: 1','default'),/differ/i);
});

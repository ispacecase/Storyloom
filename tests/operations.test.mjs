import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAssistant, planWrites, syncDecision } from '../operations.mjs';

test('accepts structured response and rejects malformed operations', () => {
  const v = parseAssistant('{"reply":"What is her name?","updates":[{"title":"Protagonist","content":"An unnamed woman.","keys":["woman"]}]}');
  assert.equal(v.updates[0].title, 'Protagonist');
  assert.throws(() => parseAssistant('{"reply":"hi","updates":[{"title":"X"}]}'));
});
test('matches titles without replacing unrelated fields', () => {
  const book = {entries:{'3':{uid:3,comment:'Protagonist',content:'Old',key:['hero'],constant:true}}};
  const writes = planWrites(book,[{title:'protagonist',content:'New',keys:['hero']}]);
  assert.equal(writes[0].uid,3);
  assert.equal(writes[0].prior.constant,true);
  assert.throws(() => planWrites({entries:{1:{uid:1,comment:'A'},2:{uid:2,comment:'a'}}},[{title:'A',content:'X',keys:[]}]), /ambiguous/i);
});
test('sync detects competing changes', () => {
  assert.equal(syncDecision('old','new','old'),'book');
  assert.equal(syncDecision('old','old','new'),'note');
  assert.equal(syncDecision('old','book','note'),'conflict');
});

test('managed note block preserves unrelated text and identifies the directive', async () => {
  const { readDirective, replaceDirective } = await import('../operations.mjs');
  const note = replaceDirective('My own note', 'Chapter 1');
  assert.match(note, /My own note/);
  assert.equal(readDirective(note), 'Chapter 1');
  assert.equal(readDirective(replaceDirective(note, 'Chapter 2')), 'Chapter 2');
  assert.throws(() => readDirective('<!-- Novel Architect -->broken'), /invalid/i);
});

test('foundation updates must preserve the agreed structure', () => {
 const book={entries:{0:{uid:0,comment:'Novel Foundation',content:'original'}}};
 assert.throws(()=>planWrites(book,[{title:'Novel Foundation',content:'Replaced with a summary',keys:[]}]),/foundation/i);
});
test('AI responses cannot be empty or excessively large', () => {
 assert.throws(()=>parseAssistant(JSON.stringify({reply:'',updates:[]})),/response/i);
 assert.throws(()=>parseAssistant(JSON.stringify({reply:'x',updates:[{title:'A',content:'x'.repeat(100001),keys:[]}]})),/content/i);
});

test('missing or comma-separated keywords are repaired without changing content',()=>{
 const r=parseAssistant(JSON.stringify({reply:'Noted',updates:[{title:'Mara',content:'An archivist.'},{title:'Island',content:'A remote island.',keys:'island, ferry'}]}));
 assert.deepEqual(r.updates[0].keys,['Mara']); assert.deepEqual(r.updates[1].keys,['island','ferry']);
});
test('malformed update errors identify the missing field',()=>{
 assert.throws(()=>parseAssistant(JSON.stringify({reply:'Noted',updates:[{title:'Mara',keys:[]}]})),/content/i);
});

test('a collaborative interview can accept plain prose as a reply without invented updates', () => {
  assert.deepEqual(parseAssistant('That gives Mara a compelling dilemma. What does she fear losing?', { allowProse: true }), {reply:'That gives Mara a compelling dilemma. What does she fear losing?',updates:[]});
  assert.throws(() => parseAssistant('That gives Mara a compelling dilemma. What does she fear losing?'));
  assert.throws(() => parseAssistant('{broken json', { allowProse: true }));
});

test('accepts model JSON containing unescaped line breaks inside strings', () => {
  const parsed=parseAssistant('{"reply":"A line\nA second line?","updates":[]}');
  assert.equal(parsed.reply,'A line\nA second line?');
});

test('extracts structured reply when a model prefixes it with prose', () => {
  const value=parseAssistant('Here is my answer.\n\n{"reply":"Here is my answer.","updates":[]}');
  assert.equal(value.reply,'Here is my answer.');
});

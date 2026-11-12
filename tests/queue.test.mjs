import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, nextJob } from '../queue.mjs';
test('does not process one chat’s messages in another', () => {
  const jobs=[]; enqueue(jobs,{chat:'a',index:1,text:'hello'}); enqueue(jobs,{chat:'b',index:2,text:'world'});
  assert.equal(nextJob(jobs,'b').text,'world'); assert.equal(nextJob(jobs,'a').text,'hello');
});
test('does not enqueue identical messages twice', () => {const q=[];const j={chat:'a',index:1,text:'x'};enqueue(q,j);enqueue(q,j);assert.equal(q.length,1);});

test('edits to processed messages require reconciliation', async()=>{
 const {requiresReview}=await import('../queue.mjs');
 const done=[{index:2,raw:'old response',previous:'old prompt'}];
 assert.equal(requiresReview(done,2),true);assert.equal(requiresReview(done,1),true);assert.equal(requiresReview(done,5),false);
});

test('a saved job is recognized after an interrupted queue acknowledgement',async()=>{
 const {wasApplied}=await import('../queue.mjs');
 assert.equal(wasApplied([{jobId:'job-1'}],'job-1'),true);
 assert.equal(wasApplied([{jobId:'job-1'}],'job-2'),false);
});

test('detects tracked messages edited while tracking was disabled',async()=>{
 const {changedProcessed}=await import('../queue.mjs');
 const prior=[{index:1,raw:'answer',previous:'question'}];
 assert.equal(changedProcessed(prior,[{mes:'question'},{mes:'changed'}]),true);
 assert.equal(changedProcessed(prior,[{mes:'question'},{mes:'answer'}]),false);
});

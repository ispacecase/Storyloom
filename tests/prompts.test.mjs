import test from 'node:test';import assert from 'node:assert/strict';import {planningSystem} from '../prompts.mjs';
test('planning has a dedicated collaborative persona independent of the main character',()=>{
 const p=planningSystem('deep');assert.match(p,/Storyloom/);assert.match(p,/independent/i);assert.match(p,/collaborat/i);assert.match(p,/JSON/);assert.match(p,/follow.up|question/i);
});
test('simple and deep have distinct behavior',()=>{
 assert.match(planningSystem('simple'),/skipped|undecided/i);assert.match(planningSystem('deep'),/proposal/i);assert.notEqual(planningSystem('simple'),planningSystem('deep'));
});

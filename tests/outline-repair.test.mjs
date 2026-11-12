import test from 'node:test';
import assert from 'node:assert/strict';
import {repairOutline} from '../outline-repair.mjs';
test('repairs one incomplete result before any save',async()=>{
 const seen=[]; const validate=x=>{if(!x.complete)throw Error('missing outline');};
 const result=await repairOutline({complete:false},validate,async (value,error)=>{seen.push([value,error]);return {complete:true};});
 assert.equal(result.complete,true);assert.equal(seen[0][1],'missing outline');
});
test('rejects a second invalid result',async()=>{
 await assert.rejects(()=>repairOutline({},()=>{throw Error('still invalid')},async()=>({})),/still invalid/);
});

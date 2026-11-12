import test from 'node:test';import assert from 'node:assert/strict';import {normalizePeopleFocus} from '../focus.mjs';
test('preserves the named focus when a model bolds multiple names',()=>{
 const r={updates:[{title:'People',content:'**Iris** | Age: 60\n**Mara** | Age: 32'}]};
 normalizePeopleFocus(r,{people:['**Mara | Age: 32']});
 assert.equal(r.updates[0].content,'Iris | Age: 60\n**Mara** | Age: 32');
});
test('does not guess if the writer’s focus is absent',()=>{
 const r={updates:[{title:'People',content:'**Iris** | Age: 60\n**Mara** | Age: 32'}]};normalizePeopleFocus(r,{people:['**Jules | Age: 22']});assert.match(r.updates[0].content,/\*\*Iris/);
});

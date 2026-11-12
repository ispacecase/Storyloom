import test from 'node:test';import assert from 'node:assert/strict';import {readFile,access} from 'node:fs/promises';
test('extension manifest points to shipped files and local imports exist',async()=>{
 const root=new URL('../',import.meta.url);const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
 assert.equal(manifest.display_name,'Storyloom');
 await access(new URL(manifest.js,root));await access(new URL(manifest.css,root));
 const js=await readFile(new URL(manifest.js,root),'utf8');
 for(const match of js.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)) await access(new URL(match[1],root));
});

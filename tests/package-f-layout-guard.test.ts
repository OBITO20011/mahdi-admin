import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';

test('every Package F spec applies the shared ancestor-clipping layout guard',()=>{
 const files=readdirSync('e2e').filter(name=>/^package-f-.*\.spec\.ts$/u.test(name));assert.ok(files.length>=9);
 for(const file of files){const source=readFileSync(`e2e/${file}`,'utf8');
  assert.match(source,/import \{checkLayout(?: as checkClipping)?\} from '.\/package-f-layout'/u,file);
  assert.match(source,/(?:await checkLayout|await checkClipping)\(page,/u,file);
 }
 const guard=readFileSync('e2e/package-f-layout.ts','utf8');
 assert.match(guard,/ancestor=ancestor\.parentElement/u);assert.match(guard,/\['hidden','clip'\]/u);
 assert.match(guard,/classList\.contains\('truncate'\)/u);assert.match(guard,/line-clamp/u);
});

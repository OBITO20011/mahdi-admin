import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';

test('every Package F axe analysis uses the shared native-animation gate',()=>{
 const specs=readdirSync('e2e').filter(name=>/^package-f-.*\.spec\.ts$/u.test(name));
 assert.ok(specs.length>0);
 for(const name of specs){
  const source=readFileSync(`e2e/${name}`,'utf8');
  if(!source.includes('AxeBuilder'))continue;
  assert.match(source,/import \{[^}]*analyzePackageFAccessibility[^}]*\} from '\.\/package-f-accessibility'/u,name);
  assert.doesNotMatch(source,/new AxeBuilder[^;\n]*\.analyze\(/u,name);
  assert.doesNotMatch(source,/\.disableRules\(|\.exclude\(/u,name);
 }
});

test('shared gate observes finite running,paused and pending Animations before unmodified axe',()=>{
 const source=readFileSync('e2e/package-f-accessibility.ts','utf8');
 assert.match(source,/document\.getAnimations\(\)/u);
 assert.match(source,/animation\.pending/u);
 assert.match(source,/playState==='running'/u);
 assert.match(source,/playState==='paused'/u);
 assert.match(source,/animation\.finished/u);
 assert.match(source,/await waitForPackageFMotion\(page\);\s*return builder\.analyze\(\)/u);
 assert.doesNotMatch(source,/waitForTimeout|setTimeout|disableRules|\.exclude\(/u);
});

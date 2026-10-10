import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');
const packageF=/(?:^|\/)package-f-[^/]+\.spec\.ts$/u;
function list(group,shard){
  const result=spawnSync(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),
    'test','--list','--reporter=json','--config',group?'playwright.ci.config.ts':'playwright.config.ts',
    ...(shard?[`--shard=${shard}/3`]:[])],{
    cwd:root,env:{...process.env,NAWASRAH_BROWSER_GROUP:group??''},
    encoding:'utf8',maxBuffer:32*1024*1024,
  });
  assert.equal(result.status,0,`Playwright list ${group??'full'} failed: ${result.stderr}`);
  const report=JSON.parse(result.stdout);
  assert.deepEqual(report.errors,[],`Discovery errors in ${group??'full'}`);
  const entries=[];
  function visit(suite,parents=[]){
    const titles=[...parents,suite.title];
    for(const spec of suite.specs??[]){
      const file=path.relative(root,path.isAbsolute(spec.file)?spec.file:path.resolve(root,'e2e',spec.file)).replaceAll('\\','/');
      for(const test of spec.tests)entries.push({file,key:JSON.stringify([test.projectName,file,spec.line,spec.column,titles,spec.title])});
    }
    for(const child of suite.suites??[])visit(child,titles);
  }
  for(const suite of report.suites)visit(suite);
  return entries;
}
function verify(full,core,shards){
  assert.equal(shards.length,3,'Exactly three actual Playwright shard lists required');
  const extra=shards.flat();
  const keys=rows=>rows.map(r=>r.key);
  for(const rows of [full,core,...shards,extra])assert.equal(new Set(keys(rows)).size,rows.length,'Duplicate test identity');
  assert.ok(full.length>0&&core.length>0&&shards.every(rows=>rows.length>0),'Empty discovery/group/shard is not a passing partition');
  assert.ok(core.every(r=>!packageF.test(r.file)),'Package F leaked into core');
  assert.ok(extra.every(r=>packageF.test(r.file)),'Non-Package F leaked into Package F');
  assert.deepEqual(keys([...core,...extra]).sort(),keys(full).sort(),'Partition union differs from full discovery');
  return {full:full.length,core:core.length,packageF:extra.length,shards:shards.map(rows=>rows.length)};
}
if(process.argv.includes('--self-test')){
  const a={file:'e2e/regular.spec.ts',key:'a'},b={file:'e2e/package-f-future.spec.ts',key:'b'},
    c={...b,key:'c'},d={...b,key:'d'};
  const full=[a,b,c,d],shards=[[b],[c],[d]];
  assert.deepEqual(verify(full,[a],shards),{full:4,core:1,packageF:3,shards:[1,1,1]});
  assert.throws(()=>verify(full,[a],shards.slice(0,2)));
  assert.throws(()=>verify(full,[a],[[b],[c],[]]));
  assert.throws(()=>verify(full,[a],[[b],[c],[b,d]]));
  assert.throws(()=>verify(full,[a,b],shards));
  assert.throws(()=>verify(full,[a],[[b],[c],[{...d,key:'substituted-project'}]]));
  assert.throws(()=>verify(full,[a],[[b],[c],[d,{...d,key:'unexpected'}]]));
  console.log('Partition rejects missing,duplicate,misrouted and substituted identities');
}else console.log(JSON.stringify(verify(list(),list('core'),[1,2,3].map(shard=>list('package-f',shard)))));

import assert from 'node:assert/strict';
import {packageFShardCount,packageFShards,isPackageFSpec} from './package-f-ci-shards.mjs';
import {listBrowserTests} from './ci-browser-discovery.mjs';
import {coreBrowserGroups,verifyCoreBrowserPartition} from './core-browser-ci-groups.mjs';

const list=(group,shard)=>listBrowserTests(group,{shard,ci:true});
function verify(full,core,shards){
  assert.equal(shards.length,packageFShardCount,'Every approved actual Playwright shard list required');
  const extra=shards.flat();
  const keys=rows=>rows.map(r=>r.key);
  for(const rows of [full,core,...shards,extra])assert.equal(new Set(keys(rows)).size,rows.length,'Duplicate test identity');
  assert.ok(full.length>0&&core.length>0&&shards.every(rows=>rows.length>0),'Empty discovery/group/shard is not a passing partition');
  assert.ok(core.every(r=>!isPackageFSpec(r.file)),'Package F leaked into core');
  assert.ok(extra.every(r=>isPackageFSpec(r.file)),'Non-Package F leaked into Package F');
  assert.deepEqual(keys([...core,...extra]).sort(),keys(full).sort(),'Partition union differs from full discovery');
  for(const project of new Set(extra.map(row=>row.project))){
    const counts=shards.map(rows=>rows.filter(row=>row.project===project).length);
    assert.ok(Math.max(...counts)-Math.min(...counts)<=1,'Per-project cases must be evenly distributed across shards');
  }
  return {full:full.length,core:core.length,packageF:extra.length,shards:shards.map(rows=>rows.length)};
}
if(process.argv.includes('--self-test')){
  const a={file:'e2e/regular.spec.ts',key:'a'};
  const cases=packageFShards.map(shard=>({file:'e2e/package-f-future.spec.ts',key:`f${shard}`}));
  const full=[a,...cases],shards=cases.map(row=>[row]);
  assert.deepEqual(verify(full,[a],shards),{full:1+packageFShardCount,core:1,packageF:packageFShardCount,shards:packageFShards.map(()=>1)});
  assert.throws(()=>verify(full,[a],shards.slice(0,-1)));
  assert.throws(()=>verify(full,[a],shards.map((rows,index)=>index===0?[]:rows)));
  assert.throws(()=>verify(full,[a],shards.map((rows,index)=>index===0?[...rows,cases[1]]:rows)));
  assert.throws(()=>verify(full,[a,cases[0]],shards));
  assert.throws(()=>verify(full,[a],shards.map((rows,index)=>index===0?[{...cases[0],key:'substituted-project'}]:rows)));
  assert.throws(()=>verify(full,[a],shards.map((rows,index)=>index===0?[...rows,{...cases[0],key:'unexpected'}]:rows)));
  console.log('Partition rejects missing,duplicate,misrouted and substituted identities');
}else{
  const core=list('core');
  const coreGroups=verifyCoreBrowserPartition(core,coreBrowserGroups.map(coreGroup=>listBrowserTests('core',{coreGroup,ci:true})));
  console.log(JSON.stringify({...verify(list(),core,packageFShards.map(shard=>list('package-f',shard))),coreGroups}));
}

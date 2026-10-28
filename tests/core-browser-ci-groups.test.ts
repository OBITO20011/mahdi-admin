import assert from 'node:assert/strict';
import test from 'node:test';
import {selectCoreBrowserProjects,verifyCoreBrowserPartition} from '../scripts/testing/core-browser-ci-groups.mjs';

const projects=[{name:'desktop-chromium',device:'desktop'},{name:'mobile-chromium',device:'pixel'},
  {name:'mobile-webkit',device:'iphone'}];
const rows=projects.flatMap(project=>Array.from({length:3},(_,index)=>({
  project:project.name,key:JSON.stringify([project.name,'future.spec.ts',index]),
})));

test('core engine scheduling preserves original project objects and local full discovery;unknown projects fail closed',()=>{
  assert.equal(selectCoreBrowserProjects(projects,undefined),projects);
  assert.equal(selectCoreBrowserProjects(projects,''),projects);
  const chromium=selectCoreBrowserProjects(projects,'chromium'),webkit=selectCoreBrowserProjects(projects,'webkit');
  assert.deepEqual(chromium,[projects[0],projects[1]]);assert.equal(webkit[0],projects[2]);
  assert.throws(()=>selectCoreBrowserProjects(projects,'unknown'),/GROUP_INVALID/u);
  assert.throws(()=>selectCoreBrowserProjects([...projects,{name:'future-engine'}],'webkit'),/INVENTORY_CHANGED/u);
  assert.throws(()=>selectCoreBrowserProjects(projects.slice(1),'chromium'),/INVENTORY_CHANGED/u);
});

test('core coverage proof rejects missing,duplicated,substituted and misrouted real identities',()=>{
  const chromium=rows.filter(row=>row.project!=='mobile-webkit'),webkit=rows.filter(row=>row.project==='mobile-webkit');
  assert.deepEqual(verifyCoreBrowserPartition(rows,[chromium,webkit]),{chromium:6,webkit:3});
  for(const parts of [[chromium],[chromium,[]],[chromium,webkit.slice(1)],
    [chromium,[...webkit,webkit[0]]],[[...chromium,webkit[0]],webkit.slice(1)],
    [chromium,webkit.map((row,index)=>index===0?{...row,key:'substituted-case'}:row)]]){
    assert.throws(()=>verifyCoreBrowserPartition(rows,parts));
  }
});

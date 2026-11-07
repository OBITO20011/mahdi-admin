import {sourceBeforePgNetSequenceState} from '../scripts/audit/source-before-pg-net-sequence-state.mjs';
import{sourceBeforeStorefrontSpeed}from'../scripts/audit/source-before-storefront-speed.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {entries} from '../scripts/audit/source-before-product-workbook-text.mjs';
import {sourceBeforeWorkbookIntegration} from '../scripts/audit/source-before-workbook-integration.mjs';
test('integrated workbook inverse binds approved main66 bytes and exposes every unknown mutation',()=>{
 const baseline='a4fc9dd43c75fab544df4480b5182776f2e35ef5';
 for(const file of Object.keys(entries)){
  const raw=sourceBeforeStorefrontSpeed(file,readFileSync(file,'utf8'))!;
  const known=spawnSync('git',['cat-file','-e',baseline+':'+file],{windowsHide:true});
  const expected=known.status===0?execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024**2}):null;
  assert.equal(sourceBeforeWorkbookIntegration(file,raw),expected,file);
  const unknown=raw+'\n// unknown source or payload mutation\n';
  assert.equal(sourceBeforeWorkbookIntegration(file,unknown),unknown,file);
 }
 assert.equal(sourceBeforeWorkbookIntegration('unreviewed.ts','unknown'),'unknown');
});
test('owner RESET/build helpers retain main66 bytes;approved pg_net diagnostics have an exact historical view',()=>{
 const protectedFiles=JSON.parse(readFileSync('scripts/testing/rehearsal219-owner-source-pins.json','utf8')).files.map((entry:[string,string])=>entry[0]);
 for(const file of protectedFiles){
  const approved=execFileSync('git',['show','a4fc9dd43c75fab544df4480b5182776f2e35ef5:'+file],{windowsHide:true,maxBuffer:32*1024**2});
  // Approved pg_net repair adds only a fixed diagnostic category/stage.
  // Exact inverse proves old bytes;all other owner helpers remain raw byte-equal.
  const raw=readFileSync(file);assert.deepEqual(file==='scripts/backup/postgres-diagnostic.mjs'?Buffer.from(sourceBeforePgNetSequenceState(file,raw.toString('utf8'))!):raw,approved,file);
 }
});

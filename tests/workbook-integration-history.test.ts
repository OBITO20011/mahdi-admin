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
test('all actual production owner helpers retain the approved main66 bytes during workbook integration',()=>{
 const protectedFiles=JSON.parse(readFileSync('scripts/testing/rehearsal219-owner-source-pins.json','utf8')).files.map((entry:[string,string])=>entry[0]);
 for(const file of protectedFiles){
  const approved=execFileSync('git',['show','a4fc9dd43c75fab544df4480b5182776f2e35ef5:'+file],{windowsHide:true,maxBuffer:32*1024**2});
  assert.deepEqual(readFileSync(file),approved,file);
 }
});

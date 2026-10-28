import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {describeRejection,rejectionMessages} from '../src/utils/rejectionMessage';
import {businessErrorMessage} from '../src/utils/businessError';
import {pretrialP1Pins,sourceBeforePretrialP1,inventoryBeforePretrialP1} from '../scripts/audit/source-before-pretrial-p1.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
import {sourceBeforeTrialOwnerA,inventoryBeforeTrialOwnerA} from '../scripts/audit/source-before-trial-owner-a.mjs';
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
const base='b79a9e7bc5e4ff9551c8dab111edb6c04fc17dd3';

test('P1 translates every exact207/208 rejection code and never exposes unknown server detail as success',()=>{
  const sql=read('supabase/migrations/207_document_correction_preview_and_once.sql')+read('supabase/migrations/208_supplier_replacement_and_damage.sql');
  const codes=[...new Set(sql.match(/(?:CORRECTION|SUPPLIER_REPLACEMENT)_[A-Z_]+/gu))];assert.ok(codes.length>=38);
  for(const code of codes){assert.ok(rejectionMessages[code],code);assert.match(describeRejection(code+': internal detail').message,/\p{Script=Arabic}/u);assert.equal(businessErrorMessage(code),rejectionMessages[code]);}
  assert.equal(describeRejection('FUTURE_REJECTION_CODE: private detail').code,'FUTURE_REJECTION_CODE');
  assert.doesNotMatch(describeRejection('FUTURE_REJECTION_CODE: private detail').message,/private detail|نجاح/u);
  assert.equal(describeRejection('الكمية غير متاحة').message,'الكمية غير متاحة');
  assert.match(describeRejection(null).message,/تعذر/u);
});

test('P1 worker only promotes the exact matching release message',async()=>{
  const handlers=new Map<string,(event:{data:unknown;waitUntil:(p:Promise<unknown>)=>void})=>void>();let calls=0;const waits:Promise<unknown>[]=[];
  vm.runInNewContext(read('public/sw.js'),{URL,self:{location:{href:'http://localhost/sw.js?build=release-B'},addEventListener:(name:string,fn:typeof handlers extends Map<string,infer F>?F:never)=>handlers.set(name,fn),skipWaiting:()=>{calls++;return Promise.resolve();}}});
  const send=(data:unknown)=>handlers.get('message')!({data,waitUntil:p=>waits.push(p)});
  send({type:'NAWASRAH_ACTIVATE_RELEASE',buildId:'release-A'});send({type:'UNKNOWN',buildId:'release-B'});send(null);assert.equal(calls,0);
  send({type:'NAWASRAH_ACTIVATE_RELEASE',buildId:'release-B'});await Promise.all(waits);assert.equal(calls,1);
});

test('P1 preserves all service contracts,money/quantity calculations and historical migrations byte-for-byte',()=>{
  const historicalMigrations=execFileSync('git',['ls-tree','-r','--name-only',base,'--','supabase/migrations'],{encoding:'utf8'}).trim().split('\n').filter(file=>/\/\d+_[^/]+\.sql$/u.test(file)).sort();
  const currentHistoricalMigrations=execFileSync('git',['ls-files','--','supabase/migrations'],{encoding:'utf8'}).trim().split('\n').filter(file=>{const version=file.match(/\/(\d+)_[^/]+\.sql$/u)?.[1];return version!==undefined&&Number(version)<=208;}).sort();
  assert.equal(historicalMigrations.length,170);
  assert.deepEqual(currentHistoricalMigrations,historicalMigrations);
  for(const file of historicalMigrations)assert.equal(read(file),execFileSync('git',['show',base+':'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n'),file);
  const paths=['src/services/supabase','src/utils/receivingCalculations.ts','src/utils/supplierReplacement.ts','src/utils/documentCorrection.ts'];
  const changed=execFileSync('git',['diff','--name-only',base,'--',...paths],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  for(const file of changed){const restored=sourceBeforeTrialOwnerA(file,read(file));if(restored!==null)assert.equal(restored,execFileSync('git',['show',base+':'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n'));}
});

test('P1 exact inverse restores every accepted baseline byte;current and restored mutations fail closed',()=>{
  for(const [file,pin]of Object.entries(pretrialP1Pins) as Array<[string,{added?:boolean;before?:string}]>){
    const current=read(file),restored=sourceBeforePretrialP1(file,current);
    assert.throws(()=>sourceBeforePretrialP1(file,current+'\nvoid unapproved;\n'));
    if(pin.added)assert.equal(restored,null);else{assert.equal(restored,execFileSync('git',['show',base+':'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n'));assert.equal(createHash('sha256').update(restored!).digest('hex'),pin.before);}
  }
});

test('P1 keeps immutable208 owner evidence and fresh current SDK proof bound to every source and probe',async()=>{
  const old=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_208.json')),historical=await inventoryBeforePretrialP1();
  assert.deepEqual(historical.sources,old.sourceHashes);assert.deepEqual(verifyProbeCoverage(historical,old.results),old.coverage);
  const current=await inventoryBeforeTrialOwnerA(),proof=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_PRETRIAL_P1.json'));
  assert.equal(JSON.parse(read('docs/agent/project-state.json')).currentTableReadinessEvidence,'docs/operations/TABLE_ACCESS_AFTER_214_IDENTITY_BULK.json');
  assert.deepEqual(current.sources,proof.sourceHashes);assert.deepEqual(verifyProbeCoverage(current,proof.results),proof.coverage);
  assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.equal(proof.managedAccess,false);assert.equal(proof.results.length,142);assert.ok(proof.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
});

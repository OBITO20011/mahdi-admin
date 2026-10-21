import assert from 'node:assert/strict';
import test from 'node:test';
import {readCorrectionPreview} from '../src/utils/documentCorrection';
import {readFileSync} from 'node:fs';
import {assert207History} from '../scripts/operations/frankfurt-owner-upgrade207.mjs';
import {assertReady207Catalog} from '../scripts/operations/frankfurt-reference207.mjs';
import {migrationManifest} from '../scripts/testing/maintenance-db-contract.mjs';
const id='66660000-0000-4000-8000-000000000002';
const fixture=()=>({contractVersion:207,action:'customer_payment',recordId:id,reference:'CRV-207',eligible:true,blockedReason:null,cashShiftId:null,fingerprint:'a'.repeat(64),effect:{cashInMinorUnits:-3000,cliqInMinorUnits:0,customerDebtInMinorUnits:3000,supplierBalanceInMinorUnits:0,inventoryBaseUnits:0,paymentMethod:'cash',paymentInMinorUnits:3000,stock:[]}});
test('207 accepts signed financial deltas and explicit legacy null shift without substituting zero or a new shift',()=>{
 const evidence=fixture();assert.equal(readCorrectionPreview(evidence,'customer_payment',id),evidence);
 for(const corrupt of [{...evidence,recordId:'other'},{...evidence,action:'supplier_payment'},{...evidence,contractVersion:206},{...evidence,fingerprint:null},{...evidence,eligible:false}])assert.throws(()=>readCorrectionPreview(corrupt,'customer_payment',id));
 for(const n of [null,'3000',NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>readCorrectionPreview({...evidence,effect:{...evidence.effect,customerDebtInMinorUnits:n}},'customer_payment',id));
});
test('207 refuses missing stock/WAC evidence instead of displaying an inferred cost',()=>{
 const p={...fixture(),action:'purchase_receipt',effect:{...fixture().effect,stock:[{productName:'عصير',baseUnits:-20,wacBefore:500.5,wacAfter:null}]}};
 assert.equal(readCorrectionPreview(p,'purchase_receipt',id),p);
 for(const stock of [[null],[{}],[{productName:'عصير',baseUnits:-20,wacBefore:500,wacAfter:'0'}]])assert.throws(()=>readCorrectionPreview({...p,effect:{...p.effect,stock}},'purchase_receipt',id));
});
test('207 owner admission accepts every complete199..207 prefix and refuses gaps,duplicates and unreviewed history',async()=>{
 const history=(await migrationManifest(process.cwd())).filter(m=>Number(m.name.slice(0,3))<=207).map((m:{name:string})=>m.name.slice(0,3));
 const reference={appliedVersions:history,prefixes:{199:{appliedVersions:history.slice(0,161)}}};
 for(let count=161;count<=169;count++)assert.deepEqual(assert207History(history.slice(0,count),reference),history.slice(count));
 for(const changed of [history.slice(0,160),[...history,'208'],[...history.slice(0,163),...history.slice(164)],history.map((n:string,i:number)=>i===165?'203':n)])assert.throws(()=>assert207History(changed,reference));
});
test('207 real current catalog preserves private role helper and authenticated RPC ACL without anon grants',()=>{
 const evidence=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_207.json','utf8'));assert.equal(evidence.applicationReady,true);assertReady207Catalog(evidence.catalog);
 for(const target of ['get_document_correction_preview','execute_document_correction_once','correction207_assert_role_internal']){
  const changed=structuredClone(evidence.catalog),f=changed.functions.find((r:{identity:string})=>r.identity.startsWith(target+'('));f.acl.push('anon=X/postgres');assert.throws(()=>assertReady207Catalog(changed));
 }
 const changed=structuredClone(evidence.catalog);changed.indexes.find((r:{name:string})=>r.name==='uq_document_correction207_key').unique=false;assert.throws(()=>assertReady207Catalog(changed));
});

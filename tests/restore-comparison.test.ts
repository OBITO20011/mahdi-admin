import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {logicalRestoreDifferences} from '../scripts/testing/backup-restore-contract.mjs';
import {assertRestoreEvidence} from '../scripts/backup/complete-backup.mjs';
import {buildRestoreComparison,COMPARISON_CODES} from '../scripts/backup/restore-comparison.mjs';
import {postgresDiagnostic,diagnosticError} from '../scripts/backup/postgres-diagnostic.mjs';
const secret='PRIVATE_ROW_VALUE_OR_PASSWORD_NEVER_PERSIST';
const base=()=>({catalog:{functions:[{schema:'public',identity:'test_read()',owner:'postgres',acl:null,configuration:null as string[]|null,definition:'CREATE FUNCTION test_read() RETURNS text AS '+secret}]},tables:{'public.test_table':{rows:3,hash:secret}},roles:[{name:'postgres',super:false,inherit:true,config:['private.setting='+secret]}],memberships:[{role:'postgres',member:'service_role',grantor:'supabase_admin',admin:false,inherit:true,set:true}],history:['214'],sequences:[{schema:'public',name:'test_seq',value:'9007199254740997'}],storage:[{name:secret,bucket_id:'product-images',metadata:{private:secret}}]});
test('each original comparison still rejects with its exact fixed safe code;no values in thrown error',()=>{
 const cases:Array<[string,(r:any)=>void]>=[
  [COMPARISON_CODES[0],r=>{r.catalog.functions[0].definition='OTHER '+secret;}],
  [COMPARISON_CODES[1],r=>{r.tables['public.test_table'].rows=4;}],
  [COMPARISON_CODES[2],r=>{r.roles[0].config=['other='+secret];}],
  [COMPARISON_CODES[3],r=>{r.memberships[0].admin=true;}],
  [COMPARISON_CODES[4],r=>{r.history.push('213');}],
  [COMPARISON_CODES[5],r=>{r.sequences[0].value='9007199254740998';}],
  [COMPARISON_CODES[6],r=>{r.storage[0].metadata.private='changed'+secret;}],
 ];
 for(const [code,mutate]of cases){const b=base(),a=structuredClone(b);mutate(a);assert.throws(()=>assertRestoreEvidence(b,a),error=>{
  const d=postgresDiagnostic(error);assert.equal(d.category,'RESTORE_COMPARISON_FAILED');assert.equal(d.comparisonCode,code);assert.equal(d.stage,'compare-data-catalog-acl');assert.equal(postgresDiagnostic(diagnosticError('RESTORE_FAILED',d)).comparisonCode,code);assert.ok(!JSON.stringify(error).includes(secret));return true;
 });}
 assert.equal(assertRestoreEvidence(base(),base()).allRowsAndHashesMatch,true);
});
test('private report contains names and property names,counts and hashDifferent only',()=>{
 const b=base(),a=structuredClone(b);a.catalog.functions[0].definition='changed '+secret;a.catalog.functions[0].configuration=['private='+secret];a.tables['public.test_table']={rows:4,hash:'different'+secret};a.roles[0].super=true;a.roles[0].config=['changed='+secret];a.sequences[0].value='123456789123456789';a.storage[0].name='changed'+secret;
 const report=buildRestoreComparison(b,a),text=JSON.stringify(report);for(const value of [secret,'123456789123456789','9007199254740997','CREATE FUNCTION','private.setting','changed='])assert.ok(!text.includes(value),value);
 assert.deepEqual(report.tables,[{name:'public.test_table',change:'changed',rows:{before:3,after:4},hashDifferent:true}]);
 assert.deepEqual(report.roles,[{name:'postgres',change:'changed',fields:['super','config']}]);assert.deepEqual(report.sequences,[{schema:'public',name:'test_seq',change:'changed',fields:['value']}]);
 assert.deepEqual(report.catalog[0].fields,['definition','configuration']);assert.equal(report.catalog[0].name,'test_read');assert.equal(report.storage.different,true);
});
test('extra/missing image roles and memberships remain errors,not ignored platform exceptions',()=>{
 for(const role of ['supabase_etl_admin','supabase_admin','service_role','another_role']){const b=base(),a=structuredClone(b);a.roles.push({name:role,super:false,inherit:true,config:[secret]});const diff=buildRestoreComparison(b,a);assert.ok(diff.failedComparisons.includes('RESTORE_ROLES_DIFFER'));assert.equal(diff.roles[0].name,role);assert.equal(diff.roles[0].change,'only-after');assert.throws(()=>assertRestoreEvidence(b,a));}
 const b=base(),a=structuredClone(b);a.memberships=[];const r=buildRestoreComparison(b,a);assert.equal(r.memberships[0].role,'postgres');assert.equal(r.memberships[0].change,'only-before');assert.ok(!JSON.stringify(r).includes(secret));
});
test('new checker preserves original strict acceptance including ordering and function ACL/owner changes',()=>{
 const original=(b:any,a:any)=>logicalRestoreDifferences(b.catalog,a.catalog).length===0&&['tables','roles','memberships','history','sequences','storage'].every(k=>isDeepStrictEqual(b[k],a[k]));
 for(let n=0;n<40;n++){const b=base(),a:any=structuredClone(b);switch(n%8){case 0:break;case 1:a.catalog.functions[0].owner='anon';break;case 2:a.roles.reverse();a.roles.push({name:'test_role',config:[]});break;case 3:a.memberships[0].set=false;break;case 4:a.history.reverse();break;case 5:a.sequences[0].value=null;break;case 6:a.storage=[];break;default:a.tables['public.test_table'].hash='different';}assert.equal(buildRestoreComparison(b,a).ok,original(b,a));}
 const b=base();b.roles.push({name:'other_role',super:false,inherit:true,config:[]});const a=structuredClone(b);a.roles.reverse();const diff=buildRestoreComparison(b,a);assert.equal(diff.ok,false);assert.equal(diff.orderOnly.roles,true);
});
test('comparison code cannot be forged with an arbitrary data value',()=>{
 const d=postgresDiagnostic({diagnostic:{category:'RESTORE_COMPARISON_FAILED',comparisonCode:secret,comparison:base(),message:secret}});assert.equal(d.comparisonCode,undefined);assert.ok(!JSON.stringify(d).includes(secret));
});

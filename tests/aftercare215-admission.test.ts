import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {futureMigrationViolations} from '../scripts/testing/maintenance-db-contract.mjs';
import {assert215History,upgrade215Versions} from '../scripts/operations/frankfurt-owner-upgrade215.mjs';
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');

test('215 admits only the exact reviewed new migration;historical214 is unchanged and arbitrary helper/byte edits fail',()=>{
 const sql=read('supabase/migrations/215_inspected_aftercare_and_supplier_credit.sql');
 const state=JSON.parse(read('docs/agent/project-state.json'));
 assert.equal(state.migrationCeiling,216);
 assert.equal(state.migration215CanonicalLfSha256,createHash('sha256').update(sql).digest('hex').toUpperCase());
 assert.deepEqual(futureMigrationViolations(sql),[]);
 assert.ok(futureMigrationViolations(sql+'\n-- unreviewed\n').length>0);
 assert.ok(futureMigrationViolations(sql+'\nCREATE FUNCTION public.unapproved_before_internal() RETURNS int LANGUAGE sql AS $$SELECT 1$$;').includes('NEW_BEFORE_FUNCTION'));
 assert.doesNotMatch(sql,/\bpg_get_functiondef\s*\(|\bEXECUTE\s+format\s*\(/iu);
});

test('215 owner upgrade accepts complete214 or215 only;no missing migration/backfill or silent ACL repair',()=>{
 const base=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_214.json')).manifest.map((name:string)=>name.slice(0,3));
 const reference={prefixes:{'214':{appliedVersions:base}},appliedVersions:[...base,'215']};
 assert.deepEqual(upgrade215Versions,['215']);assert.equal(base.length,176);
 assert.deepEqual(assert215History(base,reference),['215']);assert.deepEqual(assert215History(reference.appliedVersions,reference),[]);
 for(const history of [base.slice(1),base.slice(0,-1),[...base,'216'],[...base,'215','215'],[...base,'215','216']])assert.throws(()=>assert215History(history,reference));
 const source=read('scripts/operations/frankfurt-owner-upgrade215.mjs');
 assert.match(source,/strictApplicationAcl:true/);assert.match(source,/plan.commandCount,0/);
 assert.doesNotMatch(source,/alignWithExecutor|GRANT EXECUTE|--no-verify-jwt/);
});

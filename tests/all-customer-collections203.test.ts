import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {futureMigrationViolations} from '../scripts/testing/maintenance-db-contract.mjs';
import {assert203History} from '../scripts/operations/frankfurt-owner-upgrade203.mjs';
const read=(f:string)=>readFileSync(f,'utf8').replaceAll('\r\n','\n');
test('203 changes only persisted payment/reversal eligibility;every other202 byte and financial equation is exact',()=>{
 const before=read('supabase/migrations/202_all_customer_collections_read_model.sql'),after=read('supabase/migrations/203_customer_payment_receipts_without_completion.sql');
 assert.equal(createHash('sha256').update(before).digest('hex'),'c6fd0cc7e0d1d79d2fd1e157225cf773431af1bddbe3bffa58a9d2a927645e12');
 const marker='CREATE OR REPLACE FUNCTION public.phase6_financial_facts_internal(',original=before.slice(before.indexOf(marker),before.indexOf('CREATE OR REPLACE FUNCTION public._get_home_dashboard_before133(')).trim();
 let restored=after.slice(after.indexOf(marker),after.lastIndexOf('COMMIT;')).trim();
 const edits=[['FROM public.customer_payments p JOIN public.orders o ON o.id = p.order_id\n    WHERE p_branch_id IS NULL OR o.branch_id = p_branch_id\n    UNION ALL','FROM public.customer_payments p JOIN order_scope o ON o.id = p.order_id\n    UNION ALL'],['FROM public.customer_payments p JOIN public.orders o ON o.id = p.order_id\n    WHERE p.is_reversed AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)','FROM public.customer_payments p JOIN order_scope o ON o.id = p.order_id WHERE p.is_reversed']];
 for(const [current,old] of edits){assert.equal(restored.split(current).length,2);restored=restored.replace(current,old);}
 assert.equal(restored,original);assert.deepEqual(futureMigrationViolations(after),[]);assert.equal([...after.matchAll(/CREATE OR REPLACE FUNCTION/gu)].length,1);
 assert.doesNotMatch(after,/CREATE TABLE|CREATE INDEX|INSERT INTO|UPDATE public\.|DELETE FROM|GRANT EXECUTE/u);
 const state=JSON.parse(read('docs/agent/project-state.json'));assert.equal(state.migrationCeiling,215);assert.equal(state.migration203CanonicalLfSha256,createHash('sha256').update(after).digest('hex').toUpperCase());
});
test('203 upgrade requires an exact complete199..203 prefix,including200 security,never a gap or unknown ceiling',()=>{
 const manifest=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_202.json')).manifest as string[],base=manifest.filter(f=>Number(f.slice(0,3))<=199).map(f=>f.slice(0,3)),versions=[...base,'200','201','202','203'],reference={prefixes:{'199':{appliedVersions:base}},appliedVersions:versions};
 for(let n=161;n<=165;n++)assert.deepEqual(assert203History(versions.slice(0,n),reference),versions.slice(n));
 for(const invalid of [base.slice(1),[...base,'201'],[...base,'200','201','203'],[...versions,'204'],[...base,'152']])assert.throws(()=>assert203History(invalid,reference));
});
test('203 legacy runtime retains real writers,exact all-method values and no invented completion or revenue',()=>{
 const runtime=read('scripts/testing/run-all-collections203-runtime.mjs');
 for(const value of ['record_customer_order_payment_once','receive_customer_cheque_v1','reverse_customer_order_payment','expected(1000,1000,1000,1000)','expected(9000,1000,0,1000)','109000','todaySalesInMinorUnits,0','todaySalesInMinorUnits,30000','netProfitInMinorUnits,24000','expected(-250)','catalogDifference','readApplicationFingerprint','assertPackageDDbLint'])assert.ok(runtime.includes(value),value);
 assert.doesNotMatch(runtime,/DISABLE TRIGGER USER|UPDATE order_status_history|DELETE FROM order_status_history|smokeScale/u);
});

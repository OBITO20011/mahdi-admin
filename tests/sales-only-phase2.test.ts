import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {bridges,sha256} from '../scripts/testing/sales-only-phase1-bridges.mjs';
import {sourceBeforeSalesOnlyPhase2,salesOnlyPhase2Pins} from '../scripts/audit/source-before-sales-only-phase2.mjs';
import {untrackedPreviewSource,costOnlyPreviewFragments,guestFeatureFragment,sharedFeatureFragment} from '../scripts/testing/sales-only-phase2-commercial.mjs';
import {liteReturnSource,returnSourceHunks} from '../scripts/testing/sales-only-phase2-returns.mjs';
import {liteStatementSource,statementHunks} from '../scripts/testing/sales-only-phase2-statement.mjs';

const root=new URL('../',import.meta.url),read=(file:string)=>readFileSync(new URL(file,root),'utf8').replaceAll('\r\n','\n');
test('only owner-approved monitoring bridge diff changes;other7 byte-identical to85',()=>{
 const pins=JSON.parse(read('docs/design/sales-only-phase2/approved-bridge-pins.json'));
 const split=(s:string)=>Object.fromEntries(s.split('--- DB219/').slice(1).map(x=>[x.split('\n')[0],'--- DB219/'+x]));
 const before=split(execFileSync('git',['show',pins.baseline+':docs/design/sales-only-phase1/bridges.patch'],{cwd:root,encoding:'utf8'}));
 const after=split(read('docs/design/sales-only-phase1/bridges.patch'));
 assert.equal(Object.keys(after).length,8);
 for(const name of Object.keys(after)){
  assert.equal(sha256(before[name]),pins.bridges[name].beforeSha256);
  assert.equal(sha256(after[name]),pins.bridges[name].approvedSha256);
  if(name!=='run_advanced_monitoring_checks')assert.equal(after[name],before[name]);
 }
 const h=bridges.find(b=>b.name==='run_advanced_monitoring_checks')!.hunks[0];
 assert.equal(h.to,h.from.replace('\n      AND NOT EXISTS (','\n      AND NOT sales_lite1.is_order(o.id)\n      AND NOT EXISTS ('));
 assert.equal(h.count??1,1);
 assert.equal(execFileSync('git',['diff',pins.baseline,'--','supabase/migrations','docs/design/sales-only-phase1/frozen-functions.json'],{cwd:root,encoding:'utf8'}),'');
});
test('phase2 metadata inverse is exact;unknown bytes remain visible;runtime state isphase2',()=>{
 assert.deepEqual(Object.keys(salesOnlyPhase2Pins.entries).sort(),['docs/agent/PHASE_STATUS.md','docs/agent/project-state.json','supabase/functions/submit-guest-order/index.ts']);
 for(const file of Object.keys(salesOnlyPhase2Pins.entries)){
  const current=read(file),old=execFileSync('git',['show',salesOnlyPhase2Pins.baseline+':'+file],{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n');
  assert.equal(sourceBeforeSalesOnlyPhase2(file,current),old);
  assert.equal(sourceBeforeSalesOnlyPhase2(file,current+'UNKNOWN'),current+'UNKNOWN');
 }
 const state=JSON.parse(read('docs/agent/project-state.json'));assert.equal(state.currentPhase,'SALES_ONLY_PHASE2');assert.equal(state.migrationCeiling,219);assert.equal(state.phaseSALES_ONLY_PHASE2ImplementationAllowed,true);
});
test('private preview keeps pinned commercial body;3cost fragments and exact shared actor guard only',()=>{
 const sql=read('supabase/migrations/132_package_d_system_unification.sql');
 const start=sql.indexOf('CREATE OR REPLACE FUNCTION public.preview_guest_promotion_v2(');
 const tail=sql.slice(start),begin=tail.indexOf('AS $$')+5,end=tail.indexOf('$$;',begin);
 assert.ok(start>0&&begin>5&&end>begin);
 const row={signature:'preview_guest_promotion_v2(jsonb,text,text)',source:tail.slice(begin,end)};
 const actual=untrackedPreviewSource(row);let expected=row.source;
 costOnlyPreviewFragments.forEach((fragment,i)=>{expected=expected.replace(fragment,i===1?'          )\n        INTO v_component_total, v_invalid_component_count':'');});
 expected=expected.replace(guestFeatureFragment,sharedFeatureFragment);
 assert.equal(actual,expected);assert.doesNotMatch(actual,/wac_cost|v_missing_wac/);
 assert.throws(()=>untrackedPreviewSource({...row,source:row.source+' '}),/COMMERCIAL_ORIGINAL_SOURCE_DRIFT/);
 const plan=read('docs/design/sales-only-phase2/commercial-plan.sql');
 assert.doesNotMatch(plan,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER)\b/u);
 assert.match(plan,/public\.phase3_canonicalize_sale_request_internal/);
 assert.match(plan,/public\.phase2_allocate_largest_remainder_internal/);
 assert.match(plan,/public\.parcel209_effective_only_internal/);
});
test('guest writer preservescard/defaultaddress;newwriters share one parcel materializer',()=>{
 const guest=read('docs/design/sales-only-phase2/guest-writer.sql');
 assert.doesNotMatch(guest,/UPDATE public\.(?:customers|customer_addresses)|DELETE FROM public\.(?:customers|customer_addresses)/u);
 assert.match(guest,/lat IS NOT NULL,false\)/);
 assert.match(guest,/sales_lite2\.materialize\(oid,op,plan,'customer_v2',phone,promotion\)/);
 const pos=read('docs/design/sales-only-phase2/pos-writer.sql');
 assert.match(pos,/sales_lite2\.materialize\(oid,op,plan,'admin_pos'\)/);
 assert.equal((pos.match(/CREATE FUNCTION sales_lite2.materialize/g)??[]).length,1);
 assert.match(guest,/FOR UPDATE;END IF;[\s\S]*plan:=sales_lite2.plan/);
 assert.match(guest,/recent>=3/);assert.match(guest,/INTERVAL '10 minutes'/i);
 assert.doesNotMatch(guest,/UPDATE public\.business_operations|inventory_movements|order_inventory_reservations/);
});
test('lite lifecycle uses existing orderlock/payment writer;no stock or historywriter replacement',()=>{
 const sql=read('docs/design/sales-only-phase2/guest-lifecycle.sql');
 assert.match(sql,/public\.phase4_lock_customer_order_context_internal\(p_order,method<>'debt',false\)/);
 assert.match(sql,/public\.record_customer_order_payment_once/);
 assert.match(sql,/o.status NOT IN\('ready','out_for_delivery'\)/);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION|inventory_movements|inventory_balances|order_inventory_reservations|UPDATE public\.business_operations/);
 assert.match(sql,/collected>total/);assert.match(sql,/PHASE3_CUSTOMER_SETTLEMENT_REFERENCE_REQUIRED/);
});

test('lite return preserves pinned215 entitlement algorithm and physical-source identity;unknown body refused',()=>{
 const sql=read('supabase/migrations/215_inspected_aftercare_and_supplier_credit.sql');
 const tail=sql.slice(sql.indexOf('CREATE FUNCTION public.tb215_prepare_return_internal(')),begin=tail.indexOf('AS $$')+5,end=tail.indexOf('$$;',begin);
 const row={signature:'tb215_prepare_return_internal(jsonb)',source:tail.slice(begin,end)};
 let expected=row.source;for(const [from,to] of returnSourceHunks)expected=expected.replace(from,()=>to);
 assert.equal(liteReturnSource(row),expected);
 assert.throws(()=>liteReturnSource({...row,source:row.source+'UNKNOWN'}),/RETURN_ORIGINAL_SOURCE_DRIFT/);
 assert.match(expected,/public\.phase43_assert_return_physical_source_internal/);
 assert.match(expected,/public\.phase42_order_financial_position_internal/);
 const writer=read('docs/design/sales-only-phase2/returns.sql');
 assert.doesNotMatch(writer,/CREATE OR REPLACE FUNCTION|INSERT INTO public\.(?:inventory_movements|sales_return_events)|UPDATE public\.(?:products|order_items)/);
 assert.match(writer,/return_money_requires_shift CHECK\(money_refund=0 OR shift_id IS NOT NULL\)/);
 assert.match(writer,/REVOKE ALL ON FUNCTION public\.lite1_return/);
});

test('parallel statement adds only provenlite movements and completiondate;canonical mismatch guard retained',()=>{
 const sql=read('supabase/migrations/192_cheque_compensation_receivable_readers.sql');
 const tail=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.get_customer_statement(')),begin=tail.indexOf('AS $$')+5,end=tail.indexOf('$$;',begin);
 const row={signature:'get_customer_statement(uuid,integer,integer)',source:tail.slice(begin,end)};
 let expected=row.source;for(const [from,to] of statementHunks)expected=expected.replace(from,()=>to);
 assert.equal(liteStatementSource(row),expected);
 assert.match(expected,/v_evidence_total IS DISTINCT FROM v_canonical/);
 assert.match(expected,/sales_lite1\.is_order\(r.order_id\)/);
 assert.doesNotMatch(expected,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER)\b/u);
 assert.throws(()=>liteStatementSource({...row,source:row.source+'UNKNOWN'}),/STATEMENT_ORIGINAL_SOURCE_DRIFT/);
});

import {sourceBefore198Presentation} from '../scripts/audit/source-before198-presentation.mjs';
import {sourceBeforeUnitTerminology} from '../scripts/audit/source-before-unit-terminology.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {verifyHistoricalWarehouseCoverage as verifyProbeCoverage} from '../scripts/audit/historical-warehouse-query-sites.mjs';
import {assertChequesCatalog} from '../scripts/operations/frankfurt-reference-cheques.mjs';
import {prepareOpeningChequeSheet,openingChequeTemplateRows,OPENING_CHEQUE_COLUMNS} from '../src/features/goLive/openingChequesImport';

const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
test('196 follow-up is exactly four explicit JSONB initializer casts;SQL business expressions and all other bytes stay unchanged',()=>{
 const file='supabase/migrations/196_go_live_opening_cheques.sql',source=read(file);
 const casts=/(JSONB:='(?:\[\]|\{\})')::JSONB/gu;
 assert.equal([...source.matchAll(casts)].length,4);
 assert.equal(source.replace(casts,'$1'),execFileSync('git',['show',`8d1f71c:${file}`],{encoding:'utf8'}).replaceAll('\r\n','\n'));
 const runner=read('scripts/testing/run-opening-cheques-runtime.mjs');assert.match(runner,/assertPackageDDbLint\(lint\)/u);
});
test('196 real-role evidence exactly covers current SDK queries;opening evidence remains RPC-only',async()=>{
 const source=await inventory(),proof=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_196.json'));
 assert.equal(source.migrationCeiling,213);assert.equal(proof.migrationCeiling,196);assert.equal(proof.managedAccess,false);
 assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,await sourceBefore198Presentation(source.sources));
 assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));
 assert.ok(proof.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));assertChequesCatalog(proof.catalog);
 const helpers=['go_live_cheque_party_internal','go_live_cheque_rows_internal','go_live_guard_opening_cheque_internal'];
 for(const name of helpers){const fn=proof.catalog.functions.find((r:{identity:string})=>r.identity.startsWith(name+'('));assert.ok(fn);
  assert.ok(!(fn.acl??[]).some((grant:string)=>/^(?:anon|authenticated|service_role)?=/u.test(grant)));}
 const workflow=read('.github/workflows/quality.yml');assert.match(workflow,/suite: \[[^\]]*opening-cheques/u);assert.match(workflow,/run-opening-cheques-runtime\.mjs/u);
});
test('opening cheque sheet preserves zeros,exact fils and explicit/unknown dates without client balances',()=>{
 const template=openingChequeTemplateRows();
 const input=[template[0],['وارد','مجيّر','بنك','000123','01/12/2026','1,234.567','محمد','0790000000','','شركة التوزيع','2026-10-01','','']];
 const prepared=prepareOpeningChequeSheet(input);assert.deepEqual(prepared.errors,[]);
 assert.deepEqual(prepared.rows,[{sourceRow:2,direction:'incoming',initial_status:'endorsed',bank_name:'بنك',cheque_number:'000123',
  due_date:'2026-12-01',amount_in_minor_units:'1234567',customer_name:'محمد',customer_phone:'0790000000',supplier_name:'',
  endorsed_supplier_name:'شركة التوزيع',cheque_date:'2026-10-01',original_debt_date:'',notes:''}]);
 const unknown=prepareOpeningChequeSheet([template[0],['صادر','قيد الانتظار','بنك','001','2026-12-01','0.001','','','شركة','','','','']]);
 assert.deepEqual(unknown.errors,[]);assert.equal(unknown.rows[0].original_debt_date,'');assert.equal(unknown.rows[0].cheque_date,'');
 assert.equal(unknown.rows[0].amount_in_minor_units,'1');
});
test('opening cheque parser rejects changed headers,invalid dates,rounding and empty files without inventing fields',()=>{
 const header=OPENING_CHEQUE_COLUMNS.map(c=>c[1]);
 assert.ok(prepareOpeningChequeSheet([header.slice(1)]).errors.length);
 assert.ok(prepareOpeningChequeSheet([header]).errors.length);
 const bad=prepareOpeningChequeSheet([header,['وارد','قيد الانتظار','بنك','123','2026-02-30','1.0001','محمد','','','','','','']]);
 assert.equal(bad.errors.length,2);assert.ok(bad.errors.every(e=>e.row===2));
 assert.equal(Object.hasOwn(bad.rows[0],'balance'),false);
});
test('opening card additions leave every existing go-live call,handler and emitted behavior outside the new card byte-identical',()=>{
 const file='src/features/goLive/GoLiveSetupView.tsx';
 const original=execFileSync('git',['show',`e69c22f:${file}`],{encoding:'utf8'}).replaceAll('\r\n','\n');
 const after=sourceBeforeUnitTerminology(file,read(file))!,importLine="import {OpeningChequesCard} from './OpeningChequesCard';\n";
 const cardLine='        {status && <OpeningChequesCard branchId={status.mainBranchId} locked={locked} onSaved={() => void refresh()} />}\n';
 assert.equal(after.split(importLine).length,2);assert.equal(after.split(cardLine).length,2);
 assert.equal(after.replace(importLine,'').replace(cardLine,''),original);
 const service='src/services/supabase/cheques.service.ts';
 assert.equal(read(service).replace('export const readCheque=','const readCheque='),execFileSync('git',['show',`e69c22f:${service}`],{encoding:'utf8'}).replaceAll('\r\n','\n'));
});
test('196 uses existing private evidence,no registration payment/balance/drawer writes and exact existing finish guard',()=>{
 const sql=read('supabase/migrations/196_go_live_opening_cheques.sql');
 assert.doesNotMatch(sql,/pg_get_functiondef|CREATE TABLE|CREATE.*_before_|UPDATE public\.(?:customers|suppliers|orders|cash_shifts)|INSERT INTO public\.(?:customer_payments|supplier_payments|inventory_movements)/u);
 assert.match(sql,/go_live_assert_setup_open_internal\(\)/u);assert.match(sql,/BEFORE INSERT ON public\.deferred_cheques/u);
 assert.match(sql,/public\.customers WHERE id=v_party\.id AND NOT is_deleted FOR UPDATE/u);
 assert.match(sql,/v_plan->'rows' IS DISTINCT FROM v_locked_rows/u);
 assert.match(sql,/go_live_begin_batch_internal\('opening_cheques'/u);
 assert.ok(sql.includes("v_number:=NULLIF(btrim(v_row->>'cheque_number'),'');"));
 assert.match(sql,/COALESCE\(v_original,v_cheque_date\)::TIMESTAMP AT TIME ZONE 'Asia\/Amman'/u);
 assert.match(sql,/origin_kind,origin_id,original_debt_at/u);assert.match(sql,/'opening_cheque',v_id/u);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.record_go_live_cheques_v1\(UUID,TEXT,JSONB\) TO authenticated/u);
 assert.doesNotMatch(sql,/GRANT[^;]+TO anon|GRANT[^;]+ON TABLE/u);
 const ui=read('src/features/goLive/OpeningChequesCard.tsx');
 assert.match(ui,/disabled=locked\|\|busy\|\|!branchId/u);assert.match(ui,/change\('customer',''\)/u);
 assert.match(ui,/preview\.data\.errors\.length>0/u);assert.match(ui,/!confirmed/u);
});

test('196 integrity extension changes only the named opening-voucher admission block;all operational193 evidence checks remain exact',()=>{
 const original=read('supabase/migrations/193_deferred_cheque_lifecycle.sql'),current=read('supabase/migrations/196_go_live_opening_cheques.sql');
 const body=(source:string)=>{const start=source.indexOf('FUNCTION public.cheque_assert_integrity_internal(p_id UUID)');assert.ok(start>0);
  const end=source.indexOf('\n$$;',start);assert.ok(end>start);return source.slice(start,end);};
 const before=body(original),after=body(current);
 const old="    OR(v_c.origin='opening' AND v_c.supplier_payment_id IS NOT NULL)";
 const start=after.indexOf("    OR(v_c.origin='opening' AND NOT EXISTS"),end=after.indexOf("    OR(v_c.origin='operational' AND v_supplier IS NOT NULL",start);
 assert.ok(start>0&&end>start);
 assert.equal(after.slice(0,start)+old+'\n'+after.slice(end),before);
 assert.ok(after.slice(start,end).includes("e.version=1 AND e.kind='opening_registered'"));
 assert.ok(after.slice(start,end).includes("e.kind='endorsed' AND e.version=2"));
 assert.ok(after.slice(start,end).includes("p.payment_method='cheque' AND NOT p.is_reversed"));
});

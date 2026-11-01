import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {buildHome219Migration,extractSqlFunction,historicalShared219Compatibility} from '../scripts/testing/build-home219-read-sql.mjs';
import {originalHomeFactsDefinition} from '../scripts/testing/home-projection219.mjs';
import {buildShared219Definition,adjust208Definition,adjust215Definition} from '../scripts/testing/home-shared-scopes219.mjs';
import {shiftSqlBenchmarkClock,installBenchmark219Clock,home219HardDate} from '../scripts/testing/home-benchmark-clock219.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=(name:string)=>readFile(new URL('../'+name,import.meta.url),'utf8');

test('shared219 SQL is fully generated from immutable203/202/208/215; no financial DML or memory/index change',async()=>{
 const generated=await buildHome219Migration(root);
 assert.equal(generated,await read('supabase/migrations/219_home_financial_facts_narrow_projection.sql'));
 assert.equal(generated.match(/CREATE OR REPLACE FUNCTION/gu)?.length,5);
 assert.equal(generated.match(/REVOKE ALL ON FUNCTION/gu)?.length,3);
 assert.doesNotMatch(generated,/^\s*(INSERT|UPDATE|DELETE|CREATE INDEX|ALTER TABLE|GRANT)\b/mu);
 assert.doesNotMatch(generated,/work_mem|bench219-clock/u);
 const source208=extractSqlFunction(await read('supabase/migrations/208_supplier_replacement_and_damage.sql'),'phase6_financial_facts_internal');
 assert.match(adjust208Definition(source208),/facts:=p_base/u);
 const recovered208=adjust208Definition(source208).split('\nALTER FUNCTION')[0]
  .replace('CREATE OR REPLACE FUNCTION public.home219_adjust208_internal(p_base JSONB,','CREATE OR REPLACE FUNCTION public.phase6_financial_facts_internal(')
  .replace(',p_verify_evidence BOOLEAN)',',p_timezone TEXT,p_verify_evidence BOOLEAN)')
  .replace('facts:=p_base;','facts:=public.phase6_financial_facts_before208_internal(p_branch_id,p_period_start,p_period_end,p_timezone,p_verify_evidence);');
 assert.equal(recovered208,source208,'EVERY208_BUSINESS_BODY_BYTE_UNCHANGED');
 const source215=extractSqlFunction(await read('supabase/migrations/215_inspected_aftercare_and_supplier_credit.sql'),'phase6_financial_facts_internal');
 const recovered215=adjust215Definition(source215).split('\nALTER FUNCTION')[0]
  .replace('CREATE OR REPLACE FUNCTION public.home219_adjust215_internal(p_base JSONB,','CREATE FUNCTION public.phase6_financial_facts_internal(')
  .replace('facts:=public.home219_adjust208_internal(p_base,p_branch_id,p_period_start,p_period_end,p_verify_evidence);','facts:=public.tb215_financial_facts_before215_internal(p_branch_id,p_period_start,p_period_end,p_timezone,p_verify_evidence);');
 assert.equal(recovered215,source215,'EVERY215_BUSINESS_BODY_BYTE_UNCHANGED');
});

test('shared helpers retain215 postprocessing and all unscoped ledgers, without leaking period bounds',async()=>{
 const sql=await buildHome219Migration(root);
 assert.match(sql,/facts:=public\.home219_adjust208_internal\(p_base,/u);
 assert.match(sql,/jsonb_object_agg\(scope219.key,public.home219_adjust215_internal/u);
 const source=await originalHomeFactsDefinition(root,203);
 const shared=buildShared219Definition(source);
 for(const name of ['order_scope','money_events','first_completion','balances'])assert.ok(shared.sharedNames.includes(name));
 assert.ok(shared.scopedNames.includes('period_sales'));
 assert.match(shared.sql,/LEAST\(p_month_start,p_week_start\)/u);
 assert.match(shared.sql,/GREATEST\(p_month_end,p_week_end\)/u);
 assert.match(shared.sql,/completion_at >= scope219.period_start/u);
 assert.match(shared.sql,/completion_at < scope219.period_end/u);
});

test('every approved historical cap can use literal home-core compatibility and exact cleanup',async()=>{
 for(const version of [197,201,202,203]){
  const source=await originalHomeFactsDefinition(root,version);
  const filename=version<=197?'134_package_e_read_performance.sql':version===201?'201_home_collections_and_damage_losses.sql':'202_all_customer_collections_read_model.sql';
  const home=extractSqlFunction(await read('supabase/migrations/'+filename),'_get_home_dashboard_before133');
  const c=historicalShared219Compatibility(source,home);
  assert.match(c.sql,/v_shared219->'week'/u);assert.match(c.sql,/IF v_today_start - INTERVAL '6 days' >= v_month_start/u);
  assert.ok(c.restoreSql.startsWith(source));assert.ok(c.restoreSql.includes(home));assert.match(c.restoreSql,/DROP FUNCTION public.home219_shared_period_facts_internal/u);
 }
});

test('benchmark clock preserves literals/comments and physical instrumentation; supported forms shifted exactly once',()=>{
 assert.equal(home219HardDate,'2026-11-01');
 const text="-- now()\nSELECT 'CURRENT_DATE now()', \"now\", now(),pg_catalog.clock_timestamp(),CURRENT_TIMESTAMP(3),CURRENT_DATE;/* now() */";
 const shifted=shiftSqlBenchmarkClock(text,-50);
 assert.equal(shifted.changes,4);assert.ok(shifted.sql.includes("'CURRENT_DATE now()'"));assert.ok(shifted.sql.includes('-- now()'));
 assert.match(shifted.sql,/pg_catalog\.clock_timestamp\(\) \+ INTERVAL '-50 seconds'/u);
 const fn=shiftSqlBenchmarkClock("DO $$BEGIN PERFORM now(); RAISE NOTICE 'now()'; END$$; SELECT $$now()$$;",1);
 assert.equal(fn.changes,1);assert.ok(fn.sql.endsWith('SELECT $$now()$$;'));
 assert.throws(()=>shiftSqlBenchmarkClock(shifted.sql,1),/DOUBLE_REWRITE/u);
 assert.throws(()=>shiftSqlBenchmarkClock('now()',1.5),/OFFSET_INVALID/u);
 assert.throws(()=>shiftSqlBenchmarkClock('/* broken',1),/UNTERMINATED_COMMENT/u);
});

test('clock fails closed before SQL on a non-whitelisted environment',async()=>{
 let calls=0;await assert.rejects(()=>installBenchmark219Clock({rawSql:async()=>{calls++;return '{}';},project:'frankfurt'}),/LOCAL_PROJECT_REQUIRED/u);assert.equal(calls,0);
});

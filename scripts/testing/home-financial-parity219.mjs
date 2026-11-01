// Runs only inside the isolated full-scale gate. Every variant rolls back;
// complete JSON and the full public function/ACL/settings catalog are compared.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {extractSqlFunction} from './build-home219-read-sql.mjs';
import {originalHomeFactsDefinition} from './home-projection219.mjs';
import {sharedHome219Definition} from './home-shared-scopes219.mjs';
import {shiftSqlBenchmarkClock,home219HardInstant} from './home-benchmark-clock219.mjs';

export async function assertFinancialParity219({root,rawSql,clock,owner}){
 const q=s=>"'"+s.replaceAll("'","''")+"'",json=async s=>JSON.parse(await rawSql(s));
 const catalog="SELECT jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',p.proowner::regrole::text,'acl',p.proacl::text,'config',p.proconfig) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN('f','p');";
 const before=await json(catalog),base=await originalHomeFactsDefinition(root,203,{privateName:true});
 const core=extractSqlFunction(await readFile(path.join(root,'supabase/migrations/202_all_customer_collections_read_model.sql'),'utf8'),'_get_home_dashboard_before133');
 const currentBase=clock.originalDefinition('public.phase6_financial_facts_before208_internal(uuid,timestamp with time zone,timestamp with time zone,text,boolean)');
 const report={completeJson:true,financialWrites:0,roleAndProfileMutationsRolledBack:true,cases:[]};
 const dates=['2026-11-01','2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-15','2026-11-30','2027-01-01'];
 const capture="CREATE FUNCTION pg_temp.read_home219() RETURNS JSONB LANGUAGE plpgsql AS $$BEGIN RETURN jsonb_build_object('result',public.get_home_dashboard());EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('sqlstate',SQLSTATE,'message',SQLERRM);END$$;";
 for(const day of dates){
  const extra=(Date.parse(day+'T12:00:00Z')-Date.parse(home219HardInstant))/1000;
  const offset=clock.report.offsetSeconds+extra;
  // Change the two literal core definitions and the calling SQL together;
  // never alter EXPLAIN timers or PostgreSQL's physical clock.
  const script='BEGIN;'+base+core+"DO $$BEGIN PERFORM set_config('request.jwt.claims',"+q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))+",true);END$$;SET LOCAL ROLE authenticated;SELECT public.get_home_dashboard();RESET ROLE;"+currentBase+sharedHome219Definition(core)+"SET LOCAL ROLE authenticated;SELECT public.get_home_dashboard();ROLLBACK;";
  const pair=(await rawSql(shiftSqlBenchmarkClock(script,offset).sql)).split(/\r?\n/u).map(s=>JSON.parse(s));
  assert.equal(pair.length,2);assert.equal(pair[0].financialFactsStatus,'available');assert.deepEqual(pair[1],pair[0],'HOME219_COMPLETE_FINANCIAL_JSON_DATE:'+day);
  report.cases.push({day,kind:'whole-home',equal:true});
 }
 for(const variant of [{role:'owner',aal:'aal1',active:true},...['manager','admin','sales','warehouse_keeper','accountant','delivery_driver'].map(role=>({role,aal:'aal2',active:true})),{role:'owner',aal:'aal2',active:false},{role:null,aal:'aal2',active:true}]){
  const setup=`DELETE FROM public.user_roles WHERE user_id=${q(owner)};`+(variant.role?`INSERT INTO public.user_roles(user_id,role_id) SELECT ${q(owner)},id FROM public.roles WHERE code=${q(variant.role)};`:'')+`UPDATE public.profiles SET is_active=${variant.active} WHERE id=${q(owner)};`;
  const claims=JSON.stringify({sub:owner,role:'authenticated',aal:variant.aal});
  const script='BEGIN;'+setup+capture+base+core+`DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(claims)},true);END$$;SET LOCAL ROLE authenticated;SELECT pg_temp.read_home219();RESET ROLE;`+currentBase+sharedHome219Definition(core)+'SET LOCAL ROLE authenticated;SELECT pg_temp.read_home219();ROLLBACK;';
  const pair=(await clock.sql(script)).split(/\r?\n/u).map(s=>JSON.parse(s));assert.equal(pair.length,2);assert.deepEqual(pair[1],pair[0],'HOME219_ROLE_AAL_ACTIVITY_PARITY');
  report.cases.push({...variant,kind:'role-and-guards',equal:true});
 }
 assert.deepEqual(await json(catalog),before,'HOME219_PARITY_ALL_FUNCTIONS_ACL_SETTINGS_RESTORED');report.catalogExactlyRestored=true;return report;
}

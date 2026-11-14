// Incomplete223 prototype gate. Fixed disposable222 source; no target argument,
// no owner demo, hosted connection or active migration/history modification.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {startPrices222Local} from './independent-prices222-local.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';

assert.equal(process.argv.length,2,'QUANTITY223_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-quantity223-core-'));
const report={ok:false,output,hostedAccess:false,ownerDemoAccess:false,prototypeOnly:true,cases:[]};
const prototype=canonicalLf(await readFile(path.join(root,'docs/design/off-quantity-counter223/prototype223.sql'),'utf8'));
report.prototypeSha256=sha256(prototype);
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
let db;const started=performance.now();
try{
 db=await startPrices222Local(222,'reference');
 const sql=db.sql,json=async text=>JSON.parse((await sql(text)).split('\n').at(-1));
 const transaction=(call,claims={sub:id(1),role:'authenticated',aal:'aal2'},role='authenticated')=>
  `BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify(claims))},true);SET LOCAL ROLE ${role};SET LOCAL statement_timeout='8s';SELECT public.${call};COMMIT;`;
 const rpc=(call,claims,role)=>json(transaction(call,claims,role));
 const catalog=()=>json(`SELECT jsonb_agg(to_jsonb(x) ORDER BY x.identity) FROM(
 SELECT n.nspname||'.'||p.oid::regprocedure::TEXT AS identity,p.prosrc,pg_get_functiondef(p.oid) AS definition,
 pg_get_userbyid(p.proowner) AS owner,p.proconfig,p.proacl::TEXT AS acl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('public','sales_lite1','sales_lite2') AND p.prokind='f')x;`);
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 const oldCatalog=await catalog(),before=await readApplicationFingerprint(db.executor);
 await sql(prototype);
 const assertOldCatalog=async()=>{
  const current=await catalog(),oldNames=new Set(oldCatalog.map(f=>f.identity));
  assert.deepEqual(current.filter(f=>oldNames.has(f.identity)),oldCatalog,'QUANTITY223_CHANGED_EXISTING_FUNCTION');
  assert.deepEqual(current.filter(f=>!oldNames.has(f.identity)).map(f=>f.identity).sort(),[
   'public.lite3_counter_context223(uuid)',
   'public.lite3_low_counters223(integer,integer)',
   'public.lite3_set_counter223(uuid,boolean,bigint,bigint,bigint,uuid)',
  ].sort(),'QUANTITY223_UNEXPECTED_NEW_PUBLIC_FUNCTION');
 };
 await assertOldCatalog();
 assert.deepEqual((await readApplicationFingerprint(db.executor)).tables,before.tables,'QUANTITY223_APPLY_CHANGED_APPLICATION_ROWS');
 report.cases.push({name:'all existing public/lite1/lite2 functions exact;existing application data unchanged',passed:true,functions:oldCatalog.length});
 const context=()=>rpc(`lite3_counter_context223('${id(103)}')`);
 await assert.rejects(context(),/QUANTITY223_OFF_REQUIRED/u);
 await rpc('lite1_set_mode2(false)');
 const initial=await context();assert.equal(initial.products.length,1);
 assert.equal(initial.products[0].enabled,false);assert.equal(initial.products[0].quantity,0);assert.equal(initial.products[0].revision,0);
 assert.equal(await sql('SELECT count(*) FROM sales_lite3.quantity_counters;'),'0','READ_CREATED_COUNTER');
 report.cases.push({name:'ON refuses counter API;OFF absent counter defaults disabled;reads create no rows',passed:true});
 const family=await rpc(`lite3_counter_context223('${id(100)}')`);
 assert.equal(family.isFamily,true);assert.deepEqual(family.products.map(p=>p.productId).sort(),[id(101),id(102)]);
 const setter=(pid,enabled,qty,threshold,rev,key)=>`lite3_set_counter223('${pid}',${enabled},${qty},${threshold},${rev},'${key}')`;
 await assert.rejects(rpc(setter(id(100),true,3,2,0,id(900))),/QUANTITY223_SELLABLE_PRODUCT_REQUIRED/u);
 const firstCall=setter(id(103),true,3,2,0,id(901));
 const first=await rpc(firstCall);assert.equal(first.quantity,3);assert.equal(first.revision,1);
 const replay=await rpc(firstCall);assert.equal(replay.idempotentReplay,true);assert.equal(replay.revision,1);
 assert.equal(await sql('SELECT count(*) FROM sales_lite3.quantity_events;'),'1');
 await assert.rejects(rpc(setter(id(103),true,4,2,0,id(901))),/QUANTITY223_IDEMPOTENCY_CONFLICT/u);
 await assert.rejects(rpc(setter(id(103),true,4,2,0,id(902))),/QUANTITY223_CONFLICT/u);
 for(const qty of [-1,1000000001])await assert.rejects(rpc(setter(id(101),true,qty,2,0,id(903))),/QUANTITY223_INPUT_INVALID/u);
 assert.equal(await sql(`SELECT count(*) FROM sales_lite3.quantity_requests WHERE key IN('${id(900)}','${id(902)}','${id(903)}');`),'0','FAILED_REQUEST_CONSUMED_KEY');
 report.cases.push({name:'family parent refused;manual CAS/idempotency/negative bounds;failures consume no keys',passed:true});
 for(const [role,claims]of [['anon',{role:'anon'}],['service_role',{role:'service_role'}],['authenticated',{sub:id(1),role:'authenticated',aal:'aal1'}]]){
  await assert.rejects(rpc(firstCall,claims,role),role==='authenticated'?/QUANTITY223_OWNER_AAL2_REQUIRED/u:/permission denied for function/u);
 }
 await assert.rejects(sql(transaction('lite3_counter_context223(NULL)') .replace("SELECT public.lite3_counter_context223(NULL)","SELECT count(*) FROM sales_lite3.quantity_counters")),/permission denied for schema sales_lite3/u);
 report.cases.push({name:'anon/service role denied;owner AAL1 denied;authenticated cannot read private tables',passed:true});
 const calls=[setter(id(103),true,10,2,1,id(904)),setter(id(103),true,20,2,1,id(905))];
 const race=await Promise.allSettled(calls.map(c=>rpc(c)));
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 assert.match(race.find(r=>r.status==='rejected').reason.message,/QUANTITY223_CONFLICT/u);
 const afterRace=(await context()).products[0];assert.equal(afterRace.revision,2);assert.ok([10,20].includes(afterRace.quantity));
 assert.equal(await sql('SELECT count(*) FROM sales_lite3.quantity_events;'),'2');
 report.cases.push({name:'actual two-session manual CAS:one winner,one conflict,no lost update',passed:true});
 const beforeRollback=await json("SELECT jsonb_build_object('counter',(SELECT jsonb_agg(to_jsonb(c)) FROM sales_lite3.quantity_counters c),'events',(SELECT count(*) FROM sales_lite3.quantity_events),'requests',(SELECT count(*) FROM sales_lite3.quantity_requests));");
 await sql(transaction(setter(id(103),true,99,2,2,id(906))).replace('COMMIT;','ROLLBACK;'));
 const afterRollback=await json("SELECT jsonb_build_object('counter',(SELECT jsonb_agg(to_jsonb(c)) FROM sales_lite3.quantity_counters c),'events',(SELECT count(*) FROM sales_lite3.quantity_events),'requests',(SELECT count(*) FROM sales_lite3.quantity_requests));");
 assert.deepEqual(afterRollback,beforeRollback,'QUANTITY223_ROLLBACK_CHANGED_COUNTER');
 await assert.rejects(sql('UPDATE sales_lite3.quantity_events SET quantity_after=0;'),/QUANTITY223_IMMUTABLE_EVIDENCE/u);
 await assert.rejects(sql('TRUNCATE sales_lite3.quantity_requests;'),/QUANTITY223_IMMUTABLE_EVIDENCE/u);
 report.cases.push({name:'rollback restores counter/audit evidence/cache;immutable events and request evidence',passed:true});
 await rpc(setter(id(103),true,0,2,2,id(907)));
 assert.equal((await context()).products[0].effectiveAvailable,false);
 assert.equal((await context()).products[0].manualAvailable,true);
 const low=await rpc('lite3_low_counters223(1,20)');assert.equal(low.total,1);assert.equal(low.products[0].quantity,0);
 await rpc(setter(id(103),false,0,2,3,id(908)));
 assert.equal((await context()).products[0].effectiveAvailable,true);
 assert.equal((await rpc('lite3_low_counters223(1,20)')).total,0);
 report.cases.push({name:'zero unavailable without changing manual availability;disable returns to manual semantics;owner low list',passed:true});
 await assertOldCatalog();
 assert.equal(await sql('SELECT count(*) FROM public.inventory_movements;'),'0');
 assert.equal(await sql('SELECT count(*) FROM public.inventory_balances;'),'0');
 assert.equal(await sql('SELECT count(*) FROM public.order_inventory_reservations;'),'0');
 assert.equal(sha256(canonicalLf(await readFile(path.join(root,'docs/design/off-quantity-counter223/prototype223.sql'),'utf8'))),report.prototypeSha256,'SOURCE_CHANGED_DURING_VERIFICATION');
 report.ok=true;
}catch(error){report.error=String(error.stack??error).slice(0,6000);process.exitCode=1;}
finally{
 if(db){try{await db.stop();report.cleanup=true;}catch(error){report.cleanup=false;report.cleanupError=String(error.message);process.exitCode=1;}}
 report.elapsedMs=Math.round(performance.now()-started);
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}

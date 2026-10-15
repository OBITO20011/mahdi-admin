// Real LOCAL Supabase Realtime/PostgreSQL WebSocket proof. No mocks or managed URL.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {readRealtimePublication,verify151Publication,classify151Frame} from './realtime151-contract.mjs';
import {testJwt,fixtureId as id} from '../audit/table-access-probes.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-realtime151-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-realtime151-'));
const report={startedAt:new Date().toISOString(),managedAccess:false,output};
const clients=[],channels=[];let local,executor,realtimeName,redact=s=>s,stage='bootstrap150';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function bounded(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}}
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'150',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  TURNSTILE_SECRET:'isolated-realtime-captcha-not-invoked',
  NAWASRAH_SUPABASE_EXCLUDE:'storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;executor=executorFor(['--container','supabase_db_'+project]);
 const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
 const json=async text=>JSON.parse(await sql(text));
 const before=await json(schemaCatalogSql),publication=await readRealtimePublication(executor);
 assert.deepEqual(publication.tables,[],'BASE150_PUBLICATION_NOT_EMPTY');
 stage='apply151';const migration=await readFile(path.join(root,'supabase/migrations/151_explicit_application_realtime_publication.sql'),'utf8');
 await sql(migration);report.membership=verify151Publication(publication,await readRealtimePublication(executor));
 assert.deepEqual(catalogDifference(before,await json(schemaCatalogSql)),[],'151_CHANGED_GRANTS_RLS_OR_SCHEMA');
 report.grantsRlsAndSchemaUnchanged=true;const after=await readRealtimePublication(executor);
 await sql(migration);assert.deepEqual(await readRealtimePublication(executor),after);report.idempotent=true;
 stage='fixture';
 await sql('ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 for(const [n,role] of [[2,'cashier'],[3,null]])await sql(`
 INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES('${id(n)}','authenticated','authenticated','realtime-${n}@example.test','{}','{}');
 INSERT INTO profiles(id,full_name,is_active,branch_id) VALUES('${id(n)}','موظف فحص',true,'${id(200)}');
 ${role?`INSERT INTO roles(code,name_ar) VALUES('${role}','كاشير') ON CONFLICT(code) DO NOTHING;
 INSERT INTO user_roles(user_id,role_id) SELECT '${id(n)}',id FROM roles WHERE code='${role}';`:''}`);
 const owner=statement=>json(`BEGIN;SET LOCAL ROLE authenticated;
 DO $$BEGIN PERFORM set_config('request.jwt.claims','{"sub":"${id(1)}","role":"authenticated","aal":"aal2"}',true);END$$;
 SELECT public.${statement};COMMIT;`);
 const received=await owner(`create_direct_supplier_receipt_v2(p_supplier_id:='${id(301)}',p_branch_id:='${id(200)}',p_warehouse_id:='${id(201)}',
 p_idempotency_key:='realtime151-receipt-00000000001',p_payment_method:='deferred',p_lines:='[{"client_line_id":"${id(901)}","line_kind":"base_unit","commercial_quantity":10,"base_unit_name":"باكيت","gross_amount_in_minor_units":2000,"line_discount_in_minor_units":0,"components":[{"product_id":"${id(101)}","base_quantity":10}]}]'::jsonb)`);
 assert.equal(received.success,true);await owner(`open_cash_shift('${id(200)}',0)`);
 stage='real-channels';
 // Local CLI test keys only,in memory. Never print status or container env.
 const status=JSON.parse((await exec(process.execPath,[cli,'status','-o','json','--workdir',local],{cwd:root,windowsHide:true})).stdout);
 const api=new URL(status.API_URL);assert.ok(['127.0.0.1','localhost'].includes(api.hostname),'LOCAL_ONLY');
 api.hostname='127.0.0.1';assert.equal(api.port,'25431');
 const names=(await exec('docker',['ps','--format','{{.Names}}'],{windowsHide:true})).stdout.trim().split(/\r?\n/u);
 const realtime=names.find(n=>n.startsWith('supabase_realtime_')&&n.endsWith(project));assert.ok(realtime,'LOCAL_REALTIME_MISSING');
 realtimeName=realtime;
 const info=JSON.parse((await exec('docker',['inspect',realtime],{windowsHide:true})).stdout)[0];
 const secret=status.JWT_SECRET||info.Config.Env.find(e=>e.startsWith('API_JWT_SECRET='))?.slice('API_JWT_SECRET='.length);
 assert.ok(secret&&status.ANON_KEY,'LOCAL_TEST_SIGNING_CONFIG_REQUIRED');
 const sensitive=[secret,...Object.entries(status).filter(([key])=>/KEY|SECRET|TOKEN/iu.test(key)).map(([,value])=>value),
  ...info.Config.Env.filter(e=>/SECRET|PASSWORD|TOKEN|KEY/iu.test(e.split('=')[0])).map(e=>e.slice(e.indexOf('=')+1))].filter(v=>typeof v==='string'&&v.length>=8);
 redact=text=>{let value=String(text);for(const item of sensitive)value=value.replaceAll(item,'[REDACTED]');
  return value.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,'[REDACTED_JWT]').replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gu,'$1[REDACTED]@');};
 report.systemMessages=[];report.receivedFrames=[];report.denials={anon:0};
 const observed={staff:[],noRole:[],anon:[]},states={},staffEvent=deferred(),forbiddenEvent=deferred();
 for(const [label,actor] of [['staff',id(2)],['noRole',id(3)],['anon',null]]){
  const token=label==='anon'?status.ANON_KEY:testJwt('authenticated',actor,secret);
  const client=createClient(api.origin,status.ANON_KEY,{accessToken:async()=>token,auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{timeout:10000}});clients.push(client);
  await client.realtime.setAuth(token);assert.ok(client.realtime.accessTokenValue===token,'EXACT_REALTIME_TOKEN_REQUIRED');
  const joined=deferred(),databaseReady=deferred();
  const channel=client.channel('realtime151-'+label).on('postgres_changes',{event:'INSERT',schema:'public',table:'orders'},payload=>{
   report.receivedFrames.push({actor:label,eventType:payload.eventType,schema:payload.schema,table:payload.table,
    recordId:payload.new?.id??null,newKeys:Object.keys(payload.new??{}),oldKeys:Object.keys(payload.old??{}),errors:(payload.errors??[]).map(redact)});
   try{
    if(classify151Frame(label,payload)==='denied'){report.denials.anon++;return;}
    observed[label].push(payload.new.id);staffEvent.resolve(payload.new.id);
   }catch{
    forbiddenEvent.resolve(label);if(label==='staff')staffEvent.resolve(null);
   }
  }).on('system',{},payload=>{
   report.systemMessages.push({at:new Date().toISOString(),actor:label,status:payload.status,extension:payload.extension,message:redact(payload.message)});
   if(payload.extension==='postgres_changes'&&payload.status==='ok')databaseReady.resolve();
  }).subscribe((state,error)=>{
   states[label]=state;
   if(state==='SUBSCRIBED')joined.resolve(state);
   else if(state==='CHANNEL_ERROR'||state==='TIMED_OUT'){
    if(label==='anon'&&state==='CHANNEL_ERROR')joined.resolve('DENIED');
    else joined.reject(Error('CHANNEL_JOIN_FAILED:'+label+':'+state+':'+(error?.message??'')));
   }
  });channels.push(channel);
  const joinedState=await bounded(joined.promise,15000,'CHANNEL_JOIN_DEADLINE:'+label);
  // Socket JOIN is not the PostgreSQL CDC readiness notification. The latter
  // confirms that the actual logical subscription exists before our INSERT.
  if(joinedState!=='DENIED')await bounded(databaseReady.promise,15000,'POSTGRES_SUBSCRIPTION_NOT_READY:'+label);
 }
 report.channelStates={...states};report.observedIds=observed;stage='insert-through-public-pos-v2';
 report.insertStartedAt=new Date().toISOString();
 const sale=await owner(`create_pos_sale_v2('${id(201)}','${id(200)}','${id(401)}','عميل فحص','cash',
 '[{"commercial_line_kind":"base_unit","product_id":"${id(101)}","base_quantity":1,"price_authority":"server_catalog","line_discount_in_minor_units":0}]'::jsonb,
 0,1000,'realtime151-sale-000000000000001')`);assert.equal(sale.success,true);
 report.visibility={};
 for(const [label,actor] of [['staff',id(2)],['noRole',id(3)]]){
  const count=await sql(`BEGIN READ ONLY;SET LOCAL ROLE authenticated;DO $$BEGIN PERFORM set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated","aal":"aal2"}',true);END$$;SELECT count(*) FROM orders WHERE id='${sale.orderId}';ROLLBACK;`);
  assert.equal(count,label==='staff'?'1':'0','RLS_ROW_VISIBILITY:'+label);report.visibility[label]=Number(count);
 }
 const eventId=await bounded(staffEvent.promise,15000,'ACTIVE_STAFF_EVENT_MISSING');assert.equal(eventId,sale.orderId);
 // Bound the negative observation after the actual committed INSERT/positive
 // WebSocket delivery. This is an assertion window,not an environmental retry.
 stage='negative-observation';let negativeTimer;
 try{await Promise.race([forbiddenEvent.promise.then(label=>assert.fail('UNAUTHORIZED_REALTIME_EVENT:'+label)),
  new Promise(resolve=>{negativeTimer=setTimeout(resolve,2000);})]);}finally{clearTimeout(negativeTimer);}
 assert.deepEqual(observed,{staff:[sale.orderId],noRole:[],anon:[]});report.events={staff:1,noRole:0,anon:0};
 assert.equal(report.denials.anon,states.anon==='SUBSCRIBED'?1:0,'EXACT_ANON_DENIAL_COUNT');
 for(const [label,actor] of [['staff',id(2)],['noRole',id(3)]]){
  const count=await sql(`BEGIN READ ONLY;SET LOCAL ROLE authenticated;DO $$BEGIN PERFORM set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated","aal":"aal2"}',true);END$$;SELECT count(*) FROM orders WHERE id='${sale.orderId}';ROLLBACK;`);
  assert.equal(count,label==='staff'?'1':'0','RLS_ROW_VISIBILITY:'+label);
 }
 report.realWebSocket=true;report.publicWriter='create_pos_sale_v2';report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.code==='ERR_ASSERTION'?error.message:
 /^(?:CHANNEL_JOIN_FAILED|CHANNEL_JOIN_DEADLINE|ACTIVE_STAFF_EVENT_MISSING)/u.test(error.message)?error.message.split(':').slice(0,3).join(':'):'REALTIME151_FAILED';process.exitCode=1;}
finally{
 if(!report.ok&&realtimeName){
  try{const logs=await exec('docker',['logs','--tail','150',realtimeName],{windowsHide:true,maxBuffer:2*1024**2});await writeFile(path.join(output,'realtime.log'),redact(logs.stdout+'\n'+logs.stderr));}catch{/* preserve primary failure */}
  if(executor)try{const r=await executeInput(executor,"SELECT jsonb_build_object('slots',(SELECT jsonb_agg(jsonb_build_object('name',slot_name,'active',active,'flush',confirmed_flush_lsn::text)) FROM pg_replication_slots),'subscriptions',(SELECT jsonb_agg(jsonb_build_object('id',subscription_id,'entity',entity::regclass::text,'role',claims->>'role','sub',claims->>'sub')) FROM realtime.subscription));");
   if(r.code===0)report.replication=JSON.parse(r.stdout.trim());}catch{/* preserve primary failure */}
 }
 await Promise.all(clients.map(async(client,i)=>{try{if(channels[i])await client.removeChannel(channels[i]);}catch{/* owned stack is also stopped below */}finally{client.realtime.disconnect();}}));
 if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}

// Disposable PostgreSQL only, real service-role SQL plus a loopback Telegram
// HTTP stub. Never loads owner settings, links, secrets or hosted credentials.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {randomUUID,createHmac} from 'node:crypto';import {createServer} from 'node:http';import {once} from 'node:events';
import {createClient} from '@supabase/supabase-js';import {loadPinnedPostgrestImage} from './pinned-postgrest-image.mjs';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
import {ownerTelegramHandler} from '../../supabase/functions/owner-telegram-dispatch/handler.ts';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const project='nawasrah-owner-telegram217-test',executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-owner-telegram217-')),report={output,hostedAccess:false,ok:false,cases:[]};let local,server,restStarted=false,stage='bootstrap';
const rest='nawasrah-owner217-rest',restUrl='http://127.0.0.1:25423';
const q=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async text=>JSON.parse((await sql(text)).split('\n').at(-1));
const service=call=>json('BEGIN;SET LOCAL ROLE service_role;SELECT to_jsonb(public.'+call+');COMMIT;');
const pass=name=>{report.cases.push({name,passed:true});console.log(JSON.stringify({name,passed:true}));};
const clear=()=>sql('DELETE FROM public.automation_events;UPDATE public.owner_telegram_dispatch_settings SET enabled=true,run_id=NULL,lease_expires_at=NULL;');
const event=async(type='new_order',payload={orderNumber:'SYNTHETIC217',totalInMinorUnits:'1235500'})=>{const id=randomUUID();await sql(`INSERT INTO public.automation_events(id,event_key,event_type,entity_id,payload)VALUES(${q(id)},${q('local217:'+id)},${q(type)},${q(id)},${q(JSON.stringify(payload))}::jsonb);`);return id;};
const fail=async(text,pattern)=>{const before=await readApplicationFingerprint(executor),r=await executeInput(executor,text);assert.notEqual(r.code,0);assert.match(r.stderr,pattern);assert.deepEqual(await readApplicationFingerprint(executor),before);};
try{
 const frozen=await readVerificationSourceFreeze(root);
 const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:16*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'216',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});local=JSON.parse(boot.stdout).isolatedProjectRoot;
 const before=await readApplicationFingerprint(executor);stage='literal217';await sql(await readFile(path.join(root,'supabase/migrations/217_owner_telegram_dispatch.sql'),'utf8'));const after=await readApplicationFingerprint(executor);
 // No existing business row/sequence changes during installation.
 delete after.tables.owner_telegram_dispatch_settings;assert.deepEqual(after,before);
 assert.equal(await sql("SELECT count(*) FROM cron.job WHERE jobname='owner-telegram-dispatch' AND schedule='* * * * *' AND command='SELECT public.enqueue_owner_telegram_dispatch_v1();' AND NOT active;"),'1');
 assert.equal((await service(`claim_owner_telegram_deliveries_v1(${q(randomUUID())})`)).code,'OWNER_TELEGRAM_DISABLED');
 const netBefore=await sql('SELECT count(*) FROM net.http_request_queue;');assert.equal(await sql('SELECT public.enqueue_owner_telegram_dispatch_v1() IS NULL;'),'t');assert.equal(await sql('SELECT count(*) FROM net.http_request_queue;'),netBefore);
 pass('literal217 changes no pre-existing table/sequence; singletonfalse and minute cron held;disabled claim/pg_net make zero deliveries');
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;'); // Test-local producer isolation only.
 stage='acl';
 const privateCalls=[`owner217_claim_deliveries_internal('telegram',3,120)`,`owner217_complete_delivery_internal(${q(randomUUID())},'telegram',true,NULL)`,'enqueue_owner_telegram_dispatch_v1()'];
 for(const role of ['anon','authenticated','service_role']){
  for(const call of privateCalls)await fail(`BEGIN;SET LOCAL ROLE ${role};SELECT public.${call};COMMIT;`,/permission denied/u);
  await fail(`BEGIN;SET LOCAL ROLE ${role};SELECT * FROM public.owner_telegram_dispatch_settings;COMMIT;`,/permission denied/u);
  if(role!=='service_role')for(const call of [`claim_owner_telegram_deliveries_v1(${q(randomUUID())})`,`owner_telegram_dispatch_lease_valid_v1(${q(randomUUID())})`,`complete_owner_telegram_delivery_v1(${q(randomUUID())},${q(randomUUID())},true,NULL)`,`release_owner_telegram_dispatch_v1(${q(randomUUID())})`])await fail(`BEGIN;SET LOCAL ROLE ${role};SELECT public.${call};COMMIT;`,/permission denied/u);
 }
 pass('anon/authenticated/service cannot read dispatchsettings or invoke private leaves/cron;only service can call bounded transport RPCs');
 stage='legacy-fence';await clear();const id=await event();
 for(const channel of ['telegram',' TELEGRAM '])for(const call of [`claim_automation_deliveries(${q(channel)},10,120)`,`complete_automation_delivery(${q(id)},${q(channel)},true,NULL)`])await fail(`BEGIN;SET LOCAL ROLE service_role;SELECT public.${call};COMMIT;`,/OWNER_TELEGRAM_EDGE_CONSUMER_REQUIRED/u);
 const whats=await service("claim_automation_deliveries('whatsapp',1,120)");assert.equal(whats.items[0].eventId,id);assert.equal((await service(`complete_automation_delivery(${q(id)},'whatsapp',true,NULL)`)).status,'delivered');
 pass('old n8n Telegram claim/complete always42501/zero writes;existing WhatsApp claim/complete unchanged');
 stage='race';await clear();await event();const a=randomUUID(),b=randomUUID();
 const race=await Promise.all([service(`claim_owner_telegram_deliveries_v1(${q(a)})`),service(`claim_owner_telegram_deliveries_v1(${q(b)})`)]);
 assert.equal(race.filter(r=>r.success===true).length,1);assert.equal(race.filter(r=>r.code==='OWNER_TELEGRAM_BUSY').length,1);
 const holder=race[0].success?a:b,other=holder===a?b:a;
 assert.equal(await service(`owner_telegram_dispatch_lease_valid_v1(${q(holder)})`),true);
 await service(`release_owner_telegram_dispatch_v1(${q(other)})`);assert.equal(await service(`owner_telegram_dispatch_lease_valid_v1(${q(holder)})`),true);
 await fail(`BEGIN;SET LOCAL ROLE service_role;SELECT public.complete_owner_telegram_delivery_v1(${q(other)},${q(race.find(r=>r.success).items[0].eventId)},true,NULL);COMMIT;`,/OWNER_TELEGRAM_LEASE_LOST/u);
 await sql("UPDATE public.owner_telegram_dispatch_settings SET lease_expires_at=clock_timestamp()-INTERVAL '1 second';");
 assert.equal(await service(`owner_telegram_dispatch_lease_valid_v1(${q(holder)})`),false);assert.equal((await service(`claim_owner_telegram_deliveries_v1(${q(other)})`)).items.length,0);
 pass('two real SQL sessions yield one global holder;wrong release/complete and expired holder fenced;live event lease is never stolen');
 stage='bounded';await clear();for(let i=0;i<5;i++)await event();const run=randomUUID(),bounded=await service(`claim_owner_telegram_deliveries_v1(${q(run)})`);assert.equal(bounded.items.length,3);
 await fail(`BEGIN;SET LOCAL ROLE service_role;SELECT public.complete_owner_telegram_delivery_v1(${q(run)},${q(bounded.items[0].eventId)},false,'RAW_ERROR_TOKEN');COMMIT;`,/OWNER_TELEGRAM_COMPLETION_CODE_REQUIRED/u);
 pass('batch limited to3 using original120s event leases;non-allowlisted raw completion text rejected atomically');
 stage='retry-dead-letter';await clear();const retryId=await event();
 for(let i=1;i<=10;i++){const r=randomUUID(),claim=await service(`claim_owner_telegram_deliveries_v1(${q(r)})`);assert.equal(claim.items.length,1);assert.equal(claim.items[0].attemptCount,i);const state=await service(`complete_owner_telegram_delivery_v1(${q(r)},${q(retryId)},false,'OWNER_TELEGRAM_DELIVERY_FAILED')`);assert.equal(state.status,i===10?'dead_letter':'failed');
  const delay=Number(await sql(`SELECT round(extract(epoch FROM(next_attempt_at-updated_at))) FROM automation_event_deliveries WHERE event_id=${q(retryId)} AND channel='telegram';`));assert.equal(delay,Math.min(3600,60*2**Math.min(i,6)));await service(`release_owner_telegram_dispatch_v1(${q(r)})`);await sql(`UPDATE automation_event_deliveries SET next_attempt_at=clock_timestamp()-INTERVAL '1 second' WHERE event_id=${q(retryId)};`);
 }
 assert.equal((await service(`claim_owner_telegram_deliveries_v1(${q(randomUUID())})`)).items.length,0);assert.equal(await sql(`SELECT count(*) FROM automation_event_deliveries WHERE event_id=${q(retryId)} AND status='dead_letter' AND dead_lettered_at IS NOT NULL AND attempt_count=10;`),'1');
 pass('unchanged ten attempts/exact exponential backoff/explicit dead-letter;exhausted delivery never reclaimed');
 stage='held-cron-vault-and-net';
 const activationSql=(await readFile(path.join(root,'docs/operations/OWNER_TELEGRAM217_ENABLE.sql'),'utf8')).replace(/^BEGIN;\r?$/mu,'').replace(/COMMIT;\s*$/u,'');
 const stopSql=(await readFile(path.join(root,'docs/operations/OWNER_TELEGRAM217_DISABLE.sql'),'utf8')).replace(/^BEGIN;\r?$/mu,'').replace(/COMMIT;\s*$/u,'');
 const adminExecutor={...executor,args:[...executor.args]};adminExecutor.args[adminExecutor.args.indexOf('-U')+1]='supabase_admin';
 const captured=await executeInput(adminExecutor,`BEGIN;
 UPDATE public.owner_telegram_dispatch_settings SET enabled=true;
 CREATE OR REPLACE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}'::jsonb,params jsonb DEFAULT '{}'::jsonb,headers jsonb DEFAULT '{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds integer DEFAULT 1000)
 RETURNS bigint LANGUAGE plpgsql AS $capture$ BEGIN
 IF url IS DISTINCT FROM 'https://kzevmysfydaslxcerogt.supabase.co/functions/v1/owner-telegram-dispatch'
  OR body IS DISTINCT FROM '{"mode":"dispatch"}'::jsonb
  OR headers->>'x-owner-telegram-secret' IS DISTINCT FROM 'synthetic-local217-vault-material-only'
  OR timeout_milliseconds<>5000 THEN RAISE EXCEPTION 'LOCAL217_NET_CONTRACT_MISMATCH';END IF;
 RETURN 217;END $capture$;
 DO $proof$ BEGIN
 BEGIN PERFORM public.enqueue_owner_telegram_dispatch_v1();RAISE EXCEPTION 'LOCAL217_EXPECTED_VAULT_REFUSAL';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'OWNER_TELEGRAM_VAULT_SETTINGS_REQUIRED' THEN RAISE;END IF;END;
 END $proof$;
 SELECT vault.create_secret('synthetic-local217-vault-material-only','owner_telegram_dispatch_secret');
 SELECT vault.create_secret('https://invalid.example/never-requested','owner_telegram_dispatch_url');
 DO $proof$ BEGIN
 BEGIN PERFORM public.enqueue_owner_telegram_dispatch_v1();RAISE EXCEPTION 'LOCAL217_EXPECTED_URL_REFUSAL';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'OWNER_TELEGRAM_VAULT_SETTINGS_INVALID' THEN RAISE;END IF;END;
 END $proof$;
 SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name='owner_telegram_dispatch_url'),'https://kzevmysfydaslxcerogt.supabase.co/functions/v1/owner-telegram-dispatch');
 DO $proof$ BEGIN IF public.enqueue_owner_telegram_dispatch_v1()<>217 THEN RAISE EXCEPTION 'LOCAL217_NET_NOT_CAPTURED';END IF;END $proof$;
 UPDATE public.owner_telegram_dispatch_settings SET enabled=false,run_id=NULL,lease_expires_at=NULL;
 ${activationSql}
 DO $proof$ BEGIN IF NOT(SELECT enabled FROM public.owner_telegram_dispatch_settings WHERE id)
   OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='owner-telegram-dispatch' AND active)
 THEN RAISE EXCEPTION 'LOCAL217_OWNER_ACTIVATION_POSTCONDITION';END IF;END $proof$;
 ${stopSql}
 DO $proof$ BEGIN IF (SELECT enabled FROM public.owner_telegram_dispatch_settings WHERE id)
   OR EXISTS(SELECT 1 FROM cron.job WHERE jobname='owner-telegram-dispatch' AND active)
 THEN RAISE EXCEPTION 'LOCAL217_OWNER_STOP_POSTCONDITION';END IF;END $proof$;
 ROLLBACK;`);
 assert.equal(captured.code,0,'LOCAL217_VAULT_NET_PROOF_FAILED:'+captured.stderr);assert.equal(await sql('SELECT count(*) FROM net.http_request_queue;'),netBefore);
 pass('enabled cron refuses missing Vault/wrong URL;transactional pg_net capture and actual owner enable/disable SQL prove exact URL/header/body/timeout and held postconditions;all rolled back without any real request or lasting extension/Vault change');
 stage='loopback-handler';await clear();const sent=[];let good=true;
 server=createServer(async(req,res)=>{let text='';for await(const c of req)text+=String(c);sent.push(JSON.parse(text));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(good?{ok:true,result:{message_id:217,chat:{id:811111111}}}:{ok:false,description:'RAW_'+ 'synthetic-token-never-log'}));});server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
 const secret='local-only-synthetic-dispatch-secret-217',token='123456:'+ 'SYNTHETIC_'.repeat(4),config={secret,enabled:'true',testEnabled:'false',botToken:token,ownerChatId:'811111111',developerChatIdForComparison:'-922222222'};
 const signing='local-owner217-postgrest-signing-material-only',parts=[{alg:'HS256',typ:'JWT'},{role:'service_role',exp:Math.floor(Date.now()/1000)+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')),jwt=parts.join('.')+'.'+createHmac('sha256',signing).update(parts.join('.')).digest('base64url');
 await exec('docker',['run','-d','--name',rest,'--network','supabase_network_'+project,'-p','127.0.0.1:25423:3000','-e','PGRST_DB_URI=postgresql://authenticator:postgres@db:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET='+signing,await loadPinnedPostgrestImage()],{windowsHide:true});restStarted=true;
 const deadline=Date.now()+15000;while(true){try{if((await fetch(restUrl)).ok)break;}catch{/* Local server readiness only. */}assert.ok(Date.now()<deadline,'OWNER217_LOCAL_REST_READINESS');await new Promise(resolve=>setTimeout(resolve,100));}
 let clients=0;const rpcHttp=[];
 // Test-local standalone PostgREST has no Supabase gateway prefix. This is
 // the same REST-only path adapter as table-access-probes;no RPC body mock.
 const client=()=>{clients++;return createClient(restUrl,jwt,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{const endpoint=new URL(String(input));assert.equal(endpoint.origin,restUrl);assert.ok(endpoint.pathname.startsWith('/rest/v1/rpc/'),'LOCAL217_RPC_ONLY');endpoint.pathname=endpoint.pathname.slice('/rest/v1'.length);const result=await fetch(endpoint,{...init,signal:AbortSignal.timeout(5000)});let code=null;if(!result.ok)try{const body=await result.clone().json();code=/^[A-Z0-9_]{3,80}$/u.test(body.code)?body.code:'LOCAL_HTTP_ERROR';}catch{code='LOCAL_NON_JSON_ERROR';}rpcHttp.push({path:endpoint.pathname,status:result.status,code});return result;}}});};
 const probe=await client().rpc('owner_telegram_dispatch_lease_valid_v1',{p_run_id:randomUUID()});report.sdkProbe={errorCode:probe.error?.code??null,status:probe.status,dataIsFalse:probe.data===false};assert.equal(Boolean(probe.error),false,'LOCAL217_SDK_DISPATCH_FAILED:'+String(probe.error?.code));assert.equal(probe.data,false);clients=0;
 const deps={config,createClient:client,uuid:randomUUID,fetch:async(url,init)=>{assert.equal(String(url),'https://api.telegram.org/bot'+token+'/sendMessage');return fetch('http://127.0.0.1:'+port+'/sendMessage',init);}};
 const request=body=>new Request('http://127.0.0.1/dispatch',{method:'POST',headers:{'x-owner-telegram-secret':secret,'Content-Type':'application/json'},body:JSON.stringify(body??{mode:'dispatch'})});
 const handler=ownerTelegramHandler(deps);const okId=await event();const delivered=await(await handler(request())).json();report.firstHttpDispatch={result:delivered,requests:rpcHttp};assert.equal(delivered.delivered,1,'LOCAL217_HTTP_DISPATCH:'+JSON.stringify(report.firstHttpDispatch));assert.equal(sent.length,1);assert.equal(await sql(`SELECT status FROM automation_event_deliveries WHERE event_id=${q(okId)} AND channel='telegram';`),'delivered');
 const failureId=await event();good=false;assert.equal((await(await handler(request())).json()).failed,1);assert.equal(await sql(`SELECT last_error FROM automation_event_deliveries WHERE event_id=${q(failureId)} AND channel='telegram';`),'OWNER_TELEGRAM_DELIVERY_FAILED');
 good=true;await sql(`UPDATE automation_event_deliveries SET next_attempt_at=clock_timestamp()-INTERVAL '1 second' WHERE event_id=${q(failureId)};`);assert.equal((await(await handler(request())).json()).delivered,1);
 const sentBefore=sent.length;await event('business_integrity_warning');await event('business_alert_recovery',{resolvedAlertType:'business_integrity_warning'});assert.equal((await(await handler(request())).json()).failed,2);assert.equal(sent.length,sentBefore);
 const noWrites=await readApplicationFingerprint(executor),noClients=clients;
 assert.equal((await(await ownerTelegramHandler({...deps,config:{...config,enabled:'false'}})(request())).json()).code,'OWNER_TELEGRAM_DISABLED');assert.equal(clients,noClients);assert.deepEqual(await readApplicationFingerprint(executor),noWrites);
 const test=ownerTelegramHandler({...deps,config:{...config,enabled:'false',testEnabled:'true'}});assert.equal((await(await test(request({mode:'test',testConsent:true}))).json()).testDelivered,true);assert.equal(clients,noClients);assert.deepEqual(await readApplicationFingerprint(executor),noWrites);
 pass('real production handler + Supabase SDK + PostgREST service JWT + DB to loopback Telegram:send/ack,failure/retry,integrity/recoveryexcluded,disabledzero writes and manualtestzero claims');
 stage='business-invariance-and-integrity';await clear();await sql('UPDATE public.owner_telegram_dispatch_settings SET enabled=false;');
 const unchanged=await readApplicationFingerprint(executor);delete unchanged.tables.owner_telegram_dispatch_settings;assert.deepEqual(unchanged,before,'OWNER217_TRANSPORT_CANNOT_CHANGE_ANY_EXISTING_BUSINESS_TABLE_OR_SEQUENCE');
 await sql('SELECT public.run_advanced_monitoring_checks(NOW());');
 report.integrity=await json("SELECT jsonb_agg(jsonb_build_object('key',check_key,'status',status,'issues',issue_count) ORDER BY check_key) FROM advanced_monitoring_checks WHERE check_key LIKE 'integrity:%';");
 assert.equal(report.integrity.length,17);for(const check of report.integrity){assert.equal(check.status,'healthy',check.key);assert.equal(check.issues,0,check.key);}
 pass('every existing public business row and sequence unchanged after all transport cases;all17 current integrity checks healthy/zero after synthetic outbox cleanup');
 stage='source-freeze';assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));Object.assign(report,{ok:true,repositoryStayedFrozen:true});
}catch(error){Object.assign(report,{stage,error:error.message});throw error;}
finally{if(server)await new Promise(resolve=>server.close(resolve));if(restStarted)await exec('docker',['rm','-f',rest],{windowsHide:true});if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}

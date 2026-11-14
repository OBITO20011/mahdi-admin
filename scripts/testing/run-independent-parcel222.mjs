// Fixed identity, local Docker only; no target URL, owner workdir or resume flags.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {functionCatalogSql} from './sales-only-phase1-runtime.mjs';
import {verifyLiteParcelCapacityPath} from './lite-parcel-unit-runtime.mjs';
import {verifyIndependentParcel222Writers} from './independent-parcel222-writers.mjs';
import {verifyIndependentParcel222History} from './independent-parcel222-runtime.mjs';
import {verifyIndependentParcel222Concurrency} from './independent-parcel222-concurrency.mjs';
import {verifyIndependentParcel222Mixed} from './independent-parcel222-mixed.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';

assert.equal(process.argv.length,2,'NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const project='nawasrah-independent-price222-test',container='supabase_db_'+project;
const output=path.join(root,'test-results/independent-parcel222');
await mkdir(output,{recursive:true});
const report={ok:false,hostedAccess:false,ownerDemoAccess:false,cases:[]};let local,ownedId;
const docker=(...args)=>exec('docker',args,{cwd:root,windowsHide:true,maxBuffer:32*1024**2});
try{
 const freeze=await readVerificationSourceFreeze(root);
 const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:32*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'220',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 const first=JSON.parse((await docker('inspect',container)).stdout)[0];ownedId=first.Id;
 assert.equal(first.Config.Labels['com.supabase.cli.project'],project);
 assert.equal(path.resolve(first.Config.Labels['com.supabase.cli.workdir']),path.resolve(local));
 for(const network of Object.keys(first.NetworkSettings.Networks))await docker('network','disconnect',network,container);
 const executor=executorFor(['--container',container]);
 const owned=async()=>{const d=JSON.parse((await docker('inspect',container)).stdout)[0];assert.equal(d.Id,ownedId);assert.equal(d.Config.Labels['com.supabase.cli.project'],project);assert.deepEqual(Object.keys(d.NetworkSettings.Networks),[]);};
 const sql=async text=>{await owned();const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
 const json=async text=>JSON.parse((await sql(text)).split('\n').at(-1));
 const q=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
 const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const rpc=call=>json(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::TEXT,true);SET LOCAL ROLE authenticated;SET LOCAL statement_timeout='8s';SELECT public.${call};COMMIT;`);
 const c={sql,json,rpc,id,q,j,executor};
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 await rpc(`set_go_live_main_branch_v1(${q(id(200))})`);
 await verifyLiteParcelCapacityPath(c,report,{full:true});
 const before=await json(functionCatalogSql);assert.equal(before.length,680);
 const migration=canonicalLf(await readFile(path.join(root,'supabase/migrations/222_independent_lite_parcel_prices.sql'),'utf8'));
 await sql(migration);await sql("INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('222','independent_lite_parcel_prices');");
 report.migration222Sha256=sha256(migration);
 const after=await json(functionCatalogSql);assert.equal(after.length,683);
 assert.deepEqual(after.filter(row=>before.some(old=>old.signature===row.signature)),before,'PRICES222_CHANGED_OLD680');
 report.cases.push({name:'all680 public bodies/definitions/owners/config/rawACL unchanged',passed:true});
 await verifyLiteParcelCapacityPath(c,report,{full:true});
 await assert.rejects(rpc(`create_product_with_opening_stock_v6('PRICE222-ON-REFUSED',p_unit_id:=${q(id(10))},p_sale_unit_id:=${q(id(10))},p_sale_price_in_minor_units:=900,p_default_sale_price_in_minor_units:=900)`),/PRICES222_OFF_REQUIRED/);
 await rpc('lite1_set_mode2(false)');
 await verifyIndependentParcel222Writers(c,report);
 await verifyIndependentParcel222History(c,report);
 await verifyIndependentParcel222Mixed(c,report);
 await verifyIndependentParcel222Concurrency(c,report);
 assertVerificationSourceFreeze(freeze,await readVerificationSourceFreeze(root));
 report.ok=true;
}catch(error){report.error=String(error.message).slice(0,6000);process.exitCode=1;}
finally{
 if(local&&ownedId){try{const d=JSON.parse((await docker('inspect',container)).stdout)[0];assert.equal(d.Id,ownedId);assert.equal(d.Config.Labels['com.supabase.cli.project'],project);assert.equal(path.resolve(d.Config.Labels['com.supabase.cli.workdir']),path.resolve(local));await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'stop','--workdir',local,'--no-backup'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});report.cleanup=true;}catch{report.cleanup=false;process.exitCode=1;}}
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}

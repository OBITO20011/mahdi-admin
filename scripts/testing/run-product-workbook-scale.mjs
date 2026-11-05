// Manual full219 scale rehearsal. Fixed freshly-created disposable project only.
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {runProductWorkbookScaleCase} from './product-workbook-scale-case.mjs';
import {consumeScaleUtf8} from './scale-utf8-stream.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
assert.ok(process.argv.length===3&&['--full','--small'].includes(process.argv[2]),'SCALE_EXPLICIT_MODE_REQUIRED');
const full=process.argv[2]==='--full',project='nawasrah-product-template-test',container='supabase_db_'+project;
const out=await mkdtemp(path.join(tmpdir(),'nawasrah-product-scale-')),executor=executorFor(['--container',container]);
// No application network is permitted, including an accidentally bundled SDK.
globalThis.fetch=()=>{throw Error('SCALE_EXTERNAL_NETWORK_FORBIDDEN');};
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const sql=async text=>{const r=await executeInput(executor,"SET statement_timeout='60s';SET lock_timeout='20s';\n"+text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const asJson=s=>JSON.parse(s.split(/\r?\n/u).filter(Boolean).at(-1));
const actor='92600000-0000-4000-8000-000000000001';
const auth=text=>`BEGIN;SET LOCAL request.jwt.claims=${q(JSON.stringify({sub:actor,role:'authenticated',aal:'aal2'}))};SET LOCAL ROLE authenticated;SET LOCAL statement_timeout='8s';${text}COMMIT;`;
let local,ownedId,session,stage='bootstrap';
try{
 const running=await exec('docker',['ps','--format','{{.Names}}'],{windowsHide:true});assert.ok(!running.stdout.split(/\r?\n/u).includes(container),'DO_NOT_ADOPT_RUNNING_DATABASE');
 const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,timeout:900000,maxBuffer:8*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'219',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(stdout).isolatedProjectRoot;assert.ok(local);assert.equal(await sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'180');
 const info=JSON.parse((await exec('docker',['inspect',container],{maxBuffer:1024**2,windowsHide:true})).stdout)[0];ownedId=info.Id;
 // After image/bootstrap setup, sever every Docker network before fixture work.
 for(const network of Object.keys(info.NetworkSettings.Networks))await exec('docker',['network','disconnect',network,ownedId],{windowsHide:true});
 const isolated=JSON.parse((await exec('docker',['inspect',ownedId],{maxBuffer:1024**2,windowsHide:true})).stdout)[0];assert.deepEqual(Object.keys(isolated.NetworkSettings.Networks),[]);
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 await sql("ALTER ROLE authenticated SET statement_timeout='8s';ALTER ROLE anon SET statement_timeout='3s';");
 const catalog=asJson(await sql(schemaCatalogSql));
 stage='role timeout negative controls';
 for(const[role,seconds]of [['authenticated',8],['anon',3]]){
  const result=await executeInput(executor,`BEGIN;SET LOCAL ROLE ${role};SET LOCAL statement_timeout='${seconds}s';SELECT pg_sleep(${seconds+0.1});ROLLBACK;`);
  assert.notEqual(result.code,0);assert.match(result.stderr,/statement timeout/u);
 }
 stage='current services scale';
 // Persistent local psql removes CLI process creation from request measurements;
 // application SELECT/RPC and role/timeouts are unchanged. Requests serialize.
 session=spawn('docker',['exec','-i',ownedId,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=0'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let queue=Promise.resolve(),pending,buffer='',sequence=0,ended=false;
 session.on('exit',()=>{ended=true;pending?.reject(Error('SCALE_LOCAL_SESSION_EXIT'));});
 consumeScaleUtf8(session.stdout,chunk=>{buffer+=chunk;if(pending){const at=buffer.indexOf(pending.marker);if(at>=0){const text=buffer.slice(0,at);buffer=buffer.slice(at+pending.marker.length).replace(/^\r?\n/u,'');const task=pending;pending=null;setImmediate(()=>task.stderr?task.reject(Error('SCALE_SQL_REFUSED:'+task.stderr.slice(0,300))):task.resolve(text.trim()));}}});
 consumeScaleUtf8(session.stderr,chunk=>{if(pending)pending.stderr+=chunk;});
 const persistent=text=>{const result=queue.then(()=>new Promise((resolve,reject)=>{assert.equal(ended,false);assert.ok(!pending);const marker='__SCALE_DONE_'+(++sequence)+'__';pending={marker,resolve,reject,stderr:''};session.stdin.write(text+'\n\\echo '+marker+'\n');}));queue=result.catch(()=>{});return result;};
 const json=async text=>asJson(await persistent(text));
 const report=await runProductWorkbookScaleCase({json,sql,auth,actor,container,out,full});
 session.stdin.end();await new Promise(resolve=>session.once('exit',resolve));session=null;
 assert.deepEqual(catalogDifference(catalog,asJson(await sql(schemaCatalogSql))),[]);
 await writeFile(path.join(out,'isolation.json'),JSON.stringify({ok:true,containerId:ownedId,history:180,ceiling:219,networks:[],applicationFetchBlocked:true,catalogDifferences:0,timeoutNegativeControls:['authenticated8s','anon3s']},null,2)+'\n');
 console.log(JSON.stringify({ok:true,out,parents:report.parents,flavors:report.flavors,catalogDifferences:0}));
}catch(error){await writeFile(path.join(out,'failure.json'),JSON.stringify({ok:false,stage,message:error.message},null,2)+'\n');console.error(JSON.stringify({ok:false,out,stage,message:error.message}));process.exitCode=1;}
finally{
 session?.stdin.end();
 if(local){if(ownedId){const current=JSON.parse((await exec('docker',['inspect',container],{windowsHide:true})).stdout)[0];assert.equal(current.Id,ownedId,'REFUSE_CLEANUP_REPLACEMENT');}await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024**2});}
}

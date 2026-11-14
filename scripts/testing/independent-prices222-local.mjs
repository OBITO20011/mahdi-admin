// Dedicated DB-only test stack. The shared-port bootstrap and its active-stack
// refusal are untouched. No caller-supplied URL, workdir, image or connection.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,cp,realpath,unlink,rmdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {withIsolatedSupabasePorts,isolatedSupabasePortSettings} from './isolated-supabase-ports.mjs';
import {databasePortsFromConfig,waitForDatabasePorts} from './isolated-db-port-guard.mjs';
import {operationalManifest} from '../operations/operational-schema.mjs';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
// CLI truncates project identifiers beyond 40 chars. Keep this identity short
// so its literal config, labels, container and cleanup guard always agree.
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const exclude='gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';
const docker=(...args)=>exec('docker',args,{windowsHide:true,maxBuffer:32*1024**2});
// CLI start/stop also touches shared Docker/CLI resources. Different TCP ports
// are insufficient evidence that those commands may overlap. Refuse overlap;
// never retry a command or delete a crashed process's guard automatically.
async function cliLease(project){
 const folder=path.join(tmpdir(),'nawasrah-prices222-cli.guard'),file=path.join(folder,'lease.json'),lease={project,pid:process.pid,token:randomUUID()};
 try{await mkdir(folder);}catch(error){if(error.code==='EEXIST')throw Error('PRICES222_CLI_BUSY_INSPECT_OWNING_PROCESS',{cause:error});throw error;}
 await writeFile(file,JSON.stringify(lease),{flag:'wx'});
 return async()=>{assert.deepEqual(JSON.parse(await readFile(file,'utf8')),lease,'PRICES222_CLI_LEASE_CHANGED');await unlink(file);await rmdir(folder);};
}
export async function startPrices222Local(ceiling,purpose='reference'){
 assert.ok([220,222].includes(ceiling),'PRICES222_LOCAL_CEILING');
 const projects={reference:'nawasrah-prices222-reference-test',tables:'nawasrah-table-audit-c222-test',services:'nawasrah-service-audit-c222-test',upgrade:'nawasrah-owner-upgrade222-test',reset:'nawasrah-reset222-resume-test'};
 assert.ok(Object.hasOwn(projects,purpose),'PRICES222_FIXED_TEST_PURPOSE');
 const project=projects[purpose],container='supabase_db_'+project;
 const manifest=(await operationalManifest()).filter(m=>Number(m.name.slice(0,3))<=ceiling);
 assert.equal(manifest.length,ceiling===220?181:182);
 const names=(await docker('ps','-a','--format','{{.Names}}')).stdout.split(/\r?\n/u);
 assert.ok(!names.some(n=>n.endsWith('_'+project)),'PRICES222_OWN_STACK_ALREADY_EXISTS');
 const volumes=(await docker('volume','ls','--format','{{.Name}}')).stdout.split(/\r?\n/u);
 assert.ok(!volumes.some(n=>n.endsWith('_'+project)),'PRICES222_FRESH_VOLUME_REQUIRED');
 const local=await mkdtemp(path.join(tmpdir(),'nawasrah-prices222-db-'));
 const relative=path.relative(root,await realpath(local));
 assert.ok(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'PRICES222_EXTERNAL_TEMP_REQUIRED');
 await mkdir(path.join(local,'supabase'));
 let config=withIsolatedSupabasePorts(await readFile(path.join(root,'supabase/config.toml'),'utf8'));
 config=config.replace(/^project_id\s*=.*$/mu,'project_id = "'+project+'"');
 const offset={reference:8000,tables:9000,services:7000,upgrade:10000,reset:11000}[purpose];
 for(const setting of isolatedSupabasePortSettings)config=config.replaceAll(String(setting.port),String(setting.port-offset));
 await waitForDatabasePorts(databasePortsFromConfig(config));
 await writeFile(path.join(local,'supabase/config.toml'),config);
 await cp(path.join(root,'supabase/seed.sql'),path.join(local,'supabase/seed.sql'));
 await mkdir(path.join(local,'supabase/migrations'));
 for(const m of manifest){const text=canonicalLf(await readFile(path.join(root,'supabase/migrations',m.name),'utf8'));assert.equal(sha256(text),m.sha256);await writeFile(path.join(local,'supabase/migrations',m.name),text);}
 // The same bounded historical034 fixture repair as the canonical bootstrap.
 const cleanup=path.join(local,'supabase/migrations/034_prelaunch_test_data_cleanup.sql'),original=await readFile(cleanup,'utf8');
 assert.equal(sha256(original),manifest.find(m=>m.name.startsWith('034_')).sha256);
 const from='    public.supplier_payments,\n    public.supplier_receipt_items,';
 assert.equal(original.split(from).length,2);
 await writeFile(cleanup,original.replace(from,'    public.supplier_payments,\n    public.supplier_return_items,\n    public.supplier_returns,\n    public.stock_count_items,\n    public.stock_counts,\n    public.supplier_receipt_items,'));
 let ownedId;
 const inspect=async()=>JSON.parse((await docker('inspect',container)).stdout)[0];
 const assertOwned=async()=>{const d=await inspect();assert.equal(d.Id,ownedId);assert.equal(d.Config.Labels['com.supabase.cli.project'],project);assert.equal(path.resolve(d.Config.Labels['com.supabase.cli.workdir']),local);return d;};
 const assertRemoved=async()=>{assert.ok(!(await docker('ps','-a','--format','{{.Names}}')).stdout.split(/\r?\n/u).some(n=>n.endsWith('_'+project)),'PRICES222_OWN_CONTAINER_REMAINS');assert.ok(!(await docker('volume','ls','--format','{{.Name}}')).stdout.split(/\r?\n/u).some(n=>n.endsWith('_'+project)),'PRICES222_OWN_VOLUME_REMAINS');};
 const stopOwned=async()=>{assert.ok(ownedId,'PRICES222_CLEANUP_OWNED_ID_REQUIRED');await assertOwned();await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:16*1024**2});await assertRemoved();};
 const stop=async()=>{const release=await cliLease(project);try{await stopOwned();}finally{await release();}};
 const release=await cliLease(project);
 try{
  await exec(process.execPath,[cli,'start','--workdir',local,'--exclude',exclude],{cwd:root,windowsHide:true,maxBuffer:32*1024**2});
  const d=await inspect();assert.equal(d.Config.Labels['com.supabase.cli.project'],project);assert.equal(path.resolve(d.Config.Labels['com.supabase.cli.workdir']),local);ownedId=d.Id;
  for(const network of Object.keys(d.NetworkSettings.Networks))await docker('network','disconnect',network,container);
  const executor=executorFor(['--container',container]);
  const sql=async input=>{assert.deepEqual(Object.keys((await assertOwned()).NetworkSettings.Networks),[]);const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
  assert.equal(await sql("SELECT max(version) FROM supabase_migrations.schema_migrations;"),String(ceiling));
  return {local,container,executor,sql,stop,manifest,networkAttachments:0};
 }catch(error){
  if(!ownedId){try{const d=await inspect();if(d.Config.Labels['com.supabase.cli.project']===project&&path.resolve(d.Config.Labels['com.supabase.cli.workdir'])===local)ownedId=d.Id;}catch{/* No owned container exists. */}}
  const diagnostic={project,local,code:error.code??null,signal:error.signal??null,killed:error.killed??false,
   stderr:String(error.stderr??'').split(/\r?\n/u).filter(line=>/Starting|Stopping|ERROR|FATAL|failed|panic|port|database/iu.test(line)&&!/password|secret|token|key/iu.test(line)).slice(-12).map(line=>line.replace(/(?:postgres(?:ql)?|https?):\/\/\S+/giu,'[local-url-redacted]')),cleanup:false};
  if(ownedId){const d=await assertOwned();diagnostic.containerState={status:d.State.Status,oomKilled:d.State.OOMKilled,exitCode:d.State.ExitCode,error:d.State.Error};await stopOwned();}else await assertRemoved();
  diagnostic.cleanup=true;await writeFile(path.join(local,'bootstrap-failure.json'),JSON.stringify(diagnostic,null,2)+'\n');
  error.localBootstrapDiagnostic=path.join(local,'bootstrap-failure.json');error.cleanup=true;throw error;
 }finally{await release();}
}

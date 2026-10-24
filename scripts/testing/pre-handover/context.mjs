// Audit-only harness. Fixed disposable Docker identity; no hosted configuration.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../../operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from '../backup-restore-contract.mjs';

export const root=path.resolve(import.meta.dirname,'../../..');
export const baseline='d72f70918a63126b1d561c3a14b6c4b5bd652786';
export const container='supabase_db_nawasrah-prehandover-test';
export const executor=executorFor(['--container',container]);
export const output=path.join(tmpdir(),'nawasrah-prehandover-evidence');
export const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const owner=id(1),branch=id(200),warehouse=id(201),supplier=id(301),customer=id(401),product=id(103);
export const q=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
export const j=v=>q(JSON.stringify(v))+'::jsonb';
let counter=0;
export const key=label=>'prehandover-'+label+'-'+String(++counter).padStart(8,'0');
export const calls=[];
export async function raw(text){return executeInput(executor,"SET statement_timeout='60s';SET lock_timeout='20s';\n"+text);}
export async function sql(text){const r=await raw(text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();}
export async function json(text){return JSON.parse((await sql(text)).split(/\r?\n/u).filter(Boolean).at(-1));}
export const auth=(body,uid=owner,role='authenticated',aal='aal2',ending='COMMIT')=>`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:uid,role,aal}))},true);SET LOCAL ROLE ${role};${body}${ending};`;
export async function rpc(call,uid=owner,role='authenticated',aal='aal2'){
 const started=performance.now();const result=await json(auth('SELECT public.'+call+';',uid,role,aal));
 calls.push({call,uid,role,aal,elapsedMs:Math.round((performance.now()-started)*1000)/1000});return result;
}
export const fingerprint=()=>readApplicationFingerprint(executor);
export async function refused(call,pattern,uid=owner,role='authenticated',aal='aal2'){
 const before=await fingerprint(),r=await raw('\\set VERBOSITY verbose\n'+auth('SELECT public.'+call+';',uid,role,aal));
 assert.notEqual(r.code,0,'EXPECTED_REFUSAL');assert.match(r.stderr,pattern);assert.deepEqual(await fingerprint(),before,'REFUSAL_MUST_PRESERVE_ALL_DATA_AND_SEQUENCES');
 return {call,uid,role,aal,sqlstate:r.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/u)?.[1],error:r.stderr.split('\n').filter(l=>l.includes('ERROR:')).join('\n'),zeroWrites:true};
}
export async function save(name,data){await mkdir(output,{recursive:true});await writeFile(path.join(output,name+'.json'),JSON.stringify(data,null,2)+'\n');}
export async function assertLocal212(){
 assert.equal(container,'supabase_db_nawasrah-prehandover-test');
 const state=await json("SELECT jsonb_build_object('database',current_database(),'version',current_setting('server_version_num'),'migrations',(SELECT count(*) FROM supabase_migrations.schema_migrations),'max',(SELECT max(version::integer) FROM supabase_migrations.schema_migrations));");
 assert.equal(state.database,'postgres');assert.equal(state.migrations,174);assert.equal(state.max,212);assert.ok(Number(state.version)>=170000);return state;
}
export async function frozenSources(){
 const paths=['src','customer-web/src','supabase/migrations','supabase/functions','package.json','package-lock.json','customer-web/package.json','customer-web/package-lock.json'];
 const diff=execFileSync('git',['diff','--name-only',baseline,'--',...paths],{cwd:root,encoding:'utf8'}).trim();assert.equal(diff,'','FROZEN_BUSINESS_SOURCE_CHANGED');
 const files=execFileSync('git',['ls-files','--',...paths],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/u);
 const hashes=[];for(const file of files)hashes.push({file,sha256:createHash('sha256').update((await readFile(path.join(root,file),'utf8')).replaceAll('\r\n','\n')).digest('hex')});
 return {baseline,files:hashes,sha256:createHash('sha256').update(JSON.stringify(hashes)).digest('hex')};
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {runAcl212} from '../scripts/operations/frankfurt-owner-acl212.mjs';
import {readOwnerAcl212Bundle,parseOwnerAcl212Result} from '../scripts/operations/owner-acl212-bundle.mjs';
import {TARGET,OLD_REF} from '../scripts/operations/frankfurt-owner-build.mjs';
import {ownerSequenceMetadata,exactBigintSequenceMax} from '../scripts/operations/owner-acl212-sequences.mjs';

test('sequence metadata preserves the source-proven bigint limit exactly and rejects other unsafe values',()=>{
 const row={name:'cash_shift_number_seq',start:1001,increment:1,max:Number(exactBigintSequenceMax),min:1,cache:1,cycle:false};
 assert.equal(ownerSequenceMetadata(row).max,'9223372036854775807');assert.equal(ownerSequenceMetadata(row).start,'1001');
 assert.throws(()=>ownerSequenceMetadata({...row,name:'unreviewed_sequence'}));
 assert.throws(()=>ownerSequenceMetadata({...row,cache:Number.MAX_SAFE_INTEGER+1}));
});

const bundle=await readOwnerAcl212Bundle(process.cwd());
const result=()=>({rows:675,matches_reference_true:675,matches_reference_false:0,removed_privileges:432,
 results:bundle.manifest.objects.map((o:{section:string;signature:string;allowedExtra:unknown[]})=>({object_kind:o.section,object_identity:o.signature,removed_privileges:o.allowedExtra.length,matches_reference:true}))});
async function withOwnerFiles(callback:(dir:string)=>Promise<void>){
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-owner-acl212-unit-'));
 try{
  await mkdir(path.join(dir,'supabase/.temp'),{recursive:true});
  await writeFile(path.join(dir,'supabase/.temp/project-ref'),TARGET.id);
  await writeFile(path.join(dir,'supabase/.temp/pooler-url'),'postgresql://postgres.'+TARGET.id+'@aws-0-eu-central-1.pooler.supabase.com:5432/postgres');
  await callback(dir);
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('owner dry-run is local and cannot call confirmation,password or executor',async()=>{
 await withOwnerFiles(async dir=>{
  const forbidden=()=>{assert.fail('dry-run must never reach owner/network I/O');};
  const report=await runAcl212(['--dry-run','--workdir',dir],{confirmTarget:forbidden,readPassword:forbidden,executor:forbidden});
  assert.equal(report.ok,true);assert.equal(report.remoteWriteAttempted,false);assert.equal(report.connectionAttempted,false);
  assert.equal(report.expectedRows,675);assert.equal(report.localFilesOnly,true);
  assert.equal(JSON.parse(await readFile(path.join(report.output,'report.json'),'utf8')).ok,true);
 });
});
test('owner entry rejects contradictory/duplicate modes and arbitrary connection/SQL/password overrides',async()=>{
 for(const flags of [['--apply','--dry-run'],['--apply','--apply'],['--workdir'],['--url','x'],['--sql','x'],['--password','x'],['--target','x']])
  await assert.rejects(()=>runAcl212(flags));
});
test('apply confirmation is exact and precedes hidden-password read and connection construction',async()=>{
 await withOwnerFiles(async dir=>{
  let passwords=0,connections=0;
  const report=await runAcl212(['--apply','--workdir',dir],{interactive:true,readBackupLink:async()=>OLD_REF,confirmTarget:async()=>TARGET.id+' ',
   readPassword:async()=>{passwords++;return 'fixture';},executor:()=>{connections++;assert.fail();}});
  assert.equal(report.ok,false);assert.equal(report.error,'OWNER_ACL212_CONFIRMATION_REQUIRED');
  assert.equal(passwords,0);assert.equal(connections,0);assert.equal(report.remoteWriteAttempted,false);
 });
});
test('owner apply transmits the reviewed guarded transaction in one session and stores only validated row results',async()=>{
 await withOwnerFiles(async dir=>{
  const child=path.join(dir,'response.mjs'),rows=path.join(dir,'result.json');await writeFile(rows,JSON.stringify(result()));
  await writeFile(child,"import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;if(!s.includes('BEGIN;')||!s.includes('OWNER_ACL212_UNEXPECTED_ACL')||!s.includes('COMMIT;'))process.exit(2);process.stdout.write(fs.readFileSync(process.argv[2]));");
  const secret='fixture-'+process.pid+'-memory-only';let heldEnv:any,calls=0;
  const report=await runAcl212(['--apply','--workdir',dir],{interactive:true,readBackupLink:async()=>OLD_REF,confirmTarget:async()=>TARGET.id,readPassword:async()=>secret,
   executor:(connection:string[],env:any)=>{calls++;assert.ok(connection.includes('postgres.'+TARGET.id));assert.equal(env.PGPASSWORD,secret);heldEnv=env;return{command:process.execPath,args:[child,rows],env};}});
  assert.equal(calls,1);assert.equal(report.ok,true);assert.equal(report.commitConfirmed,true);assert.equal(report.rows,675);
  assert.equal(report.matches_reference_false,0);assert.equal(report.removed_privileges,432);assert.equal(heldEnv.PGPASSWORD,undefined);
  assert.equal(JSON.parse(await readFile(path.join(report.output,'rows.json'),'utf8')).length,675);
  assert.ok(!(await readFile(path.join(report.output,'report.json'),'utf8')).includes(secret));
 });
});
test('owner failure never persists raw stdout,stderr or the in-memory password',async()=>{
 await withOwnerFiles(async dir=>{
  const child=path.join(dir,'fail.mjs');await writeFile(child,"for await(const _c of process.stdin){};process.stdout.write(process.env.PGPASSWORD);process.stderr.write('failure '+process.env.PGPASSWORD);process.exitCode=1;");
  const secret='fixture-'+process.pid+'-no-persist';let heldEnv:any;
  const report=await runAcl212(['--apply','--workdir',dir],{interactive:true,readBackupLink:async()=>OLD_REF,confirmTarget:async()=>TARGET.id,readPassword:async()=>secret,
   executor:(_connection:string[],env:any)=>{heldEnv=env;return{command:process.execPath,args:[child],env};}});
  assert.equal(report.ok,false);assert.equal(report.error,'OWNER_ACL212_EXECUTION_FAILED');assert.equal(report.commitConfirmed,false);
  assert.equal(heldEnv.PGPASSWORD,undefined);assert.ok(!JSON.stringify(report).includes(secret));
  assert.ok(!(await readFile(path.join(report.output,'report.json'),'utf8')).includes(secret));
 });
});
test('result protocol rejects missing/duplicate identities,false matches,unsafe reductions and unknown fields;repeat may remove0',()=>{
 for(const mutate of [(r:any)=>{r.rows=674;},(r:any)=>{r.results[1]=r.results[0];},(r:any)=>{r.results[0].matches_reference=false;},
  (r:any)=>{r.results[0].removed_privileges=-1;},(r:any)=>{r.secret='must not be persisted';}]){
  const r=result();mutate(r);assert.throws(()=>parseOwnerAcl212Result(JSON.stringify(r),bundle.manifest));
 }
 const repeat=result();repeat.removed_privileges=0;repeat.results.forEach((r:any)=>{r.removed_privileges=0;});
 assert.equal(parseOwnerAcl212Result(JSON.stringify(repeat),bundle.manifest).removed_privileges,0);
});

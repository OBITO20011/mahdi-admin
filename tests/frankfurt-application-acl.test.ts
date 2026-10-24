import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compareApplicationAcl} from '../scripts/operations/application-acl-verification.mjs';
import {verifyCatalogReadOnly} from '../scripts/operations/frankfurt-catalog-verification.mjs';
import {verify211ReadOnly} from '../scripts/operations/frankfurt-owner-upgrade211.mjs';
import {verify212ReadOnly} from '../scripts/operations/frankfurt-owner-upgrade212.mjs';
import {schemaCatalogSql} from '../scripts/testing/schema-catalog.mjs';
import {notificationSnapshotSql,heldTrigger,expectedHeldNotifications} from '../scripts/operations/frankfurt-notification-hold.mjs';
import {businessCronJobs} from '../scripts/operations/build-cron-report.mjs';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {ownerAcl212Inverse,sourceBeforeOwnerAcl212} from '../scripts/audit/source-before-owner-acl212.mjs';

test('owner ACL verifier inverse exactly restores delivered source and rejects unreviewed changes',()=>{
 assert.equal(ownerAcl212Inverse.baseline,'9a09c9b4c7910da491071d5905ae6f9b868ac8b2');
 assert.deepEqual(Object.keys(ownerAcl212Inverse.entries).sort(),['package.json','scripts/operations/frankfurt-catalog-verification.mjs',
  'scripts/operations/frankfurt-owner-upgrade.mjs','scripts/operations/frankfurt-owner-upgrade211.mjs',
  'scripts/operations/frankfurt-owner-upgrade212.mjs','scripts/testing/run-trial212-gates.mjs'].sort());
 for(const file of Object.keys(ownerAcl212Inverse.entries)){
  const current=readFileSync(file,'utf8'),before=execFileSync('git',['show',ownerAcl212Inverse.baseline+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
  assert.equal(sourceBeforeOwnerAcl212(file,current),before);assert.equal(sourceBeforeOwnerAcl212(file,before),before);
  assert.throws(()=>sourceBeforeOwnerAcl212(file,current+'\nvoid unapproved;\n'));
  assert.throws(()=>sourceBeforeOwnerAcl212(file,before+'\nvoid unapproved;\n'));
 }
});

const fixture=()=>({functions:[{schema:'public',identity:'probe()',owner:'postgres',acl:['postgres=X/postgres','authenticated=X/postgres'],definition:'SELECT 1'},
 {schema:'net',identity:'http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer)',owner:'postgres',acl:null,definition:'RETURNS bigint'}],
 tables:[{schema:'public',name:'products',owner:'postgres',kind:'r',acl:['postgres=arwdDxtm/postgres','authenticated=r/postgres','service_role=Dxtm/postgres'],columns:[{name:'id',acl:null}]}]});

test('application ACL keeps legitimate service_role but rejects extra functions, table DML and sequence grants',()=>{
 const expected=fixture();assert.equal(compareApplicationAcl(expected,structuredClone(expected)).differenceCount,0);
 const changed=structuredClone(expected);changed.functions[0].acl!.push('service_role=X/postgres');changed.tables[0].acl.push('service_role=arwd/postgres');
 assert.equal(compareApplicationAcl(expected,changed).differenceCount,2);
 const sequence={schema:'public',name:'number_seq',owner:'postgres',kind:'S',acl:['postgres=rwU/postgres'],columns:[]};
 const a={tables:[sequence]},b=structuredClone(a);b.tables[0].acl.push('service_role=rU/postgres');assert.equal(compareApplicationAcl(a,b).differenceCount,1);
});

test('ACL comparison preserves grantor and grant option, detects column and missing grants, and expands NULL defaults',()=>{
 const a=fixture();
 for(const acl of [['authenticated=X*/postgres'],['authenticated=X/authenticated'],['=X/postgres']]){
  const b=structuredClone(a);b.functions[0].acl=acl;assert.equal(compareApplicationAcl(a,b).differenceCount,1);
 }
 const b=structuredClone(a);(b.tables[0].columns[0] as {acl:string[]|null}).acl=['service_role=r/postgres'];assert.equal(compareApplicationAcl(a,b).differenceCount,1);
 const d={functions:[{schema:'public',identity:'trigger()',owner:'postgres',acl:null}]};
 assert.equal(compareApplicationAcl(d,{functions:[{...d.functions[0],acl:['postgres=X/postgres','=X/postgres']}]}).differenceCount,0);
 const reversed=structuredClone(a);reversed.functions.reverse();reversed.tables[0].acl.reverse();assert.equal(compareApplicationAcl(a,reversed).differenceCount,0);
 assert.equal(compareApplicationAcl(a,{...a,functions:a.functions.filter(f=>f.schema!=='public')}).differenceCount,1);
});

const original={trigger:{schema:'public',table:'orders',name:heldTrigger,enabled:'O',
 definition:`CREATE TRIGGER ${heldTrigger} AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION notify_new_website_order_push()`},
 jobs:businessCronJobs.map((j,i)=>({id:i+1,name:j.name,schedule:'fixture',command:'SELECT '+j.calls+';',host:'localhost',port:5432,database:'postgres',username:'postgres',active:true}))};

async function withFileResponder(callback:(dir:string,executor:any,reference:any,observed:any)=>Promise<void>){
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-acl-readonly-'));
 try{
  const local={...fixture(),triggers:[original.trigger]},observed=structuredClone(local);observed.triggers[0].enabled='D';
  const responder=path.join(dir,'respond.mjs'),response=path.join(dir,'response.json');
  // This child only returns JSON fixture bytes. It has no DB/network client and
  // never interprets or executes the query strings sent by the real verifier.
  await writeFile(responder,"import fs from 'node:fs';let input='';for await(const chunk of process.stdin)input+=chunk;const replies=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));if(!(input in replies))process.exit(2);process.stdout.write(JSON.stringify(replies[input]));");
  const executor={command:process.execPath,args:[responder,response]};
  const reference={catalog:local,buildUtcDate:'2026-10-24'};
  const save=async()=>writeFile(response,JSON.stringify({[schemaCatalogSql]:observed,[notificationSnapshotSql]:expectedHeldNotifications(original)}));
  await save();await callback(dir,{...executor,save},reference,observed);
 }finally{await rm(dir,{recursive:true,force:true});}
}

for(const [version,verify] of [[211,verify211ReadOnly],[212,verify212ReadOnly]] as const){
 test(`actual ${version} verify worker rejects hidden function/table ACL and saves failure evidence without SQL execution`,async()=>{
  await withFileResponder(async(dir,executor,reference,observed)=>{
   observed.functions[0].acl.push('service_role=X/postgres');observed.tables[0].acl.push('service_role=arwd/postgres');await executor.save();
   const report:any={remoteWriteAttempted:false};
   await assert.rejects(()=>verify(executor,dir,reference,original,{beforeBuildDate:'2026-10-24',afterBuildDate:'2026-10-24'},report),/APPLICATION_ACL_MISMATCH/);
   assert.equal(report.catalogUnexpectedDifferenceCount,2);assert.equal(report.remoteWriteAttempted,false);
   const saved=JSON.parse(await readFile(path.join(dir,'application-acl-comparison.json'),'utf8'));
   assert.equal(saved.ok,false);assert.equal(saved.differences.length,2);assert.equal(report.readyCatalogValidated,undefined);
  });
 });
}

test('strict read-only worker accepts exact reference ACL and runs readiness assertion; platform drift remains informational',async()=>{
 await withFileResponder(async(dir,executor,reference,observed)=>{
  observed.functions[1].acl=['service_role=X/postgres'];await executor.save();let checked=false;
  const report:any={remoteWriteAttempted:false};
  await verifyCatalogReadOnly(executor,dir,reference,original,{beforeBuildDate:'2026-10-24',afterBuildDate:'2026-10-24'},report,
   {strictApplicationAcl:true,assertReadyCatalog:()=>{checked=true;}});
  assert.equal(checked,true);assert.equal(report.readyCatalogValidated,true);assert.equal(report.catalogUnexpectedDifferenceCount,0);
  assert.equal(report.applicationAclComparison.ok,true);assert.equal(report.remoteWriteAttempted,false);
 });
});

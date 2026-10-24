// Exercises the real verify workers using file-only JSON responders, never psql.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {notificationSnapshotSql,expectedHeldNotifications} from './frankfurt-notification-hold.mjs';
import {realtimePublicationSql} from '../testing/realtime151-contract.mjs';
import {verify211ReadOnly} from './frankfurt-owner-upgrade211.mjs';
import {verify212ReadOnly} from './frankfurt-owner-upgrade212.mjs';
import {aclEntries,privilegeWords} from './managed-catalog-policy.mjs';

const workdir=process.argv[2];assert.ok(workdir,'LOCAL_OWNER_WORKDIR_REQUIRED');
const root=path.resolve(import.meta.dirname,'../..'),temp=await mkdtemp(path.join(tmpdir(),'nawasrah-saved-acl-workers-'));
const hash=s=>createHash('sha256').update(s).digest('hex'),read=async p=>JSON.parse(await readFile(p,'utf8'));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),codes=Object.fromEntries(Object.entries(privilegeWords).map(([c,p])=>[p,c]));
const report={ok:false,fileOnlyResponder:true,sqlExecuted:false,managedAccess:false,versions:[]};
try{
 const responder=path.join(temp,'json-responder.mjs'),fixture=path.join(temp,'replies.json');
 await writeFile(responder,"import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));if(!(s in r))process.exit(2);process.stdout.write(JSON.stringify(r[s]));");
 const executor={command:process.execPath,args:[responder,fixture]},original=await read(path.join(workdir,'notification-before.json'));
 for(const [version,folder,verify] of [[211,'upgrade211-2026-10-23T14-23-28-406Z',verify211ReadOnly],[212,'upgrade212-2026-10-24T09-35-30-196Z',verify212ReadOnly]]){
  const reference=await read(path.join(workdir,`local-reference-through${version}-ready.json`));
  const file=path.join(workdir,folder,'catalog-observed.json'),input=await readFile(file,'utf8'),observed=JSON.parse(input),saved=await read(path.join(workdir,folder,'report.json'));
  const dates={beforeBuildDate:reference.buildUtcDate,afterBuildDate:saved.endedAt.slice(0,10)},output=path.join(temp,String(version));
  await mkdir(output);
  const respond=async catalog=>writeFile(fixture,JSON.stringify({[schemaCatalogSql]:catalog,[notificationSnapshotSql]:expectedHeldNotifications(original),[realtimePublicationSql]:reference.realtimePublication}));
  await respond(observed);const before={remoteWriteAttempted:false};
  await assert.rejects(()=>verify(executor,output,reference,original,dates,before),/APPLICATION_ACL_MISMATCH/);
  assert.equal(before.remoteWriteAttempted,false);assert.ok(before.catalogUnexpectedDifferenceCount>0);
  const reduced=structuredClone(observed);let removed=0;
  for(const section of ['functions','tables'])for(const row of reduced[section].filter(r=>r.schema==='public')){
   const ref=reference.catalog[section].find(r=>r.schema==='public'&&(r.identity??r.name)===(row.identity??row.name));assert.ok(ref);
   const expected=aclEntries(ref.acl,ref,section),actual=aclEntries(row.acl,row,section);
   assert.ok(expected.every(e=>actual.some(a=>same(a,e))));const extra=actual.filter(a=>!expected.some(e=>same(a,e)));
   assert.ok(extra.every(a=>a.grantee==='service_role'&&a.grantor==='postgres'&&!a.grantable));removed+=extra.length;
   const groups=new Map();for(const a of actual.filter(a=>!extra.some(e=>same(a,e)))){
    const k=JSON.stringify([a.grantee,a.grantor]);groups.set(k,(groups.get(k)??'')+codes[a.privilege]+(a.grantable?'*':''));
   }
   row.acl=[...groups].map(([k,c])=>{const[g,r]=JSON.parse(k);return(g==='PUBLIC'?'':g)+'='+c+'/'+r;});
  }
  await respond(reduced);const after={remoteWriteAttempted:false};
  await verify(executor,output,reference,original,dates,after);
  assert.equal(after.catalogUnexpectedDifferenceCount,0);assert.equal(after.readyCatalogValidated,true);assert.equal(after.remoteWriteAttempted,false);
  assert.equal(hash(await readFile(file,'utf8')),hash(input),'SAVED_OWNER_CATALOG_UNCHANGED');
  report.versions.push({version,beforeRejected:true,error:'APPLICATION_ACL_MISMATCH',beforeDifferentObjects:before.catalogUnexpectedDifferenceCount,
   removedPrivilegesInMemory:removed,afterAccepted:true,afterDifferentObjects:0,readyCatalogValidated:true,queriesRespondedFromFilesOnly:true,savedCatalogUnchanged:true});
 }
 report.ok=true;
 await writeFile(path.join(root,'docs/operations/FRANKFURT_VERIFY_ONLY_ACL212_REGRESSION.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}finally{await rm(temp,{recursive:true,force:true});}

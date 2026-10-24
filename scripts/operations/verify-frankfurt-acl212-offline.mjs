// File validation and an in-memory guard model ONLY. Never executes SQL.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {readReady212Reference,assertReady212Catalog} from './frankfurt-reference212.mjs';
import {aclEntries,privilegeWords} from './managed-catalog-policy.mjs';
import {acl212Shape,acl212Signature} from './prepare-frankfurt-acl212-offline.mjs';
import {compareApplicationAcl} from './application-acl-verification.mjs';
import {ownerSequenceMetadata} from './owner-acl212-sequences.mjs';
import {canonicalLf} from '../testing/maintenance-db-contract.mjs';

export function validateAcl212Entry(entry,row,after=false){
 assert.equal(row.key,entry.key,'IDENTITY');assert.deepEqual(row.shape,entry.shape,'SHAPE');
 assert.ok(entry.expectedAcl.every(e=>row.acl.some(a=>same(a,e))),'MISSING');
 assert.ok(row.acl.every(a=>[...entry.expectedAcl,...entry.allowedExtra].some(e=>same(a,e))),'UNKNOWN_EXTRA');
 if(after)assert.deepEqual(row.acl,entry.expectedAcl,'POSTCONDITION');
}
export function validateAcl212State(manifest,state,after=false){
 assert.deepEqual(state.history,manifest.history,'HISTORY');assert.deepEqual(state.related,manifest.related,'RELATED');
 assert.deepEqual(state.objects.map(o=>o.key),manifest.objects.map(o=>o.key),'SCOPE');
 for(let i=0;i<manifest.objects.length;i++)validateAcl212Entry(manifest.objects[i],state.objects[i],after);
}
export function reduceAcl212State(manifest,state){
 validateAcl212State(manifest,state);let removed=0;
 for(let i=0;i<manifest.objects.length;i++){
  const entry=manifest.objects[i],row=state.objects[i],keep=row.acl.filter(a=>!entry.allowedExtra.some(e=>same(a,e)));
  removed+=row.acl.length-keep.length;row.acl=keep;
 }
 validateAcl212State(manifest,state,true);return removed;
}

export async function verifyAcl212(root,workdir){
 const sqlFile=path.join(root,'docs/operations/FRANKFURT_FUNCTION_ACL212_OWNER.sql'),sql=canonicalLf(await readFile(sqlFile,'utf8'));
 const match=sql.match(/\$manifest212\$([\s\S]*?)\$manifest212\$/u);assert.ok(match);
 const manifest=JSON.parse(match[1]),reference=await readReady212Reference(root,path.join(workdir,'local-reference-through212-ready.json'));
 const observedText=await readFile(path.join(workdir,'upgrade212-2026-10-24T09-35-30-196Z/catalog-observed.json'),'utf8'),observed=JSON.parse(observedText);
 const hash=s=>createHash('sha256').update(s).digest('hex');
 assert.equal(hash(observedText),manifest.observedSha256);assert.equal(hash(await readFile(path.join(workdir,'local-reference-through212-ready.json'))),manifest.referenceSha256);
 assert.equal(manifest.ceiling,212);assert.deepEqual(manifest.history,reference.appliedVersions);assert.equal(manifest.history.length,174);
 assert.equal(manifest.objects.length,675);assert.equal(manifest.objects.filter(o=>o.section==='functions').length,556);
 const state={history:[...manifest.history],related:structuredClone(manifest.related),objects:[]};
 for(const section of Object.keys(manifest.related)){
  const expected=structuredClone((reference.catalog[section]??[]).filter(r=>(section==='schemas'?r.name:r.schema)==='public')
   .map(r=>section==='sequences'?ownerSequenceMetadata(r):r));
  if(section==='triggers')for(const r of expected)if(r.table==='orders'&&r.name==='trg_notify_new_website_order_push')r.enabled='D';
  assert.deepEqual(manifest.related[section],expected,'REFERENCE_RELATED_METADATA');
 }
 const expectedCommands=[];
 for(const entry of manifest.objects){
  const find=c=>c[entry.section].find(r=>r.schema==='public'&&(r.identity??r.name)===entry.identity),local=find(reference.catalog),actual=find(observed);
  assert.ok(local&&actual,entry.key);assert.deepEqual(entry.shape,acl212Shape(local,entry.section));
  assert.equal(entry.signature,acl212Signature(local,entry.section));assert.deepEqual(entry.expectedAcl,aclEntries(local.acl,local,entry.section));
  const actualAcl=aclEntries(actual.acl,actual,entry.section);
  assert.deepEqual(entry.allowedExtra,actualAcl.filter(a=>!entry.expectedAcl.some(e=>same(a,e))));
  assert.ok(entry.allowedExtra.every(a=>a.grantee==='service_role'&&a.grantor==='postgres'&&!a.grantable));
  state.objects.push({key:entry.key,shape:acl212Shape(actual,entry.section),acl:actualAcl});
  if(entry.allowedExtra.length)expectedCommands.push(`REVOKE ${[...new Set(entry.allowedExtra.map(a=>a.privilege))].sort().join(', ')} ON ${entry.section==='functions'?'FUNCTION':local.kind==='S'?'SEQUENCE':'TABLE'} ${entry.signature} FROM service_role RESTRICT;`);
 }
 const statements=(sql.match(/^\s*REVOKE [^;]+;/gmu)??[]).map(s=>s.trim());assert.deepEqual(statements,expectedCommands);assert.equal(statements.length,264);
 const executable=sql.replace(match[0],'null').replace(/--[^\n]*/gu,'').replace('ON COMMIT DROP','');
 assert.doesNotMatch(executable,/\b(?:GRANT|CASCADE|ALTER|TRUNCATE|DROP)\s/gu);
 assert.equal((executable.match(/CREATE TEMP TABLE/gu)??[]).length,1);
 assert.match(sql,/pg_try_advisory_xact_lock\(734151139\)/u);
 assert.match(sql,/v_pass=2 AND v_acl IS DISTINCT FROM v_object->'expectedAcl'/u);
 assert.ok(sql.indexOf('OWNER_ACL212_UNEXPECTED_ACL')<sql.indexOf(statements[0]));
 assert.match(sql,/IF v_pass=1 THEN\s*-- FIRST REVOKE/u);assert.match(sql,/matches_reference[\s\S]*COMMIT;/u);
 validateAcl212State(manifest,state);
 const original=structuredClone(state),accepted=[],refused=[];
 assert.equal(reduceAcl212State(manifest,state),432);accepted.push('saved212 removes432');
 assert.equal(reduceAcl212State(manifest,state),0);accepted.push('idempotent repeat removes0');
 for(let i=0;i<manifest.objects.length;i++){
  const entry=manifest.objects[i],row=original.objects[i];
  const refuse=(label,mutate,after=false)=>{
   const copy=structuredClone(row);mutate(copy);const before=structuredClone(copy);
   assert.throws(()=>validateAcl212Entry(entry,copy,after));assert.deepEqual(copy,before,'NO_PRECHECK_MUTATION');refused.push(label+' '+entry.key);
  };
  refuse('wrong owner',r=>{r.shape.owner='authenticated';});
  refuse('missing grant',r=>{r.acl.shift();});
  refuse('unknown grantor',r=>{r.acl[0].grantor='authenticated';});
  refuse('changed grant option',r=>{r.acl[0].grantable=!r.acl[0].grantable;});
  if(!entry.expectedAcl.some(a=>a.grantee==='PUBLIC'))refuse('unknown PUBLIC',r=>{r.acl.push({grantee:'PUBLIC',grantor:'postgres',privilege:entry.section==='functions'?'EXECUTE':'SELECT',grantable:false});});
  if(entry.section==='functions'){
   refuse('changed body',r=>{r.shape.definitionMd5='0'.repeat(32);});
   refuse('changed search_path',r=>{r.shape.configuration=['search_path=owner_acl212_untrusted'];});
  }else refuse('changed column metadata',r=>{r.shape.columns=[{name:'unexpected'}];});
  if(entry.allowedExtra.length){
   const partial=structuredClone(row);partial.acl=structuredClone(entry.expectedAcl);validateAcl212Entry(entry,partial);accepted.push('previously repaired '+entry.key);
   refuse('postcondition retained extra',()=>{},true);
  }
 }
 for(const section of Object.keys(manifest.related)){
  const copy=structuredClone(original);copy.related[section]=[];const before=structuredClone(copy);
  assert.throws(()=>reduceAcl212State(manifest,copy));assert.deepEqual(copy,before);refused.push('whole-scope changed '+section);
 }
 for(const change of ['missing212','extra213','overload']){
  const copy=structuredClone(original);
  if(change==='missing212')copy.history.pop();else if(change==='extra213')copy.history.push('213');else copy.objects.push({...copy.objects[0],key:'public.unexpected()'});
  const before=structuredClone(copy);assert.throws(()=>reduceAcl212State(manifest,copy));assert.deepEqual(copy,before);refused.push(change);
 }
 const products=manifest.objects.find(o=>o.key==='public.products'),productRow=original.objects.find(o=>o.key===products.key);
 assert.equal(products.allowedExtra.length,4);
 for(let mask=0;mask<16;mask++){
  const row=structuredClone(productRow);row.acl=row.acl.filter(a=>!products.allowedExtra.some((e,i)=>(mask&(1<<i))&&same(a,e)));
  validateAcl212Entry(products,row);accepted.push('products partial mask '+mask);
 }
 // Independent ACL encoding of the reduced state preserves NULL/default meaning.
 const reduced=structuredClone(observed),codes=Object.fromEntries(Object.entries(privilegeWords).map(([a,b])=>[b,a]));
 for(let i=0;i<manifest.objects.length;i++){
  const e=manifest.objects[i],row=reduced[e.section].find(r=>r.schema==='public'&&(r.identity??r.name)===e.identity),groups=new Map();
  for(const a of state.objects[i].acl){const k=JSON.stringify([a.grantee,a.grantor]);groups.set(k,(groups.get(k)??'')+codes[a.privilege]+(a.grantable?'*':''));}
  row.acl=[...groups].map(([k,v])=>{const[g,r]=JSON.parse(k);return(g==='PUBLIC'?'':g)+'='+v+'/'+r;});
 }
 assert.equal(compareApplicationAcl(reference.catalog,observed).differenceCount,264);
 assert.equal(compareApplicationAcl(reference.catalog,reduced).differenceCount,0);assertReady212Catalog(reduced);
 const report={ok:true,fileOnly:true,sqlExecuted:false,sqlCompiledInPostgres:false,managedAccess:false,referenceSha256:manifest.referenceSha256,
  observedSha256:manifest.observedSha256,sqlSha256:hash(sql),checkedFunctions:556,checkedRelations:119,resultRows:675,
  revokeStatements:264,extraPrivileges:432,acceptedCases:accepted.length,refusedCases:refused.length,accepted,refused,
  strictAclBefore:264,strictAclAfter:0,originalReady212PassesAfterReduction:true,zeroMutationOnPrecheckFailure:true};
 await writeFile(path.join(root,'docs/operations/FRANKFURT_ACL212_VERIFICATION.json'),JSON.stringify(report,null,2)+'\n');
 return {ok:true,accepted:accepted.length,refused:refused.length,resultRows:675,extraPrivileges:432,sqlExecuted:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 assert.ok(process.argv[2],'LOCAL_OWNER_WORKDIR_REQUIRED');console.log(JSON.stringify(await verifyAcl212(path.resolve(import.meta.dirname,'../..'),path.resolve(process.argv[2]))));
}

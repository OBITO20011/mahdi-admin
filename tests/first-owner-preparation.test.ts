import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {bindFirstOwnerSql,validateFirstOwner} from '../scripts/operations/first-owner-core.mjs';
import {firstOwnerArguments} from '../scripts/operations/frankfurt-first-owner.mjs';
import {assertFirstOwner198Access,readFirstOwner198Reference} from '../scripts/operations/first-owner-reference198.mjs';
import {inventoryBeforeSales204 as inventory} from '../scripts/audit/source-before-sales-history204.mjs';
const input={ownerId:'92600000-0000-4000-8000-000000000001',email:'owner@example.test',name:'المالك',branchCode:'BR-MAIN',branchName:'الفرع الرئيسي'};
test('first owner is a guarded data bootstrap,not an unauthenticated RPC or a second-owner bypass',()=>{
 const sql=bindFirstOwnerSql(input);for(const guard of ['FIRST_OWNER_AUTH_IDENTITY_NOT_CONFIRMED','FIRST_OWNER_ALREADY_INITIALIZED','FIRST_OWNER_REQUIRES_UNUSED_BUSINESS','FIRST_OWNER_BRANCH_MISMATCH'])assert.ok(sql.includes(guard));
 assert.match(sql,/pg_advisory_xact_lock/u);assert.match(sql,/ISOLATION LEVEL SERIALIZABLE/u);assert.match(sql,/email_confirmed_at IS NULL/u);
 assert.match(sql,/r.code='owner'/u);assert.match(sql,/FIRST_OWNER_BOOTSTRAP/u);
 assert.doesNotMatch(sql,/CREATE (?:OR REPLACE )?FUNCTION|GRANT |REVOKE |INSERT INTO auth\.|UPDATE auth\.|mfa_factors/iu);
 assert.throws(()=>validateFirstOwner({...input,ownerId:"';DROP SCHEMA auth;--"}));
 assert.throws(()=>validateFirstOwner({...input,branchCode:'x;DROP TABLE'}));
 assert.match(bindFirstOwnerSql({...input,name:"علي'سليم"}),/علي''سليم/u);
});

test('binding SQL and all business/Auth validation remain byte-identical to delivered7c22eef',()=>{
 const file='scripts/operations/first-owner-core.mjs';
 assert.equal(readFileSync(file,'utf8').replaceAll('\r\n','\n'),execFileSync('git',['show','7c22eef:'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'));
});

test('first owner198 requires current real access identities,roles,history,catalog and complete source hashes',async()=>{
 const source=await inventory(),proof=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_STAGING_198.json','utf8'));
 const reference={migrationCeiling:198,catalog:proof.catalog,buildUtcDate:proof.startedAt.slice(0,10),manifest:proof.manifest.map((name:string)=>({name})),manifestDigest:'attested-by-readReady198Reference'};
 const accepted=assertFirstOwner198Access(reference,JSON.stringify(proof),source);assert.equal(accepted.queries,proof.results.length);
 const changedSource=structuredClone(source);changedSource.entries[0].id+=':unapproved';assert.throws(()=>assertFirstOwner198Access(reference,JSON.stringify(proof),changedSource),/INCOMPLETE_QUERY_PROBE_COVERAGE/u,'Historical source projection never bypasses exact query identities');
 for(const change of [
  (p:typeof proof)=>{p.migrationCeiling=182;},(p:typeof proof)=>{p.managedAccess=true;},
  (p:typeof proof)=>{p.infrastructureOk=false;},(p:typeof proof)=>{p.applicationReady=false;},
  (p:typeof proof)=>{p.sourceHashes[0].sha256='changed';},(p:typeof proof)=>{p.manifest.pop();},
  (p:typeof proof)=>{p.results.pop();},(p:typeof proof)=>{p.results.push(p.results[0]);},
  (p:typeof proof)=>{p.results[0].appRole='substituted';},(p:typeof proof)=>{p.results[0].sqlstate='42501';},
  (p:typeof proof)=>{p.results[0].outcome='other_error';},
  (p:typeof proof)=>{p.catalog.tables.find((t:{schema:string;name:string})=>t.schema==='public'&&t.name==='products').rls=false;},
  (p:typeof proof)=>{p.catalog.functions.find((f:{schema:string})=>f.schema==='public').owner='authenticated';},
 ]){const changed=structuredClone(proof);change(changed);assert.throws(()=>assertFirstOwner198Access(reference,JSON.stringify(changed),source));}
});

test('old150/182 references are rejected before password,connection or report creation;no fallback reader',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-old-owner-reference-'));
 try{
  const file=path.join(dir,'local-reference-through198-ready.json');
  for(const [format,ceiling]of[[3,150],[7,182],[8,195]]){
   await writeFile(file,JSON.stringify({format,migrationCeiling:ceiling}));
   await assert.rejects(()=>readFirstOwner198Reference(fileURLToPath(new URL('..',import.meta.url)),file),/READY198_REFERENCE_REQUIRED/u);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
 const code=readFileSync('scripts/operations/frankfurt-first-owner.mjs','utf8');
 assert.ok(code.includes('await readReady199Reference'));
 assert.doesNotMatch(code,/readReference182|readyReference182Name|frankfurt-reference150/u);
 assert.ok(code.indexOf('await readReady199Reference')<code.indexOf('await ownerPassword()'));
 assert.ok(code.indexOf('await readReady199Reference')<code.indexOf('connectionFromLink(await'));
 const runtime=readFileSync('scripts/testing/run-first-owner-runtime.mjs','utf8');
 for(const text of ["NAWASRAH_MAX_MIGRATION:'198'",'firstOwnerWithExecutor','staleReport.remoteWriteAttempted,false','expectedHeldNotifications(original)'])assert.ok(runtime.includes(text),text);
});
test('first owner dry-run cannot request a password or access the project',()=>{
 assert.equal(firstOwnerArguments([]).apply,false);assert.throws(()=>firstOwnerArguments(['--apply']));
 assert.throws(()=>firstOwnerArguments(['--apply','--dry-run']));assert.throws(()=>firstOwnerArguments(['--email','one','--email','two']));
 const source=readFileSync('scripts/operations/frankfurt-first-owner.mjs','utf8');assert.ok(source.indexOf('if(!options.apply)')<source.indexOf('await ownerPassword()'));
 assert.match(source,/connectionFromLink/u);assert.match(source,/reference.appliedVersions/u);assert.match(source,/FIRST_OWNER_SCHEMA_OR_PERMISSION_CHANGED/u);
});

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertReady226Reference,ready226ReferenceName,parcel226ReadinessPath} from './frankfurt-reference226.mjs';
import {operationalManifest} from './operational-schema.mjs';
import {assertOutsideRepository} from './frankfurt-owner-build.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql} from '../testing/realtime151-contract.mjs';
import {frankfurt220TriggerAcl} from './frozen220-trigger-acl.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from '../testing/verification-source-freeze.mjs';

const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
export async function buildReady226Reference(args){
 assert.ok(args.length===2&&args[0]==='--output'&&args[1],'ONLY_EXPLICIT_LOCAL_OUTPUT_SUPPORTED');
 const target=path.resolve(args[1]);
 assert.equal(path.basename(target),ready226ReferenceName);
 assertOutsideRepository(target);
 assert.ok(!target.split(path.sep).includes('nawasrah-fra-001-138'),'REFERENCE_OUTPUT_MUST_NOT_BE_OWNER_WORKDIR');
 await mkdir(path.dirname(target),{recursive:true});
 const parent=await realpath(path.dirname(target));
 assertOutsideRepository(parent,await realpath(root));
 assert.ok(!parent.toLowerCase().split(path.sep).includes('nawasrah-fra-001-138'),'REFERENCE_OUTPUT_MUST_NOT_BE_OWNER_WORKDIR');
 await assert.rejects(()=>readFile(target),{code:'ENOENT'},'REFERENCE_ALREADY_EXISTS');
 const frozen=await readVerificationSourceFreeze(root);
 const {stdout}=await exec(process.execPath,['scripts/testing/capture-inventory226-catalog.mjs'],{
  cwd:root,windowsHide:true,timeout:900000,maxBuffer:16*1024**2,
 });
 const capture=JSON.parse(stdout.trim().split(/\r?\n/u).at(-1));
 assert.equal(capture.ok,true);
 assert.equal(capture.cleanup,true);
 assert.equal(capture.networkAttachments,0);
 assert.equal(capture.ownerDemoAccess,false);
 assert.equal(capture.hostedAccess,false);
 const output=capture.output,read=name=>readFile(path.join(output,name+'.json'),'utf8').then(JSON.parse);
 assert.deepEqual(await read('fresh-incremental-differences'),[]);
 const manifest=await operationalManifest();
 assert.equal(capture.manifestSha256,manifestDigest(manifest));
 const appliedVersions=manifest.map(row=>row.name.slice(0,3));
 const prefix=(value,versions)=>({...value,catalogSha256:sha256(JSON.stringify(value.catalog)),appliedVersions:versions});
 const prefixes={
  225:prefix(await read('catalog225'),appliedVersions.slice(0,-1)),
  226:prefix(await read('catalog226-incremental'),appliedVersions),
 };
 const proofText=canonicalLf(await readFile(path.join(root,parcel226ReadinessPath),'utf8'));
 const proof=JSON.parse(proofText),source=await inventory(),final=prefixes[226];
 const functionText=canonicalLf(await readFile(path.join(root,'docs/generated/DB_FUNCTIONS.md'),'utf8'));
 assert.equal(canonicalLf(await readFile(path.join(output,'DB_FUNCTIONS226.md'),'utf8')),functionText,'EXACT226_FUNCTION_REFERENCE');
 const reference={
  format:36,migrationCeiling:226,manifest,manifestDigest:manifestDigest(manifest),...final,prefixes,
  functions:capture.publicFunctions,postgresVersion:capture.postgresVersion,catalogQuerySha256:sha256(schemaCatalogSql),
  realtimeQuerySha256:sha256(realtimePublicationSql),realtimeSha256:sha256(JSON.stringify(final.realtimePublication)),
  frankfurtFrozenTriggerAcl:frankfurt220TriggerAcl,notificationSnapshot:capture.notificationSnapshot,cronAudit:capture.cronAudit,
  freshIncrementalDifferenceCount:0,readiness:{sourceHashes:source.sources,accessEvidenceSha256:sha256(proofText),
   coverage:proof.coverage,queries:proof.results.length,errors:0},
 };
 assertReady226Reference(reference,manifest,proofText,source);
 assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));
 await writeFile(target,JSON.stringify(reference,null,2)+'\n',{flag:'wx'});
 return {ok:true,output,target,repositoryStayedFrozen:true,managedAccess:false,ownerDemoAccess:false,
  migrations:186,functions:707,realtimeMembers:13,freshIncrementalDifferenceCount:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await buildReady226Reference(process.argv.slice(2))));}
 catch(error){console.error(String(error.message));process.exitCode=1;}
}

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertReady223Reference,ready223ReferenceName} from './frankfurt-reference223.mjs';
import {upgradeReferenceManifest,upgradeReferenceProof,upgradeReferenceSource} from './upgrade-versioned-reference.mjs';
import {assertOutsideRepository} from './frankfurt-owner-build.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {manifestDigest,canonicalLf,sha256,canonicalDefinitionLf,renderFunctionReference} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql} from '../testing/realtime151-contract.mjs';
import {frankfurt220TriggerAcl} from './frozen220-trigger-acl.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from '../testing/verification-source-freeze.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const exec=promisify(execFile);
export async function buildReady223Reference(args){
 assert.ok(args.length===2&&args[0]==='--output'&&args[1],'ONLY_EXPLICIT_LOCAL_OUTPUT_SUPPORTED');
 const target=path.resolve(args[1]);
 assert.equal(path.basename(target),ready223ReferenceName);
 assertOutsideRepository(target);
 assert.ok(!target.split(path.sep).some(part=>part.toLowerCase()==='nawasrah-fra-001-138'),'REFERENCE_OUTPUT_MUST_NOT_BE_OWNER_WORKDIR');
 await mkdir(path.dirname(target),{recursive:true});
 assertOutsideRepository(await realpath(path.dirname(target)),await realpath(root));
 await assert.rejects(()=>readFile(target),{code:'ENOENT'},'REFERENCE_ALREADY_EXISTS');

 const freeze=await readVerificationSourceFreeze(root);
 const {stdout}=await exec(process.execPath,['scripts/testing/capture-optional-quantity223-catalog.mjs'],{
  cwd:root,windowsHide:true,maxBuffer:16*1024**2,env:{...process.env,NAWASRAH_CHECK_CATALOG223_PINS:'1'},
 });
 const capture=JSON.parse(stdout.trim().split(/\r?\n/u).at(-1));
 assert.equal(capture.ok,true);
 assert.equal(capture.cleanup,true);
 assert.equal(capture.networkAttachments,0);
 assert.equal(capture.ownerDemoAccess,false);
 assert.equal(capture.hostedAccess,false);
 const output=capture.output,read=name=>readFile(path.join(output,name+'.json'),'utf8').then(JSON.parse);
 assert.deepEqual(await read('fresh-incremental-differences'),[]);
 const manifest=await upgradeReferenceManifest(root,223);
 assert.equal(capture.manifestSha256,manifestDigest(manifest));
 const versionHistory=manifest.map(m=>m.name.slice(0,3));
 const prefix=(captured,versions)=>({...captured,catalogSha256:sha256(JSON.stringify(captured.catalog)),appliedVersions:versions});
 const prefixes={
  222:prefix(await read('catalog222'),versionHistory.slice(0,-1)),
  223:prefix(await read('catalog223-incremental'),versionHistory),
 };
 const proofText=await upgradeReferenceProof(root,223);
 const proof=JSON.parse(proofText),source=await inventory({projectSource:(file,text)=>upgradeReferenceSource(223,file,text)}),final=prefixes[223];
 const functions=(await read('public223-functions')).map(row=>({...row,definition:canonicalDefinitionLf(row.definition)}));
 const functionText=canonicalLf(await readFile(path.join(root,'docs/generated/DB_FUNCTIONS.md'),'utf8'));
 assert.equal(renderFunctionReference(manifest,functions),upgradeReferenceSource(223,'docs/generated/DB_FUNCTIONS.md',functionText),'EXACT223_FUNCTION_REFERENCE');
 const reference={
  format:33,migrationCeiling:223,manifest,manifestDigest:manifestDigest(manifest),...final,prefixes,
  functions:functions.length,postgresVersion:capture.postgresVersion,catalogQuerySha256:sha256(schemaCatalogSql),
  realtimeQuerySha256:sha256(realtimePublicationSql),realtimeSha256:sha256(JSON.stringify(final.realtimePublication)),
  frankfurtFrozenTriggerAcl:frankfurt220TriggerAcl,notificationSnapshot:capture.notificationSnapshot,cronAudit:capture.cronAudit,
  freshIncrementalDifferenceCount:0,readiness:{sourceHashes:source.sources,accessEvidenceSha256:sha256(proofText),
   coverage:proof.coverage,queries:proof.results.length,errors:0},
 };
 assertReady223Reference(reference,manifest,proofText,source);
 assertVerificationSourceFreeze(freeze,await readVerificationSourceFreeze(root));
 await writeFile(target,JSON.stringify(reference,null,2)+'\n',{flag:'wx'});
 const report={ok:true,output,target,repositoryStayedFrozen:true,managedAccess:false,ownerDemoAccess:false,
  migrations:183,functions:687,realtimeMembers:13,freshIncrementalDifferenceCount:0};
 console.log(JSON.stringify(report));
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{await buildReady223Reference(process.argv.slice(2));}
 catch(error){console.error(String(error.message));process.exitCode=1;}
}

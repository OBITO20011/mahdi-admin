import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {capturePrices222Reference} from './independent-prices222-capture.mjs';
import {assertReady222Reference,ready222ReferenceName} from './frankfurt-reference222.mjs';
import {operationalManifest} from './operational-schema.mjs';
import {DEFAULT_WORKDIR,assertOutsideRepository} from './frankfurt-owner-build.mjs';
import {inventory} from '../audit/table-access-inventory.mjs';
import {manifestDigest,canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {realtimePublicationSql} from '../testing/realtime151-contract.mjs';
import {frankfurt220TriggerAcl} from './frozen220-trigger-acl.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from '../testing/verification-source-freeze.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export async function buildReady222Reference(args=[]){
 assert.ok(!args.length||args.length===2&&args[0]==='--output','ONLY_LOCAL_OUTPUT_OPTION_SUPPORTED');
 const target=path.resolve(args[1]??path.join(DEFAULT_WORKDIR,ready222ReferenceName));assert.equal(path.basename(target),ready222ReferenceName);assertOutsideRepository(target);await mkdir(path.dirname(target),{recursive:true});assertOutsideRepository(await realpath(path.dirname(target)),await realpath(root));await assert.rejects(()=>readFile(target),{code:'ENOENT'},'REFERENCE_ALREADY_EXISTS');
 const output=await mkdtemp(path.join(tmpdir(),'nawasrah-reference222-')),report={ok:false,output,target,managedAccess:false,ownerDemoAccess:false};
 try{
  const freeze=await readVerificationSourceFreeze(root),manifest=await operationalManifest(),source=await inventory();
  const proofText=canonicalLf(await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_222.json'),'utf8')),proof=JSON.parse(proofText);
  const captured=await capturePrices222Reference(output);assert.equal(captured.manifestSha256,manifestDigest(manifest));
  const final=captured.prefixes['222'];
  const reference={format:32,migrationCeiling:222,frankfurtFrozenTriggerAcl:frankfurt220TriggerAcl,manifest,manifestDigest:manifestDigest(manifest),...final,postgresVersion:captured.postgresVersion,catalogQuerySha256:sha256(schemaCatalogSql),functions:captured.functions,realtimeQuerySha256:sha256(realtimePublicationSql),realtimeSha256:sha256(JSON.stringify(final.realtimePublication)),prefixes:captured.prefixes,freshIncrementalDifferenceCount:0,notificationSnapshot:captured.notificationSnapshot,cronAudit:captured.cronAudit,readiness:{sourceHashes:source.sources,accessEvidenceSha256:sha256(proofText),coverage:proof.coverage,queries:proof.results.length,errors:0}};
  assertReady222Reference(reference,manifest,proofText,source);assert.deepEqual((await inventory()).sources,source.sources);assertVerificationSourceFreeze(freeze,await readVerificationSourceFreeze(root));
  await writeFile(target,JSON.stringify(reference,null,2)+'\n',{flag:'wx'});Object.assign(report,{ok:true,repositoryStayedFrozen:true,migrations:182,functions:683,realtimeMembers:13,freshIncrementalDifferenceCount:0});
 }catch(error){report.error=String(error.message);report.bootstrapDiagnostic=error.localBootstrapDiagnostic??null;throw error;}
 finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{await buildReady222Reference(process.argv.slice(2));}catch{process.exitCode=1;}}

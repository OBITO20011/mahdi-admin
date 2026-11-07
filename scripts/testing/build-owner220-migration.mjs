// Explicit post-go-live Draft220 promotion. Never modifies001–219.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';

export const owner220MigrationName='220_posthandover_reads_and_guest_identity.sql';
export const owner220CandidatePath='docs/design/migration220/220_posthandover_read_performance.sql';
export const owner220ReviewedCandidateSha256='f8ad1bf651495b44d73b1d16e6d05f2d73d04fd47ae384abb69d9e1b629a9cde';
export async function buildOwner220Migration(root){
 const source=canonicalLf(await readFile(path.join(root,owner220CandidatePath),'utf8'));
 assert.equal(sha256(source),owner220ReviewedCandidateSha256,'OWNER220_REVIEWED_CANDIDATE_CHANGED');
 const header='-- QUARANTINED POST-GO-LIVE DRAFT. Not in supabase/migrations. No owner apply command.\n-- Explicit local runner only; active catalog/history/tools remain219.\n';
 assert.ok(source.startsWith(header),'OWNER220_REVIEWED_HEADER_CHANGED');
 return '-- Owner-approved post-go-live220 candidate;Draft tools only until separate merge approval.\n-- Exact reviewed79 statements inside one atomic transaction;218 stays reserved.\nBEGIN;\n'+source.slice(header.length)+'\nCOMMIT;\n';
}
const root=path.resolve(import.meta.dirname,'../..');
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 assert.ok(!process.argv.slice(2).length||process.argv.slice(2).length===1&&process.argv[2]==='--write','OWNER220_FIXED_LOCAL_BUILD_OPTIONS');
 const source=await buildOwner220Migration(root),file=path.join(root,'supabase/migrations',owner220MigrationName);
 if(process.argv[2]==='--write')await writeFile(file,source);else assert.equal(canonicalLf(await readFile(file,'utf8')),source,'OWNER220_DERIVED_MIGRATION_DRIFT');
 console.log(JSON.stringify({name:owner220MigrationName,sha256:sha256(source),reviewedCandidateSha256:owner220ReviewedCandidateSha256,atomic:true,hostedAccess:false}));
}

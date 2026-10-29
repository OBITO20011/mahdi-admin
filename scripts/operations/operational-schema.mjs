// One ceiling authority: project-state. A manifest commitment prevents a new
// migration from being silently admitted by backups/reset/upgrade adapters.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {migrationManifest,manifestDigest} from '../testing/maintenance-db-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const state=JSON.parse(readFileSync(path.join(root,'docs/agent/project-state.json'),'utf8'));
export const operationalSchema=Object.freeze({ceiling:state.migrationCeiling,...state.operationalSchema});
export function assertOperationalManifest(manifest){
 assert.equal(Number(manifest.at(-1).name.slice(0,3)),operationalSchema.ceiling,'OPERATIONAL_CEILING_DRIFT');
 assert.equal(manifestDigest(manifest),operationalSchema.manifestSha256,'OPERATIONAL_TOOL_MANIFEST_NOT_REVIEWED');
 assert.equal(operationalSchema.archiveFormatVersion,2,'OPERATIONAL_ARCHIVE_FORMAT_DRIFT');return manifest;
}
export async function operationalManifest(){
 const manifest=await migrationManifest(root);
 return assertOperationalManifest(manifest);
}
export async function assertOperationalHistory(history){
 assert.ok(Array.isArray(history),'OPERATIONAL_HISTORY_REQUIRED');
 const ceiling=Number(history.at(-1));
 assert.ok([operationalSchema.ceiling,...operationalSchema.legacyArchiveCeilings].includes(ceiling),'OPERATIONAL_HISTORY_UNSUPPORTED');
 const manifest=(await operationalManifest()).filter(m=>Number(m.name.slice(0,3))<=ceiling);
 assert.deepEqual(history,manifest.map(m=>m.name.slice(0,3)),'OPERATIONAL_HISTORY_GAP_DUPLICATE_OR_FUTURE');
 return {ceiling,files:manifest.length};
}
export function assertCurrentResetReference(reference){
 assert.equal(reference.migrationCeiling,operationalSchema.ceiling,'RESET_CURRENT_REFERENCE_REQUIRED');
 assert.equal(reference.manifestDigest,operationalSchema.manifestSha256,'RESET_CURRENT_REFERENCE_MANIFEST_CHANGED');
 assert.equal(operationalSchema.readyReferenceName,`local-reference-through${reference.migrationCeiling}-ready.json`);
 return reference;
}

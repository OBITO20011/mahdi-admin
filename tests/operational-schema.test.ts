import {assertExternalDependents,assertResetCeiling as assertReset220Ceiling} from '../scripts/operations/reset220-foundation.mjs';
import {assertResetCeiling as assertReset222Ceiling} from '../scripts/operations/reset222-foundation.mjs';
import {reset222Arguments} from '../scripts/operations/frankfurt-owner-reset222.mjs';
import {reset220Arguments} from '../scripts/operations/frankfurt-owner-reset220.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';import path from 'node:path';
import {operationalSchema,operationalManifest,assertOperationalManifest,assertOperationalHistory,assertSupportedResetReference} from '../scripts/operations/operational-schema.mjs';
import {migrationManifest,manifestDigest} from '../scripts/testing/maintenance-db-contract.mjs';
import {assertRegisteredBackupTasks,requiredBackupModes} from '../scripts/operations/backup-task-preflight.mjs';
import {reset215Arguments} from '../scripts/operations/frankfurt-owner-reset215.mjs';
import {reset216Arguments} from '../scripts/operations/frankfurt-owner-reset216.mjs';
import {reset219Arguments} from '../scripts/operations/frankfurt-owner-reset219.mjs';
import {reset217Arguments} from '../scripts/operations/frankfurt-owner-reset217.mjs';
import {ownerPlan} from '../scripts/operations/frankfurt-backup-runtime.mjs';
import {assertResetCeiling,resetUnits} from '../scripts/operations/trial-reset-core.mjs';

test('one project-state ceiling binds the full SQL manifest and every operational entrypoint;future/gap/duplicate histories fail',async()=>{
 const state=JSON.parse(readFileSync('docs/agent/project-state.json','utf8')),manifest=await migrationManifest(process.cwd());
 assert.equal(operationalSchema.ceiling,state.migrationCeiling);assert.equal(Number(manifest.at(-1)!.name.slice(0,3)),state.migrationCeiling);
 assert.equal(manifestDigest(manifest),operationalSchema.manifestSha256);assert.deepEqual(await operationalManifest(),manifest);
 assert.throws(()=>assertOperationalManifest([...manifest,{name:`${state.migrationCeiling+1}_unreviewed.sql`,sha256:'a'.repeat(64)}]),/OPERATIONAL_CEILING_DRIFT/);
 assert.throws(()=>assertOperationalManifest(manifest.map((m:{name:string;sha256:string},i:number)=>i===0?{...m,sha256:'0'.repeat(64)}:m)),/OPERATIONAL_TOOL_MANIFEST_NOT_REVIEWED/);
 const history=manifest.map((m:{name:string})=>m.name.slice(0,3)),old=history.filter((v:string)=>Number(v)<=214);
 assert.deepEqual(await assertOperationalHistory(history),{ceiling:state.migrationCeiling,files:manifest.length});
 assert.deepEqual(await assertOperationalHistory(old),{ceiling:214,files:176});
 for(const bad of [history.slice(1),history.slice(0,-1).concat('999'),history.concat(history.at(-1)!),history.filter((_:string,i:number)=>i!==120)])await assert.rejects(assertOperationalHistory(bad));
 for(const [kind,key]of[['reset','resetCommand'],['upgrade','upgradeCommand']] as const){
  assert.equal(operationalSchema[key],`frankfurt-owner-${kind}${state.migrationCeiling}`);
  assert.ok(existsSync(`scripts/operations/${operationalSchema[key]}.mjs`));
  assert.ok(readFileSync(`scripts/operations/${operationalSchema[key]}.mjs`,'utf8').includes('operationalManifest()'));
 }
 assert.equal(ownerPlan().supportedSchemaCeiling,state.migrationCeiling);assert.equal(ownerPlan().archiveFormatVersion,2);
 const core=readFileSync(`scripts/operations/trial-reset${state.migrationCeiling}-core.mjs`,'utf8');
 assert.ok(core.includes(`const policy${state.migrationCeiling}={ceiling:${state.migrationCeiling},files:${manifest.length},`),'RESET_REBUILD_ADAPTER_MUST_ADVANCE_WITH_MIGRATION');
 assert.ok(readFileSync('scripts/backup/complete-backup.mjs','utf8').match(/assertOperationalHistory\(before.history\)/gu)!.length===2);
 assert.equal(state.migrationCeiling,222);assert.equal(manifest.length,182);
 assert.equal(reset222Arguments([]).reference.split(/[\\/]/u).at(-1),operationalSchema.readyReferenceName);
 assert.equal(reset220Arguments([]).reference.split(/[\\/]/u).at(-1),'local-reference-through220-ready.json');
 assert.equal(reset219Arguments([]).reference.split(/[\\/]/u).at(-1),'local-reference-through219-ready.json');
 assert.equal(reset217Arguments([]).reference.split(/[\\/]/u).at(-1),'local-reference-through217-ready.json');
 assert.equal(reset216Arguments([]).reference.split(/[\\/]/u).at(-1),'local-reference-through216-ready.json');
 assert.equal(reset215Arguments([]).reference.split(/[\\/]/u).at(-1),'local-reference-through215-ready.json');
 // Every supported preceding adapter retains its own exact file count after
 // the current ceiling advances. This catches the actual215 rebuild failure.
 assert.equal(assertResetCeiling({migrationCeiling:215,manifest:manifest.filter((m:{name:string})=>Number(m.name.slice(0,3))<=215)}),177);
 assert.equal(assertResetCeiling({migrationCeiling:216,manifest:manifest.filter((m:{name:string})=>Number(m.name.slice(0,3))<=216)}),178);
 assert.equal(assertResetCeiling({migrationCeiling:217,manifest,manifestDigest:operationalSchema.manifestSha256}),179);
 assert.throws(()=>assertResetCeiling({migrationCeiling:218,manifest}),/RESET_REFERENCE_CEILING/);
 assert.equal(assertResetCeiling({migrationCeiling:219,manifest:manifest.filter((m:{name:string})=>Number(m.name.slice(0,3))<=219)}),180);
 assert.throws(()=>assertReset222Ceiling({migrationCeiling:222,manifest,manifestDigest:'0'.repeat(64)}),/RESET_CURRENT_MANIFEST_UNREVIEWED/);
 const prefix220=manifest.filter((m:{name:string})=>Number(m.name.slice(0,3))<=220),reference220={migrationCeiling:220,manifest:prefix220,manifestDigest:manifestDigest(prefix220)};
 assert.equal(assertReset220Ceiling(reference220),181);assert.doesNotThrow(()=>assertSupportedResetReference(reference220));
 assert.throws(()=>assertSupportedResetReference({...reference220,manifestDigest:'0'.repeat(64)}),/RESET_HISTORICAL_REFERENCE_MANIFEST_CHANGED/);
 assert.throws(()=>assertSupportedResetReference({...reference220,manifest:prefix220.slice(1)}),/RESET_HISTORICAL_REFERENCE_MANIFEST_CHANGED/);
});

test('preceding215 rebuild selects exactly177 literal files only after the whole current216 manifest and exact reference prefix are verified',async()=>{
 const current=await migrationManifest(process.cwd()),prefix=current.filter((m:{name:string})=>Number(m.name.slice(0,3))<=215),reference={migrationCeiling:215,manifest:prefix,manifestDigest:manifestDigest(prefix)};
 const units=await resetUnits(process.cwd(),reference);assert.equal(units.length,177);assert.equal(units.at(-1)!.name,'215_inspected_aftercare_and_supplier_credit.sql');assert.ok(!units.some((m:{name:string})=>m.name.startsWith('216_')));
 await assert.rejects(resetUnits(process.cwd(),{...reference,manifest:prefix.slice(1)}),/RESET_HISTORICAL_REFERENCE_MANIFEST_CHANGED/);
 await assert.rejects(resetUnits(process.cwd(),{...reference,manifestDigest:'0'.repeat(64)}),/RESET_HISTORICAL_REFERENCE_MANIFEST_CHANGED/);
});

test('upgrade requires all five enabled registered tasks to use the updated checkout and exact safe invocation',()=>{
 const repository=path.resolve('local-fixture-checkout');
 const tasks=requiredBackupModes.map((mode:string)=>({name:'Nawasrah Frankfurt '+mode,enabled:true,actions:[{execute:path.resolve('Windows/System32/WindowsPowerShell/v1.0/powershell.exe'),workingDirectory:repository,arguments:`-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path.join(repository,'scripts/operations/frankfurt-backup-owner.ps1')}" -Mode ${mode} -ConfigPath "${path.resolve('ProgramData/NawasrahFrankfurtBackup/config.json')}" -Apply`}]}));
 assert.equal(assertRegisteredBackupTasks(tasks,repository).tasks,5);
 for(const change of [
  (t:typeof tasks)=>t.pop(),
  (t:typeof tasks)=>{t[0].enabled=false;},
  (t:typeof tasks)=>{t[0].actions[0].workingDirectory=path.resolve('old-checkout');},
  (t:typeof tasks)=>{t[0].actions[0].arguments+='; Invoke-Other';},
  (t:typeof tasks)=>{t[0].actions[0].arguments=t[0].actions[0].arguments.replace('frankfurt-backup-owner','old-backup');},
 ]){const copy=structuredClone(tasks);change(copy);assert.throws(()=>assertRegisteredBackupTasks(copy,repository));}
 const source=readFileSync('scripts/operations/frankfurt-owner-upgrade215.mjs','utf8');
 assert.ok(source.indexOf('await preflight(root)')<source.lastIndexOf('return runOwner('),'REGISTERED_TASK_CHECK_BEFORE_PASSWORD_AND_DB');
});

// RED at222: the exact213 storage metadata policy was accidentally tied to
// the moving current ceiling. Versioned220 must retain its literal220 admission.
test('legacy220 RESET retains only its exact existing storage metadata dependency at222',()=>{
 const row={class:'pg_policy',schema:'storage',relation:'storage.objects',policy:'ERP staff can read own product image metadata',description:'existing213 storage metadata policy'};
 assert.doesNotThrow(()=>assertExternalDependents([row],220));
 for(const changed of [{...row,policy:'unknown policy'},{...row,schema:'public'},{...row,relation:'storage.other'},{...row,class:'unknown'}])assert.throws(()=>assertExternalDependents([changed],220),/UNREVIEWED_EXTERNAL_DROP_DEPENDENT/);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';import path from 'node:path';
import {operationalSchema,operationalManifest,assertOperationalManifest,assertOperationalHistory} from '../scripts/operations/operational-schema.mjs';
import {migrationManifest,manifestDigest} from '../scripts/testing/maintenance-db-contract.mjs';
import {assertRegisteredBackupTasks,requiredBackupModes} from '../scripts/operations/backup-task-preflight.mjs';
import {reset215Arguments} from '../scripts/operations/frankfurt-owner-reset215.mjs';
import {reset216Arguments} from '../scripts/operations/frankfurt-owner-reset216.mjs';
import {ownerPlan} from '../scripts/operations/frankfurt-backup-runtime.mjs';

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
 const core=readFileSync('scripts/operations/trial-reset214-core.mjs','utf8');
 assert.ok(core.includes(`const policy${state.migrationCeiling}={ceiling:${state.migrationCeiling},files:${manifest.length},`),'RESET_REBUILD_ADAPTER_MUST_ADVANCE_WITH_MIGRATION');
 assert.ok(readFileSync('scripts/backup/complete-backup.mjs','utf8').match(/assertOperationalHistory\(before.history\)/gu)!.length===2);
 assert.equal(reset216Arguments([]).reference.split(/[\\/]/u).at(-1),operationalSchema.readyReferenceName);
 assert.equal(reset215Arguments([]).reference.split(/[\\/]/u).at(-1),'local-reference-through215-ready.json');
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

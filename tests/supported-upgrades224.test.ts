import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {assertSupportedUpgrade224,supportedPriorUpgrades224} from '../scripts/operations/supported-upgrades224.mjs';
import {upgradeReferenceOrigins,upgradeReferenceManifest,upgradeReferenceProof,upgradeReferenceSource} from '../scripts/operations/upgrade-versioned-reference.mjs';
import {assert222History,inputs222,run222} from '../scripts/operations/frankfurt-owner-upgrade222.mjs';
import {assert223History,inputs223,run223} from '../scripts/operations/frankfurt-owner-upgrade223.mjs';
import {operationalManifest} from '../scripts/operations/operational-schema.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {canonicalLf,sha256} from '../scripts/testing/maintenance-db-contract.mjs';
import {sourceBeforeSupportedUpgrades224,supportedUpgrades224Pins} from '../scripts/audit/source-before-supported-upgrades224.mjs';
import {sourceBeforeCutoverHold224} from '../scripts/audit/source-before-cutover-hold224.mjs';
import {cutoverCommandDocuments,documentedCutoverCommands,classifyCutoverCommand} from '../scripts/testing/cutover-command-contract.mjs';

test('all three versioned tool generators preserve their literal approved templates on current224',()=>{
 for(const name of ['independent-prices222','optional-quantity223','inventory224'])
  execFileSync(process.execPath,[`scripts/testing/build-${name}-tools.mjs`,'--check'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
});

test('every documented official command has an explicit offline mode or a named no-offline limitation',()=>{
 const documents=Object.fromEntries(cutoverCommandDocuments.map(name=>[name,readFileSync('docs/operations/'+name+'.md','utf8')]));
 const commands=documentedCutoverCommands(documents);
 assert.ok(commands.some(row=>row.command.includes('--resume-registration')),'FENCED_REGISTRATION_COMMAND_REQUIRED');
 for(const mode of ['Backup','Upload','VerifyRemote','RestoreRemote'])
  assert.ok(commands.some(row=>row.command.includes('-Mode '+mode+' -Apply')),'FENCED_BACKUP_COMMAND_REQUIRED:'+mode);
 assert.ok(commands.every(row=>row.line>0));
 for(const row of commands)assert.ok(['offline','no-offline-mode'].includes(classifyCutoverCommand(row.command).kind));
 assert.throws(()=>classifyCutoverCommand('node scripts/operations/frankfurt-owner-upgrade225.mjs --dry-run'),/CUTOVER_COMMAND_UNREVIEWED/);
 const workflow=readFileSync('.github/workflows/inventory224.yml','utf8');
 assert.ok(workflow.includes('node scripts/testing/run-supported-upgrades224-proof.mjs'));
});

test('224 admits only reviewed 222/223 adapters;unknown command,ceiling,archive or version is refused',()=>{
 const schema={ceiling:224,upgradeCommand:'frankfurt-owner-upgrade224',legacyArchiveCeilings:[220,222,223]};
 assert.deepEqual(supportedPriorUpgrades224,[222,223]);
 for(const version of [222,223]){
  assert.doesNotThrow(()=>assertSupportedUpgrade224(version,schema));
  for(const bad of [{...schema,ceiling:225},{...schema,ceiling:220},{...schema,upgradeCommand:'frankfurt-owner-upgrade225'},
   {...schema,upgradeCommand:`frankfurt-owner-upgrade${version}`},{...schema,legacyArchiveCeilings:[220]}])
   assert.throws(()=>assertSupportedUpgrade224(version,bad),/UPGRADE_ADAPTER_NOT_CURRENT/);
 }
 for(const version of [219,220,221,224,225])assert.throws(()=>assertSupportedUpgrade224(version,schema),/UPGRADE_ADAPTER_NOT_CURRENT/);
});

test('real adapters preserve the full manifest check and dispatch only their original offline plan',async()=>{
 for(const[version,run]of [[222,run222],[223,run223]] as const){
  let verified=false;
  await run(['--dry-run'],{manifest:async()=>{verified=true;return operationalManifest();},runOwner:async(args,config)=>{
   assert.equal(verified,true);assert.deepEqual(args,['--dry-run']);assert.ok(config&&'label'in config&&'versions'in config);assert.equal(config.label,String(version));
   assert.deepEqual(config.versions,[String(version)]);return{ok:true};
  }});
  await assert.rejects(()=>run(['--dry-run'],{manifest:async()=>{throw Error('MANIFEST_CHANGED');},runOwner:async()=>{throw Error('MUST_NOT_DISPATCH');}}),/MANIFEST_CHANGED/);
 }
});

test('current prefix SQL bytes,manifest,evidence and source rows match original merge commitments exactly',async()=>{
 for(const version of [222,223] as const){
  const pin=upgradeReferenceOrigins[version],manifest=await upgradeReferenceManifest(process.cwd(),version);
  assert.equal(manifest.length,pin.files);
  const proof=await upgradeReferenceProof(process.cwd(),version),file=`docs/operations/TABLE_ACCESS_AFTER_${version}.json`;
  const original=canonicalLf(execFileSync('git',['show',pin.commit+':'+file],{encoding:'utf8',maxBuffer:64*1024**2}));
  assert.equal(proof,original);assert.equal(sha256(proof),pin.proofSha256);
  assert.deepEqual((await inventory({projectSource:(file,text)=>upgradeReferenceSource(version,file,text)})).sources,JSON.parse(proof).sourceHashes);
  const sql=readFileSync('supabase/migrations/'+pin.migration);
  assert.deepEqual(sql,execFileSync('git',['show',pin.commit+':supabase/migrations/'+pin.migration],{maxBuffer:32*1024**2}));
  assert.equal(sha256(sql),pin.migrationSha256);
  const bad={manifest:manifest.map((row:{name:string;sha256:string})=>row.name===pin.migration?{...row,sha256:'0'.repeat(64)}:row)};
  await assert.rejects(()=>(version===222?inputs222(bad):inputs223(bad)),new RegExp(`UPGRADE${version}_PIN_MISMATCH`));
 }
 assert.throws(()=>upgradeReferenceSource(220,'x','x'),/VERSION_UNSUPPORTED/);
});

test('222 refuses actual223 history and223 refuses actual220 history;no order or reserved-version relaxation',async()=>{
 const manifest=await operationalManifest(),history=(v:number)=>manifest.filter((m:{name:string})=>Number(m.name.slice(0,3))<=v).map((m:{name:string})=>m.name.slice(0,3));
 const r222={prefixes:{220:{appliedVersions:history(220)}},appliedVersions:history(222)};
 const r223={prefixes:{222:{appliedVersions:history(222)}},appliedVersions:history(223)};
 assert.throws(()=>assert222History(history(223),r222),/UPGRADE222_REQUIRES_COMPLETE220_OR222/);
 assert.throws(()=>assert223History(history(220),r223),/UPGRADE223_REQUIRES_COMPLETE222_OR223/);
 assert.deepEqual(assert222History(history(220),r222),['222']);assert.deepEqual(assert223History(history(222),r223),['223']);
});

test('new exact historical projection admits only its reviewed bytes;unknown byte never disappears',()=>{
 for(const[file,pin]of Object.entries(supportedUpgrades224Pins)){
  const current=canonicalLf(readFileSync(file,'utf8'));
  const raw=sourceBeforeCutoverHold224(file,current);
  assert.ok(raw!==null);
  assert.equal(sha256(raw),pin.after);assert.equal(sourceBeforeSupportedUpgrades224(file,raw),pin.beforeText);
  assert.equal(sourceBeforeSupportedUpgrades224(file,current+'\nUNKNOWN_BYTE'),current+'\nUNKNOWN_BYTE');
 }
});

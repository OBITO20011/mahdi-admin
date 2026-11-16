import assert from 'node:assert/strict';
import test from 'node:test';
import {operationalManifest} from '../scripts/operations/operational-schema.mjs';
import {checkRegistration224,upgrade224ErrorCode} from '../scripts/operations/upgrade224-registration.mjs';
import {run224,upgrade224Arguments} from '../scripts/operations/frankfurt-owner-upgrade224.mjs';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {canonicalLf,sha256} from '../scripts/testing/maintenance-db-contract.mjs';
import {sourceBeforeUpgradeRegistration,upgradeRegistrationPins} from '../scripts/audit/source-before-upgrade-registration.mjs';

const versions=(await operationalManifest()).map(({name}:{name:string})=>name.slice(0,3));
const before=versions.slice(0,-1);
const reference={prefixes:{223:{appliedVersions:before},224:{appliedVersions:versions}}};
const list=(remote:string[])=>JSON.stringify({
 migrations:[...remote.map(version=>({local:'',remote:version,time:version})),
  ...(remote.includes('224')?[]:[{local:'224',remote:'',time:'224'}])],
 message:'Migrations listed',
});

test('pinned CLI JSON uses the complete ordered remote history for each mode',async()=>{
 for(const mode of ['--preflight-registration','--apply','--resume-registration','--verify-only']){
  const remote=mode==='--verify-only'?versions:before;
  const cli=async(flags:string[])=>{
   assert.deepEqual(flags,['migration','list','--linked','--output-format','json']);
   return {stdout:list(remote)};
  };
  const checked=await checkRegistration224({cli,reference,mode});
  assert.deepEqual(checked,{ceiling:mode==='--verify-only'?224:223,files:remote.length});
 }
 for(const stdout of [list(versions),list(before.slice(1)),list([...before.slice(0,-2),'221','223']),
  list([...before.slice(0,-2),'223','223']),list([...before].reverse()),'{"migrations":[null]}','not JSON']){
  await assert.rejects(()=>checkRegistration224({cli:async()=>({stdout}),reference,mode:'--apply'}),{
   code:'UPGRADE_REGISTRATION_PREFLIGHT_FAILED',
  });
 }
 await assert.rejects(()=>checkRegistration224({cli:async()=>({stdout:list(before)}),reference,mode:'--verify-only'}),{
  code:'UPGRADE_REGISTRATION_PREFLIGHT_FAILED',
 });
});

test('failed list exposes only the safe code and precedes archive inspection and the write pipeline',async()=>{
 const detail='synthetic connection and password diagnostic';
 let attemptedBackupCheck=false;
 await assert.rejects(()=>run224(['--apply','--backup-evidence','nonexistent-test-evidence.json'],{
  preflight:async()=>({ok:true,tasks:1,supportedCeiling:224,repositoryMatches:true}),
  runOwner:async (_args,configuration)=>{
   assert.ok(configuration&&'registration' in configuration);
   const {registration}=configuration;
   assert.ok(registration&&typeof registration==='object'&&'preflight' in registration);
   assert.equal(registration.preflight,checkRegistration224);
   await checkRegistration224({cli:async()=>{throw new Error(detail);},reference,mode:'--apply'});
   attemptedBackupCheck=true;
   throw new Error('write pipeline reached');
  },
 }),error=>{
  assert.equal(upgrade224ErrorCode(error),'UPGRADE_REGISTRATION_PREFLIGHT_FAILED');
  assert.doesNotMatch(JSON.stringify(error),/synthetic connection/u);
  return true;
 });
 assert.equal(attemptedBackupCheck,false);
});

test('224 recovery requires a pending state and the original backup, and cannot be combined with apply',()=>{
 const command=['--resume-registration','--backup-evidence','before.json','--registration-state','registration-state.json'];
 assert.deepEqual(upgrade224Arguments(command).forward,['--resume-registration']);
 for(const args of [
  command.slice(0,3),[...command,'--apply'],[...command,'--verify-only'],
  ['--apply','--backup-evidence','before.json','--registration-state','registration-state.json'],
  ['--preflight-registration','--backup-evidence','before.json'],
 ])assert.throws(()=>upgrade224Arguments(args));
});

test('historical projection admits only approved registration bytes and preserves the prior pins',()=>{
 const baseline='d451b1a9aa726f2c576402289c412ee458ee76a1';
 for(const [file,pin] of Object.entries(upgradeRegistrationPins)){
  const current=canonicalLf(readFileSync(file,'utf8'));
  assert.equal(sha256(current),pin.after,file);
  assert.equal(sourceBeforeUpgradeRegistration(file,current),pin.beforeText,file);
  assert.equal(sourceBeforeUpgradeRegistration(file,current+'\nunknown'),current+'\nunknown',file);
  if(pin.beforeText!==null)assert.equal(pin.beforeText,canonicalLf(execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'})),file);
 }
 const names=execFileSync('git',['diff','--name-only',baseline,'--','supabase','scripts/audit'],{encoding:'utf8'}).split(/\r?\n/u).filter(Boolean);
 assert.ok(names.every(file=>file==='scripts/audit/source-before-core-webkit-shards.mjs'||file==='scripts/audit/upgrade-registration-source-pins.json'||file==='scripts/audit/source-before-upgrade-registration.mjs'));
 for(const file of ['scripts/operations/frankfurt-owner-upgrade.mjs','scripts/operations/upgrade-preparation-errors.mjs']){
  assert.equal(canonicalLf(readFileSync(file,'utf8')),canonicalLf(execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'})),file);
 }
});

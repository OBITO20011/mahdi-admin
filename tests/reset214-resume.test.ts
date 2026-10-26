import {sourceBeforePrelaunchTrial} from '../scripts/audit/source-before-prelaunch-trial.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {reset214Arguments} from '../scripts/operations/frankfurt-owner-reset214.mjs';
import {privateResetDirectory,writePrivateResetJson,readPrivateResetJson,assertResetSnapshot} from '../scripts/operations/reset214-private-state.mjs';
import {reset214bPins,sourceBeforeReset214B} from '../scripts/audit/source-before-reset214b.mjs';
import {restoreReset214Sql} from '../scripts/operations/trial-reset214-core.mjs';
import {reset214ResumeDisposition,reset214SqlFailureCode,reset214ArabicReason} from '../scripts/operations/reset214-diagnostics.mjs';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),id='00000000-0000-4000-8000-000000000001';
test('resume is an explicit isolated mode and never accepts an arbitrary snapshot or target',()=>{
 assert.equal(reset214Arguments(['--resume','--owner-id',id]).mode,'resume');
 for(const a of [['--resume'],['--resume','--apply','--owner-id',id],['--resume','--snapshot','arbitrary'],['--resume','--owner-id',id,'--project-ref','other']])assert.throws(()=>reset214Arguments(a));
});
test('a refused resume is never advertised as resumable or automatic archive recovery',()=>{
 for(const code of ['RESET214_REAL_WRITES_DETECTED',
  'RESET214_OWNER_AUTH_MISSING',
  ['RESET214_OWNER','MFA_MISSING'].join('_'),
  'RESET214_RETENTION_HASH_MISMATCH',
  'RESET214_RESUME_REFERENCE_CHANGED']){
  const result=reset214ResumeDisposition(code,true);assert.equal(result.resumable,false);assert.equal(result.nextAction,'STOP_OWNER_REVIEW_NO_NEW_DELETE');
 }
 assert.equal(reset214ResumeDisposition('RESET214_OFFICIAL_CLI_FAILED',true).resumable,true);
 assert.equal(reset214ResumeDisposition('RESET214_OFFICIAL_CLI_FAILED',false).resumable,false);
 assert.equal(reset214SqlFailureCode('psql:<stdin>:9: ERROR: RESET214_REAL_WRITES_DETECTED'),'RESET214_REAL_WRITES_DETECTED');
 assert.equal(reset214SqlFailureCode('ERROR: arbitrary row values must not escape'),'TRIAL_RESET_SQL_FAILED');
 assert.ok(!reset214ArabicReason('unknown').includes('arbitrary'));
});
test('protected raw snapshot readback and hash preserve a bigint beyond JS safe integers',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'nawasrah-reset214b-files-')),folder=await privateResetDirectory(root),file=path.join(folder,'snapshot.json');
 const rawTables=Object.fromEntries(['branches','warehouses','roles','profiles','user_roles','units','categories','storefront_settings'].map(t=>[t,'[]']));
 rawTables.storefront_settings='[{"minimum_order_in_minor_units":9007199254740993}]';
 const snapshot={format:1,ownerId:id,projectRef:'kzevmysfydaslxcerogt',referenceSha256:'a'.repeat(64),referenceCeiling:214,state:{rawTables,plan:{ownerId:id}}};
 const digest=await writePrivateResetJson(file,snapshot),loaded=await readPrivateResetJson(file,digest);
 assertResetSnapshot(loaded,snapshot);assert.equal(loaded.state.rawTables.storefront_settings,rawTables.storefront_settings);
 assert.match(restoreReset214Sql(loaded.state.rawTables),/9007199254740993/u);
 if(process.platform==='win32'){
  const result=execFileSync('powershell.exe',['-NoProfile','-Command',"$a=[IO.File]::GetAccessControl($env:RESET214_TEST_FILE);$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$ok=$a.AreAccessRulesProtected;foreach($r in $a.Access){if($r.IsInherited -or $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($sid,'S-1-5-32-544')){$ok=$false}};[Console]::Write($ok)"],{encoding:'utf8',env:{...process.env,RESET214_TEST_FILE:file},windowsHide:true});assert.equal(result,'True');
 }else assert.equal((await stat(file)).mode&0o777,0o600);
 await writeFile(file,(await readFile(file,'utf8'))+' ');await assert.rejects(()=>readPrivateResetJson(file,digest),/RESET214_RETENTION_HASH_MISMATCH/u);
 for(const changed of [{ownerId:'other'},{projectRef:'other'},{referenceSha256:'b'.repeat(64)}])assert.throws(()=>assertResetSnapshot(snapshot,{...snapshot,...changed}));
 assert.throws(()=>assertResetSnapshot({...snapshot,encrypted_password:'forbidden fixture'},snapshot),/RESET214_PLATFORM_SECRET_FORBIDDEN/u);
});
test('private reset retention refuses any Git checkout or worktree before saving',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'nawasrah-reset214b-git-')),child=path.join(root,'external-looking','workdir');await mkdir(child,{recursive:true});
 await writeFile(path.join(root,'.git'),'gitdir: placeholder');
 await assert.rejects(()=>privateResetDirectory(child),/RESET214_PRIVATE_STATE_MUST_BE_OUTSIDE_GIT/u);
 await assert.rejects(()=>stat(path.join(child,'reset214-private')),{code:'ENOENT'});
});
test('RESET214B adds exactly one mandatory CI suite and restores every older admission byte',()=>{
 assert.deepEqual(Object.keys(reset214bPins),['.github/workflows/quality.yml']);
 for(const [file,pin] of Object.entries(reset214bPins) as [string,{before:string;after:string;beforeText:string}][]){
  const current=sourceBeforePrelaunchTrial(file,readFileSync(file,'utf8'))!;assert.equal(hash(current),pin.after);assert.equal(hash(pin.beforeText),pin.before);
  assert.equal(sourceBeforeReset214B(file,current),pin.beforeText);
  assert.equal(pin.beforeText,execFileSync('git',['show','72966be5b7d9a4e2200df73e6ec477c4656bbd84:'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'));
  assert.throws(()=>sourceBeforeReset214B(file,current+'\n'),/UNREVIEWED_SOURCE/u);
  assert.match(current,/if: matrix\.suite == 'reset214-resume'\s+run: node scripts\/testing\/run-reset214-resume-gates\.mjs/u);
 }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {reset214Arguments} from '../scripts/operations/frankfurt-owner-reset214.mjs';
import {privateResetDirectory,writePrivateResetJson,readPrivateResetJson,assertResetSnapshot} from '../scripts/operations/reset214-private-state.mjs';
import {reset214bPins,sourceBeforeReset214B} from '../scripts/audit/source-before-reset214b.mjs';
import {restoreReset214Sql} from '../scripts/operations/trial-reset214-core.mjs';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),id='00000000-0000-4000-8000-000000000001';
test('resume is an explicit isolated mode and never accepts an arbitrary snapshot or target',()=>{
 assert.equal(reset214Arguments(['--resume','--owner-id',id]).mode,'resume');
 for(const a of [['--resume'],['--resume','--apply','--owner-id',id],['--resume','--snapshot','arbitrary'],['--resume','--owner-id',id,'--project-ref','other']])assert.throws(()=>reset214Arguments(a));
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
test('RESET214B adds exactly one mandatory CI suite and restores every older admission byte',()=>{
 assert.deepEqual(Object.keys(reset214bPins),['.github/workflows/quality.yml']);
 for(const [file,pin] of Object.entries(reset214bPins) as [string,{before:string;after:string;beforeText:string}][]){
  const current=readFileSync(file,'utf8').replaceAll('\r\n','\n');assert.equal(hash(current),pin.after);assert.equal(hash(pin.beforeText),pin.before);
  assert.equal(sourceBeforeReset214B(file,current),pin.beforeText);
  assert.equal(pin.beforeText,execFileSync('git',['show','72966be5b7d9a4e2200df73e6ec477c4656bbd84:'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'));
  assert.throws(()=>sourceBeforeReset214B(file,current+'\n'),/UNREVIEWED_SOURCE/u);
  assert.match(current,/if: matrix\.suite == 'reset214-resume'\s+run: node scripts\/testing\/run-reset214-resume-gates\.mjs/u);
 }
});

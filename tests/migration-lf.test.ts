import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,unlinkSync,realpathSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {migrationLfEvidence} from '../scripts/agent/migration-lf.mjs';
import {migrationLfPins,sourceBeforeMigrationLf} from '../scripts/audit/source-before-migration-lf.mjs';
import {sourceBeforeRestoreRawAcl} from '../scripts/audit/source-before-restore-raw-acl.mjs';
import {sourceBeforeOnUnitDisplay225} from '../scripts/audit/source-before-on-unit-display225.mjs';

test('LF maintenance projects only exact reviewed source;historical beforeText and unknown bytes remain protected',()=>{
 for(const [file,pin]of Object.entries(migrationLfPins)){
  const current=readFileSync(file,'utf8').replace(/\r\n?/gu,'\n');
  const beforeRestore=sourceBeforeRestoreRawAcl(file,sourceBeforeOnUnitDisplay225(file,current));
  assert.notEqual(beforeRestore,null,file);
  assert.equal(sourceBeforeMigrationLf(file,beforeRestore),pin.beforeText,file);
  assert.equal(sourceBeforeMigrationLf(file,sourceBeforeRestoreRawAcl(file,sourceBeforeOnUnitDisplay225(file,current+'UNKNOWN_BYTE'))),current+'UNKNOWN_BYTE',file);
 }
 assert.equal(execFileSync('git',['diff','--name-only','HEAD','--','supabase/migrations'],{encoding:'utf8'}).trim(),'');
});

test('literal222/223/224 pins and all current SQL bytes remain LF;preflight invokes the rejecting check',()=>{
 assert.deepEqual(migrationLfEvidence(process.cwd()),{ok:true,checkedFiles:184,invalid:[],code:null});
 const state=JSON.parse(readFileSync('docs/agent/project-state.json','utf8'));
 for(const [file,expected]of [
  ['222_independent_lite_parcel_prices.sql','bcf55b1f43714e27d525dedac51cc7c3f85d0e1f2be422bbc422cafc6ff84a68'],
  ['223_optional_sales_quantity.sql','d5d6397bd5d676f766493b7a85b1f47ad6f1b6f6c465e7b4a32219ee49abc0af'],
  ['224_optional_quantity_inventory_reader.sql','f706c9b09d76f0d28dc431320cae993f209142955c7b70f813f6514068ec631d'],
 ]){
  const sqlPath='supabase/migrations/'+file,raw=readFileSync(sqlPath);
  assert.equal(createHash('sha256').update(raw).digest('hex'),expected);
  assert.equal(state['migration'+file.slice(0,3)+'CanonicalLfSha256'].toLowerCase(),expected);
  assert.deepEqual(raw,execFileSync('git',['show','HEAD:'+sqlPath]));
 }
 const preflight=readFileSync('scripts/agent/preflight.mjs','utf8');
 assert.ok(preflight.includes('migrationLfEvidence(root)'));assert.ok(preflight.includes("if(!migrationLf.ok)failures.push('MIGRATION_SQL_LF_BYTES_REQUIRED:"));
});

test('a real Git checkout with autocrlf=true preserves migration LF;copied CRLF is detected without rewriting it',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'nawasrah-migration-lf-'));
 const git=(...args:string[])=>execFileSync('git',['-c','core.hooksPath='+path.join(directory,'empty-hooks'),...args],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe']});
 try{
  mkdirSync(path.join(directory,'empty-hooks'));mkdirSync(path.join(directory,'supabase','migrations'),{recursive:true});
  git('init','-q');git('config','core.autocrlf','true');
  writeFileSync(path.join(directory,'.gitattributes'),readFileSync('.gitattributes'));
  const relative='supabase/migrations/222_sample.sql',absolute=path.join(directory,relative),lf=Buffer.from('BEGIN;\nSELECT 1;\nROLLBACK;\n');
  writeFileSync(absolute,lf);git('add','--all');git('-c','user.name=Local QA','-c','user.email=qa@example.test','commit','-qm','LF checkout fixture','--no-gpg-sign');
  unlinkSync(absolute);git('checkout','--',relative);
  assert.deepEqual(readFileSync(absolute),lf);
  assert.match(git('check-attr','eol','--',relative).toString(),/: eol: lf/u);
  const crlf=Buffer.from(lf.toString().replaceAll('\n','\r\n'));writeFileSync(absolute,crlf);
  assert.deepEqual(migrationLfEvidence(directory),{ok:false,checkedFiles:1,invalid:['222_sample.sql'],code:'MIGRATION_SQL_LF_BYTES_REQUIRED'});
  assert.deepEqual(readFileSync(absolute),crlf,'preflight must never rewrite the file');
 }finally{
  const actual=realpathSync(directory),parent=realpathSync(tmpdir());
  assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('nawasrah-migration-lf-'));
  rmSync(actual,{recursive:true,force:true});
 }
});

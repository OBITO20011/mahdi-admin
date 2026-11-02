import{sourceBeforePreTraining}from'../scripts/audit/source-before-pre-training.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {home219Pins,sourceBeforeHome219} from '../scripts/audit/source-before-home-performance219.mjs';
import {collectSafeDbDiagnostics} from '../scripts/testing/collect-safe-db-diagnostics.mjs';

const lf=(s:string)=>s.replaceAll('\r\n','\n');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
test('219 historical view binds actual baseline bytes and never erases an unreviewed mutation',()=>{
  assert.equal(home219Pins.baseline,'cab1c5aed8c2069e2919c566ea09c2da9757896d');
  for(const file of ['.github/workflows/quality.yml','.github/workflows/backup-recovery.yml',
    'docs/agent/project-state.json','scripts/audit/source-before-sentry.mjs',
    'scripts/operations/trial-reset-core.mjs','scripts/operations/trial-reset214-core.mjs',
    'scripts/testing/run-canonical-receivables197-scale.mjs','scripts/testing/run-home-damage201-scale.mjs',
    'scripts/testing/run-all-collections202-scale.mjs'])assert.ok(home219Pins.entries[file],'MISSING_REVIEWED219_PATH:'+file);
  for(const [file,pin] of Object.entries(home219Pins.entries) as [string,{after:string;before:string|null;beforeText:string|null}][]){
    const current=sourceBeforePreTraining(file,lf(readFileSync(file,'utf8')))!;
    assert.equal(hash(current),pin.after,file);
    assert.equal(sourceBeforeHome219(file,current),pin.beforeText,file);
    if(pin.beforeText!==null){
      assert.equal(hash(pin.beforeText),pin.before,file);
      assert.equal(lf(execFileSync('git',['show',home219Pins.baseline+':'+file],{encoding:'utf8',maxBuffer:32*1024**2})),pin.beforeText,file);
    }
    assert.equal(sourceBeforeHome219(file,current+'\nunknown219\n'),current+'\nunknown219\n',file);
  }
  assert.equal(sourceBeforeHome219('unknown','unreviewed'),'unreviewed');
});

test('CI collects only allowlisted catalog/performance evidence, redacts tokens and never copies retention or Auth data',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'nawasrah-safe-diagnostic-test-'));
  try{
    const source=path.join(root,'source'),output=path.join(root,'output'),valid=path.join(source,'nawasrah-home219-synthetic');
    await mkdir(valid,{recursive:true});
    const token='123456789:'+ 'x'.repeat(35);
    await writeFile(path.join(valid,'performance-report.json'),JSON.stringify({p95:1234,definition:`SELECT '${token}'`}));
    await writeFile(path.join(valid,'reset-catalog-differences.json'),'[]');
    await writeFile(path.join(valid,'retention.json'),'OWNER_AUTH_AND_MFA_MUST_NOT_COPY');
    await writeFile(path.join(valid,'report.json'),'UNREVIEWED_REPORT_MUST_NOT_COPY');
    const resumed=path.join(valid,'resumed-migration-088');await mkdir(resumed);
    await writeFile(path.join(resumed,'reset-catalog-before.json'),'{}');
    await writeFile(path.join(resumed,'reset-catalog-after.json'),'{}');
    const privateDir=path.join(valid,'reset214-private');await mkdir(privateDir);
    await writeFile(path.join(privateDir,'reset-catalog-before.json'),'PRIVATE_STATE_MUST_NOT_COPY');
    const other=path.join(source,'unrelated');await mkdir(other);await writeFile(path.join(other,'performance-report.json'),'{}');
    const result=await collectSafeDbDiagnostics(source,output);
    assert.equal(result.files.length,4);assert.deepEqual(result.errors,[]);
    assert.equal(result.rawReportsCopied,false);assert.equal(result.retentionOrAuthFilesCopied,false);
    assert.deepEqual((await readdir(path.join(output,'nawasrah-home219-synthetic'))).sort(),['performance-report.json','reset-catalog-differences.json','resumed-migration-088']);
    assert.ok(result.files.some((f:{file:string})=>f.file.endsWith('resumed-migration-088/reset-catalog-before.json')));
    const data=await readFile(path.join(output,'nawasrah-home219-synthetic/performance-report.json'),'utf8');
    assert.ok(!data.includes(token));assert.equal(JSON.parse(data).p95,1234);
    assert.equal(result.files.find((f:{file:string})=>f.file.endsWith('performance-report.json'))!.redactedFields.length,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

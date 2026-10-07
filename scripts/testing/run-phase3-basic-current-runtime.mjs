import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import path from 'node:path';
const exec=promisify(execFile);
const root=path.resolve(import.meta.dirname,'../..');
const projectId='nawasrah-phase3-basic-current-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
let workdir;
try {
  const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
    cwd:root,windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:'132',
      NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:
        'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const built=JSON.parse(stdout);assert.equal(built.ok,true);workdir=built.isolatedProjectRoot;
  const fixture=await readFile(path.join(root,'scripts/testing/phase3-configurable-parcel-contracts-runtime.sql'),'utf8');
  const result=await new Promise((resolve,reject)=>{
    const child=spawn('docker',['exec','-i',`supabase_db_${projectId}`,'psql','-U','postgres','-d','postgres',
      '-X','-q','-At','-v','ON_ERROR_STOP=1'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',value=>{out+=value;});child.stderr.on('data',value=>{err+=value;});
    child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(out.trim().split(/\r?\n/u).at(-1))):reject(Error(err)));
    child.stdin.end(`SET statement_timeout='60s';SET lock_timeout='30s';SET nawasrah.package_d_current='1';\n${fixture}`);
  });
  assert.equal(result.ok,true);assert.equal(result.scenarios.length,30);
  assert.equal(result.operationRows,4);assert.equal(result.reservationRows,2);assert.equal(result.featureState,'ENABLED');
  for(const scenario of ['pos_v1_new_creation_retired_zero_write','pos_v1_after_v2_retired','pos_v1_reversal_fixture_creation_retired']) {
    assert.ok(result.scenarios.includes(scenario));
  }
  console.log(JSON.stringify({ok:true,schema:'001-132',basicSqlFixture:result,
    historicalV1Proof:'retained unchanged in historical001-131 job',retiredV1RejectedOn132:true},null,2));
} finally {
  if(workdir)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],
    {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
interface RegistryProof{schemaVersion:number;legacy:string;mirror:string;digest:string;manifestText:string}
const proof:RegistryProof=JSON.parse(read('tests/fixtures/postgrest-v16.1-registry-manifest.json'));
const pinned=proof.legacy+'@'+proof.digest;
test('official GHCR16.1 pin identifies the exact prior ECR multiarch bytes,not a version upgrade',()=>{
 assert.equal(proof.schemaVersion,1);assert.equal(proof.legacy,'public.ecr.aws/supabase/postgrest:v16.1');assert.equal(proof.mirror,'ghcr.io/supabase/postgrest:v16.1');
 assert.equal(proof.digest,'sha256:5922bde07147b82b1c9d8f749e48c1e5b99ebb233f3888bb7ab65f07cf4ac82d');
 assert.equal('sha256:'+createHash('sha256').update(proof.manifestText).digest('hex'),proof.digest);
 const manifest:{schemaVersion:number;manifests:{digest:string;platform:{os:string;architecture:string}}[]}=JSON.parse(proof.manifestText);
 assert.equal(manifest.schemaVersion,2);
 assert.deepEqual(manifest.manifests.map(m=>({platform:m.platform.os+'/'+m.platform.architecture,digest:m.digest})),[
  {platform:'linux/amd64',digest:'sha256:73e76c305027cb1119bc7c6ab82449d9e1a50a9e8697f4ebac5443dc63590c90'},
  {platform:'linux/arm64',digest:'sha256:2fa40bb679b2a731f6ffe7dc9db6c15d57fd4e329e59e6362f9307630323535f'},
 ]);
});
test('current immutable ECR pin changes ONLY the Docker image argument,not launch env,port,readiness or probe contracts',()=>{
 const file='scripts/audit/run-table-access-diagnostic.mjs',current=read(file);
 const previous=execFileSync('git',['show',`f8a48d5:${file}`],{encoding:'utf8'}).replaceAll('\r\n','\n');
 const block=(source:string)=>{const start=source.indexOf(" report.stage='local-postgrest';"),end=source.indexOf(" report.stage='actual-original-queries';",start);
  assert.ok(start>0&&end>start);return source.slice(start,end);};
 const after=block(current);assert.equal(after.split(pinned).length,2);
 assert.equal(after.replace(pinned,proof.legacy),block(previous));
 assert.equal([...after.matchAll(/await exec\('docker',\['run'/gu)].length,1);
 assert.doesNotMatch(after,/docker\.io|latest|--pull=always|retry/iu);
});

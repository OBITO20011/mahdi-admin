// Resolve graphs only; never execute a handler or read application secrets.
import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),binary=process.env.NAWASRAH_DENO_BINARY;
assert.ok(binary&&path.isAbsolute(binary),'PINNED_DENO_BIN_CJS_REQUIRED');
const deno=async args=>exec(process.execPath,[binary,...args],{cwd:root,windowsHide:true,maxBuffer:2*1024**2});
assert.match((await deno(['--version'])).stdout,/^deno 2\.1\.4 /);
const hash=b=>createHash('sha256').update(b).digest('hex'),proof=[];
for(const name of ['manage-staff-users','n8n-alert-feed','send-order-push','admin-ai-assistant','submit-guest-order']){
 const dir=path.join(root,'supabase/functions',name),config=path.join(dir,'deno.json'),lock=path.join(dir,'deno.lock'),before=await readFile(lock);
 assert.deepEqual(JSON.parse(await readFile(config,'utf8')),{lock:{path:'./deno.lock',frozen:true}});
 const contents=JSON.parse(before);assert.equal(contents.version,'4');
 if(name!=='submit-guest-order')assert.equal(contents.specifiers['npm:@supabase/supabase-js@2.110.8'],'2.110.8');
 if(name==='send-order-push')assert.equal(contents.specifiers['npm:web-push@3.6.7'],'3.6.7');
 await deno(['cache','--frozen','--config',config,path.join(dir,'index.ts')]);assert.deepEqual(await readFile(lock),before);
 proof.push({function:name,lockSha256:hash(before),frozen:true,handlersExecuted:false});
}
// An unrecorded graph must fail rather than quietly updating a deployed lock.
const temp=await mkdtemp(path.join(tmpdir(),'nawasrah-edge-lock-negative-'));
await writeFile(path.join(temp,'deno.json'),'{"lock":{"path":"./deno.lock","frozen":true}}');
await writeFile(path.join(temp,'deno.lock'),'{"version":"4"}');await writeFile(path.join(temp,'probe.ts'),"import 'npm:@supabase/supabase-js@2.110.8';\n");
await assert.rejects(deno(['cache','--frozen','--config',path.join(temp,'deno.json'),path.join(temp,'probe.ts')]),error=>/lockfile|lock file|frozen/iu.test(error.stderr));
assert.deepEqual(JSON.parse(await readFile(path.join(temp,'deno.lock'),'utf8')),{version:'4'});
console.log(JSON.stringify({ok:true,functions:proof,frozenUnrecordedGraphRejected:true}));

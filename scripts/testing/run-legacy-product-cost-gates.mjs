// Independent CI shard; existing product/warehouse gates remain unchanged.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-legacy-product-cost-gate-'));
const reference=path.join(output,'local-reference-through200-ready.json');
for(const args of [
 ['scripts/testing/run-legacy-product-cost-runtime.mjs'],
 ['scripts/operations/build-acl-reference200.mjs','--output',reference],
 ['scripts/testing/run-legacy-cost-upgrade200-runtime.mjs',reference],
]){
 const result=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:16*1024**2});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);
}

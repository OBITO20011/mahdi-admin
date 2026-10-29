// Pinned Deno graph/typecheck;unit goldens and actual disposable DB transport.
import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import path from 'node:path';import {readFile} from 'node:fs/promises';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),deno=process.env.NAWASRAH_DENO_BINARY;
assert.ok(deno&&path.isAbsolute(deno),'PINNED_DENO_BIN_CJS_REQUIRED');
const lock=path.join(root,'supabase/functions/owner-telegram-dispatch/deno.lock'),before=await readFile(lock);
const run=async args=>{const r=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:32*1024**2});process.stdout.write(r.stdout);process.stderr.write(r.stderr);};
await run([deno,'check','--frozen','--config','supabase/functions/owner-telegram-dispatch/deno.json','supabase/functions/owner-telegram-dispatch/index.ts']);assert.deepEqual(await readFile(lock),before);
await run(['--import','tsx','--test','tests/owner-telegram-dispatch217.test.ts']);
await run(['--import','tsx','scripts/testing/run-owner-telegram217-runtime.mjs']);
console.log(JSON.stringify({ok:true,managedAccess:false,frozenDeno:true,goldenAndHandler:8,actualDatabaseGroups:9}));

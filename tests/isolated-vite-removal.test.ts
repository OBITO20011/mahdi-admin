import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForOwnedViteRemoval} from '../scripts/testing/stop-isolated-vite.mjs';
const failure=(code:string)=>Object.assign(new Error(code),{code});
test('Windows delete-pending EPERM is polled but cleanup succeeds only after actual ENOENT',async()=>{
 let time=0,probes=0;
 await waitForOwnedViteRemoval('synthetic-owned-directory',{platform:'win32',clock:()=>time,pause:async(ms:number)=>{time+=ms;},probe:async()=>{probes++;if(probes===1)throw failure('EPERM');if(probes===3)throw failure('ENOENT');}});
 assert.equal(probes,3);assert.equal(time,40);
});
test('persistent Windows EPERM and an existing directory both fail at the unchanged5s deadline',async()=>{
 for(const permission of [true,false]){let time=0;await assert.rejects(waitForOwnedViteRemoval('synthetic-owned-directory',{platform:'win32',clock:()=>time,pause:async(ms:number)=>{time+=ms;},probe:async()=>{if(permission)throw failure('EPERM');}}),/ISOLATED_VITE_CACHE_NOT_REMOVED/u);assert.equal(time,5000);}
});
test('real access denial and non-Windows EPERM fail immediately without accepting or retrying them',async()=>{
 for(const [platform,code]of [['win32','EACCES'],['linux','EPERM'],['linux','EIO']]as const){let pauses=0;await assert.rejects(waitForOwnedViteRemoval('synthetic-owned-directory',{platform,pause:async()=>{pauses++;},probe:async()=>{throw failure(code);}}),(e:NodeJS.ErrnoException)=>e.code===code);assert.equal(pauses,0);}
});

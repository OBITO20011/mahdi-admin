import test from 'node:test';
import assert from 'node:assert/strict';
import {legacy219ReadRpcNames,legacy219MissingRpcName,replyLegacy219MissingRpc} from '../e2e/legacy219-rpc';
test('legacy219 fixture returns exact missing-reader404, never a success or a writer exemption',async()=>{
 assert.equal(legacy219ReadRpcNames.length,13);assert.equal(new Set(legacy219ReadRpcNames).size,13);
 for(const name of legacy219ReadRpcNames){
  const responses:unknown[]=[];
  assert.equal(await replyLegacy219MissingRpc({request:()=>({url:()=>`http://127.0.0.1:4176/rest/v1/rpc/${name}`}),fulfill:async response=>{responses.push(response);}}),true);
  assert.deepEqual(responses,[{status:404,json:{code:'PGRST202',message:`Could not find public.${name} in the legacy219 fixture`}}]);
 }
 for(const path of ['/rest/v1/rpc/lite1_pos2','/rest/v1/rpc/execute_return','/rest/v1/rpc/unreviewed','/rest/v1/orders','/rest/v1/rpc/lite1_operating_mode_extra']){
  let calls=0;assert.equal(legacy219MissingRpcName(path),undefined);
  assert.equal(await replyLegacy219MissingRpc({request:()=>({url:()=>`http://127.0.0.1:4176${path}`}),fulfill:async()=>{calls++;}}),false);assert.equal(calls,0);
 }
});

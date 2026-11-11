import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {legacy219ReadRpcNames,legacy219MissingRpcName,replyLegacy219MissingRpc} from '../e2e/legacy219-rpc';
test('legacy219 fixture returns exact missing-reader404, never a success or a writer exemption',async()=>{
 assert.equal(legacy219ReadRpcNames.length,15);assert.equal(new Set(legacy219ReadRpcNames).size,15);
 const addedReaders=legacy219ReadRpcNames.slice(13);
 assert.deepEqual(addedReaders,['lite1_debt_aging2','lite1_crm_page2']);
 const migration=readFileSync('supabase/migrations/220_sales_only_operating_mode.sql','utf8');
 for(const reader of addedReaders){
  // PostgreSQL forbids writes in STABLE functions.
  const declaration=migration.match(new RegExp('CREATE FUNCTION public\\.'+reader+'\\([^\\n]*\\)\\s+RETURNS jsonb\\s+LANGUAGE plpgsql\\s+STABLE SECURITY DEFINER\\s+SET search_path[^\\n]*'));
  assert.ok(declaration,reader+' must remain a STABLE reader');
 }
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

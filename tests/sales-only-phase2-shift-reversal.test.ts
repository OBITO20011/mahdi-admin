import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertLiteShiftReversalBlock,readOperatingShiftReversalWithRpc,shiftReversalGuardMessage} from '../src/services/supabase/operatingShiftReversal';

const shift='92600000-0000-4000-8000-000000000500';
test('owner-approved status guard is narrow,volatile andadditional;never rewrites originalfunctions or grants private access',()=>{
 const sql=readFileSync('docs/design/sales-only-phase2/shift-reversal-guard.sql','utf8');
 assert.match(sql,/LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public/);
 assert.match(sql,/BEFORE UPDATE OF status ON public\.cash_shifts/);
 assert.match(sql,/NEW\.status IN\('cancelled','reversed'\)/);
 assert.match(sql,/r\.shift_id=OLD\.id AND r\.money_refund>0/);
 assert.doesNotMatch(sql,/pg_advisory|FOR UPDATE|FOR SHARE|UPDATE public\.|INSERT INTO|DELETE FROM|ALTER FUNCTION|CREATE OR REPLACE|DISABLE TRIGGER|session_replication_role/);
 assert.match(sql,/result:=public\.preview_cash_shift_full_reversal\(p_shift_id\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION sales_lite2\.guard_shift_lite_refund\(\) FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.lite1_preview_shift_reversal2\(UUID\) TO authenticated/);
 assert.doesNotMatch(sql,/GRANT.*(?:TABLE|SCHEMA|TO anon|TO service_role)/);
});

test('parallel preview falls backonly onexactmissing219RPC,retains identity,andnever retries errors or malformed success',async()=>{
 const calls:unknown[]=[];await readOperatingShiftReversalWithRpc(async(name,args)=>{calls.push([name,args]);return name==='lite1_preview_shift_reversal2'?{data:null,error:{code:'PGRST202',message:'public.lite1_preview_shift_reversal2'},status:404}:{data:{success:true},error:null};},shift);
 assert.deepEqual(calls,[['lite1_preview_shift_reversal2',{p_shift_id:shift}],['preview_cash_shift_full_reversal',{p_shift_id:shift}]]);
 for(const response of [{data:{malformed:true},error:null,status:200},{data:null,error:{code:'42501',message:'denied'},status:404},{data:null,error:{code:'PGRST202',message:'other'},status:404},{data:null,error:{code:'PGRST202',message:'lite1_preview_shift_reversal2'},status:500}]){let count=0;await readOperatingShiftReversalWithRpc(async()=>{count++;return response;},shift);assert.equal(count,1);}
});

test('positive lite block requiresmatchingidentity,false execution and a visible blocking reason;full DTO unchanged',()=>{
 const blocked={success:true,shiftId:shift,canExecute:false,liteMonetaryRefundBlocked:true,operations:[{operationType:'lite_monetary_refund',originalRecordId:shift,status:'BLOCKED',reason:'استخدم الإغلاق اليومي'}]};
 assert.doesNotThrow(()=>assertLiteShiftReversalBlock(blocked,shift));const full={success:true,shiftId:shift,canExecute:true,operations:[]},copy=structuredClone(full);assertLiteShiftReversalBlock(full,shift);assert.deepEqual(full,copy);
 for(const patch of [{canExecute:true},{shiftId:'other'},{liteMonetaryRefundBlocked:false},{operations:[]},{operations:[{...blocked.operations[0],status:'SUPPORTED'}]},{operations:[{...blocked.operations[0],reason:''}]}])assert.throws(()=>assertLiteShiftReversalBlock({...blocked,...patch},shift),/SHIFT-03/);
});

test('only exact server guard identity becomes Arabic action copy;never success or raw injected message',()=>{
 assert.match(shiftReversalGuardMessage({code:'P0001',message:'LITE2_SHIFT_REVERSAL_HAS_LITE_REFUND'})!,/استخدم عدّ الدرج والإغلاق اليومي/);
 for(const error of [{code:'42501',message:'LITE2_SHIFT_REVERSAL_HAS_LITE_REFUND'},{code:'P0001',message:'LITE2_SHIFT_REVERSAL_HAS_LITE_REFUND SECRET'},{message:'network SECRET'}])assert.equal(shiftReversalGuardMessage(error),null);
});

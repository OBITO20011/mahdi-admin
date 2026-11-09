import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {drawerSource,drawerHunks,drawerSignature} from '../scripts/testing/sales-only-phase2-drawer.mjs';
import {readOperatingShiftMovementsWithRpc} from '../src/services/supabase/operatingShiftMovements';
test('parallel drawer copies pinned215 reader with three exact changes;role/pagination/canonical mismatch and full delegation retained',()=>{
 const migration=readFileSync('supabase/migrations/215_inspected_aftercare_and_supplier_credit.sql','utf8').replaceAll('\r\n','\n');
 const start=migration.indexOf('CREATE OR REPLACE FUNCTION public.get_cash_shift_movement_page('),tail=migration.slice(start),a=tail.indexOf('AS $function$')+'AS $function$'.length,b=tail.indexOf('$function$;',a);
 const row={signature:drawerSignature,source:tail.slice(a,b)};let expected=row.source;
 for(const[from,to]of drawerHunks){assert.equal(expected.split(from).length,2);expected=expected.replace(from,()=>to);}assert.equal(drawerSource(row),expected);assert.throws(()=>drawerSource({...row,source:row.source+'UNKNOWN'}),/DRAWER_FROZEN_SOURCE_DRIFT/);
 assert.match(expected,/public\.assert_erp_role\(ARRAY\['owner','admin','manager','accountant'\]/);assert.match(expected,/p_page_size>100/);assert.match(expected,/ORDER BY at DESC,id DESC,source/);assert.match(expected,/v_canonical=totals.amount THEN 'matched' ELSE 'mismatch'/);
 assert.match(expected,/r\.shift_id=p_shift_id AND r\.method=p_method AND r\.money_refund>0/);
 assert.doesNotMatch(expected,/INSERT INTO|UPDATE public\.|DELETE FROM/);
});
test('drawer request onlymissingexactRPC fallsback;pagination/signalkept andabortedread cannotstartlegacyquery',async()=>{
 const args={p_shift_id:'local',p_kind:'refunds',p_method:'cash',p_page:2,p_page_size:25},signal=new AbortController().signal,calls:unknown[]=[];
 await readOperatingShiftMovementsWithRpc(async(n,a,s)=>{calls.push([n,a,s]);return n==='lite1_shift_movements2'?{data:null,error:{code:'PGRST202',message:'public.lite1_shift_movements2'},status:404}:{data:{},error:null};},args,signal);
 assert.deepEqual(calls,[['lite1_shift_movements2',args,signal],['get_cash_shift_movement_page',args,signal]]);
 const controller=new AbortController();let count=0;await assert.rejects(readOperatingShiftMovementsWithRpc(async()=>{count++;controller.abort();return {data:null,error:{code:'PGRST202',message:'lite1_shift_movements2'},status:404};},args,controller.signal),/ABORTED/);assert.equal(count,1);
 for(const response of [{data:{malformed:true},error:null,status:200},{data:null,error:{code:'42501',message:'denied'},status:404},{data:null,error:{code:'PGRST202',message:'other'},status:404}]){count=0;await readOperatingShiftMovementsWithRpc(async()=>{count++;return response;},args);assert.equal(count,1);}
});

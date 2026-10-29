import type {SupabaseClient} from '@supabase/supabase-js';
import {aftercare215Record,type Aftercare215Action} from '../../utils/aftercare215Contracts';

export function assertAftercare215Request(action:Aftercare215Action,orderId:string,request:Record<string,unknown>):void{
  const payload=request.payload;
  const invalid=()=>new Error('AFTERCARE_REVIEW_REQUIRED: طلب المعاينة المحفوظ غير مطابق للفاتورة.');
  if(Object.keys(request).sort().join(',')!=='payload,previewFingerprint'||!aftercare215Record(payload)
    ||typeof request.previewFingerprint!=='string'||!/^[0-9a-f]{64}$/u.test(request.previewFingerprint))throw invalid();
  const source=action==='exchange'?payload.returnRequest:payload;
  if(!aftercare215Record(source)||source.orderId!==orderId)throw invalid();
  const check=(v:unknown):void=>{
    if(Array.isArray(v)){v.forEach(check);return;}
    if(!aftercare215Record(v))return;
    for(const [k,entry]of Object.entries(v)){
      if(/cost|cogs|wac|profit|loss|ownerValues|RecoveryInMinorUnits/iu.test(k))throw invalid();
      check(entry);
    }
  };
  check(payload);
}
/** Every retry uses the persisted payload, seal and key, without preview again. */
export async function invokeAftercare215(client:SupabaseClient,action:Aftercare215Action,orderId:string,key:string,request:Record<string,unknown>){
  assertAftercare215Request(action,orderId,request);
  const args={p_payload:request.payload,p_idempotency_key:key,p_preview_fingerprint:request.previewFingerprint};
  if(action==='sealed_return')return await client.rpc('settle_admin_sales_return_v2',args);
  if(action==='inspected_replacement')return await client.rpc('settle_inspected_sales_replacement_v2',args);
  return await client.rpc('settle_sales_exchange_v1',args);
}

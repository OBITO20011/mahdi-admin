import {isSupabaseConfigured,supabase} from '../../lib/supabase';
import {parseAftercare215Preview,type Aftercare215Action,type Aftercare215Payloads} from '../../utils/aftercare215Contracts';
import {runAdminAftercareMutation} from './adminAftercareRecovery';
import {invokeAftercare215} from './aftercare215Rpc';

const clientOrThrow=()=>{if(!isSupabaseConfigured||!supabase)throw new Error('اتصال قاعدة البيانات غير متاح.');return supabase;};
export function aftercare215OrderId<A extends Aftercare215Action>(action:A,payload:Aftercare215Payloads[A]):string{
  return action==='exchange'?(payload as Aftercare215Payloads['exchange']).returnRequest.orderId:(payload as Aftercare215Payloads['sealed_return']).orderId;
}
export async function previewAftercare215<A extends Aftercare215Action>(action:A,payload:Aftercare215Payloads[A],ownerAllowed:boolean){
  const captured=structuredClone(payload),orderId=aftercare215OrderId(action,captured),client=clientOrThrow();
  const args={p_payload:captured};
  const result=action==='sealed_return'?await client.rpc('preview_admin_sales_return_v2',args)
    :action==='inspected_replacement'?await client.rpc('preview_inspected_sales_replacement_v2',args)
    :await client.rpc('preview_sales_exchange_v1',args);
  if(result.error)throw result.error;
  return parseAftercare215Preview(action,orderId,result.data,ownerAllowed);
}
export async function settleAftercare215<A extends Aftercare215Action>(action:A,payload:Aftercare215Payloads[A],previewFingerprint:string){
  const captured=structuredClone(payload),orderId=aftercare215OrderId(action,captured),client=clientOrThrow();
  const result=await runAdminAftercareMutation(client,orderId,action,'START_NEW',{payload:captured,previewFingerprint},
    (key,request)=>invokeAftercare215(client,action,orderId,key,request));
  return {success:result.data?.success===true,data:result.data,error:result.error?.message as string|undefined};
}

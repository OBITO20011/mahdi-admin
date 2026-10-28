import {supabase,isSupabaseConfigured} from '../../lib/supabase';
import {parseSupplierCreditPage215,parseSupplierCreditPreview215,type SupplierCreditAction215} from '../../utils/supplierCredit215';
import type {SupplierReplacementPayload} from '../../utils/supplierReplacement';
const client=()=>{if(!isSupabaseConfigured||!supabase)throw new Error('خدمة خصم المورد غير متاحة.');return supabase;};
export async function previewSupplierCredit215(action:SupplierCreditAction215,payload:SupplierReplacementPayload){
  const captured=structuredClone(payload),{data,error}=await client().rpc('preview_supplier_replacement_credit_v1',{p_action:action,p_payload:captured});
  if(error)throw new Error(error.message);return parseSupplierCreditPreview215(action,captured,data);
}
export async function readSupplierCredits215(supplierId:string,page=1){
  const{data,error}=await client().rpc('get_supplier_replacement_credits_v1',{p_supplier_id:supplierId,p_page:page,p_page_size:25});
  if(error)throw new Error(error.message);const result=parseSupplierCreditPage215(data);if(result.page!==page)throw new Error('صفحة سجل خصم المورد غير مطابقة.');return result;
}

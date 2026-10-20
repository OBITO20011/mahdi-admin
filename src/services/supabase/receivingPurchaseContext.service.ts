import {supabase,isSupabaseConfigured} from '../../lib/supabase';
import {parsePurchaseContexts,parseReceiptDisplay} from '../../utils/receivingPurchaseContext';
const namedError=(error:{code?:string;message:string})=>new Error(['PGRST202','42883'].includes(error.code??'')?'قراءة أسعار الاستلام تحتاج ترقية205 من المالك.':`تعذر قراءة أسعار الاستلام: ${error.message}`);
export async function fetchReceivingPurchaseContexts(productIds:string[],signal?:AbortSignal){
  if(!supabase||!isSupabaseConfigured)throw Error('الاتصال بقراءة أسعار الاستلام غير متاح.');
  const ids=Array.from(new Set(productIds)).sort();if(!ids.length)return {};
  if(ids.length>100)throw Error('اختر حتى100 صنف لقراءة آخر شراء.');
  let request=supabase.rpc('get_receiving_purchase_context',{p_product_ids:ids});
  if(signal)request=request.abortSignal(signal);
  const {data,error}=await request;if(error)throw namedError(error);
  return parsePurchaseContexts(data,ids);
}
export async function fetchSupplierReceiptDisplay(receiptId:string){
  if(!supabase||!isSupabaseConfigured)throw Error('الاتصال بقراءة تفاصيل الاستلام غير متاح.');
  const {data,error}=await supabase.rpc('get_supplier_receipt_display_context',{p_receipt_id:receiptId});
  if(error)throw namedError(error);return parseReceiptDisplay(data,receiptId);
}

import {supabase,isSupabaseConfigured} from '../../lib/supabase';
import {isSalesHistoryDate,parseSalesHistoryPage,type SalesHistoryInput,type SalesHistoryPage} from '../../utils/salesHistory';
export type {SalesHistoryInput,SalesHistoryPage,SalesHistoryItem} from '../../utils/salesHistory';
export type SalesHistoryResult={success:true;data:SalesHistoryPage}|{success:false;error:string;unavailable?:boolean};
export async function fetchSalesHistoryPageFromSupabase(input:SalesHistoryInput,signal?:AbortSignal):Promise<SalesHistoryResult> {
  if(!isSupabaseConfigured||!supabase)return {success:false,error:'سجل المبيعات غير متاح حالياً.',unavailable:true};
  if(input.period==='range'&&(!isSalesHistoryDate(input.fromDate)||!isSalesHistoryDate(input.toDate)||input.fromDate>input.toDate))
    return {success:false,error:'اختر مدى تاريخ صحيحاً.'};
  try {
    const request=supabase.rpc('get_sales_history_page',{
      p_page:input.page,p_page_size:input.pageSize,p_period:input.period,
      p_from_date:input.period==='range'?input.fromDate:null,p_to_date:input.period==='range'?input.toDate:null,
      p_payment_method:input.paymentMethod??'all',p_source:input.source??'all',
      p_customer_search:input.customerSearch?.trim()||null,p_number_search:input.numberSearch?.trim()||null,p_sales_only:input.salesOnly??false,
    });
    const {data,error}=await (signal?request.abortSignal(signal):request);
    if(error){
      if(error.code==='PGRST202')return {success:false,error:'سجل المبيعات غير متاح حالياً.',unavailable:true};
      return {success:false,error:error.code==='42501'?'لا تملك صلاحية قراءة سجل المبيعات.':error.message||'تعذر تحميل سجل المبيعات.'};
    }
    return {success:true,data:parseSalesHistoryPage(data)};
  }catch(error){return {success:false,error:error instanceof Error?error.message:'تعذر تحميل سجل المبيعات.'};}
}

import {isSupabaseConfigured,supabase} from '../../lib/supabase';
import {readCustomerStatement} from '../../utils/customerStatement';

export async function fetchCustomerStatement(customerId:string,page=1) {
  if(!isSupabaseConfigured||!supabase)return null;
  try {
    const {data,error}=await supabase.rpc('get_customer_statement',{
      p_customer_id:customerId,p_page:page,p_page_size:25,
    });
    return error?null:readCustomerStatement(data);
  }catch{return null;}
}

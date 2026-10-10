import {isSupabaseConfigured, supabase} from '../../lib/supabase';
import {readCustomerDebtAging} from '../../utils/customerDebtAging';
export type {CustomerDebtAging} from '../../utils/customerDebtAging';

export async function fetchCustomerDebtAging(customerId: string | null = null) {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const {data, error} = await supabase.rpc('get_customer_debt_aging', {p_customer_id: customerId});
    return error ? null : readCustomerDebtAging(data);
  } catch {return null;}
}

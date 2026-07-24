import { supabase, isSupabaseConfigured } from '../../lib/supabase';

export interface ReceiveInventoryInput {
  warehouseId: string;
  productId: string;
  quantity: number;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
}

export async function receiveInventoryInSupabase(
  input: ReceiveInventoryInput
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase client is not configured');
  }

  try {
    const { data: res, error } = await supabase.rpc('receive_inventory', {
      p_warehouse_id: input.warehouseId,
      p_product_id: input.productId,
      p_quantity: input.quantity,
      p_reference_type: input.referenceType || 'purchase_receipt',
      p_reference_id: input.referenceId || null,
      p_notes: input.notes || 'استلام شحنة بضاعة جديدة للمخزن',
    });

    if (error) {
      console.error('RPC receive_inventory error:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: res,
    };
  } catch (err: any) {
    console.error('Exception during receiveInventoryInSupabase:', err);
    return { success: false, error: err?.message || 'تعذر التواصل مع قاعدة بيانات Supabase' };
  }
}

export async function fetchInventoryBalancesFromSupabase() {
  if (!isSupabaseConfigured || !supabase) return [];

  try {
    const { data, error } = await supabase
      .from('inventory_balances')
      .select(`
        id,
        warehouse_id,
        product_id,
        on_hand_quantity,
        reserved_quantity,
        available_quantity,
        updated_at,
        products ( name_ar, sku, barcode ),
        warehouses ( name_ar )
      `);

    if (error) {
      console.warn('Error fetching inventory balances from Supabase:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('Exception fetching inventory balances:', err);
    return [];
  }
}

export async function fetchInventoryMovementsFromSupabase() {
  if (!isSupabaseConfigured || !supabase) return [];

  try {
    const { data, error } = await supabase
      .from('inventory_movements')
      .select(`
        id,
        warehouse_id,
        product_id,
        movement_type,
        quantity,
        balance_before,
        balance_after,
        reference_type,
        notes,
        created_at,
        products ( name_ar, sku ),
        warehouses ( name_ar )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Error fetching inventory movements from Supabase:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('Exception fetching inventory movements:', err);
    return [];
  }
}

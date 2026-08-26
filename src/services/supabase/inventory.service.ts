import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { InventoryMovement, MovementType } from '../../types';

export interface ReceiveInventoryInput {
  warehouseId: string;
  productId: string;
  quantity: number;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
}

export interface AdjustInventoryStockInput {
  warehouseId: string;
  productId: string;
  actualQuantity: number;
  reason: string;
  adjustmentType?: 'stock_count' | 'damage' | 'expired' | 'manual';
}

export interface TransferInventoryInput {
  productId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  quantity: number;
  notes?: string;
}

export interface SupabaseInventoryMutationResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function receiveInventoryInSupabase(
  input: ReceiveInventoryInput
): Promise<SupabaseInventoryMutationResult> {
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

function mapMovementType(
  movementType: string,
  referenceType?: string | null
): MovementType {
  if (referenceType === 'damage') return 'Damage';
  if (referenceType === 'expired') return 'Expired';
  if (referenceType === 'stock_count') return 'Stock Count';

  const movementTypes: Record<string, MovementType> = {
    opening_balance: 'Opening Balance',
    purchase_receipt: 'Purchase Receipt',
    sales_deduction: 'Sale',
    transfer_in: 'Transfer In',
    transfer_out: 'Transfer Out',
    adjustment_add: 'Manual Adjustment',
    adjustment_subtract: 'Manual Adjustment',
    return_in: 'Sale Return',
    return_out: 'Purchase Return',
  };

  return movementTypes[movementType] || 'Manual Adjustment';
}

export async function transferInventoryBetweenWarehousesInSupabase(
  input: TransferInventoryInput,
): Promise<SupabaseInventoryMutationResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'الاتصال بقاعدة بيانات Supabase غير متاح.',
    };
  }

  const quantity = Math.floor(Number(input.quantity));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      success: false,
      error: 'الكمية المنقولة يجب أن تكون عددًا صحيحًا أكبر من صفر.',
    };
  }

  if (input.sourceWarehouseId === input.destinationWarehouseId) {
    return {
      success: false,
      error: 'يجب اختيار مستودعين مختلفين لعملية النقل.',
    };
  }

  try {
    const { data, error } = await supabase.rpc(
      'transfer_inventory_between_warehouses',
      {
        p_product_id: input.productId,
        p_source_warehouse_id: input.sourceWarehouseId,
        p_destination_warehouse_id: input.destinationWarehouseId,
        p_quantity: quantity,
        p_notes: input.notes?.trim() || null,
      },
    );

    if (error) {
      console.error('RPC transfer_inventory_between_warehouses error:', error);
      return {success: false, error: error.message};
    }

    if (
      !data ||
      typeof data !== 'object' ||
      !('success' in data) ||
      data.success !== true
    ) {
      return {
        success: false,
        error: 'تعذر تأكيد نقل المخزون من قاعدة البيانات.',
      };
    }

    return {success: true, data};
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'تعذر التواصل مع قاعدة بيانات Supabase.';
    console.error('Exception during inventory transfer:', error);
    return {success: false, error: message};
  }
}

export async function fetchInventoryMovementsFromSupabase(): Promise<
  InventoryMovement[]
> {
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
        reference_id,
        notes,
        created_by,
        created_at,
        products ( name_ar, sku ),
        warehouses ( name_ar, branch_id )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Error fetching inventory movements from Supabase:', error.message);
      return [];
    }

    return (data || []).map((movement: any) => {
      const product = Array.isArray(movement.products)
        ? movement.products[0]
        : movement.products;
      const warehouse = Array.isArray(movement.warehouses)
        ? movement.warehouses[0]
        : movement.warehouses;

      return {
        id: movement.id,
        productId: movement.product_id,
        productName: product?.name_ar || product?.sku || 'منتج',
        branchId: warehouse?.branch_id || '',
        warehouseId: movement.warehouse_id,
        movementType: mapMovementType(
          movement.movement_type,
          movement.reference_type
        ),
        previousQuantity: Number(movement.balance_before) || 0,
        quantityChange: Number(movement.quantity) || 0,
        newQuantity: Number(movement.balance_after) || 0,
        reason:
          movement.notes ||
          movement.reference_type ||
          movement.movement_type,
        performedByUserId: movement.created_by || '',
        performedByUserName: movement.created_by ? 'موظف معتمد' : 'النظام',
        timestamp: movement.created_at,
        referenceId: movement.reference_id || undefined,
        notes: movement.notes || undefined,
      };
    });
  } catch (err) {
    console.warn('Exception fetching inventory movements:', err);
    return [];
  }
}

export async function adjustInventoryStockInSupabase(
  input: AdjustInventoryStockInput
): Promise<SupabaseInventoryMutationResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'الاتصال بقاعدة بيانات Supabase غير متاح.',
    };
  }

  try {
    const { data, error } = await supabase.rpc('adjust_inventory_stock', {
      p_warehouse_id: input.warehouseId,
      p_product_id: input.productId,
      p_actual_quantity: Math.floor(Number(input.actualQuantity) || 0),
      p_reason: input.reason.trim(),
      p_adjustment_type: input.adjustmentType || 'stock_count',
    });

    if (error) return { success: false, error: error.message };
    if (!data?.success) {
      return {
        success: false,
        error: data?.message || 'فشلت عملية تسوية المخزون.',
      };
    }

    return { success: true, data };
  } catch (error: unknown) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'تعذر الاتصال بقاعدة بيانات Supabase.',
    };
  }
}

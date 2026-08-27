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

export interface InventoryMovementPageInput {
  page?: number;
  pageSize?: number;
  searchQuery?: string;
  branchId?: string;
  warehouseId?: string;
  productId?: string;
}

export interface InventoryMovementPage {
  movements: InventoryMovement[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  productMovementCounts: Record<string, number>;
  salesProductIds: string[];
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

function mapInventoryMovement(record: Record<string, unknown>): InventoryMovement {
  return {
    id: typeof record.id === 'string' ? record.id : '',
    productId: typeof record.product_id === 'string' ? record.product_id : '',
    productName:
      typeof record.product_name === 'string' ? record.product_name : 'منتج',
    branchId: typeof record.branch_id === 'string' ? record.branch_id : '',
    warehouseId:
      typeof record.warehouse_id === 'string' ? record.warehouse_id : '',
    movementType: mapMovementType(
      typeof record.movement_type === 'string' ? record.movement_type : '',
      typeof record.reference_type === 'string' ? record.reference_type : null
    ),
    previousQuantity: Number(record.balance_before) || 0,
    quantityChange: Number(record.quantity) || 0,
    newQuantity: Number(record.balance_after) || 0,
    reason:
      (typeof record.notes === 'string' && record.notes) ||
      (typeof record.reference_type === 'string' && record.reference_type) ||
      (typeof record.movement_type === 'string' && record.movement_type) ||
      'حركة مخزون',
    performedByUserId:
      typeof record.created_by === 'string' ? record.created_by : '',
    performedByUserName:
      typeof record.created_by === 'string' ? 'موظف معتمد' : 'النظام',
    timestamp: typeof record.created_at === 'string' ? record.created_at : '',
    referenceId:
      typeof record.reference_id === 'string' ? record.reference_id : undefined,
    notes: typeof record.notes === 'string' ? record.notes : undefined,
  };
}

function toNonNegativeInteger(value: unknown, fallback = 0): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.max(0, Math.floor(numericValue))
    : fallback;
}

export async function fetchInventoryMovementsFromSupabase(
  input: InventoryMovementPageInput = {}
): Promise<InventoryMovementPage> {
  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize || 25)));
  const emptyPage: InventoryMovementPage = {
    movements: [],
    page,
    pageSize,
    totalCount: 0,
    totalPages: 1,
    productMovementCounts: {},
    salesProductIds: [],
  };
  if (!isSupabaseConfigured || !supabase) return emptyPage;

  try {
    const { data, error } = await supabase.rpc('get_inventory_movement_page', {
      p_page: page,
      p_page_size: pageSize,
      p_search: input.searchQuery?.trim() || null,
      p_branch_id: input.branchId || null,
      p_warehouse_id: input.warehouseId || null,
      p_product_id: input.productId || null,
    });

    if (error) {
      console.warn('Error fetching inventory movements from Supabase:', error.message);
      return emptyPage;
    }

    const payload =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const productMovementCounts =
      payload.product_movement_counts &&
      typeof payload.product_movement_counts === 'object' &&
      !Array.isArray(payload.product_movement_counts)
        ? Object.fromEntries(
            Object.entries(payload.product_movement_counts).map(([productId, count]) => [
              productId,
              toNonNegativeInteger(count),
            ])
          )
        : {};
    const salesProductIds = Array.isArray(payload.sales_product_ids)
      ? payload.sales_product_ids.filter(
          (productId): productId is string => typeof productId === 'string'
        )
      : [];
    const totalCount = toNonNegativeInteger(payload.total_count);

    return {
      movements: rows
        .filter(
          (row): row is Record<string, unknown> =>
            Boolean(row) && typeof row === 'object'
        )
        .map(mapInventoryMovement),
      page,
      pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      productMovementCounts,
      salesProductIds,
    };
  } catch (err) {
    console.warn('Exception fetching inventory movements:', err);
    return emptyPage;
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

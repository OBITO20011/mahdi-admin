import { isSupabaseConfigured, supabase } from '../../lib/supabase';

type RpcRecord = Record<string, unknown>;

export interface InventoryOpeningProduct {
  productId: string;
  sku: string;
  barcode?: string;
  productName: string;
  purchasePackageName: string;
  baseUnitName: string;
  unitsPerPackage: number;
  currentQuantity: number;
  reservedQuantity: number;
  costPriceInMinorUnits: number;
  defaultPurchasePriceInMinorUnits: number;
  hasOperationalMovements: boolean;
  eligible: boolean;
  blockReason?: string;
}

export interface InventoryOpeningSessionSummary {
  id: string;
  sessionNumber: string;
  itemCount: number;
  totalPreviousQuantity: number;
  totalActualQuantity: number;
  totalQuantityChange: number;
  notes: string;
  createdByName: string;
  createdAt: string;
}

export interface InventoryOpeningSetup {
  warehouse: {
    id: string;
    branchId?: string;
    name: string;
  };
  products: InventoryOpeningProduct[];
  recentSessions: InventoryOpeningSessionSummary[];
}

export interface InventoryOpeningRowInput {
  productId: string;
  packageCount: number;
  looseUnits: number;
}

export interface ApplyInventoryOpeningResult {
  sessionId: string;
  sessionNumber: string;
  itemCount: number;
  totalPreviousQuantity: number;
  totalActualQuantity: number;
  totalQuantityChange: number;
  idempotentReplay: boolean;
  message: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const numberValue = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
  }
  return supabase;
}

function mapProduct(payload: RpcRecord): InventoryOpeningProduct {
  return {
    productId: textValue(payload.productId),
    sku: textValue(payload.sku),
    barcode: textValue(payload.barcode) || undefined,
    productName: textValue(payload.productName),
    purchasePackageName:
      textValue(payload.purchasePackageName) || 'طرد',
    baseUnitName: textValue(payload.baseUnitName) || 'قطعة',
    unitsPerPackage: Math.max(1, Math.floor(numberValue(payload.unitsPerPackage))),
    currentQuantity: Math.max(0, Math.floor(numberValue(payload.currentQuantity))),
    reservedQuantity: Math.max(
      0,
      Math.floor(numberValue(payload.reservedQuantity))
    ),
    costPriceInMinorUnits: Math.max(
      0,
      Math.floor(numberValue(payload.costPriceInMinorUnits))
    ),
    defaultPurchasePriceInMinorUnits: Math.max(
      0,
      Math.floor(numberValue(payload.defaultPurchasePriceInMinorUnits))
    ),
    hasOperationalMovements: payload.hasOperationalMovements === true,
    eligible: payload.eligible === true,
    blockReason: textValue(payload.blockReason) || undefined,
  };
}

function mapSession(payload: RpcRecord): InventoryOpeningSessionSummary {
  return {
    id: textValue(payload.id),
    sessionNumber: textValue(payload.sessionNumber),
    itemCount: Math.max(0, Math.floor(numberValue(payload.itemCount))),
    totalPreviousQuantity: Math.max(
      0,
      Math.floor(numberValue(payload.totalPreviousQuantity))
    ),
    totalActualQuantity: Math.max(
      0,
      Math.floor(numberValue(payload.totalActualQuantity))
    ),
    totalQuantityChange: Math.floor(numberValue(payload.totalQuantityChange)),
    notes: textValue(payload.notes),
    createdByName: textValue(payload.createdByName) || 'مستخدم النظام',
    createdAt: textValue(payload.createdAt),
  };
}

export async function fetchInventoryOpeningSetupFromSupabase(
  warehouseId: string
): Promise<InventoryOpeningSetup> {
  const { data, error } = await requireClient().rpc(
    'get_inventory_opening_setup',
    { p_warehouse_id: warehouseId }
  );
  if (error) {
    throw new Error(error.message || 'تعذر تحميل تهيئة المخزون الافتتاحي.');
  }

  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(
      textValue(payload.message) || 'تعذر تحميل تهيئة المخزون الافتتاحي.'
    );
  }
  const warehouse = (payload.warehouse || {}) as RpcRecord;

  return {
    warehouse: {
      id: textValue(warehouse.id),
      branchId: textValue(warehouse.branchId) || undefined,
      name: textValue(warehouse.name),
    },
    products: Array.isArray(payload.products)
      ? payload.products.map((item) => mapProduct(item as RpcRecord))
      : [],
    recentSessions: Array.isArray(payload.recentSessions)
      ? payload.recentSessions.map((item) => mapSession(item as RpcRecord))
      : [],
  };
}

export async function applyInventoryOpeningSetupInSupabase(input: {
  warehouseId: string;
  rows: InventoryOpeningRowInput[];
  notes: string;
  idempotencyKey: string;
}): Promise<ApplyInventoryOpeningResult> {
  const { data, error } = await requireClient().rpc(
    'apply_inventory_opening_setup',
    {
      p_warehouse_id: input.warehouseId,
      p_rows: input.rows.map((row) => ({
        productId: row.productId,
        packageCount: Math.max(0, Math.floor(row.packageCount)),
        looseUnits: Math.max(0, Math.floor(row.looseUnits)),
      })),
      p_notes: input.notes.trim(),
      p_idempotency_key: input.idempotencyKey,
    }
  );
  if (error) {
    throw new Error(error.message || 'تعذر اعتماد المخزون الافتتاحي.');
  }

  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(
      textValue(payload.message) || 'تعذر اعتماد المخزون الافتتاحي.'
    );
  }

  return {
    sessionId: textValue(payload.sessionId),
    sessionNumber: textValue(payload.sessionNumber),
    itemCount: Math.max(0, Math.floor(numberValue(payload.itemCount))),
    totalPreviousQuantity: Math.max(
      0,
      Math.floor(numberValue(payload.totalPreviousQuantity))
    ),
    totalActualQuantity: Math.max(
      0,
      Math.floor(numberValue(payload.totalActualQuantity))
    ),
    totalQuantityChange: Math.floor(numberValue(payload.totalQuantityChange)),
    idempotentReplay: payload.idempotentReplay === true,
    message:
      textValue(payload.message) || 'تم اعتماد المخزون الافتتاحي بنجاح.',
  };
}

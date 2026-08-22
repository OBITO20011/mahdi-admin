/**
 * Nawasrah Business Manager - Direct Goods Receiving Service
 * Handles direct receiving from suppliers, updating inventory, supplier payments & RPCs
 */

import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import {
  SupplierReceipt,
  SupplierReceiptItem,
  SupplierReceiptPayment,
  DirectReceiptForm,
  ReceivingProduct,
} from '../../types/directReceiving';
import { Supplier, Unit, Warehouse, Branch } from '../../types';

// Helper: Convert DB row to SupplierReceipt interface
const mapSupplierReceiptRow = (row: any): SupplierReceipt => ({
  id: row.id,
  receiptNumber: row.receipt_number,
  supplierId: row.supplier_id,
  supplierName: row.suppliers?.company_name || 'مورد غير معروف',
  supplierPhone: row.suppliers?.phone || '',
  warehouseId: row.warehouse_id,
  warehouseName: row.warehouses?.name_ar || 'المستودع الرئيسي',
  branchId: row.branch_id,
  branchName: row.branches?.name_ar || '',
  supplierInvoiceNumber: row.supplier_invoice_number,
  supplierInvoiceDate: row.supplier_invoice_date,
  receivedAt: row.received_at,
  receivedBy: row.received_by,
  receivedByName: row.profiles?.full_name || 'موظف الاستلام',
  subtotalInMinorUnits: Number(row.subtotal_in_minor_units) || 0,
  discountInMinorUnits: Number(row.discount_in_minor_units) || 0,
  deliveryFeeInMinorUnits: Number(row.delivery_fee_in_minor_units) || 0,
  taxInMinorUnits: Number(row.tax_in_minor_units) || 0,
  totalInMinorUnits: Number(row.total_in_minor_units) || 0,
  amountPaidInMinorUnits: Number(row.amount_paid_in_minor_units) || 0,
  amountDueInMinorUnits: Number(row.amount_due_in_minor_units) || 0,
  paymentStatus: row.payment_status || 'unpaid',
  paymentMethod: row.payment_method,
  paymentReference: row.payment_reference,
  notes: row.notes,
  internalNotes: row.internal_notes,
  status: row.status || 'completed',
  isArchived: Boolean(row.is_archived),
  items: row.supplier_receipt_items ? row.supplier_receipt_items.map(mapSupplierReceiptItemRow) : [],
  payments: row.supplier_payments ? row.supplier_payments.map(mapSupplierPaymentRow) : [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapSupplierReceiptItemRow = (item: any): SupplierReceiptItem => ({
  id: item.id,
  supplierReceiptId: item.supplier_receipt_id,
  productId: item.product_id,
  productName: item.products?.name_ar || item.products?.sku || 'منتج',
  productSku: item.products?.sku || '',
  productBarcode: item.products?.barcode || '',
  purchaseUnitId: item.purchase_unit_id,
  baseUnitId: item.base_unit_id,
  purchaseUnitName: item.purchase_unit_name || item.purchase_unit?.name_ar || 'طرد',
  baseUnitName: item.base_unit_name || item.base_unit?.name_ar || 'حبة',
  packageQuantity: Number(item.package_quantity) || 0,
  unitsPerPackage: Number(item.units_per_package) || 1,
  totalBaseUnits: Number(item.total_base_units) || 0,
  packagePriceInMinorUnits: Number(item.package_price_in_minor_units) || 0,
  baseUnitCostInMinorUnits: Number(item.base_unit_cost_in_minor_units) || 0,
  sellingPriceInMinorUnits: Number(item.selling_price_in_minor_units) || 0,
  discountInMinorUnits: Number(item.discount_in_minor_units) || 0,
  lineTotalInMinorUnits: Number(item.line_total_in_minor_units) || 0,
  batchNumber: item.batch_number,
  productionDate: item.production_date,
  expiryDate: item.expiry_date,
  notes: item.notes,
  createdAt: item.created_at,
});

const mapSupplierPaymentRow = (p: any): SupplierReceiptPayment => ({
  id: p.id,
  supplierReceiptId: p.supplier_receipt_id,
  supplierId: p.supplier_id,
  amountInMinorUnits: Number(p.amount_in_minor_units) || 0,
  paymentMethod: p.payment_method || 'cash',
  referenceNumber: p.reference_number,
  paymentDate: p.payment_date,
  notes: p.notes,
  createdBy: p.created_by,
  isReversed: Boolean(p.is_reversed),
  reversedAt: p.reversed_at,
  reversedBy: p.reversed_by,
  reversalReason: p.reversal_reason,
  createdAt: p.created_at,
});

/**
 * Fetch supplier receipts with filters
 */
export const fetchSupplierReceiptsFromSupabase = async (params?: {
  search?: string;
  supplierId?: string;
  warehouseId?: string;
  paymentStatus?: string;
  isArchived?: boolean;
}): Promise<{ success: boolean; data?: SupplierReceipt[]; error?: string }> => {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'الاتصال بقاعدة البيانات غير متاح.' };
  }

  try {
    let query = supabase
      .from('supplier_receipts')
      .select(`
        *,
        suppliers ( company_name, phone ),
        warehouses ( name_ar ),
        branches ( name_ar ),
        profiles ( full_name ),
        supplier_receipt_items (
          *,
          products ( name_ar, sku, barcode )
        ),
        supplier_payments ( * )
      `)
      .order('received_at', { ascending: false });

    if (params?.isArchived !== undefined) {
      query = query.eq('is_archived', params.isArchived);
    }

    if (params?.supplierId) {
      query = query.eq('supplier_id', params.supplierId);
    }

    if (params?.warehouseId) {
      query = query.eq('warehouse_id', params.warehouseId);
    }

    if (params?.paymentStatus && params.paymentStatus !== 'all') {
      query = query.eq('payment_status', params.paymentStatus);
    }

    if (params?.search && params.search.trim()) {
      const searchTerm = `%${params.search.trim()}%`;
      query = query.or(`receipt_number.ilike.${searchTerm},supplier_invoice_number.ilike.${searchTerm}`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching supplier receipts:', error);
      return { success: false, error: error.message };
    }

    const receipts = (data || []).map(mapSupplierReceiptRow);
    return { success: true, data: receipts };
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء جلب سندات الاستلام.' };
  }
};

/**
 * Fetch single supplier receipt by ID
 */
export const fetchSupplierReceiptByIdFromSupabase = async (
  receiptId: string
): Promise<{ success: boolean; data?: SupplierReceipt; error?: string }> => {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'الاتصال بقاعدة البيانات غير متاح.' };
  }

  try {
    const { data, error } = await supabase
      .from('supplier_receipts')
      .select(`
        *,
        suppliers ( company_name, phone, contact_person ),
        warehouses ( name_ar ),
        branches ( name_ar ),
        profiles ( full_name ),
        supplier_receipt_items (
          *,
          products ( name_ar, sku, barcode )
        ),
        supplier_payments ( * )
      `)
      .eq('id', receiptId)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: mapSupplierReceiptRow(data) };
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء جلب تفاصيل السند.' };
  }
};

/**
 * Call create_direct_supplier_receipt RPC to save receipt, update inventory, record payment
 */
export const createDirectSupplierReceiptInSupabase = async (
  form: DirectReceiptForm
): Promise<{
  success: boolean;
  data?: {
    receiptId: string;
    receiptNumber: string;
    total: number;
    paid: number;
    due: number;
    productsCount: number;
    totalInventoryUnitsAdded: number;
  };
  error?: string;
}> => {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'الاتصال بقاعدة البيانات غير متاح.' };
  }

  try {
    const payload = {
      p_supplier_id: form.supplierId,
      p_warehouse_id: form.warehouseId,
      p_branch_id: form.branchId || null,
      p_supplier_invoice_number: form.supplierInvoiceNumber || null,
      p_supplier_invoice_date: form.supplierInvoiceDate || null,
      p_received_at: form.receivedAt || new Date().toISOString(),
      p_delivery_fee_in_minor_units: form.deliveryFeeInMinorUnits || 0,
      p_discount_in_minor_units: form.discountInMinorUnits || 0,
      p_tax_in_minor_units: form.taxInMinorUnits || 0,
      p_amount_paid_in_minor_units: form.amountPaidInMinorUnits || 0,
      p_payment_method: form.paymentMethod || 'cash',
      p_payment_reference: form.paymentReference || null,
      p_notes: form.notes || null,
      p_internal_notes: form.internalNotes || null,
      p_idempotency_key: form.idempotencyKey || null,
      p_items: form.items.map((item) => ({
        product_id: item.productId,
        purchase_unit_id: item.purchaseUnitId || null,
        base_unit_id: item.baseUnitId || null,
        purchase_unit_name: item.purchaseUnitName || 'طرد',
        base_unit_name: item.baseUnitName || 'حبة',
        package_quantity: item.packageQuantity,
        units_per_package: item.unitsPerPackage,
        package_price_in_minor_units: item.packagePriceInMinorUnits,
        update_product_defaults: Boolean(item.updateProductDefaults),
        discount_in_minor_units: item.discountInMinorUnits || 0,
        batch_number: item.batchNumber || null,
        production_date: item.productionDate || null,
        expiry_date: item.expiryDate || null,
        notes: item.notes || null,
      })),
    };

    const { data, error } = await supabase.rpc('create_direct_supplier_receipt', payload);

    if (error) {
      console.error('RPC create_direct_supplier_receipt error:', error);
      return { success: false, error: error.message };
    }

    if (data && data.success) {
      return {
        success: true,
        data: {
          receiptId: data.receipt_id,
          receiptNumber: data.receipt_number,
          total: data.total,
          paid: data.paid,
          due: data.due,
          productsCount: data.products_count,
          totalInventoryUnitsAdded: data.total_inventory_units_added,
        },
      };
    }

    return { success: false, error: 'فشلت عملية إنشاء سند الاستلام.' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء استلام البضاعة.' };
  }
};

/**
 * Record a payment against an existing supplier receipt
 */
export const recordSupplierReceiptPaymentInSupabase = async (
  receiptId: string,
  amountInMinorUnits: number,
  paymentMethod: string,
  referenceNumber?: string,
  notes?: string
): Promise<{ success: boolean; data?: any; error?: string }> => {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'الاتصال بقاعدة البيانات غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc('record_supplier_receipt_payment', {
      p_receipt_id: receiptId,
      p_amount_in_minor_units: amountInMinorUnits,
      p_payment_method: paymentMethod,
      p_reference_number: referenceNumber || null,
      p_notes: notes || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء تسجيل الدفعة.' };
  }
};

/**
 * Archive / Unarchive supplier receipt
 */
export const archiveSupplierReceiptInSupabase = async (
  receiptId: string,
  isArchived: boolean
): Promise<{ success: boolean; error?: string }> => {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'الاتصال بقاعدة البيانات غير متاح.' };
  }

  try {
    const { error } = await supabase.rpc('archive_supplier_receipt', {
      p_receipt_id: receiptId,
      p_is_archived: isArchived,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء أرشفة السند.' };
  }
};

export const cancelSupplierReceiptInSupabase = async (
  receiptId: string,
  reason: string
): Promise<{
  success: boolean;
  data?: {
    receiptId: string;
    receiptNumber: string;
    inventoryUnitsReversed: number;
    paymentsAmountReversed: number;
  };
  error?: string;
}> => {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'الاتصال بقاعدة البيانات غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc('cancel_supplier_receipt', {
      p_supplier_receipt_id: receiptId,
      p_reason: reason.trim() || 'إلغاء سند استلام البضائع',
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return data?.success
      ? {
          success: true,
          data: {
            receiptId: data.receipt_id,
            receiptNumber: data.receipt_number,
            inventoryUnitsReversed:
              Number(data.inventory_units_reversed) || 0,
            paymentsAmountReversed:
              Number(data.payments_amount_reversed) || 0,
          },
        }
      : { success: false, error: 'لم يؤكد الخادم إلغاء السند.' };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'حدث خطأ أثناء إلغاء سند الاستلام.',
    };
  }
};

/**
 * Helper data fetchers for receiving modal dropdowns
 */
export const fetchSuppliersForReceivingFromSupabase = async (): Promise<Supplier[]> => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة بيانات Supabase غير متاح.');
  }
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('is_active', true)
    .order('company_name');

  if (error) throw error;

  return (data || []).map((s: any) => ({
    id: s.id,
    companyName: s.company_name,
    contactPerson: s.contact_person || '',
    phone: s.phone || '',
    whatsapp: s.whatsapp || '',
    email: s.email || '',
    address: s.address || '',
    currentBalance: (Number(s.current_balance_in_minor_units) || 0) / 1000,
    taxNumber: s.tax_number || '',
    notes: s.notes || '',
    isActive: s.is_active,
  }));
};

export const fetchProductsForReceivingFromSupabase = async (): Promise<ReceivingProduct[]> => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة بيانات Supabase غير متاح.');
  }
  const { data, error } = await supabase
    .from('products')
    .select(`
      id,
      name_ar,
      sku,
      barcode,
      unit_id,
      purchase_unit_id,
      units_per_purchase_unit,
      default_purchase_price_in_minor_units,
      cost_price_in_minor_units,
      sale_price_in_minor_units,
      min_stock_level,
      base_unit:units!products_unit_id_fkey ( id, name_ar, code ),
      purchase_unit:units!products_purchase_unit_id_fkey ( id, name_ar, code ),
      inventory_balances (
        warehouse_id,
        on_hand_quantity,
        reserved_quantity,
        available_quantity
      )
    `)
    .eq('is_active', true)
    .order('name_ar');

  if (error) {
    console.error('Error fetching products for receiving:', error);
    throw error;
  }

  return (data || []).map((product: any) => {
    const baseUnit = Array.isArray(product.base_unit) ? product.base_unit[0] : product.base_unit;
    const purchaseUnit = Array.isArray(product.purchase_unit)
      ? product.purchase_unit[0]
      : product.purchase_unit;
    const unitsPerPackage = Math.max(
      1,
      Math.floor(Number(product.units_per_purchase_unit) || 1)
    );
    const costPriceInMinorUnits = Number(product.cost_price_in_minor_units) || 0;
    const defaultPackagePriceInMinorUnits =
      Number(product.default_purchase_price_in_minor_units) ||
      costPriceInMinorUnits * unitsPerPackage;
    const inventoryBalances = (product.inventory_balances || []).map(
      (balance: any) => ({
        warehouseId: balance.warehouse_id,
        onHandQuantity: Math.max(
          0,
          Math.floor(Number(balance.on_hand_quantity) || 0)
        ),
        reservedQuantity: Math.max(
          0,
          Math.floor(Number(balance.reserved_quantity) || 0)
        ),
        availableQuantity: Math.max(
          0,
          Math.floor(
            Number(
              balance.available_quantity ??
                (Number(balance.on_hand_quantity) || 0) -
                  (Number(balance.reserved_quantity) || 0)
            ) || 0
          )
        ),
      })
    );
    const onHandQuantity = inventoryBalances.reduce(
      (sum: number, balance: any) =>
        sum + balance.onHandQuantity,
      0
    );
    const reservedQuantity = inventoryBalances.reduce(
      (sum: number, balance: any) =>
        sum + balance.reservedQuantity,
      0
    );
    const availableQuantity = inventoryBalances.reduce(
      (sum: number, balance: any) =>
        sum + balance.availableQuantity,
      0
    );

    return {
      id: product.id,
      nameAr: product.name_ar || '',
      sku: product.sku || '',
      barcode: product.barcode || '',
      baseUnitId: baseUnit?.id || product.unit_id || undefined,
      baseUnitName: baseUnit?.name_ar || 'حبة',
      baseUnitCode: baseUnit?.code || undefined,
      purchaseUnitId: purchaseUnit?.id || baseUnit?.id || product.purchase_unit_id || undefined,
      purchaseUnitName: purchaseUnit?.name_ar || baseUnit?.name_ar || 'حبة',
      purchaseUnitCode: purchaseUnit?.code || baseUnit?.code || undefined,
      unitsPerPackage,
      defaultPackagePriceInMinorUnits,
      costPriceInMinorUnits,
      salePriceInMinorUnits: Number(product.sale_price_in_minor_units) || 0,
      onHandQuantity,
      reservedQuantity,
      availableQuantity,
      minStockLevel: Math.max(
        0,
        Math.floor(Number(product.min_stock_level) || 0)
      ),
      inventoryBalances,
    };
  });
};

export const fetchUnitsForReceivingFromSupabase = async (): Promise<Unit[]> => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة بيانات Supabase غير متاح.');
  }
  const { data, error } = await supabase.from('units').select('*').order('name_ar');
  if (error) throw error;
  return (data || []).map((u: any) => ({
    id: u.id,
    code: u.code,
    nameAr: u.name_ar,
    conversionFactor: 1,
  }));
};

export const fetchWarehousesForReceivingFromSupabase = async (): Promise<Warehouse[]> => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة بيانات Supabase غير متاح.');
  }
  const { data, error } = await supabase
    .from('warehouses')
    .select('*')
    .eq('is_active', true)
    .order('name_ar');
  if (error) throw error;
  return (data || []).map((w: any) => ({
    id: w.id,
    code: w.code || '',
    name: w.name_ar || w.name || 'مستودع',
    nameAr: w.name_ar || w.name || 'مستودع',
    branchId: w.branch_id || '',
    location: w.location || '',
  }));
};

export const fetchBranchesForReceivingFromSupabase = async (): Promise<Branch[]> => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة بيانات Supabase غير متاح.');
  }
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('is_active', true)
    .order('name_ar');
  if (error) throw error;
  return (data || []).map((b: any) => ({
    id: b.id,
    name: b.name_ar || b.name || 'فرع',
    nameAr: b.name_ar || b.name || 'فرع',
    address: b.address || '',
    city: b.city || '',
    phone: b.phone || '',
    isMain: Boolean(b.is_main),
  }));
};

/**
 * Realtime subscription listener for direct receiving changes
 */
export const subscribeToSupplierReceiptsRealtime = (callback: () => void) => {
  if (!isSupabaseConfigured || !supabase) return () => {};

  const channel = supabase
    .channel('supplier-receipts-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'supplier_receipts' }, () => callback())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'supplier_receipt_items' }, () => callback())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'supplier_payments' }, () => callback())
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};

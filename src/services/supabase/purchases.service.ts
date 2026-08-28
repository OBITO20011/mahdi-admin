/**
 * Nawasrah Business Manager - Supabase Purchasing Service Layer
 * Interacts with purchase_orders, purchase_receipts, supplier_payments & RPCs
 */

import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import {
  CreatePurchaseOrderInput,
  PurchaseOrder,
  PurchaseOrderFilters,
  ReceivePurchaseOrderInput,
  SupplierPayment,
  SupplierPurchaseSummary,
  PurchaseReceipt,
} from '../../types/purchases';
import { Supplier } from '../../types';

// Helper: Convert minor units (fils) to JOD (1 JOD = 1000 fils)
const minorToJod = (fils: number | null | undefined): number => {
  return (Number(fils) || 0) / 1000.0;
};

// Helper: Convert JOD to minor units (fils)
const jodToMinor = (jod: number | null | undefined): number => {
  return Math.round((Number(jod) || 0) * 1000);
};

// Helper: Check if string is valid UUID
export function isValidUUID(id: unknown): id is string {
  if (!id || typeof id !== 'string') return false;
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  return uuidRegex.test(id.trim());
}

const mapSupplierRow = (supplier: any): Supplier => ({
  id: supplier.id,
  companyName: supplier.company_name,
  contactPerson: supplier.contact_person || '',
  phone: supplier.phone || '',
  whatsapp: supplier.whatsapp || '',
  address: supplier.address || '',
  currentBalance:
    (Number(supplier.current_balance_in_minor_units) || 0) / 1000,
  taxNumber: supplier.tax_number || '',
  notes: supplier.notes || '',
  email: supplier.email || '',
  isActive: supplier.is_active ?? true,
});

/**
 * Fetch list of suppliers from Supabase
 */
export async function fetchSuppliersFromSupabase(includeInactive: boolean = false): Promise<Supplier[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    let query = supabase
      .from('suppliers')
      .select('*')
      .order('company_name', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error || !data) {
      console.warn('fetchSuppliersFromSupabase error:', error?.message);
      return [];
    }

    return data.map(mapSupplierRow);
  } catch (err) {
    console.error('Exception in fetchSuppliersFromSupabase:', err);
    return [];
  }
}

export interface CreateSupplierInput {
  companyName: string;
  contactPerson?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  notes?: string;
  isActive?: boolean;
}

/**
 * Create a new supplier in Supabase
 */
export async function createSupplierInSupabase(
  input: CreateSupplierInput
): Promise<{ success: boolean; data?: Supplier; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'خدمة Supabase غير مفعّلة' };
  }

  try {
    const companyName = input.companyName.trim();
    if (!companyName) {
      return { success: false, error: 'اسم الشركة/المورد مطلوب' };
    }

    const { data, error } = await supabase.rpc('save_supplier', {
      p_company_name: companyName,
      p_supplier_id: null,
      p_contact_person: input.contactPerson?.trim() || null,
      p_phone: input.phone?.trim() || null,
      p_whatsapp: input.whatsapp?.trim() || null,
      p_email: input.email?.trim() || null,
      p_address: input.address?.trim() || null,
      p_tax_number: input.taxNumber?.trim() || null,
      p_notes: input.notes?.trim() || null,
      p_is_active: input.isActive ?? true,
    });

    if (error) {
      console.error('createSupplierInSupabase error:', error.message);
      return { success: false, error: error.message };
    }

    if (!data?.success || !data?.supplier) {
      return { success: false, error: 'لم يتم إرجاع بيانات المورد المنشأ' };
    }

    return { success: true, data: mapSupplierRow(data.supplier) };
  } catch (err: any) {
    console.error('Exception in createSupplierInSupabase:', err);
    return { success: false, error: err?.message || 'حدث خطأ أثناء إضافة المورد' };
  }
}

/**
 * Update an existing supplier in Supabase
 */
export async function updateSupplierInSupabase(
  supplierId: string,
  input: CreateSupplierInput
): Promise<{ success: boolean; data?: Supplier; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'خدمة Supabase غير مفعّلة' };
  }

  try {
    const companyName = input.companyName.trim();
    if (!companyName) {
      return { success: false, error: 'اسم الشركة/المورد مطلوب' };
    }

    const { data, error } = await supabase.rpc('save_supplier', {
      p_company_name: companyName,
      p_supplier_id: supplierId,
      p_contact_person: input.contactPerson?.trim() || null,
      p_phone: input.phone?.trim() || null,
      p_whatsapp: input.whatsapp?.trim() || null,
      p_email: input.email?.trim() || null,
      p_address: input.address?.trim() || null,
      p_tax_number: input.taxNumber?.trim() || null,
      p_notes: input.notes?.trim() || null,
      p_is_active: input.isActive ?? true,
    });

    if (error) {
      console.error('updateSupplierInSupabase error:', error.message);
      return { success: false, error: error.message };
    }

    if (!data?.success || !data?.supplier) {
      return { success: false, error: 'لم يؤكد الخادم تحديث المورد.' };
    }

    return { success: true, data: mapSupplierRow(data.supplier) };
  } catch (err: any) {
    console.error('Exception in updateSupplierInSupabase:', err);
    return { success: false, error: err?.message || 'حدث خطأ أثناء تحديث المورد' };
  }
}

/**
 * Toggle active status of supplier
 */
export async function toggleSupplierActiveInSupabase(
  supplierId: string,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'خدمة Supabase غير مفعّلة' };
  }

  try {
    const { data, error } = await supabase.rpc('set_supplier_active', {
      p_supplier_id: supplierId,
      p_is_active: isActive,
    });

    if (error) return { success: false, error: error.message };
    return data?.success
      ? { success: true }
      : { success: false, error: 'لم يؤكد الخادم تغيير حالة المورد.' };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

/**
 * Fetch Purchase Orders list with optional filtering
 */
export async function fetchPurchaseOrdersFromSupabase(
  filters?: PurchaseOrderFilters
): Promise<{ success: boolean; data: PurchaseOrder[]; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, data: [], error: 'Supabase is not configured' };
  }

  try {
    let query = supabase
      .from('purchase_orders')
      .select(`
        *,
        suppliers (id, company_name),
        branches (id, name_ar),
        warehouses (id, name_ar),
        purchase_order_items (
          id,
          purchase_order_id,
          product_id,
          ordered_quantity,
          received_quantity,
          purchase_price_in_minor_units,
          discount_in_minor_units,
          line_total_in_minor_units,
          products (
            id,
            name_ar,
            sku,
            barcode,
            unit_id,
            base_unit:units!products_unit_id_fkey(name_ar)
          )
        )
      `);

    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }
    if (filters?.supplierId && filters.supplierId !== 'all') {
      query = query.eq('supplier_id', filters.supplierId);
    }
    if (filters?.branchId && filters.branchId !== 'all') {
      query = query.eq('branch_id', filters.branchId);
    }
    if (filters?.warehouseId && filters.warehouseId !== 'all') {
      query = query.eq('warehouse_id', filters.warehouseId);
    }

    if (filters?.sortBy === 'highest_value') {
      query = query.order('total_in_minor_units', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      console.error('fetchPurchaseOrdersFromSupabase error:', error.message);
      return { success: false, data: [], error: error.message };
    }

    const formatted: PurchaseOrder[] = (data || []).map((po: any) => {
      const items = (po.purchase_order_items || []).map((item: any) => ({
        id: item.id,
        purchaseOrderId: item.purchase_order_id,
        productId: item.product_id,
        productName: item.products?.name_ar || 'منتج غير معروف',
        sku: item.products?.sku || '',
        barcode: item.products?.barcode || '',
        unit: item.products?.base_unit?.name_ar || 'قطعة',
        orderedQuantity: item.ordered_quantity,
        receivedQuantity: item.received_quantity,
        purchasePrice: minorToJod(item.purchase_price_in_minor_units),
        discount: minorToJod(item.discount_in_minor_units),
        lineTotal: minorToJod(item.line_total_in_minor_units),
      }));

      const subtotal = minorToJod(po.subtotal_in_minor_units);
      const discount = minorToJod(po.discount_in_minor_units);
      const deliveryFee = minorToJod(po.delivery_fee_in_minor_units);
      const totalAmount = minorToJod(po.total_in_minor_units);
      const amountPaid = minorToJod(po.amount_paid_in_minor_units);
      const amountDue = Math.max(0, totalAmount - amountPaid);

      return {
        id: po.id,
        purchaseOrderNumber: po.purchase_order_number,
        supplierId: po.supplier_id,
        supplierName: po.suppliers?.company_name || 'مورد غير معروف',
        branchId: po.branch_id,
        branchName: po.branches?.name_ar,
        warehouseId: po.warehouse_id,
        warehouseName: po.warehouses?.name_ar,
        status: po.status,
        orderDate: po.order_date,
        expectedDeliveryDate: po.expected_delivery_date,
        subtotal,
        discount,
        deliveryFee,
        totalAmount,
        amountPaid,
        amountDue,
        supplierInvoiceNumber: po.supplier_invoice_number,
        notes: po.notes,
        internalNotes: po.internal_notes,
        createdBy: po.created_by,
        approvedBy: po.approved_by,
        approvedAt: po.approved_at,
        receivedAt: po.received_at,
        cancelledAt: po.cancelled_at,
        createdAt: po.created_at,
        updatedAt: po.updated_at,
        items,
      };
    });

    // Client side filtering for search and outstanding if needed
    let filteredData = formatted;
    if (filters?.search) {
      const q = filters.search.toLowerCase().trim();
      filteredData = filteredData.filter(
        (po) =>
          po.purchaseOrderNumber.toLowerCase().includes(q) ||
          po.supplierName.toLowerCase().includes(q) ||
          (po.supplierInvoiceNumber && po.supplierInvoiceNumber.toLowerCase().includes(q))
      );
    }

    if (filters?.sortBy === 'outstanding') {
      filteredData.sort((a, b) => b.amountDue - a.amountDue);
    }

    return { success: true, data: filteredData };
  } catch (err: any) {
    console.error('Exception in fetchPurchaseOrdersFromSupabase:', err);
    return { success: false, data: [], error: err?.message || 'Error fetching purchase orders' };
  }
}

/**
 * Fetch a single Purchase Order by ID with full details (items, receipts, payments)
 */
export async function fetchPurchaseOrderByIdFromSupabase(
  poId: string
): Promise<{ success: boolean; data?: PurchaseOrder; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { data: po, error } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        suppliers (id, company_name, contact_person, phone, email, address),
        branches (id, name_ar),
        warehouses (id, name_ar),
        purchase_order_items (
          id,
          purchase_order_id,
          product_id,
          ordered_quantity,
          received_quantity,
          purchase_price_in_minor_units,
          discount_in_minor_units,
          line_total_in_minor_units,
          products (
            id,
            name_ar,
            sku,
            barcode,
            unit_id,
            base_unit:units!products_unit_id_fkey(name_ar)
          )
        ),
        purchase_receipts (
          id,
          receipt_number,
          received_at,
          supplier_delivery_note,
          notes,
          purchase_receipt_items (
            id,
            product_id,
            received_quantity,
            unit_cost_in_minor_units,
            products (name_ar)
          )
        ),
        supplier_payments (
          id,
          amount_in_minor_units,
          payment_method,
          reference_number,
          payment_date,
          notes,
          created_at
        )
      `)
      .eq('id', poId)
      .single();

    if (error || !po) {
      return { success: false, error: error?.message || 'Purchase order not found' };
    }

    const items = (po.purchase_order_items || []).map((item: any) => ({
      id: item.id,
      purchaseOrderId: item.purchase_order_id,
      productId: item.product_id,
      productName: item.products?.name_ar || 'منتج غير معروف',
      sku: item.products?.sku || '',
      barcode: item.products?.barcode || '',
      unit: item.products?.base_unit?.name_ar || 'قطعة',
      orderedQuantity: item.ordered_quantity,
      receivedQuantity: item.received_quantity,
      purchasePrice: minorToJod(item.purchase_price_in_minor_units),
      discount: minorToJod(item.discount_in_minor_units),
      lineTotal: minorToJod(item.line_total_in_minor_units),
    }));

    const receipts = (po.purchase_receipts || []).map((rc: any) => ({
      id: rc.id,
      receiptNumber: rc.receipt_number,
      purchaseOrderId: po.id,
      supplierId: po.supplier_id,
      supplierName: po.suppliers?.company_name || '',
      warehouseId: po.warehouse_id || '',
      warehouseName: po.warehouses?.name_ar || '',
      receivedBy: '',
      receivedAt: rc.received_at,
      supplierDeliveryNote: rc.supplier_delivery_note,
      notes: rc.notes,
      items: (rc.purchase_receipt_items || []).map((ri: any) => ({
        id: ri.id,
        purchaseReceiptId: rc.id,
        productId: ri.product_id,
        productName: ri.products?.name_ar || '',
        receivedQuantity: ri.received_quantity,
        unitCost: minorToJod(ri.unit_cost_in_minor_units),
      })),
    }));

    const payments: SupplierPayment[] = (po.supplier_payments || []).map((sp: any) => ({
      id: sp.id,
      supplierId: po.supplier_id,
      supplierName: po.suppliers?.company_name || '',
      purchaseOrderId: po.id,
      purchaseOrderNumber: po.purchase_order_number,
      amount: minorToJod(sp.amount_in_minor_units),
      paymentMethod: sp.payment_method,
      referenceNumber: sp.reference_number,
      paymentDate: sp.payment_date,
      notes: sp.notes,
      createdAt: sp.created_at,
    }));

    const subtotal = minorToJod(po.subtotal_in_minor_units);
    const discount = minorToJod(po.discount_in_minor_units);
    const deliveryFee = minorToJod(po.delivery_fee_in_minor_units);
    const totalAmount = minorToJod(po.total_in_minor_units);
    const amountPaid = minorToJod(po.amount_paid_in_minor_units);

    const formattedPo: PurchaseOrder = {
      id: po.id,
      purchaseOrderNumber: po.purchase_order_number,
      supplierId: po.supplier_id,
      supplierName: po.suppliers?.company_name || 'مورد غير معروف',
      branchId: po.branch_id,
      branchName: po.branches?.name_ar,
      warehouseId: po.warehouse_id,
      warehouseName: po.warehouses?.name_ar,
      status: po.status,
      orderDate: po.order_date,
      expectedDeliveryDate: po.expected_delivery_date,
      subtotal,
      discount,
      deliveryFee,
      totalAmount,
      amountPaid,
      amountDue: Math.max(0, totalAmount - amountPaid),
      supplierInvoiceNumber: po.supplier_invoice_number,
      notes: po.notes,
      internalNotes: po.internal_notes,
      createdBy: po.created_by,
      approvedBy: po.approved_by,
      approvedAt: po.approved_at,
      receivedAt: po.received_at,
      cancelledAt: po.cancelled_at,
      createdAt: po.created_at,
      updatedAt: po.updated_at,
      items,
      receipts,
      payments,
    };

    return { success: true, data: formattedPo };
  } catch (err: any) {
    console.error('Exception in fetchPurchaseOrderByIdFromSupabase:', err);
    return { success: false, error: err?.message || 'Error fetching purchase order' };
  }
}

/**
 * Call RPC create_purchase_order
 */
export async function createPurchaseOrderInSupabase(
  input: CreatePurchaseOrderInput
): Promise<{ success: boolean; purchaseOrderId?: string; purchaseOrderNumber?: string; message?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    // Strict UUID validation & cleanup to prevent non-UUID values (e.g. "b-jrbd", empty strings)
    const p_supplier_id = isValidUUID(input.supplierId) ? input.supplierId.trim() : null;
    const p_branch_id = isValidUUID(input.branchId) ? input.branchId.trim() : null;
    const p_warehouse_id = isValidUUID(input.warehouseId) ? input.warehouseId.trim() : null;

    if (!p_supplier_id) {
      return {
        success: false,
        error: 'معرّف المورد غير صالح (p_supplier_id يجب أن يكون UUID صالحاً).',
      };
    }

    if (!input.items || input.items.length === 0) {
      return {
        success: false,
        error: 'عناصر طلب الشراء مفقودة (p_items فارغة).',
      };
    }

    const p_items = [];
    for (const item of input.items) {
      const cleanProductId = isValidUUID(item.productId) ? item.productId.trim() : null;
      if (!cleanProductId) {
        return {
          success: false,
          error: `معرّف المنتج غير صالح (p_items.product_id يجب أن يكون UUID صالحاً): "${item.productId}"`,
        };
      }
      p_items.push({
        product_id: cleanProductId,
        ordered_quantity: Number(item.orderedQuantity) || 1,
        purchase_price_in_minor_units: jodToMinor(item.purchasePrice),
        discount_in_minor_units: jodToMinor(item.discount || 0),
      });
    }

    // Development logging for debugging (no sensitive user data)
    if (import.meta.env.DEV) {
      console.log('[create_purchase_order RPC Payload]:', {
        p_supplier_id,
        p_branch_id,
        p_warehouse_id,
        item_product_ids: p_items.map((it) => it.product_id),
      });
    }

    const { data, error } = await supabase.rpc('create_purchase_order', {
      p_supplier_id,
      p_branch_id,
      p_warehouse_id,
      p_expected_delivery_date: input.expectedDeliveryDate || null,
      p_delivery_fee_in_minor_units: jodToMinor(input.deliveryFee || 0),
      p_discount_in_minor_units: jodToMinor(input.discount || 0),
      p_supplier_invoice_number: input.supplierInvoiceNumber || null,
      p_notes: input.notes || null,
      p_internal_notes: input.internalNotes || null,
      p_items,
    });

    if (error) {
      console.error('RPC create_purchase_order error:', error);
      return { success: false, error: error.message };
    }

    if (data && data.success) {
      return {
        success: true,
        purchaseOrderId: data.purchase_order_id,
        purchaseOrderNumber: data.purchase_order_number,
        message: data.message,
      };
    }

    return { success: false, error: data?.message || 'فشل إنشاء أمر الشراء' };
  } catch (err: any) {
    console.error('Exception in createPurchaseOrderInSupabase:', err);
    return { success: false, error: err?.message || 'Exception creating purchase order' };
  }
}

/**
 * Update an existing draft purchase order and its items
 */
export async function updatePurchaseOrderInSupabase(
  poId: string,
  input: CreatePurchaseOrderInput
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const cleanSupplierId = isValidUUID(input.supplierId) ? input.supplierId.trim() : null;
    const cleanBranchId = isValidUUID(input.branchId) ? input.branchId.trim() : null;
    const cleanWarehouseId = isValidUUID(input.warehouseId) ? input.warehouseId.trim() : null;

    if (!cleanSupplierId) {
      return { success: false, error: 'معرّف المورد غير صالح (يجب أن يكون UUID).' };
    }

    if (!input.items || input.items.length === 0) {
      return { success: false, error: 'يجب إضافة منتج واحد على الأقل إلى طلب الشراء.' };
    }

    const items = input.items.map((item) => ({
      product_id: item.productId,
      ordered_quantity: Math.max(1, Math.floor(Number(item.orderedQuantity) || 1)),
      purchase_price_in_minor_units: jodToMinor(item.purchasePrice),
      discount_in_minor_units: jodToMinor(item.discount),
    }));

    const { data, error } = await supabase.rpc('update_purchase_order', {
      p_purchase_order_id: poId,
      p_supplier_id: cleanSupplierId,
      p_branch_id: cleanBranchId,
      p_warehouse_id: cleanWarehouseId,
      p_expected_delivery_date: input.expectedDeliveryDate || null,
      p_delivery_fee_in_minor_units: jodToMinor(input.deliveryFee),
      p_discount_in_minor_units: jodToMinor(input.discount),
      p_supplier_invoice_number: input.supplierInvoiceNumber?.trim() || null,
      p_notes: input.notes?.trim() || null,
      p_internal_notes: input.internalNotes?.trim() || null,
      p_items: items,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return data?.success
      ? { success: true, message: 'تم تحديث أمر الشراء بنجاح' }
      : { success: false, error: 'لم يؤكد الخادم تحديث أمر الشراء.' };
  } catch (err: any) {
    console.error('Exception in updatePurchaseOrderInSupabase:', err);
    return { success: false, error: err?.message || 'خطأ أثناء تحديث أمر الشراء' };
  }
}

/**
 * Delete a draft purchase order
 */
export async function deletePurchaseOrderInSupabase(
  poId: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { data, error } = await supabase.rpc(
      'delete_draft_purchase_order',
      { p_purchase_order_id: poId }
    );

    if (error) {
      return { success: false, error: error.message };
    }

    return data?.success
      ? { success: true, message: 'تم حذف طلب الشراء بنجاح' }
      : { success: false, error: 'لم يؤكد الخادم حذف أمر الشراء.' };
  } catch (err: any) {
    console.error('Exception in deletePurchaseOrderInSupabase:', err);
    return { success: false, error: err?.message || 'خطأ أثناء حذف طلب الشراء' };
  }
}

/**
 * Send purchase order (draft -> sent)
 */
export async function sendPurchaseOrderInSupabase(
  poId: string,
  notes?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { data, error } = await supabase.rpc('update_purchase_order_status', {
      p_purchase_order_id: poId,
      p_new_status: 'sent',
      p_notes: notes || 'تم إرسال أمر الشراء إلى المورد',
    });

    if (error) return { success: false, error: error.message };
    return { success: data?.success || false, message: data?.message, error: data?.message };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

/**
 * Approve purchase order (sent -> approved)
 */
export async function approvePurchaseOrderInSupabase(
  poId: string,
  notes?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { data, error } = await supabase.rpc('update_purchase_order_status', {
      p_purchase_order_id: poId,
      p_new_status: 'approved',
      p_notes: notes || 'تم اعتماد أمر الشراء من قبل الإدارة',
    });

    if (error) return { success: false, error: error.message };
    return { success: data?.success || false, message: data?.message, error: data?.message };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

/**
 * Receive goods for purchase order via RPC receive_purchase_order
 */
export async function receivePurchaseOrderInSupabase(
  input: ReceivePurchaseOrderInput
): Promise<{ success: boolean; receiptId?: string; receiptNumber?: string; message?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const p_items = input.items.map((item) => ({
      purchase_order_item_id: item.purchaseOrderItemId,
      product_id: item.productId,
      received_quantity: item.receivedQuantity,
      unit_cost_in_minor_units: jodToMinor(item.unitCost),
    }));

    const { data, error } = await supabase.rpc('receive_purchase_order', {
      p_purchase_order_id: input.purchaseOrderId,
      p_warehouse_id: input.warehouseId || null,
      p_supplier_delivery_note: input.supplierDeliveryNote || null,
      p_notes: input.notes || null,
      p_items,
    });

    if (error) {
      console.error('RPC receive_purchase_order error:', error);
      return { success: false, error: error.message };
    }

    if (data && data.success) {
      return {
        success: true,
        receiptId: data.receipt_id,
        receiptNumber: data.receipt_number,
        message: data.message,
      };
    }

    return { success: false, error: data?.message || 'فشل استلام البضائع' };
  } catch (err: any) {
    console.error('Exception in receivePurchaseOrderInSupabase:', err);
    return { success: false, error: err?.message || 'Exception receiving purchase order' };
  }
}

/**
 * Cancel purchase order via RPC cancel_purchase_order
 */
export async function cancelPurchaseOrderInSupabase(
  poId: string,
  reason?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { data, error } = await supabase.rpc('cancel_purchase_order', {
      p_purchase_order_id: poId,
      p_reason: reason || 'إلغاء أمر الشراء',
    });

    if (error) return { success: false, error: error.message };
    return { success: data?.success || false, message: data?.message, error: data?.message };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

/**
 * Record supplier payment via RPC record_supplier_payment
 */
export async function recordSupplierPaymentInSupabase(params: {
  supplierId: string;
  purchaseOrderId?: string;
  amount: number; // JOD
  paymentMethod?: string;
  referenceNumber?: string;
  paymentDate?: string;
  notes?: string;
  idempotencyKey: string;
}): Promise<{ success: boolean; paymentId?: string; message?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { data, error } = await supabase.rpc('record_supplier_payment', {
      p_supplier_id: params.supplierId,
      p_purchase_order_id: params.purchaseOrderId || null,
      p_amount_in_minor_units: jodToMinor(params.amount),
      p_payment_method: params.paymentMethod || 'cash',
      p_reference_number: params.referenceNumber || null,
      p_payment_date: params.paymentDate || new Date().toISOString(),
      p_notes: params.notes || null,
      p_idempotency_key: params.idempotencyKey,
    });

    if (error) {
      console.error('RPC record_supplier_payment error:', error);
      return { success: false, error: error.message };
    }

    if (data && data.success) {
      return {
        success: true,
        paymentId: data.payment_id,
        message: data.message,
      };
    }

    return { success: false, error: data?.message || 'فشل تسجيل الدفعة' };
  } catch (err: any) {
    console.error('Exception in recordSupplierPaymentInSupabase:', err);
    return { success: false, error: err?.message };
  }
}

/**
 * Fetch all supplier payments with supplier and PO info
 */
export async function fetchSupplierPaymentsFromSupabase(supplierId?: string): Promise<SupplierPayment[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    let query = supabase
      .from('supplier_payments')
      .select(`
        *,
        suppliers (id, company_name),
        purchase_orders (id, purchase_order_number)
      `)
      .order('payment_date', { ascending: false });

    if (supplierId && supplierId !== 'all') {
      query = query.eq('supplier_id', supplierId);
    }

    const { data, error } = await query;

    if (error || !data) {
      console.warn('fetchSupplierPaymentsFromSupabase error or empty:', error?.message);
      return [];
    }

    return data.map((p: any) => ({
      id: p.id,
      supplierId: p.supplier_id,
      supplierName: p.suppliers?.company_name || 'مورد غير معروف',
      purchaseOrderId: p.purchase_order_id,
      purchaseOrderNumber: p.purchase_orders?.purchase_order_number || '',
      amount: minorToJod(p.amount_in_minor_units),
      paymentMethod: p.payment_method || 'cash',
      referenceNumber: p.reference_number || '',
      paymentDate: p.payment_date || p.created_at,
      notes: p.notes || '',
      createdByName: p.created_by || 'المستخدم',
      createdAt: p.created_at,
    }));
  } catch (err) {
    console.error('Exception in fetchSupplierPaymentsFromSupabase:', err);
    return [];
  }
}

/**
 * Fetch purchase receipts history
 */
export async function fetchGoodsReceiptsFromSupabase(): Promise<PurchaseReceipt[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('purchase_receipts')
      .select(`
        *,
        purchase_orders (id, purchase_order_number, supplier_id, suppliers (id, company_name)),
        warehouses (id, name_ar),
        purchase_receipt_items (
          id,
          purchase_receipt_id,
          purchase_order_item_id,
          product_id,
          received_quantity,
          unit_cost_in_minor_units,
          products (id, name_ar)
        )
      `)
      .order('received_at', { ascending: false });

    if (error || !data) {
      console.warn('fetchGoodsReceiptsFromSupabase error:', error?.message);
      return [];
    }

    return data.map((r: any) => ({
      id: r.id,
      receiptNumber: r.receipt_number || r.id.substring(0, 8),
      purchaseOrderId: r.purchase_order_id,
      supplierId: r.purchase_orders?.supplier_id || '',
      supplierName: r.purchase_orders?.suppliers?.company_name || 'مورد غير معروف',
      warehouseId: r.warehouse_id || '',
      warehouseName: r.warehouses?.name_ar || 'المستودع الرئيسي',
      receivedBy: r.received_by || 'موظف المستودع',
      receivedByName: r.received_by || 'موظف المستودع',
      receivedAt: r.received_at || r.created_at,
      supplierDeliveryNote: r.supplier_delivery_note || '',
      notes: r.notes || '',
      items: (r.purchase_receipt_items || []).map((ri: any) => ({
        id: ri.id,
        purchaseReceiptId: ri.purchase_receipt_id,
        purchaseOrderItemId: ri.purchase_order_item_id,
        productId: ri.product_id,
        productName: ri.products?.name_ar || 'منتج',
        receivedQuantity: ri.received_quantity,
        unitCost: minorToJod(ri.unit_cost_in_minor_units),
      })),
    }));
  } catch (err) {
    console.error('Exception in fetchGoodsReceiptsFromSupabase:', err);
    return [];
  }
}

/**
 * Fetch supplier purchasing summary metrics
 */
export async function fetchSupplierPurchaseSummaryFromSupabase(
  supplierId: string
): Promise<SupplierPurchaseSummary> {
  const emptySummary: SupplierPurchaseSummary = {
    totalPurchaseOrders: 0,
    totalPurchases: 0,
    totalPaid: 0,
    totalOutstanding: 0,
    openPurchaseOrdersCount: 0,
  };

  if (!isSupabaseConfigured || !supabase) {
    return emptySummary;
  }

  try {
    const { data: pos, error } = await supabase
      .from('purchase_orders')
      .select('id, purchase_order_number, status, total_in_minor_units, amount_paid_in_minor_units, created_at')
      .eq('supplier_id', supplierId)
      .order('created_at', { ascending: false });

    if (error || !pos) return emptySummary;

    let totalPurchasesFils = 0;
    let totalPaidFils = 0;
    let totalOutstandingFils = 0;
    let openCount = 0;

    pos.forEach((po: any) => {
      if (po.status !== 'cancelled') {
        const total = Number(po.total_in_minor_units) || 0;
        const paid = Number(po.amount_paid_in_minor_units) || 0;
        const due = Math.max(0, total - paid);

        totalPurchasesFils += total;
        totalPaidFils += paid;
        totalOutstandingFils += due;

        if (['draft', 'sent', 'approved', 'partially_received'].includes(po.status)) {
          openCount++;
        }
      }
    });

    const latestPo = pos[0];

    return {
      totalPurchaseOrders: pos.length,
      totalPurchases: minorToJod(totalPurchasesFils),
      totalPaid: minorToJod(totalPaidFils),
      totalOutstanding: minorToJod(totalOutstandingFils),
      latestPurchaseOrderNumber: latestPo?.purchase_order_number,
      latestPurchaseOrderDate: latestPo?.created_at,
      openPurchaseOrdersCount: openCount,
    };
  } catch (err) {
    console.error('Exception in fetchSupplierPurchaseSummaryFromSupabase:', err);
    return emptySummary;
  }
}

/**
 * Subscribe to realtime updates for purchasing tables
 */
export function subscribeToPurchasesRealtime(callback: () => void): () => void {
  if (!isSupabaseConfigured || !supabase) {
    return () => {};
  }

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      callback();
    }, 350);
  };

  const channel = supabase
    .channel('purchases_realtime_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'purchase_orders' },
      scheduleRefresh
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'purchase_order_items' },
      scheduleRefresh
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'purchase_receipts' },
      scheduleRefresh
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'supplier_payments' },
      scheduleRefresh
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_balances' },
      scheduleRefresh
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_movements' },
      scheduleRefresh
    )
    .subscribe();

  return () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    void supabase.removeChannel(channel);
  };
}

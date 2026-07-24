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

/**
 * Fetch list of suppliers from Supabase
 */
export async function fetchSuppliersFromSupabase(): Promise<Supplier[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('is_active', true)
      .order('company_name', { ascending: true });

    if (error || !data) {
      console.warn('fetchSuppliersFromSupabase error:', error?.message);
      return [];
    }

    return data.map((s: any) => ({
      id: s.id,
      companyName: s.company_name,
      contactPerson: s.contact_person || '',
      phone: s.phone || '',
      whatsapp: s.whatsapp || '',
      address: s.address || '',
      currentBalance: 0, // calculate from payments / POs if needed
      taxNumber: s.tax_number || '',
      notes: s.notes || '',
    }));
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

    const payload = {
      company_name: companyName,
      contact_person: input.contactPerson?.trim() || null,
      phone: input.phone?.trim() || null,
      whatsapp: input.whatsapp?.trim() || null,
      email: input.email?.trim() || null,
      address: input.address?.trim() || null,
      tax_number: input.taxNumber?.trim() || null,
      notes: input.notes?.trim() || null,
      is_active: input.isActive ?? true,
    };

    const { data, error } = await supabase
      .from('suppliers')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      console.error('createSupplierInSupabase error:', error.message);
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: 'لم يتم إرجاع بيانات المورد المنشأ' };
    }

    const newSupplier: Supplier = {
      id: data.id,
      companyName: data.company_name,
      contactPerson: data.contact_person || '',
      phone: data.phone || '',
      whatsapp: data.whatsapp || '',
      address: data.address || '',
      currentBalance: 0,
      taxNumber: data.tax_number || '',
      notes: data.notes || '',
    };

    return { success: true, data: newSupplier };
  } catch (err: any) {
    console.error('Exception in createSupplierInSupabase:', err);
    return { success: false, error: err?.message || 'حدث خطأ أثناء إضافة المورد' };
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
          products (id, name_ar, sku, unit_id, units(name_ar))
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
        unit: item.products?.units?.name_ar || 'قطعة',
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
          products (id, name_ar, sku, unit_id, units(name_ar))
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
      unit: item.products?.units?.name_ar || 'قطعة',
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
    const p_items = input.items.map((item) => ({
      product_id: item.productId,
      ordered_quantity: item.orderedQuantity,
      purchase_price_in_minor_units: jodToMinor(item.purchasePrice),
      discount_in_minor_units: jodToMinor(item.discount || 0),
    }));

    const { data, error } = await supabase.rpc('create_purchase_order', {
      p_supplier_id: input.supplierId,
      p_branch_id: input.branchId || null,
      p_warehouse_id: input.warehouseId || null,
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

  const channel = supabase
    .channel('purchases_realtime_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'purchase_orders' },
      () => callback()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'purchase_order_items' },
      () => callback()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'purchase_receipts' },
      () => callback()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'supplier_payments' },
      () => callback()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_balances' },
      () => callback()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_movements' },
      () => callback()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

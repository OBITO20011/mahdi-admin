import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Order, OrderStatus, PaymentMethod, PaymentStatus } from '../../types';
import {
  calculateOrderAmountDue,
  type OperationalOrderFilter,
} from '../../utils/orderCalculations';

const paymentMethods: PaymentMethod[] = [
  'cash',
  'cash_on_delivery',
  'cliq',
  'card',
  'bank_transfer',
  'debt',
  'mixed',
];
const paymentStatuses: PaymentStatus[] = ['unpaid', 'partially_paid', 'paid', 'refunded'];

export type OperationalOrdersSort = 'newest' | 'oldest';

export interface OperationalOrdersPageInput {
  page: number;
  pageSize: number;
  filter: OperationalOrderFilter;
  searchQuery?: string;
  sort?: OperationalOrdersSort;
}

export interface OperationalOrdersSummary {
  review: number;
  active: number;
  due: number;
}

export interface OperationalOrdersPage {
  success: boolean;
  orders: OperationalOrderListItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  summary: OperationalOrdersSummary;
  error?: string;
}

export interface OperationalOrderListItem {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  governorate: string;
  region: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  totalAmount: number;
  amountPaid: number;
  amountDue: number;
  itemCount: number;
  branchId: string;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_OPERATIONAL_ORDERS_SUMMARY: OperationalOrdersSummary = {
  review: 0,
  active: 0,
  due: 0,
};

const ORDER_DETAIL_SELECT = `
  id,
  order_number,
  customer_id,
  customer_name_snapshot,
  status,
  payment_method,
  payment_status,
  payment_reference_number,
  payment_confirmed_at,
  payment_confirmed_by,
  cash_shift_id,
  subtotal_in_minor_units,
  delivery_fee_in_minor_units,
  delivery_zone,
  discount_in_minor_units,
  promotion_code_snapshot,
  total_in_minor_units,
  amount_paid_in_minor_units,
  customer_notes,
  internal_notes,
  whatsapp_message,
  tracking_token,
  delivery_started_at,
  estimated_arrival_at,
  delivery_completed_at,
  delivery_driver_phone,
  source,
  branch_id,
  warehouse_id,
  created_at,
  updated_at,
  customers (
    id,
    full_name,
    phone,
    email
  ),
  customer_addresses (
    id,
    governorate,
    city,
    area,
    street,
    building,
    floor,
    apartment,
    notes,
    latitude,
    longitude,
    formatted_address,
    google_maps_url,
    location_source,
    location_confirmed
  ),
  order_items (
    id,
    product_id,
    product_name_snapshot,
    sku_snapshot,
    quantity,
    unit_price_in_minor_units,
    line_total_in_minor_units,
    sale_package_quantity,
    units_per_sale_package,
    sale_package_name_snapshot,
    sale_package_price_in_minor_units,
    products (
      id,
      cost_price_in_minor_units,
      base_unit:units!products_unit_id_fkey (
        name_ar
      ),
      product_images (
        image_url
      )
    )
  ),
  order_status_history (
    id,
    old_status,
    new_status,
    changed_by,
    notes,
    created_at
  ),
  sales_returns (
    id,
    return_number,
    reason,
    stock_disposition,
    refund_method,
    refund_amount_in_minor_units,
    reference_number,
    created_at
  )
`;

const OPERATIONAL_ORDER_LIST_SELECT = `
  id,
  order_number,
  customer_name_snapshot,
  status,
  payment_method,
  payment_status,
  total_in_minor_units,
  amount_paid_in_minor_units,
  branch_id,
  created_at,
  updated_at,
  customers (
    full_name,
    phone
  ),
  customer_addresses (
    governorate,
    city,
    area
  ),
  order_items (count)
`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asNonNegativeInteger = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const asPositiveInteger = (value: number, fallback: number): number =>
  Number.isInteger(value) && value > 0 ? value : fallback;

function parseOperationalOrdersPagePayload(value: unknown): {
  orderIds: string[];
  totalCount: number;
  summary: OperationalOrdersSummary;
} | null {
  if (!isRecord(value) || !Array.isArray(value.order_ids)) return null;

  const summary = isRecord(value.summary) ? value.summary : {};
  return {
    orderIds: value.order_ids.filter(
      (orderId): orderId is string => typeof orderId === 'string'
    ),
    totalCount: asNonNegativeInteger(value.total_count),
    summary: {
      review: asNonNegativeInteger(summary.review_count),
      active: asNonNegativeInteger(summary.active_count),
      due: asNonNegativeInteger(summary.due_in_minor_units) / 1000,
    },
  };
}

function toPaymentMethod(value: unknown): PaymentMethod {
  return paymentMethods.includes(value as PaymentMethod)
    ? (value as PaymentMethod)
    : 'cash_on_delivery';
}

function toPaymentStatus(value: unknown): PaymentStatus {
  return paymentStatuses.includes(value as PaymentStatus)
    ? (value as PaymentStatus)
    : 'unpaid';
}

async function fetchOperationalOrderListRows(
  orderIds: readonly string[]
): Promise<{
  success: boolean;
  orders: OperationalOrderListItem[];
  error?: string;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      orders: [],
      error: 'لم يتم إعداد عميل Supabase بنجاح.',
    };
  }

  if (orderIds.length === 0) {
    return { success: true, orders: [] };
  }

  try {
    const { data, error } = await supabase
      .from('orders')
      .select(OPERATIONAL_ORDER_LIST_SELECT)
      .in('id', [...orderIds]);

    if (error) {
      console.error('[fetchOperationalOrderListRows Error]:', error);
      return { success: false, orders: [], error: error.message };
    }

    if (!data) {
      return { success: true, orders: [] };
    }

    return { success: true, orders: mapOperationalOrderListRows(data) };
  } catch (error) {
    console.error('[fetchOperationalOrderListRows Exception]:', error);
    return {
      success: false,
      orders: [],
      error:
        error instanceof Error
          ? error.message
          : 'حدث خطأ غير متوقع أثناء جلب صفحة الطلبات.',
    };
  }
}

function firstRelation(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return isRecord(value[0]) ? value[0] : {};
  }
  return isRecord(value) ? value : {};
}

function mapOperationalOrderListRows(
  data: unknown[]
): OperationalOrderListItem[] {
  return data.flatMap((value) => {
    if (!isRecord(value) || typeof value.id !== 'string') return [];

    const customer = firstRelation(value.customers);
    const address = firstRelation(value.customer_addresses);
    const itemCountRelation = firstRelation(value.order_items);
    const totalAmount = Number(value.total_in_minor_units || 0) / 1000;
    const amountPaid = Number(value.amount_paid_in_minor_units || 0) / 1000;

    return [{
      id: value.id,
      orderNumber:
        typeof value.order_number === 'string' ? value.order_number : value.id,
      customerName:
        typeof customer.full_name === 'string'
          ? customer.full_name
          : typeof value.customer_name_snapshot === 'string'
            ? value.customer_name_snapshot
            : 'زبون نقدي',
      customerPhone:
        typeof customer.phone === 'string' ? customer.phone : '',
      governorate:
        typeof address.governorate === 'string'
          ? address.governorate
          : 'غير محدد',
      region:
        typeof address.area === 'string'
          ? address.area
          : typeof address.city === 'string'
            ? address.city
            : 'غير محدد',
      status:
        typeof value.status === 'string'
          ? (value.status as OrderStatus)
          : 'new',
      paymentMethod: toPaymentMethod(value.payment_method),
      paymentStatus: toPaymentStatus(value.payment_status),
      totalAmount,
      amountPaid,
      amountDue: calculateOrderAmountDue(totalAmount, amountPaid),
      itemCount: asNonNegativeInteger(itemCountRelation.count),
      branchId: typeof value.branch_id === 'string' ? value.branch_id : '',
      createdAt:
        typeof value.created_at === 'string'
          ? value.created_at
          : new Date(0).toISOString(),
      updatedAt:
        typeof value.updated_at === 'string'
          ? value.updated_at
          : typeof value.created_at === 'string'
            ? value.created_at
            : new Date(0).toISOString(),
    }];
  });
}

function mapOrderRows(data: unknown[]): Order[] {
  return data.map((ord: any) => {
    const cust = ord.customers || {};
    const addr = ord.customer_addresses || {};

    const items = (ord.order_items || []).map((item: any) => {
      const prod = item.products || {};
      const unitPrice = Number(item.unit_price_in_minor_units || 0) / 1000;
      const lineTotal = Number(item.line_total_in_minor_units || 0) / 1000;
      const costPrice = Number(prod.cost_price_in_minor_units || 0) / 1000;
      const packageQuantity = Number(item.sale_package_quantity || 0);
      const unitsPerSalePackage = Number(item.units_per_sale_package || 0);
      const isWholesaleSnapshot = packageQuantity > 0 && unitsPerSalePackage > 0;
      const displayQuantity = isWholesaleSnapshot
        ? packageQuantity
        : Number(item.quantity || 1);
      const displayUnitPrice = isWholesaleSnapshot
        ? Number(item.sale_package_price_in_minor_units || 0) / 1000
        : unitPrice;

      const unitName = isWholesaleSnapshot
        ? item.sale_package_name_snapshot || 'طرد'
        : prod.base_unit?.name_ar || prod.unit || 'قطعة';
      const imgUrl =
        Array.isArray(prod.product_images) && prod.product_images.length > 0
          ? prod.product_images[0].image_url
          : prod.image_url || '';

      return {
        id: item.id,
        productId: item.product_id || '',
        productName: item.product_name_snapshot || 'منتج',
        productImage: imgUrl,
        sku: item.sku_snapshot || '',
        unit: unitName,
        unitPrice: displayUnitPrice,
        costPrice,
        quantity: displayQuantity,
        baseQuantity: Number(item.quantity || 1),
        unitsPerSalePackage: unitsPerSalePackage || undefined,
        salePackage: isWholesaleSnapshot ? unitName : undefined,
        discount: 0,
        totalPrice: lineTotal,
      };
    });

    const statusHistory = (ord.order_status_history || [])
      .map((h: any) => ({
        status: (h.new_status || 'new') as OrderStatus,
        changedAt: h.created_at || new Date().toISOString(),
        changedBy: h.changed_by || 'النظام',
        reason: h.notes || undefined,
      }))
      .sort(
        (a: any, b: any) =>
          new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()
      );

    const lat = addr.latitude ? Number(addr.latitude) : undefined;
    const lng = addr.longitude ? Number(addr.longitude) : undefined;

    let gMapsUrl = addr.google_maps_url;
    if (!gMapsUrl && lat && lng) {
      gMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    }

    const addressStr =
      addr.formatted_address ||
      [addr.governorate, addr.city, addr.area, addr.street, addr.building]
        .filter(Boolean)
        .join(' - ') ||
      'عنوان غير محدد';
    const totalAmount = Number(ord.total_in_minor_units || 0) / 1000;
    const amountPaid = Number(ord.amount_paid_in_minor_units || 0) / 1000;
    const salesReturn = Array.isArray(ord.sales_returns)
      ? ord.sales_returns[0]
      : ord.sales_returns;

    return {
      id: ord.id,
      orderNumber: ord.order_number,
      customerId: cust.id || ord.customer_id || undefined,
      customerName: cust.full_name || ord.customer_name_snapshot || 'زبون نقدي',
      customerPhone: cust.phone || '',
      governorate: addr.governorate || 'غير محدد',
      region: addr.area || addr.city || 'غير محدد',
      address: addressStr,
      customerAddress: {
        governorate: addr.governorate,
        area: addr.area,
        street: addr.street,
        building: addr.building,
        apartment: addr.apartment,
        landmark: addr.city,
        deliveryNotes: addr.notes,
      },
      latitude: lat,
      longitude: lng,
      formattedAddress: addr.formatted_address,
      googleMapsUrl: gMapsUrl,
      locationSource: addr.location_source || 'manual',
      locationConfirmed: Boolean(addr.location_confirmed),
      trackingToken: ord.tracking_token || undefined,
      deliveryStartedAt: ord.delivery_started_at || undefined,
      estimatedArrivalAt: ord.estimated_arrival_at || undefined,
      deliveryCompletedAt: ord.delivery_completed_at || undefined,
      deliveryDriverPhone: ord.delivery_driver_phone || undefined,
      items,
      subtotal: Number(ord.subtotal_in_minor_units || 0) / 1000,
      deliveryFee: Number(ord.delivery_fee_in_minor_units || 0) / 1000,
      deliveryZone:
        ord.delivery_zone === 'inside_ramtha' || ord.delivery_zone === 'outside_ramtha'
          ? ord.delivery_zone
          : undefined,
      discount: Number(ord.discount_in_minor_units || 0) / 1000,
      promotionCode: ord.promotion_code_snapshot || undefined,
      totalAmount,
      amountPaid,
      amountDue: calculateOrderAmountDue(totalAmount, amountPaid),
      paymentMethod: toPaymentMethod(ord.payment_method),
      paymentStatus: toPaymentStatus(ord.payment_status),
      paymentReferenceNumber: ord.payment_reference_number || undefined,
      paymentConfirmedAt: ord.payment_confirmed_at || undefined,
      paymentConfirmedBy: ord.payment_confirmed_by || undefined,
      cashShiftId: ord.cash_shift_id || undefined,
      returnNumber: salesReturn?.return_number || undefined,
      returnReason: salesReturn?.reason || undefined,
      returnStockDisposition: salesReturn?.stock_disposition || undefined,
      refundMethod: salesReturn?.refund_method || undefined,
      refundAmount: salesReturn
        ? Number(salesReturn.refund_amount_in_minor_units || 0) / 1000
        : undefined,
      refundReferenceNumber: salesReturn?.reference_number || undefined,
      returnedAt: salesReturn?.created_at || undefined,
      source: ord.source || 'website',
      status: (ord.status as OrderStatus) || 'new',
      branchId: ord.branch_id || '',
      isNew: ord.status === 'new',
      notes: ord.customer_notes,
      internalNotes: ord.internal_notes,
      createdAt: ord.created_at,
      updatedAt: ord.updated_at,
      statusHistory,
    };
  });
}

export async function fetchOrderByIdFromSupabase(
  orderId: string
): Promise<{ success: boolean; order?: Order; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير غير معد.' };
  }

  try {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_DETAIL_SELECT)
      .eq('id', orderId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: 'الطلب غير موجود في قاعدة البيانات.' };
      }

      console.error('[fetchOrderByIdFromSupabase Error]:', error);
      return { success: false, error: error.message };
    }

    const [order] = mapOrderRows([data]);
    if (!order) {
      return { success: false, error: 'الطلب غير موجود في قاعدة البيانات.' };
    }

    return { success: true, order };
  } catch (err: any) {
    return { success: false, error: err?.message || 'تعذر جلب تفاصيل الطلب.' };
  }
}

export async function confirmOrderInSupabase(
  orderId: string,
  notes?: string
): Promise<{ success: boolean; message?: string; rawJson?: any; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc('accept_order_for_preparation', {
      p_order_id: orderId,
      p_notes: notes || null,
    });

    if (error) {
      console.error('[confirmOrderInSupabase Error]:', error);
      return { success: false, error: error.message, rawJson: error };
    }

    return {
      success: true,
      rawJson: data,
      message: data?.message || 'تم قبول الطلب وبدء التجهيز.',
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء تأكيد الطلب.' };
  }
}

export async function completeWebsiteOrderWithPaymentInSupabase(
  orderId: string,
  paymentMethod: 'cash' | 'cliq',
  referenceNumber?: string,
  notes?: string
): Promise<{ success: boolean; message?: string; rawJson?: any; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc(
      'complete_website_order_with_payment',
      {
        p_order_id: orderId,
        p_payment_method: paymentMethod,
        p_reference_number: referenceNumber?.trim() || null,
        p_notes: notes || null,
      }
    );

    if (error) {
      console.error(
        '[completeWebsiteOrderWithPaymentInSupabase Error]:',
        error
      );
      return { success: false, error: error.message, rawJson: error };
    }

    return {
      success: true,
      rawJson: data,
      message:
        data?.message ||
        'تم تأكيد القبض والتسليم وخصم الكميات من المخزون.',
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'حدث خطأ أثناء تأكيد قبض وتسليم الطلب.',
    };
  }
}

export async function cancelOrderInSupabase(
  orderId: string,
  notes?: string
): Promise<{ success: boolean; message?: string; rawJson?: any; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc('update_order_status', {
      p_order_id: orderId,
      p_new_status: 'cancelled',
      p_notes: notes || null,
    });

    if (error) {
      console.error('[cancelOrderInSupabase Error]:', error);
      return { success: false, error: error.message, rawJson: error };
    }

    return {
      success: true,
      rawJson: data,
      message: data?.message || 'تم إلغاء الطلب وتحرير الكمية المحجوزة.',
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء إلغاء الطلب.' };
  }
}

export async function fetchOperationalOrdersPageFromSupabase(
  input: OperationalOrdersPageInput
): Promise<OperationalOrdersPage> {
  const page = asPositiveInteger(input.page, 1);
  const pageSize = Math.min(100, asPositiveInteger(input.pageSize, 25));
  const sort = input.sort === 'oldest' ? 'oldest' : 'newest';
  const searchQuery = input.searchQuery?.trim() || null;

  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      orders: [],
      page,
      pageSize,
      totalCount: 0,
      totalPages: 1,
      summary: EMPTY_OPERATIONAL_ORDERS_SUMMARY,
      error: 'لم يتم إعداد عميل Supabase بنجاح.',
    };
  }

  try {
    const { data, error } = await supabase.rpc('get_operational_orders_page', {
      p_page: page,
      p_page_size: pageSize,
      p_filter: input.filter,
      p_search: searchQuery,
      p_sort: sort,
    });

    if (error) {
      console.error('[fetchOperationalOrdersPageFromSupabase Error]:', error);
      return {
        success: false,
        orders: [],
        page,
        pageSize,
        totalCount: 0,
        totalPages: 1,
        summary: EMPTY_OPERATIONAL_ORDERS_SUMMARY,
        error: error.message,
      };
    }

    const pagePayload = parseOperationalOrdersPagePayload(data);
    if (!pagePayload) {
      return {
        success: false,
        orders: [],
        page,
        pageSize,
        totalCount: 0,
        totalPages: 1,
        summary: EMPTY_OPERATIONAL_ORDERS_SUMMARY,
        error: 'استجابة صفحة الطلبات غير صالحة.',
      };
    }

    if (pagePayload.orderIds.length === 0) {
      return {
        success: true,
        orders: [],
        page,
        pageSize,
        totalCount: pagePayload.totalCount,
        totalPages: Math.max(1, Math.ceil(pagePayload.totalCount / pageSize)),
        summary: pagePayload.summary,
      };
    }

    const listResult = await fetchOperationalOrderListRows(
      pagePayload.orderIds
    );
    if (!listResult.success) {
      return {
        success: false,
        orders: [],
        page,
        pageSize,
        totalCount: pagePayload.totalCount,
        totalPages: Math.max(1, Math.ceil(pagePayload.totalCount / pageSize)),
        summary: pagePayload.summary,
        error: listResult.error || 'تعذر تحميل صفحة الطلبات.',
      };
    }

    const ordersById = new Map(
      listResult.orders.map((order) => [order.id, order])
    );
    const orders = pagePayload.orderIds.flatMap((orderId) => {
      const order = ordersById.get(orderId);
      return order ? [order] : [];
    });

    return {
      success: true,
      orders,
      page,
      pageSize,
      totalCount: pagePayload.totalCount,
      totalPages: Math.max(1, Math.ceil(pagePayload.totalCount / pageSize)),
      summary: pagePayload.summary,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'تعذر تحميل صفحة الطلبات.';
    console.error('[fetchOperationalOrdersPageFromSupabase Exception]:', error);
    return {
      success: false,
      orders: [],
      page,
      pageSize,
      totalCount: 0,
      totalPages: 1,
      summary: EMPTY_OPERATIONAL_ORDERS_SUMMARY,
      error: message,
    };
  }
}

export async function fetchOperationalOrdersSummaryFromSupabase(): Promise<{
  success: boolean;
  summary: OperationalOrdersSummary;
  error?: string;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      summary: EMPTY_OPERATIONAL_ORDERS_SUMMARY,
      error: 'لم يتم إعداد عميل Supabase بنجاح.',
    };
  }

  try {
    const { data, error } = await supabase.rpc('get_operational_orders_page', {
      p_page: 1,
      p_page_size: 1,
      p_filter: 'action',
      p_search: null,
      p_sort: 'newest',
    });

    if (error) {
      return {
        success: false,
        summary: EMPTY_OPERATIONAL_ORDERS_SUMMARY,
        error: error.message,
      };
    }

    const payload = parseOperationalOrdersPagePayload(data);
    if (!payload) {
      return {
        success: false,
        summary: EMPTY_OPERATIONAL_ORDERS_SUMMARY,
        error: 'استجابة ملخص الطلبات غير صالحة.',
      };
    }

    return { success: true, summary: payload.summary };
  } catch (error) {
    return {
      success: false,
      summary: EMPTY_OPERATIONAL_ORDERS_SUMMARY,
      error:
        error instanceof Error ? error.message : 'تعذر تحميل ملخص الطلبات.',
    };
  }
}

export interface CompleteWebsiteOrderSettlementInput {
  orderId: string;
  paymentMethod: 'cash' | 'cliq' | 'debt';
  amountCollected: number;
  deliveryFee: number;
  referenceNumber?: string;
  notes?: string;
}

export async function completeWebsiteOrderWithSettlementInSupabase(
  input: CompleteWebsiteOrderSettlementInput
): Promise<{
  success: boolean;
  message?: string;
  remainingAmount?: number;
  paymentNumber?: string;
  rawJson?: any;
  error?: string;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  const amountCollectedInMinorUnits = Math.round(input.amountCollected * 1000);
  const deliveryFeeInMinorUnits = Math.round(input.deliveryFee * 1000);
  if (
    !Number.isFinite(amountCollectedInMinorUnits) ||
    amountCollectedInMinorUnits < 0 ||
    !Number.isFinite(deliveryFeeInMinorUnits) ||
    deliveryFeeInMinorUnits < 0
  ) {
    return { success: false, error: 'المبلغ المقبوض وأجرة التوصيل يجب ألا يكونا سالبين.' };
  }

  try {
    const { data, error } = await supabase.rpc(
      'complete_website_order_with_settlement',
      {
        p_order_id: input.orderId,
        p_payment_method: input.paymentMethod,
        p_amount_collected_in_minor_units: amountCollectedInMinorUnits,
        p_delivery_fee_in_minor_units: deliveryFeeInMinorUnits,
        p_reference_number: input.referenceNumber?.trim() || null,
        p_notes: input.notes?.trim() || null,
      }
    );

    if (error) {
      console.error(
        '[completeWebsiteOrderWithSettlementInSupabase Error]:',
        error
      );
      return { success: false, error: error.message, rawJson: error };
    }

    return {
      success: data?.success === true,
      rawJson: data,
      remainingAmount: Number(data?.remaining_in_minor_units || 0) / 1000,
      paymentNumber: data?.customer_payment_number || undefined,
      message: data?.message || 'تم تسليم الطلب وتسجيل التحصيل والذمة.',
      error: data?.success === true ? undefined : data?.message,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'حدث خطأ أثناء تسليم الطلب وتسجيل التحصيل.',
    };
  }
}

export async function returnCompletedWebsiteOrderInSupabase(input: {
  orderId: string;
  reason: string;
  stockDisposition: 'restock' | 'damaged';
  refundMethod: 'cash' | 'cliq';
  referenceNumber?: string;
  notes?: string;
}): Promise<{
  success: boolean;
  message?: string;
  returnNumber?: string;
  error?: string;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc(
      'return_completed_website_order',
      {
        p_order_id: input.orderId,
        p_reason: input.reason.trim(),
        p_stock_disposition: input.stockDisposition,
        p_refund_method: input.refundMethod,
        p_reference_number: input.referenceNumber?.trim() || null,
        p_notes: input.notes?.trim() || null,
      }
    );

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: data?.success === true,
      message: data?.message || 'تم تسجيل المرتجع بنجاح.',
      returnNumber: data?.return_number,
      error: data?.success === true ? undefined : data?.message,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'تعذر تسجيل مرتجع الطلب.',
    };
  }
}

export async function updateOrderStatusInSupabase(
  orderId: string,
  newStatus: string,
  notes?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc('update_order_status', {
      p_order_id: orderId,
      p_new_status: newStatus,
      p_notes: notes || null,
    });

    if (error) {
      console.error('[updateOrderStatusInSupabase Error]:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      message: data?.message || `تم تحديث حالة الطلب إلى ${newStatus}.`,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء تحديث حالة الطلب.' };
  }
}

export function buildStorefrontTrackingUrl(trackingToken: string): string {
  const environment = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env;
  const baseUrl =
    environment?.VITE_STOREFRONT_PUBLIC_URL?.trim() ||
    'https://nawasrah-store.pages.dev';
  return `${baseUrl.replace(/\/+$/, '')}/#track=${encodeURIComponent(
    trackingToken
  )}`;
}

export async function startOrUpdateOrderDeliveryInSupabase(
  orderId: string,
  etaMinutes: number,
  driverPhone: string,
  notes?: string
): Promise<{
  success: boolean;
  message?: string;
  estimatedArrivalAt?: string;
  trackingToken?: string;
  trackingUrl?: string;
  driverPhone?: string;
  error?: string;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc(
      'start_or_update_order_delivery',
      {
        p_order_id: orderId,
        p_eta_minutes: etaMinutes,
        p_driver_phone: driverPhone.trim(),
        p_notes: notes?.trim() || null,
      }
    );

    if (error) {
      return { success: false, error: error.message };
    }

    const trackingToken = data?.tracking_token || undefined;
    return {
      success: data?.success === true,
      message: data?.message || 'بدأ التوصيل وتم تحديد وقت الوصول.',
      estimatedArrivalAt: data?.estimated_arrival_at || undefined,
      trackingToken,
      driverPhone: data?.driver_phone || undefined,
      trackingUrl: trackingToken
        ? buildStorefrontTrackingUrl(trackingToken)
        : undefined,
      error: data?.success === true ? undefined : data?.message,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'تعذر بدء توصيل الطلب.',
    };
  }
}

export interface OrderDeliveryAddressInput {
  governorate: string;
  city?: string;
  area: string;
  street?: string;
  building?: string;
  floor?: string;
  apartment?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  locationSource: 'gps' | 'map_pin' | 'manual';
  locationConfirmed: boolean;
}

export async function updateOrderDeliveryAddressInSupabase(
  orderId: string,
  address: OrderDeliveryAddressInput
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc(
      'update_order_delivery_address',
      {
        p_order_id: orderId,
        p_governorate: address.governorate,
        p_city: address.city || null,
        p_area: address.area,
        p_street: address.street || null,
        p_building: address.building || null,
        p_floor: address.floor || null,
        p_apartment: address.apartment || null,
        p_notes: address.notes || null,
        p_latitude: address.latitude ?? null,
        p_longitude: address.longitude ?? null,
        p_location_source: address.locationSource,
        p_location_confirmed: address.locationConfirmed,
      }
    );

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      message: data?.message || 'تم تحديث عنوان التوصيل بنجاح.',
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'تعذر تحديث عنوان التوصيل.',
    };
  }
}

export type OrderRealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface OrderRealtimeChange {
  eventType: OrderRealtimeEventType;
  orderIds: string[];
}

export function subscribeToOrdersInSupabase(
  onNewOrUpdatedOrder: (payload: OrderRealtimeChange) => void
) {
  if (!isSupabaseConfigured || !supabase) {
    return () => {};
  }

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingEventType: OrderRealtimeEventType | null = null;
  const pendingOrderIds = new Set<string>();

  const scheduleRefresh = (
    eventType: OrderRealtimeEventType,
    orderId?: string
  ) => {
    // An order transition can write the order and several accounting/inventory
    // records in quick succession. Keep the INSERT signal for the toast, but
    // let the list perform one refresh for the complete burst.
    if (eventType === 'INSERT' || !pendingEventType) {
      pendingEventType = eventType;
    }
    if (orderId) pendingOrderIds.add(orderId);
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (!pendingEventType) return;
      const payload: OrderRealtimeChange = {
        eventType: pendingEventType,
        orderIds: [...pendingOrderIds],
      };
      pendingEventType = null;
      pendingOrderIds.clear();
      refreshTimer = null;
      onNewOrUpdatedOrder(payload);
    }, 350);
  };

  const channel = supabase
    .channel(`public-orders-changes-${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      (payload) => {
        const eventType = payload.eventType;
        if (
          eventType === 'INSERT' ||
          eventType === 'UPDATE' ||
          eventType === 'DELETE'
        ) {
          const newRow = isRecord(payload.new) ? payload.new : {};
          const oldRow = isRecord(payload.old) ? payload.old : {};
          const orderId =
            typeof newRow.id === 'string'
              ? newRow.id
              : typeof oldRow.id === 'string'
                ? oldRow.id
                : undefined;
          scheduleRefresh(eventType, orderId);
        }
      }
    )
    .subscribe();

  return () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    void supabase.removeChannel(channel);
  };
}

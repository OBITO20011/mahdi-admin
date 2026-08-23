import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Order, OrderStatus, PaymentMethod, PaymentStatus } from '../../types';
import { calculateOrderAmountDue } from '../../utils/orderCalculations';

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

export async function fetchOrdersFromSupabase(
  filterStatus?: string,
  searchQuery?: string,
  scope: 'operational' | 'all' = 'operational'
): Promise<{ success: boolean; orders: Order[]; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      orders: [],
      error: 'لم يتم إعداد عميل Supabase بنجاح.',
    };
  }

  try {
    let query = supabase
      .from('orders')
      .select(`
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
      `)
      .order('created_at', { ascending: false });

    if (scope === 'operational') {
      query = query.or('source.is.null,source.neq.pos');
    }

    if (filterStatus && filterStatus !== 'all') {
      query = query.eq('status', filterStatus);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[fetchOrdersFromSupabase Error]:', error);
      return { success: false, orders: [], error: error.message };
    }

    if (!data) {
      return { success: true, orders: [] };
    }

    const mappedOrders: Order[] = data.map((ord: any) => {
      const cust = ord.customers || {};
      const addr = ord.customer_addresses || {};

      const items = (ord.order_items || []).map((item: any) => {
        const prod = item.products || {};
        const unitPrice = Number(item.unit_price_in_minor_units || 0) / 1000;
        const lineTotal = Number(item.line_total_in_minor_units || 0) / 1000;
        const costPrice = Number(prod.cost_price_in_minor_units || 0) / 1000;
        const packageQuantity = Number(item.sale_package_quantity || 0);
        const unitsPerSalePackage = Number(
          item.units_per_sale_package || 0
        );
        const isWholesaleSnapshot =
          packageQuantity > 0 && unitsPerSalePackage > 0;
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
          unitsPerSalePackage:
            unitsPerSalePackage || undefined,
          salePackage: isWholesaleSnapshot
            ? unitName
            : undefined,
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
      const amountPaid =
        Number(ord.amount_paid_in_minor_units || 0) / 1000;
      const salesReturn = Array.isArray(ord.sales_returns)
        ? ord.sales_returns[0]
        : ord.sales_returns;

      return {
        id: ord.id,
        orderNumber: ord.order_number,
        customerId: cust.id || ord.customer_id || undefined,
        customerName:
          cust.full_name || ord.customer_name_snapshot || 'زبون نقدي',
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
          ord.delivery_zone === 'inside_ramtha' ||
          ord.delivery_zone === 'outside_ramtha'
            ? ord.delivery_zone
            : undefined,
        discount: Number(ord.discount_in_minor_units || 0) / 1000,
        promotionCode: ord.promotion_code_snapshot || undefined,
        totalAmount,
        amountPaid,
        amountDue: calculateOrderAmountDue(totalAmount, amountPaid),
        paymentMethod: toPaymentMethod(ord.payment_method),
        paymentStatus: toPaymentStatus(ord.payment_status),
        paymentReferenceNumber:
          ord.payment_reference_number || undefined,
        paymentConfirmedAt: ord.payment_confirmed_at || undefined,
        paymentConfirmedBy: ord.payment_confirmed_by || undefined,
        cashShiftId: ord.cash_shift_id || undefined,
        returnNumber: salesReturn?.return_number || undefined,
        returnReason: salesReturn?.reason || undefined,
        returnStockDisposition:
          salesReturn?.stock_disposition || undefined,
        refundMethod: salesReturn?.refund_method || undefined,
        refundAmount: salesReturn
          ? Number(salesReturn.refund_amount_in_minor_units || 0) / 1000
          : undefined,
        refundReferenceNumber:
          salesReturn?.reference_number || undefined,
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

    // Apply client-side search query if present
    let filtered = mappedOrders;
    if (searchQuery && searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      filtered = mappedOrders.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.customerPhone.includes(q)
      );
    }

    return { success: true, orders: filtered };
  } catch (err: any) {
    console.error('[fetchOrdersFromSupabase Exception]:', err);
    return {
      success: false,
      orders: [],
      error: err?.message || 'حدث خطأ غير متوقع أثناء جلب الطلبات.',
    };
  }
}

export async function fetchOrderByIdFromSupabase(
  orderId: string
): Promise<{ success: boolean; order?: Order; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير غير معد.' };
  }

  try {
    const res = await fetchOrdersFromSupabase('all', undefined, 'all');
    if (!res.success) {
      return { success: false, error: res.error };
    }

    const order = res.orders.find((o) => o.id === orderId);
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

export function subscribeToOrdersInSupabase(
  onNewOrUpdatedOrder: (payload: any) => void
) {
  if (!isSupabaseConfigured || !supabase) {
    return () => {};
  }

  const channel = supabase
    .channel(`public-orders-changes-${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      (payload) => {
        console.log('[Supabase Realtime] Order event received:', payload);
        onNewOrUpdatedOrder(payload);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

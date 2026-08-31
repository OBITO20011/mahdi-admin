import {
  invokePublicEdgeFunction,
  isSupabaseConfigured,
  supabase,
} from '../lib/supabase';
import {
  GuestOrderReceipt,
  GuestOrderRequest,
  GuestOrderTracking,
  GuestPromotionQuote,
} from '../types/checkout';
import {
  buildDeliveryAddress,
  MAX_GUEST_DELIVERY_DETAILS_LENGTH,
  normalizeJordanPhone,
} from '../utils/checkout';

type RpcPayload = Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function integerValue(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.max(0, Math.round(numericValue))
    : 0;
}

export function mapGuestOrderReceipt(data: RpcPayload): GuestOrderReceipt {
  if (data.success !== true) {
    throw new Error(
      stringValue(data.message) || 'تعذر تسجيل الطلب في نظام الإدارة.'
    );
  }

  const orderNumber = stringValue(data.order_number);
  const orderId = stringValue(data.order_id);
  if (!orderNumber || !orderId) {
    throw new Error('تم استلام رد غير مكتمل عند إنشاء الطلب.');
  }

  return {
    success: true,
    id: orderId,
    orderNumber,
    customerId: stringValue(data.customer_id),
    customerAddressId: stringValue(data.customer_address_id),
    customerReused: data.customer_reused === true,
    idempotentReplay: data.idempotent_replay === true,
    subtotalInMinorUnits: integerValue(data.subtotal),
    discountInMinorUnits: integerValue(data.discount),
    totalInMinorUnits: integerValue(data.total),
    deliveryFeeInMinorUnits: integerValue(data.delivery_fee),
    deliveryZone:
      data.delivery_zone === 'outside_ramtha'
        ? 'outside_ramtha'
        : 'inside_ramtha',
    promotionCode: stringValue(data.promotion_code),
    status: stringValue(data.status) || 'new',
    paymentMethod:
      data.payment_method === 'cliq' ? 'cliq' : 'cash_on_delivery',
    trackingToken: stringValue(data.tracking_token) || undefined,
    trackingPath: stringValue(data.tracking_path) || undefined,
    message:
      stringValue(data.message) || 'تم تسجيل الطلب في نظام الإدارة بنجاح.',
  };
}

export function mapGuestPromotionQuote(
  data: RpcPayload
): GuestPromotionQuote {
  if (data.success !== true) {
    throw new Error(
      stringValue(data.message) || 'تعذر التحقق من رمز الخصم.'
    );
  }

  const code = stringValue(data.code);
  const promotionCodeId = stringValue(data.promotion_code_id);
  if (!code || !promotionCodeId) {
    throw new Error('تم استلام رد غير مكتمل عند التحقق من الخصم.');
  }

  return {
    success: true,
    promotionCodeId,
    code,
    description: stringValue(data.description),
    subtotalInMinorUnits: integerValue(data.subtotal),
    discountInMinorUnits: integerValue(data.discount),
    totalInMinorUnits: integerValue(data.total),
    message: stringValue(data.message) || 'تم تطبيق رمز الخصم.',
  };
}

export async function previewGuestPromotion(
  code: string,
  items: GuestOrderRequest['items'],
  customerPhone?: string
): Promise<GuestPromotionQuote> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
  }

  const normalizedPhone = customerPhone
    ? normalizeJordanPhone(customerPhone)
    : null;
  const { data, error } = await supabase.rpc(
    'preview_guest_promotion',
    {
      p_code: code,
      p_items: items,
      p_customer_phone: normalizedPhone,
    }
  );

  if (error) {
    throw new Error(error.message || 'تعذر التحقق من رمز الخصم.');
  }

  return mapGuestPromotionQuote((data || {}) as RpcPayload);
}

export async function submitGuestCustomerOrder(
  request: GuestOrderRequest
): Promise<GuestOrderReceipt> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
  }

  const normalizedPhone = normalizeJordanPhone(request.customer.phone);
  if (!normalizedPhone) {
    throw new Error('رقم الهاتف الأردني غير صحيح.');
  }

  const deliveryAddress = buildDeliveryAddress(request.customer);
  if (!deliveryAddress || deliveryAddress.length > MAX_GUEST_DELIVERY_DETAILS_LENGTH) {
    throw new Error(`تفاصيل العنوان والتوصيل يجب ألا تتجاوز ${MAX_GUEST_DELIVERY_DETAILS_LENGTH} حرفًا.`);
  }

  const data = await invokePublicEdgeFunction<RpcPayload>(
    'submit-guest-order',
    {
      idempotencyKey: request.idempotencyKey,
      turnstileToken: request.turnstileToken,
      clientSessionId: request.clientSessionId,
      customer: {
        ...request.customer,
        fullName: request.customer.fullName.trim(),
        phone: normalizedPhone,
        governorate: request.customer.governorate.trim(),
        city: request.customer.city.trim(),
        area: request.customer.area.trim(),
        street: deliveryAddress,
        building: request.customer.building.trim(),
        addressNotes: request.customer.addressNotes.trim(),
        googleMapsUrl: request.customer.googleMapsUrl.trim(),
        customerNotes: request.customer.customerNotes.trim(),
      },
      items: request.items,
      promotionCode: request.promotionCode?.trim() || null,
      paymentMethod: request.paymentMethod,
      deliveryZone: request.deliveryZone,
    }
  );

  return mapGuestOrderReceipt(data);
}

function mapGuestOrderTracking(payload: RpcPayload): GuestOrderTracking {
  if (payload.success !== true) {
    throw new Error(stringValue(payload.message) || 'لم نعثر على الطلب بهذه البيانات.');
  }

  const rawTimeline = Array.isArray(payload.timeline) ? payload.timeline : [];
  return {
    success: true,
    orderNumber: stringValue(payload.order_number),
    status: stringValue(payload.status),
    paymentMethod:
      payload.payment_method === 'cliq' ? 'cliq' : 'cash_on_delivery',
    paymentStatus: stringValue(payload.payment_status) || 'unpaid',
    totalInMinorUnits: integerValue(payload.total),
    itemCount: integerValue(payload.item_count),
    createdAt: stringValue(payload.created_at),
    updatedAt: stringValue(payload.updated_at),
    trackingToken: stringValue(payload.tracking_token),
    trackingPath: stringValue(payload.tracking_path),
    deliveryStartedAt: stringValue(payload.delivery_started_at) || undefined,
    estimatedArrivalAt:
      stringValue(payload.estimated_arrival_at) || undefined,
    deliveryCompletedAt:
      stringValue(payload.delivery_completed_at) || undefined,
    driverPhone: stringValue(payload.driver_phone) || undefined,
    timeline: rawTimeline.map((entry) => {
      const value = (entry || {}) as RpcPayload;
      return {
        status: stringValue(value.status),
        createdAt: stringValue(value.created_at),
      };
    }),
  };
}

export async function trackGuestOrder(
  orderNumber: string,
  phone: string
): Promise<GuestOrderTracking> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
  }

  const normalizedPhone = normalizeJordanPhone(phone);
  if (!normalizedPhone) throw new Error('رقم الهاتف الأردني غير صحيح.');

  const { data, error } = await supabase.rpc('track_guest_order', {
    p_order_number: orderNumber.trim().toUpperCase(),
    p_customer_phone: normalizedPhone,
  });
  if (error) throw new Error(error.message || 'تعذر متابعة الطلب.');
  return mapGuestOrderTracking((data || {}) as RpcPayload);
}

export async function trackGuestOrderByToken(
  trackingToken: string
): Promise<GuestOrderTracking> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
  }

  const { data, error } = await supabase.rpc('track_guest_order_by_token', {
    p_tracking_token: trackingToken.trim(),
  });
  if (error) throw new Error(error.message || 'تعذر فتح رابط متابعة الطلب.');
  return mapGuestOrderTracking((data || {}) as RpcPayload);
}

import { CartItem } from '../types/catalog';
import {
  CheckoutErrors,
  DeliveryZone,
  GuestCheckoutForm,
  GuestOrderItem,
  GuestOrderReceipt,
  GuestPaymentMethod,
  LastGuestOrder,
  PendingGuestOrder,
  SavedGuestCustomer,
  WhatsAppOrderSummary,
} from '../types/checkout';
import { formatJod } from './money';

export const PENDING_ORDER_STORAGE_KEY =
  'nawasrah-guest-order-request-v1';
export const SAVED_CUSTOMER_STORAGE_KEY = 'nawasrah-saved-customer-v1';
export const LAST_ORDER_STORAGE_KEY = 'nawasrah-last-order-v1';
export const GUEST_ORDER_SESSION_STORAGE_KEY =
  'nawasrah-guest-order-session-v1';
/**
 * Kept in sync with the Edge gateway and PostgreSQL checkout core.
 */
export const MAX_GUEST_ORDER_LINE_ITEMS = 50;
/**
 * Matches the public checkout RPC validation for p_street. Keeping this in
 * the browser prevents a long delivery instruction from being cut off by the
 * gateway before it reaches PostgreSQL.
 */
export const MAX_GUEST_DELIVERY_DETAILS_LENGTH = 300;

const PENDING_ORDER_TTL_MS = 24 * 60 * 60 * 1000;
export const SAVED_GUEST_CUSTOMER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const EMPTY_GUEST_CHECKOUT_FORM: GuestCheckoutForm = {
  fullName: '',
  phone: '',
  governorate: 'إربد',
  city: 'الرمثا',
  area: '',
  street: '',
  building: '',
  addressNotes: '',
  googleMapsUrl: '',
  latitude: null,
  longitude: null,
  customerNotes: '',
};

export function buildGoogleMapsUrl(
  latitude: number,
  longitude: number
): string {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error('إحداثيات الموقع غير صحيحة.');
  }
  return `https://www.google.com/maps?q=${latitude.toFixed(
    6
  )},${longitude.toFixed(6)}`;
}

export function isSupportedGoogleMapsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return false;

    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host === 'maps.app.goo.gl') return true;
    if (host === 'goo.gl') return path.startsWith('/maps');
    if (host === 'maps.google.com' || host.startsWith('maps.google.')) {
      return true;
    }
    return (
      (host === 'google.com' ||
        host === 'www.google.com' ||
        /^www\.google\.[a-z.]+$/.test(host) ||
        /^google\.[a-z.]+$/.test(host)) &&
      path.startsWith('/maps')
    );
  } catch {
    return false;
  }
}

export interface GoogleMapsCoordinates {
  latitude: number;
  longitude: number;
}

function validCoordinates(
  latitude: number,
  longitude: number
): GoogleMapsCoordinates | null {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

/**
 * Reads coordinates from non-shortened Google Maps share URLs. Short links
 * remain valid and clickable, but cannot be confirmed without resolving their
 * redirect on Google's servers.
 */
export function extractGoogleMapsCoordinates(
  value: string
): GoogleMapsCoordinates | null {
  if (!isSupportedGoogleMapsUrl(value)) return null;

  try {
    const url = new URL(value.trim());
    const queryValue =
      url.searchParams.get('q') || url.searchParams.get('query');
    const queryMatch = queryValue?.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
    );

    if (queryMatch) {
      return validCoordinates(Number(queryMatch[1]), Number(queryMatch[2]));
    }

    const pathMatch = decodeURIComponent(url.pathname).match(
      /\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/|$)/
    );

    if (pathMatch) {
      return validCoordinates(Number(pathMatch[1]), Number(pathMatch[2]));
    }
  } catch {
    return null;
  }

  return null;
}

export function normalizePromotionCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeJordanPhone(phone: string): string | null {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00962')) digits = digits.slice(2);
  if (digits.startsWith('962')) digits = `0${digits.slice(3)}`;
  if (/^7\d{8}$/.test(digits)) digits = `0${digits}`;
  return /^07[789]\d{7}$/.test(digits) ? digits : null;
}

export function validateGuestCheckout(
  form: GuestCheckoutForm
): CheckoutErrors {
  const errors: CheckoutErrors = {};
  const fullName = form.fullName.trim();
  if (fullName.length < 2) {
    errors.fullName = 'اكتب اسمك الكامل.';
  } else if (fullName.length > 120) {
    errors.fullName = 'الاسم أطول من المسموح.';
  }

  if (!normalizeJordanPhone(form.phone)) {
    errors.phone = 'أدخل رقمًا أردنيًا صحيحًا مثل 0791234567.';
  }

  if (!form.governorate.trim()) errors.governorate = 'اختر المحافظة.';
  if (!form.city.trim()) errors.city = 'اكتب المدينة.';
  if (!form.area.trim()) errors.area = 'اكتب المنطقة أو الحي.';
  if (!form.street.trim()) errors.street = 'اكتب تفاصيل العنوان.';
  else if (form.street.trim().length > MAX_GUEST_DELIVERY_DETAILS_LENGTH) {
    errors.street = `تفاصيل العنوان والتوصيل يجب ألا تتجاوز ${MAX_GUEST_DELIVERY_DETAILS_LENGTH} حرفًا.`;
  }

  const mapsUrl = form.googleMapsUrl.trim();
  if (mapsUrl && !isSupportedGoogleMapsUrl(mapsUrl)) {
    errors.googleMapsUrl = 'ألصق رابط مشاركة صحيحًا من خرائط Google.';
  }

  if ((form.latitude === null) !== (form.longitude === null)) {
    errors.googleMapsUrl = 'أعد تحديد الموقع الحالي بشكل كامل.';
  }

  if (
    form.latitude !== null &&
    form.longitude !== null &&
    (
      !Number.isFinite(form.latitude) ||
      !Number.isFinite(form.longitude) ||
      form.latitude < -90 ||
      form.latitude > 90 ||
      form.longitude < -180 ||
      form.longitude > 180
    )
  ) {
    errors.googleMapsUrl = 'إحداثيات الموقع الحالي غير صحيحة.';
  }

  return errors;
}

export function buildGuestOrderItems(
  cartItems: CartItem[]
): GuestOrderItem[] {
  return cartItems.map((item) => ({
    product_id: item.productId,
    quantity: Math.max(1, Math.floor(item.quantity)),
  }));
}

function fingerprintHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createOrderFingerprint(
  form: GuestCheckoutForm,
  cartItems: CartItem[],
  promotionCode = '',
  paymentMethod: GuestPaymentMethod = 'cash_on_delivery',
  deliveryZone: DeliveryZone = 'inside_ramtha'
): string {
  const normalized = {
    customer: {
      fullName: form.fullName.trim(),
      phone: normalizeJordanPhone(form.phone) || form.phone.trim(),
      governorate: form.governorate.trim(),
      city: form.city.trim(),
      area: form.area.trim(),
      street: form.street.trim(),
      building: form.building.trim(),
      addressNotes: form.addressNotes.trim(),
      googleMapsUrl: form.googleMapsUrl.trim(),
      latitude: form.latitude,
      longitude: form.longitude,
      customerNotes: form.customerNotes.trim(),
    },
    promotionCode: normalizePromotionCode(promotionCode),
    paymentMethod,
    deliveryZone,
    items: buildGuestOrderItems(cartItems).sort((first, second) =>
      first.product_id.localeCompare(second.product_id)
    ),
  };

  return fingerprintHash(JSON.stringify(normalized));
}

export function readSavedGuestCustomer(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  now = Date.now()
): GuestCheckoutForm | null {
  try {
    const raw = storage.getItem(SAVED_CUSTOMER_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedGuestCustomer;
    if (
      saved.version !== 2 ||
      !saved.customer ||
      typeof saved.customer !== 'object' ||
      Array.isArray(saved.customer) ||
      !Number.isFinite(saved.expiresAt) ||
      saved.expiresAt <= now
    ) {
      storage.removeItem(SAVED_CUSTOMER_STORAGE_KEY);
      return null;
    }
    return { ...EMPTY_GUEST_CHECKOUT_FORM, ...saved.customer };
  } catch {
    storage.removeItem(SAVED_CUSTOMER_STORAGE_KEY);
    return null;
  }
}

export function saveGuestCustomer(
  storage: Pick<Storage, 'setItem'>,
  customer: GuestCheckoutForm,
  now = Date.now()
): void {
  const saved: SavedGuestCustomer = {
    version: 2,
    customer: { ...customer },
    savedAt: now,
    expiresAt: now + SAVED_GUEST_CUSTOMER_TTL_MS,
  };
  storage.setItem(SAVED_CUSTOMER_STORAGE_KEY, JSON.stringify(saved));
}

export function clearSavedGuestCustomer(
  storage: Pick<Storage, 'removeItem'>
): void {
  storage.removeItem(SAVED_CUSTOMER_STORAGE_KEY);
}

export function readLastGuestOrder(
  storage: Pick<Storage, 'getItem'>
): LastGuestOrder | null {
  try {
    const raw = storage.getItem(LAST_ORDER_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as LastGuestOrder;
    if (saved.version !== 1 || !Array.isArray(saved.items)) return null;
    return saved;
  } catch {
    return null;
  }
}

export function saveLastGuestOrder(
  storage: Pick<Storage, 'setItem'>,
  orderNumber: string,
  items: CartItem[]
): LastGuestOrder {
  const saved: LastGuestOrder = {
    version: 1,
    orderNumber,
    items: items.map((item) => ({
      productId: item.productId,
      quantity: Math.max(1, Math.floor(item.quantity)),
    })),
    createdAt: Date.now(),
  };
  storage.setItem(LAST_ORDER_STORAGE_KEY, JSON.stringify(saved));
  return saved;
}

export function createPromotionContextKey(
  phone: string,
  cartItems: CartItem[]
): string {
  return fingerprintHash(
    JSON.stringify({
      phone: normalizeJordanPhone(phone) || phone.replace(/\s+/g, '').trim(),
      items: buildGuestOrderItems(cartItems).sort((first, second) =>
        first.product_id.localeCompare(second.product_id)
      ),
    })
  );
}

function generateRequestKey(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.randomUUID !== 'function') {
    throw new Error('المتصفح لا يدعم إنشاء مفتاح آمن للطلب.');
  }
  return cryptoApi.randomUUID();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function getOrCreateGuestOrderSessionId(
  storage: Pick<Storage, 'getItem' | 'setItem'>
): string {
  try {
    const existing = storage.getItem(GUEST_ORDER_SESSION_STORAGE_KEY);
    if (existing && isUuid(existing)) return existing;
  } catch {
    // Continue with a fresh opaque session identifier when storage is blocked.
  }

  const sessionId = generateRequestKey();
  try {
    storage.setItem(GUEST_ORDER_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // The current request can still use the in-memory identifier.
  }
  return sessionId;
}

export function getOrCreateIdempotencyKey(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  fingerprint: string,
  now = Date.now()
): string {
  try {
    const storedValue = storage.getItem(PENDING_ORDER_STORAGE_KEY);
    if (storedValue) {
      const pending = JSON.parse(storedValue) as PendingGuestOrder;
      if (
        pending.fingerprint === fingerprint &&
        typeof pending.idempotencyKey === 'string' &&
        now - pending.createdAt < PENDING_ORDER_TTL_MS
      ) {
        return pending.idempotencyKey;
      }
    }
  } catch {
    // A blocked or corrupted storage entry must not block checkout.
  }

  const idempotencyKey = generateRequestKey();
  const pending: PendingGuestOrder = {
    fingerprint,
    idempotencyKey,
    createdAt: now,
  };
  storage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify(pending));
  return idempotencyKey;
}

export function clearPendingOrder(
  storage: Pick<Storage, 'removeItem'>
): void {
  storage.removeItem(PENDING_ORDER_STORAGE_KEY);
}

export function buildWhatsAppOrderMessage({
  receipt,
  customer,
  items,
  paymentMethod,
}: WhatsAppOrderSummary): string {
  const itemLines = items.map(
    (item) =>
      `• ${item.nameAr} — ${item.quantity} ${item.saleUnitNameAr} × ${formatJod(
        item.unitPriceInMinorUnits
      )}`
  );
  const address = [
    customer.governorate,
    customer.city,
    customer.area,
    customer.street,
    customer.building,
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(' - ');

  return [
    '🛒 *طلب جملة جديد من الموقع*',
    `رقم الطلب: *${receipt.orderNumber}*`,
    'تم حفظ الطلب في النظام؛ يرجى مراجعته وتأكيده من تطبيق الإدارة.',
    '',
    `📦 *الأصناف (${items.length})*`,
    ...itemLines,
    '',
    receipt.discountInMinorUnits > 0
      ? `المجموع قبل الخصم: ${formatJod(receipt.subtotalInMinorUnits)}`
      : '',
    receipt.discountInMinorUnits > 0
      ? `الخصم${receipt.promotionCode ? ` (${receipt.promotionCode})` : ''}: -${formatJod(
          receipt.discountInMinorUnits
        )}`
      : '',
    '🚚 *التوصيل والتحصيل*',
    `منطقة التوصيل: ${receipt.deliveryZone === 'inside_ramtha' ? 'داخل الرمثا' : 'خارج الرمثا'}`,
    `أجرة التوصيل: ${formatJod(receipt.deliveryFeeInMinorUnits)}`,
    `طريقة الدفع: ${paymentMethod === 'cliq' ? 'CliQ' : 'كاش عند الاستلام'}`,
    `💰 *الإجمالي المطلوب: ${formatJod(receipt.totalInMinorUnits)}*`,
    '',
    '👤 *بيانات العميل*',
    `الاسم: ${customer.fullName.trim()}`,
    `الهاتف: ${normalizeJordanPhone(customer.phone) || customer.phone.trim()}`,
    `العنوان: ${address}`,
    customer.googleMapsUrl.trim()
      ? `الموقع: ${customer.googleMapsUrl.trim()}`
      : '',
    customer.customerNotes.trim()
      ? `ملاحظات: ${customer.customerNotes.trim()}`
      : '',
    '',
    'يرجى تأكيد الطلب للعميل، شكرًا.',
  ]
    .filter((line, index, allLines) => line !== '' || allLines[index - 1] !== '')
    .join('\n');
}

export function normalizeWhatsAppRecipient(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('00962')) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) {
    return `962${digits.slice(1)}`;
  }
  return digits;
}

export function buildWhatsAppUrl(
  recipient: string,
  message: string
): string {
  const normalizedRecipient = normalizeWhatsAppRecipient(recipient);
  const baseUrl = normalizedRecipient
    ? `https://wa.me/${normalizedRecipient}`
    : 'https://wa.me/';
  return `${baseUrl}?text=${encodeURIComponent(message)}`;
}

export function isSuccessfulReceipt(
  receipt: GuestOrderReceipt | null
): receipt is GuestOrderReceipt {
  return Boolean(receipt?.success && receipt.orderNumber);
}

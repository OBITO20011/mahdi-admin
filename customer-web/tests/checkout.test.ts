import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { STORE_PUBLIC_CONFIG } from '../src/config/store';
import {
  mapGuestOrderReceipt,
  mapGuestPromotionQuote,
} from '../src/services/orders.service';
import { CartItem } from '../src/types/catalog';
import {
  EMPTY_GUEST_CHECKOUT_FORM,
  SAVED_CUSTOMER_STORAGE_KEY,
  SAVED_GUEST_CUSTOMER_TTL_MS,
  PENDING_ORDER_STORAGE_KEY,
  GUEST_ORDER_SESSION_STORAGE_KEY,
  MAX_GUEST_ORDER_LINE_ITEMS,
  MAX_GUEST_DELIVERY_DETAILS_LENGTH,
  buildGuestOrderItems,
  buildGoogleMapsUrl,
  buildWhatsAppOrderMessage,
  buildWhatsAppUrl,
  createOrderFingerprint,
  createPromotionContextKey,
  extractGoogleMapsCoordinates,
  readSavedGuestCustomer,
  saveGuestCustomer,
  clearSavedGuestCustomer,
  readLastGuestOrder,
  saveLastGuestOrder,
  getOrCreateIdempotencyKey,
  buildDeliveryAddress,
  getOrCreateGuestOrderSessionId,
  isSupportedGoogleMapsUrl,
  normalizeJordanPhone,
  normalizePromotionCode,
  validateGuestCheckout,
} from '../src/utils/checkout';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) || null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const cartItems: CartItem[] = [
  {
    productId: '11111111-1111-4111-8111-111111111111',
    sku: 'NWS-1001',
    nameAr: 'بيبسي',
    imageUrl: '',
    saleUnitNameAr: 'كرتونة',
    unitsPerSalePackage: 12,
    unitPriceInMinorUnits: 5400,
    quantity: 2,
    maxAvailablePackages: 3,
  },
];

const validForm = {
  ...EMPTY_GUEST_CHECKOUT_FORM,
  fullName: 'محمد أحمد',
  phone: '0791234567',
  area: 'الحي الشرقي',
  street: 'شارع الجامعة بجانب الصيدلية',
};

test('Jordan phone formats resolve to one guest customer identity', () => {
  assert.equal(normalizeJordanPhone('0791234567'), '0791234567');
  assert.equal(normalizeJordanPhone('+962 79 123 4567'), '0791234567');
  assert.equal(normalizeJordanPhone('962791234567'), '0791234567');
  assert.equal(normalizeJordanPhone('791234567'), '0791234567');
  assert.equal(normalizeJordanPhone('061234567'), null);
});

test('guest checkout requires identity and a structured deliverable address', () => {
  assert.deepEqual(validateGuestCheckout(validForm), {});
  const errors = validateGuestCheckout({
    ...validForm,
    fullName: '',
    phone: '123',
    area: '',
    street: '',
  });
  assert.ok(errors.fullName);
  assert.ok(errors.phone);
  assert.ok(errors.area);
  assert.equal(errors.street, undefined);
});

test('delivery details use the RPC length limit before the request is sent', () => {
  assert.equal(MAX_GUEST_DELIVERY_DETAILS_LENGTH, 300);
  const baseAddressLength = buildDeliveryAddress({...validForm, street: ''}).length;
  const maxOptionalDetailsLength = MAX_GUEST_DELIVERY_DETAILS_LENGTH - baseAddressLength - 3;
  assert.deepEqual(
    validateGuestCheckout({
      ...validForm,
      street: 'أ'.repeat(maxOptionalDetailsLength),
    }),
    {}
  );
  assert.match(
    validateGuestCheckout({
      ...validForm,
      street: 'أ'.repeat(maxOptionalDetailsLength + 1),
    }).street || '',
    /300/
  );
});

test('delivery details are optional while the structured address remains canonical', () => {
  const withoutDetails = {...validForm, street: ''};
  assert.equal(buildDeliveryAddress(withoutDetails), 'إربد - الرمثا - الحي الشرقي');
  assert.deepEqual(validateGuestCheckout(withoutDetails), {});
  assert.equal(buildDeliveryAddress({...withoutDetails, street: 'بناية 12، اتصل قبل الوصول'}), 'إربد - الرمثا - الحي الشرقي - بناية 12، اتصل قبل الوصول');
});

test('current GPS coordinates produce a stable Google Maps link', () => {
  assert.equal(
    buildGoogleMapsUrl(32.55812, 36.008742),
    'https://www.google.com/maps?q=32.558120,36.008742'
  );
  assert.throws(() => buildGoogleMapsUrl(120, 36), /إحداثيات/);
});

test('delivery location accepts Google Maps sharing links and rejects arbitrary URLs', () => {
  assert.equal(
    isSupportedGoogleMapsUrl('https://maps.app.goo.gl/AbCdEf123'),
    true
  );
  assert.equal(
    isSupportedGoogleMapsUrl('https://www.google.com/maps?q=32.55,36.00'),
    true
  );
  assert.equal(
    isSupportedGoogleMapsUrl('https://maps.google.com/?q=32.55,36.00'),
    true
  );
  assert.equal(isSupportedGoogleMapsUrl('https://example.com/maps'), false);

  assert.ok(
    validateGuestCheckout({
      ...validForm,
      googleMapsUrl: 'https://example.com/maps',
    }).googleMapsUrl
  );
});

test('direct Google Maps links expose exact coordinates for confirmed delivery', () => {
  assert.deepEqual(
    extractGoogleMapsCoordinates(
      'https://maps.google.com/?q=32.558120,36.008742'
    ),
    { latitude: 32.55812, longitude: 36.008742 }
  );
  assert.deepEqual(
    extractGoogleMapsCoordinates(
      'https://www.google.com/maps/place/Ramtha/@32.558120,36.008742,16z'
    ),
    { latitude: 32.55812, longitude: 36.008742 }
  );
  assert.equal(
    extractGoogleMapsCoordinates('https://maps.app.goo.gl/AbCdEf123'),
    null
  );
});

test('guest order sends wholesale package counts only', () => {
  assert.deepEqual(buildGuestOrderItems(cartItems), [
    {
      product_id: '11111111-1111-4111-8111-111111111111',
      quantity: 2,
    },
  ]);
});

test('guest checkout exposes the same 50-line-item limit as the server gateway', () => {
  assert.equal(MAX_GUEST_ORDER_LINE_ITEMS, 50);
});

test('the same pending checkout reuses one idempotency key', () => {
  const storage = new MemoryStorage();
  const fingerprint = createOrderFingerprint(validForm, cartItems);
  const firstKey = getOrCreateIdempotencyKey(
    storage as unknown as Storage,
    fingerprint,
    1000
  );
  const secondKey = getOrCreateIdempotencyKey(
    storage as unknown as Storage,
    fingerprint,
    2000
  );
  assert.equal(firstKey, secondKey);
  assert.match(
    storage.getItem(PENDING_ORDER_STORAGE_KEY) || '',
    /"fingerprint":"[0-9a-f]{8}"/
  );
  assert.doesNotMatch(
    storage.getItem(PENDING_ORDER_STORAGE_KEY) || '',
    /محمد|0791234567/
  );
});

test('guest order session ID is opaque, stable per session and contains no customer data', () => {
  const storage = new MemoryStorage();
  const first = getOrCreateGuestOrderSessionId(
    storage as unknown as Storage
  );
  const second = getOrCreateGuestOrderSessionId(
    storage as unknown as Storage
  );
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f-]{36}$/i);
  assert.equal(storage.getItem(GUEST_ORDER_SESSION_STORAGE_KEY), first);
  assert.doesNotMatch(first, /محمد|0791234567/);
});

test('payment choice changes the protected order fingerprint', () => {
  assert.notEqual(
    createOrderFingerprint(validForm, cartItems, '', 'cash_on_delivery'),
    createOrderFingerprint(validForm, cartItems, '', 'cliq')
  );
});

test('delivery zone changes the protected order fingerprint', () => {
  assert.notEqual(
    createOrderFingerprint(validForm, cartItems, '', 'cash_on_delivery', 'inside_ramtha'),
    createOrderFingerprint(validForm, cartItems, '', 'cash_on_delivery', 'outside_ramtha')
  );
});

test('saved customer data and last order stay optional on this device', () => {
  const storage = new MemoryStorage();
  saveGuestCustomer(storage as unknown as Storage, validForm);
  assert.equal(readSavedGuestCustomer(storage as unknown as Storage)?.phone, '0791234567');
  clearSavedGuestCustomer(storage as unknown as Storage);
  assert.equal(readSavedGuestCustomer(storage as unknown as Storage), null);

  saveLastGuestOrder(storage as unknown as Storage, 'ORD-2026-001', cartItems);
  assert.equal(readLastGuestOrder(storage as unknown as Storage)?.items[0].quantity, 2);
});

test('saved customer details expire after thirty days and are removed', () => {
  const storage = new MemoryStorage();
  const savedAt = 1_700_000_000_000;
  saveGuestCustomer(storage as unknown as Storage, validForm, savedAt);

  const raw = storage.getItem(SAVED_CUSTOMER_STORAGE_KEY);
  assert.ok(raw);
  assert.equal(JSON.parse(raw).version, 2);
  assert.equal(JSON.parse(raw).expiresAt, savedAt + SAVED_GUEST_CUSTOMER_TTL_MS);
  assert.equal(
    readSavedGuestCustomer(storage as unknown as Storage, savedAt + SAVED_GUEST_CUSTOMER_TTL_MS - 1)?.phone,
    validForm.phone,
  );
  assert.equal(
    readSavedGuestCustomer(storage as unknown as Storage, savedAt + SAVED_GUEST_CUSTOMER_TTL_MS),
    null,
  );
  assert.equal(storage.getItem(SAVED_CUSTOMER_STORAGE_KEY), null);
});

test('legacy or malformed saved customer storage fails closed and is removed', () => {
  const storage = new MemoryStorage();
  storage.setItem(SAVED_CUSTOMER_STORAGE_KEY, JSON.stringify({ version: 1, customer: validForm, savedAt: Date.now() }));
  assert.equal(readSavedGuestCustomer(storage as unknown as Storage), null);
  assert.equal(storage.getItem(SAVED_CUSTOMER_STORAGE_KEY), null);

  storage.setItem(SAVED_CUSTOMER_STORAGE_KEY, '{not-json');
  assert.equal(readSavedGuestCustomer(storage as unknown as Storage), null);
  assert.equal(storage.getItem(SAVED_CUSTOMER_STORAGE_KEY), null);
});

test('saved customer storage stays absent when consent is revoked or never given', () => {
  const storage = new MemoryStorage();
  assert.equal(storage.getItem(SAVED_CUSTOMER_STORAGE_KEY), null);
  saveGuestCustomer(storage as unknown as Storage, validForm);
  clearSavedGuestCustomer(storage as unknown as Storage);
  assert.equal(storage.getItem(SAVED_CUSTOMER_STORAGE_KEY), null);
});

test('successful RPC data maps to a stable order receipt', () => {
  const receipt = mapGuestOrderReceipt({
    success: true,
    order_id: 'order-id',
    order_number: 'ORD-2026-001',
    customer_id: 'customer-id',
    customer_address_id: 'address-id',
    customer_reused: true,
    idempotent_replay: false,
    subtotal: 10800,
    total: 10800,
    discount: 0,
    delivery_fee: 2000,
    delivery_zone: 'outside_ramtha',
    status: 'new',
    message: 'تم إنشاء الطلب',
  });
  assert.equal(receipt.orderNumber, 'ORD-2026-001');
  assert.equal(receipt.totalInMinorUnits, 10800);
  assert.equal(receipt.customerReused, true);
  assert.equal(receipt.deliveryFeeInMinorUnits, 2000);
  assert.equal(receipt.deliveryZone, 'outside_ramtha');
});

test('promotion preview uses the server-calculated discount and total', () => {
  const quote = mapGuestPromotionQuote({
    success: true,
    promotion_code_id: 'promotion-id',
    code: 'WELCOME10',
    description: 'خصم الافتتاح',
    subtotal: 10800,
    discount: 1080,
    total: 9720,
  });
  assert.equal(quote.code, 'WELCOME10');
  assert.equal(quote.discountInMinorUnits, 1080);
  assert.equal(quote.totalInMinorUnits, 9720);
  assert.equal(normalizePromotionCode(' welcome10 '), 'WELCOME10');
});

test('promotion quote context changes with phone or cart quantity', () => {
  const first = createPromotionContextKey(validForm.phone, cartItems);
  const sameNormalizedPhone = createPromotionContextKey(
    '+962 79 123 4567',
    cartItems
  );
  const changedQuantity = createPromotionContextKey(validForm.phone, [
    { ...cartItems[0], quantity: 3 },
  ]);

  assert.equal(first, sameNormalizedPhone);
  assert.notEqual(first, changedQuantity);
});

test('WhatsApp opens only with the saved order number and summary', () => {
  const receipt = mapGuestOrderReceipt({
    success: true,
    order_id: 'order-id',
    order_number: 'ORD-2026-001',
    total: 10800,
    subtotal: 12000,
    discount: 1200,
    delivery_fee: 2000,
    delivery_zone: 'outside_ramtha',
    promotion_code: 'WELCOME10',
  });
  const message = buildWhatsAppOrderMessage({
    receipt,
    customer: validForm,
    items: cartItems,
    paymentMethod: 'cliq',
  });
  const url = buildWhatsAppUrl('0799999999', message);
  assert.match(message, /ORD-2026-001/);
  assert.match(message, /طلب جملة جديد من الموقع/);
  assert.match(message, /الأصناف \(1\)/);
  assert.match(message, /بيبسي — 2 كرتونة/);
  assert.match(message, /الخصم \(WELCOME10\)/);
  assert.match(message, /طريقة الدفع: CliQ/);
  assert.match(message, /منطقة التوصيل: خارج الرمثا/);
  assert.match(message, /أجرة التوصيل/);
  assert.match(message, /الإجمالي المطلوب/);
  assert.match(url, /^https:\/\/wa\.me\/962799999999\?text=/);
});

test('store WhatsApp contact targets the configured temporary number', () => {
  const url = buildWhatsAppUrl(
    STORE_PUBLIC_CONFIG.WHATSAPP_NUMBER,
    'طلب محفوظ'
  );
  assert.match(url, /^https:\/\/wa\.me\/962772838886\?text=/);
});

test('guest RPC is a guarded wrapper around canonical order creation', () => {
  const migration = readFileSync(
    new URL(
      '../../supabase/migrations/029_guest_promotions_and_gps.sql',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.submit_guest_customer_order/
  );
  assert.match(
    migration,
    /v_result := public\.create_customer_order/
  );
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /INTERVAL '10 minutes'/);
  assert.match(migration, /TO anon, authenticated/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.promotion_codes/);
  assert.match(migration, /public\._calculate_guest_promotion/);
  assert.match(migration, /p_latitude DOUBLE PRECISION/);
  assert.match(migration, /FOR UPDATE/);
  assert.doesNotMatch(
    migration,
    /UPDATE public\.inventory_balances|INSERT INTO public\.order_items/
  );
});

test('latest security migration makes the guest mutation service-only', () => {
  const migration = readFileSync(
    new URL(
      '../../supabase/migrations/086_guest_order_abuse_gateway.sql',
      import.meta.url
    ),
    'utf8'
  );
  const service = readFileSync(
    new URL('../src/services/orders.service.ts', import.meta.url),
    'utf8'
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.submit_guest_customer_order[\s\S]*FROM PUBLIC, anon, authenticated/
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.submit_guest_customer_order[\s\S]*TO service_role/
  );
  assert.match(service, /'submit-guest-order'/);
  assert.doesNotMatch(
    service,
    /supabase\.rpc\(\s*['"]submit_guest_customer_order['"]/
  );
});

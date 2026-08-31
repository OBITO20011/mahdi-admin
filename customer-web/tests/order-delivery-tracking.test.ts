import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');
const service = readFileSync('src/services/orders.service.ts', 'utf8');
const trackingModal = readFileSync(
  'src/components/OrderTrackingModal.tsx',
  'utf8'
);
const checkoutModal = readFileSync('src/components/CheckoutModal.tsx', 'utf8');
const receiptType = readFileSync('src/types/checkout.ts', 'utf8');

test('secure tracking links open without customer login', () => {
  assert.match(app, /#track=/);
  assert.match(app, /trackingToken=\{trackingToken\}/);
  assert.match(service, /rpc\('track_guest_order_by_token'/);
  assert.match(service, /p_tracking_token/);
});

test('customer tracking renders only actual canonical status history and has an explicit refresh', () => {
  for (const status of [
    'new',
    'pending_confirmation',
    'confirmed',
    'preparing',
    'processing',
    'ready',
    'out_for_delivery',
    'delivered',
    'completed',
    'returned',
    'cancelled',
  ]) {
    assert.match(trackingModal, new RegExp(`\\b${status}\\b`));
  }
  assert.match(trackingModal, /estimatedArrivalAt/);
  assert.match(trackingModal, /متبقي تقريبًا/);
  assert.match(trackingModal, /visibleTimeline/);
  assert.match(trackingModal, /تحديث الحالة/);
  assert.doesNotMatch(trackingModal, /setInterval/);
  assert.doesNotMatch(trackingModal, /30_000/);
});

test('successful checkout keeps the opaque tracking capability and offers a direct tracking action', () => {
  assert.match(receiptType, /trackingToken\?: string/);
  assert.match(service, /trackingToken: stringValue\(data\.tracking_token\)/);
  assert.match(checkoutModal, /onTrackOrder: \(receipt: GuestOrderReceipt\) => void/);
  assert.match(checkoutModal, /متابعة الطلب/);
});

test('public tracking screen does not render customer private information', () => {
  assert.doesNotMatch(
    trackingModal,
    /customerPhone|customerAddress|googleMapsUrl|latitude|longitude/
  );
});

test('customer can contact the assigned driver from the secure tracking page', () => {
  assert.match(service, /driverPhone: stringValue\(payload\.driver_phone\)/);
  assert.match(trackingModal, /رقم السائق المسؤول عن توصيل طلبك/);
  assert.match(trackingModal, /اتصال بالسائق/);
  assert.match(trackingModal, /واتساب السائق/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');
const service = readFileSync('src/services/orders.service.ts', 'utf8');
const trackingModal = readFileSync(
  'src/components/OrderTrackingModal.tsx',
  'utf8'
);

test('secure tracking links open without customer login', () => {
  assert.match(app, /#track=/);
  assert.match(app, /trackingToken=\{trackingToken\}/);
  assert.match(service, /rpc\('track_guest_order_by_token'/);
  assert.match(service, /p_tracking_token/);
});

test('customer tracking shows canonical stages and ETA with automatic refresh', () => {
  for (const status of [
    'new',
    'confirmed',
    'preparing',
    'ready',
    'out_for_delivery',
    'completed',
  ]) {
    assert.match(trackingModal, new RegExp(`'${status}'`));
  }
  assert.match(trackingModal, /estimatedArrivalAt/);
  assert.match(trackingModal, /متبقي تقريبًا/);
  assert.match(trackingModal, /30_000/);
  assert.match(trackingModal, /تتحدث حالة الطلب تلقائيًا/);
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

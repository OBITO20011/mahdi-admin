import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mapPublicStorefrontSettings } from '../src/services/storefront-settings.service';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const cart = readFileSync(
  new URL('../src/components/CartDrawer.tsx', import.meta.url),
  'utf8'
);
const checkout = readFileSync(
  new URL('../src/components/CheckoutModal.tsx', import.meta.url),
  'utf8'
);

const validSettings = {
  storeNameAr: 'متجر اختبار',
  whatsappNumber: '0790000000',
  cliqAlias: 'test@cliq',
  ordersEnabled: true,
  announcementText: 'إعلان اختبار',
  businessHoursText: 'يوميًا',
  deliveryAreasText: 'الرمثا',
  deliveryEtaText: 'خلال يوم',
  exchangePolicyText: 'حسب الحالة',
  minimumOrderInMinorUnits: 1250,
  deliveryFeeInMinorUnits: 2000,
  insideRamthaDeliveryFeeInMinorUnits: 2000,
  outsideRamthaDeliveryFeeInMinorUnits: 4000,
  showNewestProducts: true,
  showBestSellers: true,
  showOffers: true,
  showLowStock: true,
  updatedAt: '2026-08-31T00:00:00Z',
};

test('a complete settings response keeps checkout values authoritative', () => {
  const settings = mapPublicStorefrontSettings(validSettings);
  assert.equal(settings.ordersEnabled, true);
  assert.equal(settings.minimumOrderInMinorUnits, 1250);
  assert.equal(settings.insideRamthaDeliveryFeeInMinorUnits, 2000);
  assert.equal(settings.outsideRamthaDeliveryFeeInMinorUnits, 4000);
});

test('missing checkout settings fail closed instead of mapping defaults', () => {
  assert.throws(
    () => mapPublicStorefrontSettings({}),
    /تعذر التحقق من إعدادات الطلب والتوصيل/
  );
  assert.throws(
    () =>
      mapPublicStorefrontSettings({
        ...validSettings,
        insideRamthaDeliveryFeeInMinorUnits: undefined,
      }),
    /تعذر التحقق من إعدادات الطلب والتوصيل/
  );
});

test('settings failures use the customer-safe message instead of RPC internals', () => {
  assert.match(
    readFileSync(
      new URL('../src/services/storefront-settings.service.ts', import.meta.url),
      'utf8'
    ),
    /if \(error\) throw new Error\(SETTINGS_UNAVAILABLE_MESSAGE\)/
  );
});

test('settings failures block checkout and retry returns through the same loader', () => {
  assert.match(app, /const \[settingsUnavailable, setSettingsUnavailable\]/);
  assert.match(app, /setSettingsUnavailable\(true\)/);
  assert.match(app, /loadStorefrontSettings\(true\)/);
  assert.match(app, /checkoutDisabled=\{!settingsTrusted\}/);
  assert.match(cart, /disabled=\{checkoutDisabled\}/);
  assert.match(app, /settingsUnavailable=\{settingsUnavailable\}/);
  assert.match(checkout, /settingsUnavailable/);
  assert.match(checkout, /لن نعرض رسوم توصيل أو حدًا أدنى غير موثوقين/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const checkout = readFileSync(
  new URL('../src/components/CheckoutModal.tsx', import.meta.url),
  'utf8'
);

test('checkout uses one clear delivery details field without duplicate note inputs', () => {
  assert.match(checkout, /label="تفاصيل العنوان والتوصيل \(اختياري\)"/);
  assert.match(checkout, /maxLength=\{MAX_GUEST_DELIVERY_DETAILS_LENGTH\}/);
  assert.match(checkout, /رقم المحل أو المبنى، الشارع، أقرب معلم/);
  assert.doesNotMatch(checkout, /label="رقم المحل أو المبنى"/);
  assert.doesNotMatch(checkout, /label="ملاحظات على العنوان"/);
  assert.doesNotMatch(checkout, /label="ملاحظات على الطلب"/);
});

test('checkout keeps the established delivery location, payment, coupon, and saved-data flows', () => {
  assert.match(checkout, /أنا في موقع التوصيل/);
  assert.match(checkout, /موقع التوصيل مختلف/);
  assert.match(checkout, /استخدام موقعي الحالي للتوصيل/);
  assert.match(checkout, /فتح خرائط Google واختيار المكان/);
  assert.match(checkout, /معك رمز خصم؟/);
  assert.match(checkout, /طريقة الدفع/);
  assert.match(checkout, /لا تستخدم هذا الخيار على جهاز مشترك/);
});

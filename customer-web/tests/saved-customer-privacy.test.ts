import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const checkoutModal = readFileSync(
  new URL('../src/components/CheckoutModal.tsx', import.meta.url),
  'utf8',
);

test('revoking saved-details consent clears local customer storage immediately', () => {
  assert.match(checkoutModal, /if \(!enabled\) clearSavedGuestCustomer\(window\.localStorage\)/);
});

test('checkout warns against saving customer details on a shared device', () => {
  assert.match(checkoutModal, /لا تستخدم هذا الخيار على جهاز مشترك/);
});

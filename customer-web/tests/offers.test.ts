import assert from 'node:assert/strict';
import test from 'node:test';
import { mapStorefrontOffer } from '../src/services/offers.service';

test('storefront percentage offer maps basis points without inventing a price', () => {
  const offer = mapStorefrontOffer({
    id: 'offer-1',
    code: 'WELCOME10',
    description_ar: 'خصم افتتاح الموقع',
    discount_type: 'percentage',
    discount_value: 1250,
    minimum_subtotal_in_minor_units: 10000,
    maximum_discount_in_minor_units: 5000,
    expires_at: '2026-12-31T21:00:00.000Z',
  });

  assert.equal(offer.discountType, 'percentage');
  assert.equal(offer.discountValue, 12.5);
  assert.equal(offer.minimumSubtotalInMinorUnits, 10000);
  assert.equal(offer.maximumDiscountInMinorUnits, 5000);
  assert.equal(offer.code, 'WELCOME10');
});

test('storefront fixed offer maps fils to JOD once', () => {
  const offer = mapStorefrontOffer({
    id: 'offer-2',
    code: 'SAVE1',
    discount_type: 'fixed',
    discount_value: 1500,
    minimum_subtotal_in_minor_units: 0,
  });

  assert.equal(offer.discountType, 'fixed');
  assert.equal(offer.discountValue, 1.5);
  assert.equal(offer.maximumDiscountInMinorUnits, undefined);
});

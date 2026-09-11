import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FloatingContactActions } from '../src/components/FloatingContactActions';
import { StoreInfoSection } from '../src/components/StoreInfoSection';

const settings = {
  storeNameAr: 'محلات النواصرة التجارية',
  whatsappNumber: '962770000000',
  cliqAlias: '',
  ordersEnabled: true,
  announcementText: '',
  businessHoursText: 'يوميًا',
  deliveryAreasText: 'الرمثا',
  deliveryEtaText: 'حسب المنطقة',
  exchangePolicyText: 'وفق حالة الطلب',
  minimumOrderInMinorUnits: 0,
  deliveryFeeInMinorUnits: 0,
  insideRamthaDeliveryFeeInMinorUnits: 2000,
  outsideRamthaDeliveryFeeInMinorUnits: 4000,
  showNewestProducts: true,
  showBestSellers: true,
  showOffers: true,
  showLowStock: true,
  updatedAt: '2026-09-12T00:00:00Z',
};

test('store information is a named section and uses AA-safe small text color', () => {
  const markup = renderToStaticMarkup(
    React.createElement(StoreInfoSection, {
      whatsappUrl: 'https://wa.me/962770000000',
      onTrackOrder: () => undefined,
      settings,
    }),
  );

  assert.match(markup, /<section[^>]*aria-labelledby="store-info-heading"/u);
  assert.match(markup, /<h2 id="store-info-heading"/u);
  assert.match(markup, /text-slate-500[^>]*>[^<]*أجرة التوصيل داخل الرمثا/u);
  assert.doesNotMatch(markup, /text-slate-400[^>]*>[^<]*أجرة التوصيل داخل الرمثا/u);
});

test('floating contact controls are contained in a named complementary landmark', () => {
  const markup = renderToStaticMarkup(
    React.createElement(FloatingContactActions, {
      whatsappUrl: 'https://wa.me/962770000000',
    }),
  );

  assert.match(markup, /<aside[^>]*aria-label="روابط التواصل السريع"/u);
});

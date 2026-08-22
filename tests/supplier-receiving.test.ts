import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  calculateReceivingLine,
  jodToMinorUnits,
  minorUnitsToJod,
} from '../src/utils/receivingCalculations';

test('converts five cartons of 24 pieces into 120 base units', () => {
  const result = calculateReceivingLine({
    packageQuantity: 5,
    unitsPerPackage: 24,
    packagePriceInMinorUnits: jodToMinorUnits(6),
    sellingPriceInMinorUnits: jodToMinorUnits(0.4),
  });

  assert.equal(result.totalBaseUnits, 120);
  assert.equal(result.lineTotalInMinorUnits, 30_000);
  assert.equal(result.effectiveUnitCostInMinorUnits, 250);
  assert.equal(result.profitPerUnitInMinorUnits, 150);
});

test('applies a line discount before calculating effective unit cost', () => {
  const result = calculateReceivingLine({
    packageQuantity: 2,
    unitsPerPackage: 10,
    packagePriceInMinorUnits: 5_000,
    discountInMinorUnits: 1_000,
    sellingPriceInMinorUnits: 600,
  });

  assert.equal(result.lineSubtotalInMinorUnits, 10_000);
  assert.equal(result.lineTotalInMinorUnits, 9_000);
  assert.equal(result.effectiveUnitCostInMinorUnits, 450);
  assert.equal(result.profitPerUnitInMinorUnits, 150);
});

test('caps discount at the line subtotal and preserves integer inventory', () => {
  const result = calculateReceivingLine({
    packageQuantity: 3.9,
    unitsPerPackage: 12.8,
    packagePriceInMinorUnits: 2_000,
    discountInMinorUnits: 99_000,
  });

  assert.equal(result.packageQuantity, 3);
  assert.equal(result.unitsPerPackage, 12);
  assert.equal(result.totalBaseUnits, 36);
  assert.equal(result.lineTotalInMinorUnits, 0);
});

test('stores Jordanian dinar values in thousandths without floating drift', () => {
  assert.equal(jodToMinorUnits(15.125), 15_125);
  assert.equal(minorUnitsToJod(15_125), 15.125);
});

test('one supplier box of six pieces adds six base units at exact cost', () => {
  const result = calculateReceivingLine({
    packageQuantity: 1,
    unitsPerPackage: 6,
    packagePriceInMinorUnits: 3_600,
  });

  assert.equal(result.totalBaseUnits, 6);
  assert.equal(result.lineTotalInMinorUnits, 3_600);
  assert.equal(result.effectiveUnitCostInMinorUnits, 600);
});

test('receiving UI keeps package contents and removes retail selling fields', () => {
  const modal = fs.readFileSync(
    'src/features/directReceiving/CreateDirectReceiptModal.tsx',
    'utf8'
  );
  const service = fs.readFileSync(
    'src/services/supabase/directReceiving.service.ts',
    'utf8'
  );

  assert.match(modal, /محتوى الطرد/);
  assert.match(modal, /عدد الطرود المستلمة/);
  assert.match(modal, /3 كراتين × 5 حبات = 15 حبة/);
  assert.match(modal, /الكمية التي ستدخل المخزون/);
  assert.match(modal, /إنقاص عدد طرود/);
  assert.match(modal, /زيادة عدد طرود/);
  assert.match(modal, /تكلفة .* المحسوبة/);
  assert.doesNotMatch(modal, /سعر بيع القطعة/);
  assert.doesNotMatch(modal, /sellingPriceJod/);
  assert.doesNotMatch(service, /selling_price_in_minor_units: item\./);
});

test('receiving RPC strips legacy sale-price writes at the database boundary', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/024_supplier_receiving_wholesale_guard.sql',
    'utf8'
  );

  assert.match(
    migration,
    /item\.value - 'selling_price_in_minor_units'/
  );
  assert.match(
    migration,
    /public\._create_direct_supplier_receipt_impl/
  );
  assert.match(migration, /public\.assert_erp_role/);
});

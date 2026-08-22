import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  calculateOrderAmountDue,
  isOperationalOrderSource,
  matchesOperationalOrderFilter,
} from '../src/utils/orderCalculations';

test('customer due never becomes negative', () => {
  assert.equal(calculateOrderAmountDue(12.5, 2.25), 10.25);
  assert.equal(calculateOrderAmountDue(5, 8), 0);
  assert.equal(calculateOrderAmountDue(Number.NaN, 3), 0);
});

test('operational website orders exclude direct POS invoices', () => {
  assert.equal(isOperationalOrderSource('website'), true);
  assert.equal(isOperationalOrderSource(null), true);
  assert.equal(isOperationalOrderSource('pos'), false);
});

test('simple order filters group active workflow states', () => {
  assert.equal(matchesOperationalOrderFilter('new', 'action'), true);
  assert.equal(matchesOperationalOrderFilter('ready', 'active'), true);
  assert.equal(matchesOperationalOrderFilter('completed', 'completed'), true);
  assert.equal(matchesOperationalOrderFilter('cancelled', 'active'), false);
});

test('POS debt sales require a registered customer in UI and database', () => {
  const posView = readFileSync(
    new URL('../src/features/pos/PosView.tsx', import.meta.url),
    'utf8'
  );
  const migration = readFileSync(
    new URL(
      '../supabase/migrations/027_require_customer_for_debt_sales.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    posView,
    /paymentMethod === 'debt' && !selectedCustomerId/
  );
  assert.match(posView, /إضافة عميل جديد/);
  assert.match(
    migration,
    /NEW\.payment_method = 'debt' AND NEW\.customer_id IS NULL/
  );
  assert.match(
    migration,
    /CREATE TRIGGER trg_require_customer_for_debt_order/
  );
});

test('POS customer directory excludes inactive, blocked, and deleted customers', () => {
  const posService = readFileSync(
    new URL('../src/services/supabase/pos.service.ts', import.meta.url),
    'utf8'
  );

  assert.match(posService, /\.eq\('is_active', true\)/);
  assert.match(posService, /\.eq\('is_blocked', false\)/);
  assert.match(posService, /\.eq\('is_deleted', false\)/);
});

test('the quick sale action navigates to the real POS screen', () => {
  const quickActions = readFileSync(
    new URL('../src/components/layout/QuickActionButton.tsx', import.meta.url),
    'utf8'
  );

  assert.match(quickActions, /id: 'pos-sale'[\s\S]*setActiveTab\('pos'\)/);
  assert.doesNotMatch(quickActions, /openModal\('pos_sale'\)/);
});

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const cleanup = readFileSync(
  'supabase/migrations/034_prelaunch_test_data_cleanup.sql',
  'utf8',
);

test('pre-launch cleanup removes the complete experimental business cycle', () => {
  for (const table of [
    'orders',
    'customers',
    'products',
    'suppliers',
    'supplier_receipts',
    'purchase_orders',
    'purchase_receipts',
    'inventory_movements',
    'inventory_balances',
    'push_dispatches',
  ]) {
    assert.match(cleanup, new RegExp(`public\\.${table}`));
  }
  assert.match(cleanup, /TRUNCATE TABLE/);
  assert.match(cleanup, /RESTART IDENTITY/);
});

test('pre-launch cleanup preserves production configuration and push devices', () => {
  const truncateSection = cleanup.match(/TRUNCATE TABLE([\s\S]*?)RESTART IDENTITY/)?.[1] || '';
  assert.doesNotMatch(truncateSection, /public\.profiles/);
  assert.doesNotMatch(truncateSection, /public\.roles/);
  assert.doesNotMatch(truncateSection, /public\.user_roles/);
  assert.doesNotMatch(truncateSection, /public\.branches/);
  assert.doesNotMatch(truncateSection, /public\.warehouses/);
  assert.doesNotMatch(truncateSection, /public\.categories/);
  assert.doesNotMatch(truncateSection, /public\.brands/);
  assert.doesNotMatch(truncateSection, /public\.units/);
  assert.doesNotMatch(truncateSection, /public\.push_subscriptions/);
  assert.match(cleanup, /PRELAUNCH_TEST_DATA_CLEANUP/);
});

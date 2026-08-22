import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/050_admin_api_security_hardening.sql',
    import.meta.url
  ),
  'utf8'
);

const headers = readFileSync(
  new URL('../public/_headers', import.meta.url),
  'utf8'
);

test('confirmed financial reports deny anonymous execution', () => {
  for (const functionName of [
    'get_dashboard_analytics',
    'get_cash_shift_summary',
    'get_cash_shift_display_summary',
  ]) {
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${functionName}\\([\\s\\S]*?FROM PUBLIC, anon;`
      )
    );
  }
});

test('storefront contracts are not changed by the admin hardening migration', () => {
  assert.doesNotMatch(migration, /REVOKE[\s\S]*?get_public_storefront_catalog/);
  assert.doesNotMatch(migration, /REVOKE[\s\S]*?submit_guest_customer_order/);
  assert.doesNotMatch(migration, /REVOKE[\s\S]*?track_guest_order/);
});

test('legacy inventory and purchasing RPCs are role-guarded wrappers', () => {
  for (const functionName of [
    'receive_inventory',
    'create_purchase_order',
    'update_purchase_order_status',
    'receive_purchase_order',
    'record_supplier_payment',
  ]) {
    const start = migration.indexOf(
      `CREATE OR REPLACE FUNCTION public.${functionName}`
    );
    assert.notEqual(start, -1, `${functionName} wrapper is missing`);
    const nextFunction = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.',
      start + 1
    );
    const body = migration.slice(
      start,
      nextFunction === -1 ? migration.length : nextFunction
    );
    assert.match(body, /PERFORM public\.assert_erp_role/);
    assert.match(body, new RegExp(`public\\._${functionName}_impl`));
  }
});

test('read-only financial reports use caller RLS', () => {
  assert.match(
    migration,
    /ALTER FUNCTION public\.get_dashboard_analytics\(\) SECURITY INVOKER;/
  );
  assert.match(
    migration,
    /ALTER FUNCTION public\.get_cash_shift_summary\(UUID\) SECURITY INVOKER;/
  );
  assert.match(
    migration,
    /ALTER FUNCTION public\.get_cash_shift_display_summary\(UUID\) SECURITY INVOKER;/
  );
});

test('development warehouse policies are removed', () => {
  assert.match(migration, /to_regclass\(format\('public\.%I'/);
  for (const policyName of [
    'Allow anon select supplier_returns',
    'Allow anon select supplier_return_items',
    'Allow anon select stock_counts',
    'Allow anon select stock_count_items',
  ]) {
    assert.match(migration, new RegExp(`'${policyName}'`));
  }
  assert.match(migration, /DROP POLICY IF EXISTS %I ON public\.%I/);
});

test('production headers enforce HTTPS persistence', () => {
  assert.match(
    headers,
    /Strict-Transport-Security: max-age=31536000; includeSubDomains/
  );
});

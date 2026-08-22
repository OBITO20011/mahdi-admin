import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/030_secure_order_entrypoints.sql',
    import.meta.url
  ),
  'utf8'
);

test('anonymous checkout cannot call the canonical accounting RPC directly', () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.create_customer_order\([\s\S]*?FROM PUBLIC, anon;/
  );
  assert.doesNotMatch(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.create_customer_order\([\s\S]*?TO anon/
  );
});

test('staff order transitions have one RBAC guarded entry point', () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.update_order_status/
  );
  assert.match(migration, /PERFORM public\.assert_erp_role/);
  assert.match(
    migration,
    /p_new_status IN \('out_for_delivery', 'completed', 'cancelled'\)/
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.complete_order\(UUID, TEXT\)[\s\S]*?FROM PUBLIC, anon, authenticated;/
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.update_order_status\(UUID, TEXT, TEXT\)[\s\S]*?TO authenticated;/
  );
});

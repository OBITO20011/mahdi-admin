import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
test('Package D modern coordinators use one explicit NULL-safe sale guard', () => {
  const sql=read('supabase/migrations/132_package_d_system_unification.sql');
  assert.match(sql,/v_creation_type IS NULL OR v_creation_type NOT IN/u);
  assert.match(sql,/PHASE42_SALE_CONTRACT_UNSUPPORTED/u);
  assert.match(sql,/PHASE43_SALE_CONTRACT_UNSUPPORTED/u);
  assert.doesNotMatch(sql,/pg_get_functiondef|\bEXECUTE\s+(?:format\s*\(|')|\bREPLACE\s*\(/iu);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.package_d_settle_sales_return_before_guard_internal/u);
});
test('Package D does not activate feature state', () => {
  const sql=read('supabase/migrations/132_package_d_system_unification.sql');
  assert.doesNotMatch(sql,/UPDATE public\.configurable_parcel_feature_settings/iu);
  assert.match(sql,/PACKAGE_D_POS_V2_REQUIRED/u);
  assert.match(sql,/PACKAGE_D_MODERN_AFTERCARE_REQUIRED/u);
  assert.match(sql,/v_used \+ NEW\.consumed_quantity > v_capacity/u);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ERP_APP_ROLE_CODES,
  isAuthorizedErpRole,
} from '../src/services/supabase/auth.service';

const authService = readFileSync(
  'src/services/supabase/auth.service.ts',
  'utf8'
);
const store = readFileSync('src/stores/useAppStore.ts', 'utf8');
const referenceService = readFileSync(
  'src/services/supabase/reference-data.service.ts',
  'utf8'
);
const migration = readFileSync(
  'supabase/migrations/032_require_active_erp_staff.sql',
  'utf8'
);

test('admin authentication requires a real active ERP role', () => {
  assert.ok(ERP_APP_ROLE_CODES.length >= 1);
  assert.equal(isAuthorizedErpRole('admin'), true);
  assert.equal(isAuthorizedErpRole('warehouse_keeper'), true);
  assert.equal(isAuthorizedErpRole('customer'), false);
  assert.equal(isAuthorizedErpRole(''), false);
  assert.doesNotMatch(authService, /\|\|\s*true/);
  assert.doesNotMatch(authService, /roles:\s*\['Owner'\]/);
  assert.match(authService, /if \(!profile\)/);
  assert.match(authService, /profile\.is_active === true/);
});

test('production data sources fail closed instead of inventing records', () => {
  assert.doesNotMatch(store, /services\/mockData/);
  assert.doesNotMatch(store, /INITIAL_/);
  assert.match(store, /users: \[\]/);
  assert.match(store, /customers: \[\]/);
  assert.match(store, /accounts: \[\]/);
  assert.doesNotMatch(referenceService, /fallbackBrands|fallbackUnits/);
  assert.doesNotMatch(referenceService, /return DEFAULT_/);
});

test('all exposed authenticated tables require active ERP membership', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.is_active_erp_staff/);
  assert.match(migration, /p\.is_active = true/);
  assert.match(migration, /relation\.relrowsecurity = true/);
  assert.match(migration, /AS RESTRICTIVE FOR ALL TO authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.is_active_erp_staff\(\)[\s\S]*FROM PUBLIC, anon/);
});

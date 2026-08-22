import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authStore = readFileSync('src/stores/useAuthStore.ts', 'utf8');
const loginView = readFileSync('src/features/auth/LoginView.tsx', 'utf8');
const profileModal = readFileSync('src/features/more/ProfileModal.tsx', 'utf8');
const mfaService = readFileSync('src/services/supabase/mfa.service.ts', 'utf8');
const migration = readFileSync(
  'supabase/migrations/051_enrolled_staff_mfa_enforcement.sql',
  'utf8'
);

test('admin data is not loaded until the session AAL has been checked', () => {
  const handlerStart = authStore.indexOf('private async handleUserSession');
  const handler = authStore.slice(handlerStart, authStore.indexOf('public async signIn', handlerStart));
  const aalCheck = handler.indexOf('getAuthenticatorAssuranceLevel');
  const profileFetch = handler.indexOf('fetchUserProfileAndRole');

  assert.ok(handlerStart >= 0);
  assert.ok(aalCheck >= 0);
  assert.ok(profileFetch > aalCheck);
  assert.match(handler, /currentLevel === 'aal1' && aalData\.nextLevel === 'aal2'/);
  assert.match(handler, /this\.state\.mfaRequired = true/);
});

test('login challenge supports a six-digit code and a safe return to password login', () => {
  assert.match(loginView, /autoComplete="one-time-code"/);
  assert.match(loginView, /mfaCode\.length !== 6/);
  assert.match(loginView, /verifyMfa\(mfaCode\)/);
  assert.match(loginView, /cancelMfa\(\)/);
  assert.match(loginView, /الرجوع إلى البريد وكلمة المرور/);
});

test('profile security tab has a complete TOTP enrollment lifecycle', () => {
  assert.match(profileModal, /beginTotpEnrollment\(\)/);
  assert.match(profileModal, /verifyTotpFactor\(mfaEnrollment\.factorId, mfaCode\)/);
  assert.match(profileModal, /removeTotpFactor/);
  assert.match(profileModal, /رمز QR لتطبيق المصادقة/);
  assert.match(profileModal, /هل أنت متأكد من إلغاء المصادقة الثنائية/);
});

test('TOTP secrets and codes are never written to the console', () => {
  assert.doesNotMatch(mfaService, /console\.(log|info|warn|error)/);
  assert.match(mfaService, /factor\.status === 'unverified'/);
  assert.match(mfaService, /challengeAndVerify/);
});

test('database requires AAL2 only for users with a verified factor', () => {
  assert.match(migration, /FROM auth\.mfa_factors factor/);
  assert.match(migration, /factor\.status = 'verified'/);
  assert.match(migration, /OR COALESCE\(auth\.jwt\(\) ->> 'aal', 'aal1'\) = 'aal2'/);
  assert.match(migration, /public\.is_mfa_policy_satisfied\(\)/);
  assert.doesNotMatch(migration, /CREATE POLICY|DROP POLICY/);
});

test('central ERP mutation and storage guards both enforce MFA', () => {
  const assertRoleStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.assert_erp_role');
  const hasRoleStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.has_erp_role');
  const activeStaffStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.is_active_erp_staff');

  assert.ok(assertRoleStart >= 0);
  assert.ok(hasRoleStart > assertRoleStart);
  assert.ok(activeStaffStart > hasRoleStart);
  assert.match(migration.slice(assertRoleStart, hasRoleStart), /is_mfa_policy_satisfied/);
  assert.match(migration.slice(hasRoleStart, activeStaffStart), /is_mfa_policy_satisfied/);
  assert.match(migration.slice(activeStaffStart), /is_mfa_policy_satisfied/);
});

test('guest storefront entrypoints are not changed by MFA enforcement', () => {
  assert.doesNotMatch(migration, /submit_guest_customer_order/);
  assert.doesNotMatch(migration, /get_public_storefront_catalog/);
  assert.doesNotMatch(migration, /track_guest_order/);
});

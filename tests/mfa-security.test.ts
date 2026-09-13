import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LatestMfaStatusRequest,
  MfaStatusTimeoutError,
  SingleFlightRequest,
  withMfaStatusTimeout,
} from '../src/services/supabase/mfaStatusRequest';

const authStore = readFileSync('src/stores/useAuthStore.ts', 'utf8');
const loginView = readFileSync('src/features/auth/LoginView.tsx', 'utf8');
const profileModal = readFileSync('src/features/more/ProfileModal.tsx', 'utf8');
const mfaService = readFileSync('src/services/supabase/mfa.service.ts', 'utf8');
const migration = readFileSync(
  'supabase/migrations/051_enrolled_staff_mfa_enforcement.sql',
  'utf8'
);
const monitoringAccessMigration = readFileSync(
  'supabase/migrations/106_align_monitoring_owner_mfa_policy.sql',
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

test('MFA status has explicit loading, ready, error, and retry states', () => {
  assert.match(profileModal, /'idle' \| 'loading' \| 'ready' \| 'error'/);
  assert.match(profileModal, /mfaStatusState === 'error'/);
  assert.match(profileModal, /إعادة المحاولة/);
  assert.match(profileModal, /role="alert"/);
  assert.match(profileModal, /const status = await getMfaStatus\(\)/);
  assert.match(mfaService, /withMfaStatusTimeout\(mfaStatusLoader\.run\(loadMfaStatus\)\)/);
});

test('MFA status requests are single-flight and avoid concurrent SDK auth reads', () => {
  assert.match(mfaService, /new SingleFlightRequest<MfaStatus>\(\)/);
  assert.match(mfaService, /mfaStatusLoader\.run\(loadMfaStatus\)/);
  assert.doesNotMatch(mfaService, /Promise\.all\(\[\s*client\.auth\.mfa\.listFactors/);
  assert.ok(
    mfaService.indexOf('client.auth.mfa.listFactors()') <
      mfaService.indexOf('client.auth.mfa.getAuthenticatorAssuranceLevel()')
  );
});

test('MFA request lifecycle rejects stale completions and rapid duplicate checks', () => {
  const requests = new LatestMfaStatusRequest();
  const first = requests.begin();

  assert.equal(typeof first, 'number');
  assert.equal(requests.begin(), null);

  requests.cancel();
  const second = requests.begin();
  assert.equal(typeof second, 'number');
  assert.notEqual(second, first);
  assert.equal(requests.complete(first!), false);
  assert.equal(requests.complete(second!), true);
});

test('MFA timeout settles safely and ignores a late response', async () => {
  let resolveLate!: (value: string) => void;
  const lateRequest = new Promise<string>((resolve) => {
    resolveLate = resolve;
  });

  await assert.rejects(withMfaStatusTimeout(lateRequest, 5), MfaStatusTimeoutError);
  resolveLate('stale');
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('MFA retry after timeout reuses the unresolved SDK request', async () => {
  const loader = new SingleFlightRequest<string>();
  let resolveRequest!: (value: string) => void;
  let calls = 0;
  const factory = () => {
    calls += 1;
    return new Promise<string>((resolve) => {
      resolveRequest = resolve;
    });
  };

  await assert.rejects(withMfaStatusTimeout(loader.run(factory), 5), MfaStatusTimeoutError);
  const retry = withMfaStatusTimeout(loader.run(factory), 100);
  assert.equal(calls, 1);

  resolveRequest('ready');
  assert.equal(await retry, 'ready');
});

test('MFA component lifecycle prevents unmounted updates and duplicate enrollment', () => {
  assert.match(profileModal, /isMountedRef\.current = false/);
  assert.match(profileModal, /const requestCoordinator = mfaStatusRequestRef\.current/);
  assert.match(profileModal, /requestCoordinator\.cancel\(\)/);
  assert.match(profileModal, /if \(mfaMutationInFlightRef\.current\) return/);
  assert.match(profileModal, /if \(isMountedRef\.current\) setMfaEnrollment\(enrollment\)/);
});

test('TOTP secrets and codes are never written to the console', () => {
  assert.doesNotMatch(mfaService, /console\.(log|info|warn|error)/);
  assert.match(mfaService, /factor\.status === 'unverified'/);
  assert.match(mfaService, /challengeAndVerify/);
  assert.doesNotMatch(mfaService, /return message \|\|/);
});

test('database requires AAL2 only for users with a verified factor', () => {
  assert.match(migration, /FROM auth\.mfa_factors factor/);
  assert.match(migration, /factor\.status = 'verified'/);
  assert.match(migration, /OR COALESCE\(auth\.jwt\(\) ->> 'aal', 'aal1'\) = 'aal2'/);
  assert.match(migration, /public\.is_mfa_policy_satisfied\(\)/);
  assert.doesNotMatch(migration, /CREATE POLICY|DROP POLICY/);
});

test('technical monitoring reuses the enrolled-factor MFA policy without widening roles', () => {
  assert.match(
    monitoringAccessMigration,
    /assert_erp_role\([\s\S]*ARRAY\['owner'\][\s\S]*عرض المراقبة التقنية/u
  );
  assert.doesNotMatch(monitoringAccessMigration, /auth\.jwt\(\)[\s\S]*aal2/u);
  assert.match(
    monitoringAccessMigration,
    /REVOKE ALL ON FUNCTION public\.assert_monitoring_owner\(\)[\s\S]*PUBLIC, anon, authenticated/u
  );
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

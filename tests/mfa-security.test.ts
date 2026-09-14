import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LatestMfaStatusRequest,
  MAX_MFA_STATUS_ORPHANED_REQUESTS,
  MfaStatusRecoveryExhaustedError,
  MfaStatusTimeoutError,
  RecoverableMfaStatusRequest,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  assert.match(mfaService, /mfaStatusLoader\.run\(loadMfaStatus\)/);
  assert.match(profileModal, /setMfaStatus\(null\)[\s\S]*setMfaStatusError\(''\)/);
});

test('MFA status requests are recoverable single-flight and keep SDK auth reads sequential', () => {
  assert.match(mfaService, /new RecoverableMfaStatusRequest<MfaStatus>\(\)/);
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

test('MFA status succeeds normally with one accepted generation', async () => {
  const requests = new RecoverableMfaStatusRequest<string>(50);
  let sdkRequests = 0;

  const result = await requests.run(async () => {
    sdkRequests += 1;
    return 'ready';
  });

  assert.equal(result, 'ready');
  assert.equal(sdkRequests, 1);
  assert.deepEqual(requests.getDiagnostics(), {
    logicalCalls: 1,
    generationsCreated: 1,
    generationsTimedOut: 0,
    acceptedResults: 1,
    ignoredStaleResults: 0,
    activeGeneration: null,
    orphanedRequests: 0,
    maximumObservedUnderlyingRequests: 1,
  });
});

test('MFA status normal SDK failure settles without infinite loading', async () => {
  const requests = new RecoverableMfaStatusRequest<string>(50);
  const failure = new Error('isolated SDK failure');

  await assert.rejects(requests.run(async () => { throw failure; }), failure);
  assert.equal(requests.getDiagnostics().activeGeneration, null);
  assert.equal(requests.getDiagnostics().orphanedRequests, 0);
});

test('MFA hung generation times out and becomes a bounded orphan', async () => {
  const requests = new RecoverableMfaStatusRequest<string>(5);
  const hung = deferred<string>();

  await assert.rejects(requests.run(() => hung.promise), MfaStatusTimeoutError);
  assert.equal(requests.getDiagnostics().generationsTimedOut, 1);
  assert.equal(requests.getDiagnostics().orphanedRequests, 1);
  assert.equal(requests.getDiagnostics().activeGeneration, null);

  hung.resolve('late');
  await flushPromises();
});

test('MFA retry after a hung generation starts a real recovery attempt', async () => {
  const requests = new RecoverableMfaStatusRequest<string>(5);
  const first = deferred<string>();
  let sdkRequests = 0;
  const firstRequest = requests.run(() => {
    sdkRequests += 1;
    return first.promise;
  });

  await assert.rejects(firstRequest, MfaStatusTimeoutError);
  const recovery = requests.run(async () => {
    sdkRequests += 1;
    return 'ready';
  });
  assert.equal(await recovery, 'ready');
  assert.equal(sdkRequests, 2);
  assert.equal(requests.getDiagnostics().acceptedResults, 1);

  first.resolve('stale');
  await flushPromises();
});

test('MFA late stale response cannot overwrite a newer accepted result', async () => {
  const requests = new RecoverableMfaStatusRequest<string>(5);
  const first = deferred<string>();
  const accepted: string[] = [];

  await assert.rejects(requests.run(() => first.promise), MfaStatusTimeoutError);
  accepted.push(await requests.run(async () => 'fresh'));
  first.resolve('stale');
  await flushPromises();

  assert.deepEqual(accepted, ['fresh']);
  assert.equal(requests.getDiagnostics().acceptedResults, 1);
  assert.equal(requests.getDiagnostics().ignoredStaleResults, 1);
});

test('MFA concurrent callers share one generation and one SDK request', async () => {
  const requests = new RecoverableMfaStatusRequest<string>(50);
  const response = deferred<string>();
  let sdkRequests = 0;
  const factory = () => {
    sdkRequests += 1;
    return response.promise;
  };

  const first = requests.run(factory);
  const second = requests.run(factory);
  const third = requests.run(factory);
  assert.equal(first, second);
  assert.equal(second, third);
  response.resolve('ready');
  assert.deepEqual(await Promise.all([first, second, third]), ['ready', 'ready', 'ready']);
  assert.equal(sdkRequests, 1);
  assert.equal(requests.getDiagnostics().logicalCalls, 3);
});

test('MFA rapid retry creates only one recovery generation', async () => {
  const requests = new RecoverableMfaStatusRequest<string>(5);
  const hung = deferred<string>();
  const recovery = deferred<string>();
  let sdkRequests = 0;

  await assert.rejects(requests.run(() => {
    sdkRequests += 1;
    return hung.promise;
  }), MfaStatusTimeoutError);

  const retryOne = requests.run(() => {
    sdkRequests += 1;
    return recovery.promise;
  });
  const retryTwo = requests.run(() => recovery.promise);
  const retryThree = requests.run(() => recovery.promise);
  recovery.resolve('ready');
  assert.deepEqual(await Promise.all([retryOne, retryTwo, retryThree]), ['ready', 'ready', 'ready']);
  assert.equal(sdkRequests, 2);
  assert.equal(requests.getDiagnostics().maximumObservedUnderlyingRequests, 2);

  hung.resolve('stale');
  await flushPromises();
});

test('MFA orphan cap fails closed without an unbounded retry loop', async () => {
  const requests = new RecoverableMfaStatusRequest<string>(5, 2);
  const first = deferred<string>();
  const second = deferred<string>();
  let sdkRequests = 0;

  await assert.rejects(requests.run(() => {
    sdkRequests += 1;
    return first.promise;
  }), MfaStatusTimeoutError);
  await assert.rejects(requests.run(() => {
    sdkRequests += 1;
    return second.promise;
  }), MfaStatusTimeoutError);
  await assert.rejects(
    requests.run(async () => {
      sdkRequests += 1;
      return 'must-not-run';
    }),
    MfaStatusRecoveryExhaustedError
  );

  assert.equal(MAX_MFA_STATUS_ORPHANED_REQUESTS, 2);
  assert.equal(sdkRequests, 2);
  assert.equal(requests.getDiagnostics().orphanedRequests, 2);
  assert.equal(requests.getDiagnostics().maximumObservedUnderlyingRequests, 2);

  first.resolve('stale-one');
  second.resolve('stale-two');
  await flushPromises();
});

test('MFA stale generation cannot advance to a second SDK step', async () => {
  const requests = new RecoverableMfaStatusRequest<string>(5);
  const firstStep = deferred<void>();
  let secondSdkStepRequests = 0;

  await assert.rejects(requests.run(async (attempt) => {
    await firstStep.promise;
    attempt.assertCurrent();
    secondSdkStepRequests += 1;
    return 'must-not-complete';
  }), MfaStatusTimeoutError);

  firstStep.resolve();
  await flushPromises();
  assert.equal(secondSdkStepRequests, 0);
  assert.equal(requests.getDiagnostics().ignoredStaleResults, 1);
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

test('MFA status binds accepted results to a non-secret session identity', () => {
  assert.match(mfaService, /client\.auth\.getSession\(\)/);
  assert.match(mfaService, /data\.session\.user\.id/);
  assert.match(mfaService, /data\.session\.user\.last_sign_in_at/);
  assert.match(mfaService, /data\.session\.expires_at/);
  assert.doesNotMatch(mfaService, /data\.session\.(?:access_token|refresh_token)/);
  assert.match(mfaService, /await assertSameMfaSession\(sessionIdentity, attempt\)/g);
});

test('MFA retry recovery is limited to status reads and never wraps mutations', () => {
  assert.equal((mfaService.match(/mfaStatusLoader\.run\(/g) || []).length, 1);
  for (const operation of ['enroll', 'challengeAndVerify', 'unenroll']) {
    assert.doesNotMatch(mfaService, new RegExp(`mfaStatusLoader\\.run\\([^)]*${operation}`));
  }
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

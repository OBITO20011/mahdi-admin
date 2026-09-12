import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  ADMIN_ABSOLUTE_SESSION_MS,
  ADMIN_IDLE_LOCK_MS,
  createAdminSessionSecuritySnapshot,
  evaluateAdminSessionSecurity,
  lockAdminSession,
  parseAdminSessionSecuritySnapshot,
  recordAdminSessionActivity,
  unlockAdminSession,
} from '../src/services/sessionSecurity.service';

const authStore = readFileSync('src/stores/useAuthStore.ts', 'utf8');
const appShell = readFileSync(
  'src/components/layout/IPhoneContainer.tsx',
  'utf8',
);
const app = readFileSync('src/App.tsx', 'utf8');

test('idle policy stays open at 14m59s and locks at 15 minutes', () => {
  const startedAt = 1_800_000_000_000;
  const snapshot = createAdminSessionSecuritySnapshot('user-a', startedAt);

  assert.equal(
    evaluateAdminSessionSecurity(snapshot, startedAt + ADMIN_IDLE_LOCK_MS - 1_000),
    'active',
  );
  assert.equal(
    evaluateAdminSessionSecurity(snapshot, startedAt + ADMIN_IDLE_LOCK_MS),
    'idle_locked',
  );
});

test('absolute policy requires full login at 12 hours', () => {
  const startedAt = 1_800_000_000_000;
  const snapshot = createAdminSessionSecuritySnapshot('user-a', startedAt);
  const activeSnapshot = {
    ...snapshot,
    lastActivityAt: startedAt + ADMIN_ABSOLUTE_SESSION_MS - 1_000,
  };

  assert.equal(
    evaluateAdminSessionSecurity(
      activeSnapshot,
      startedAt + ADMIN_ABSOLUTE_SESSION_MS - 1_000,
    ),
    'active',
  );
  assert.equal(
    evaluateAdminSessionSecurity(
      activeSnapshot,
      startedAt + ADMIN_ABSOLUTE_SESSION_MS,
    ),
    'absolute_expired',
  );
});

test('unlock refreshes activity but never resets the absolute timer', () => {
  const startedAt = 1_800_000_000_000;
  const locked = lockAdminSession(
    createAdminSessionSecuritySnapshot('user-a', startedAt),
    startedAt + ADMIN_IDLE_LOCK_MS,
  );
  const unlocked = unlockAdminSession(
    locked,
    startedAt + ADMIN_IDLE_LOCK_MS + 5_000,
  );

  assert.equal(unlocked.lockedAt, null);
  assert.equal(unlocked.lastActivityAt, startedAt + ADMIN_IDLE_LOCK_MS + 5_000);
  assert.equal(unlocked.absoluteSessionStartedAt, startedAt);
});

test('background activity cannot silently unlock a locked session', () => {
  const startedAt = 1_800_000_000_000;
  const locked = lockAdminSession(
    createAdminSessionSecuritySnapshot('user-a', startedAt),
    startedAt + ADMIN_IDLE_LOCK_MS,
  );

  assert.equal(recordAdminSessionActivity(locked, startedAt + 2_000_000), locked);
});

test('the first activity at or after the idle boundary cannot revive the session', () => {
  const startedAt = 1_800_000_000_000;
  const snapshot = createAdminSessionSecuritySnapshot('user-a', startedAt);
  const beforeBoundary = recordAdminSessionActivity(
    snapshot,
    startedAt + ADMIN_IDLE_LOCK_MS - 1,
  );

  assert.equal(
    beforeBoundary.lastActivityAt,
    startedAt + ADMIN_IDLE_LOCK_MS - 1,
  );
  assert.equal(
    recordAdminSessionActivity(snapshot, startedAt + ADMIN_IDLE_LOCK_MS),
    snapshot,
  );
  assert.equal(
    recordAdminSessionActivity(snapshot, startedAt + ADMIN_IDLE_LOCK_MS + 1),
    snapshot,
  );
});

test('stored timestamps are isolated by user and reject clock rollback', () => {
  const startedAt = 1_800_000_000_000;
  const snapshot = createAdminSessionSecuritySnapshot('user-a', startedAt);
  const serialized = JSON.stringify(snapshot);

  assert.deepEqual(parseAdminSessionSecuritySnapshot(serialized, 'user-a'), snapshot);
  assert.equal(parseAdminSessionSecuritySnapshot(serialized, 'user-b'), null);
  assert.equal(
    evaluateAdminSessionSecurity(snapshot, startedAt - 60_001),
    'clock_invalid',
  );
});

test('session security is shared across tabs and reacts on Safari return', () => {
  assert.match(authStore, /window\.addEventListener\('storage', syncFromAnotherTab\)/);
  assert.match(authStore, /document\.addEventListener\('visibilitychange', checkWhenVisible\)/);
  assert.match(authStore, /event\.isTrusted/);
  assert.match(authStore, /window\.addEventListener\('wheel', recordTrustedActivity/);
  assert.match(authStore, /getAdminSessionSecurityStorageKey\(currentUserId\)/);
  assert.match(
    authStore,
    /if \(status === 'idle_locked'\) \{[\s\S]*?persistSessionSecuritySnapshot\(lockAdminSession\(snapshot\)\)/,
  );
  assert.match(app, /\[activeTab, isAuthenticated, recordSessionActivity\]/);
});

test('lock unmounts protected content and logout revokes only this session', () => {
  assert.match(appShell, /!isApplicationLocked && \(/);
  assert.match(appShell, /Locked sessions do not retain protected Admin content in the DOM/);
  assert.match(authStore, /supabase\.auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(authStore, /event === 'SIGNED_OUT'/);
  assert.match(authStore, /Promise\.allSettled\(\[/);
});

test('full login owns the absolute start while refresh and unlock preserve it', () => {
  const signInStart = authStore.indexOf('public async signIn');
  const refreshStart = authStore.indexOf('public async refreshCurrentUser');
  const signIn = authStore.slice(signInStart, refreshStart);
  const refreshAndUnlock = authStore.slice(refreshStart);

  assert.match(signIn, /beginFullSessionSecurity\(data\.user\.id\)/);
  assert.doesNotMatch(refreshAndUnlock, /jwt|\.iat\b/);
  assert.match(refreshAndUnlock, /unlockAdminSession\(snapshot\)/);
});

test('password unlock reauthenticates the known user and preserves MFA', () => {
  assert.match(authStore, /const expectedEmail = this\.state\.user\.email/);
  assert.match(authStore, /email: expectedEmail/);
  assert.match(authStore, /getAuthenticatorAssuranceLevel\(\)/);
  assert.match(authStore, /verifyUnlockMfa/);
  assert.match(authStore, /verifyTotpFactor\(this\.unlockMfaFactorId, code\)/);
});

import React from 'react';
import {createRoot} from 'react-dom/client';
import type {Session, User as SupabaseUser} from '@supabase/supabase-js';
import '../src/index.css';
import {IPhoneContainer} from '../src/components/layout/IPhoneContainer';
import {
  authStoreEngine,
  type AuthState,
} from '../src/stores/useAuthStore';
import {storeEngine} from '../src/stores/useAppStore';
import {
  createAdminSessionSecuritySnapshot,
  readAdminSessionSecuritySnapshot,
  writeAdminSessionSecuritySnapshot,
  type AdminSessionSecuritySnapshot,
} from '../src/services/sessionSecurity.service';

declare global {
  interface Window {
    __ADMIN_SESSION_TEST_SET_LOCKED__: (locked: boolean) => void;
    __ADMIN_SESSION_TEST_VERIFY_TURNSTILE__: () => void;
    __ADMIN_SESSION_TEST_AGE_ACTIVITY__: (atLeastMs: number) => void;
    __ADMIN_SESSION_TEST_EVALUATE__: () => Promise<void>;
    __ADMIN_SESSION_TEST_STATE__: () => AuthState & {
      storedSnapshot: AdminSessionSecuritySnapshot | null;
      refreshCount: number;
      protectedActionCount: number;
    };
  }
}

interface AuthHarnessEngine {
  state: AuthState;
  getState: () => AuthState;
  initAuth: () => Promise<void>;
  notify: () => void;
  sessionSecuritySnapshot: AdminSessionSecuritySnapshot | null;
  startSessionSecurityTracking: (snapshot: AdminSessionSecuritySnapshot) => void;
  evaluateCurrentSessionSecurity: () => Promise<void>;
  completeSessionUnlock: () => Promise<{success: boolean; error?: string}>;
  reauthenticateForUnlock: (
    password: string,
    captchaToken: string,
  ) => Promise<{success: boolean; error?: string}>;
}

const engine = authStoreEngine as unknown as AuthHarnessEngine;
const user = {
  id: 'session-security-test-user',
  email: 'owner@example.test',
  user_metadata: {},
  app_metadata: {},
  aud: 'authenticated',
  created_at: new Date(0).toISOString(),
} as SupabaseUser;
const storedSnapshot = readAdminSessionSecuritySnapshot(user.id);
const initialSnapshot = storedSnapshot || createAdminSessionSecuritySnapshot(user.id);
const session = {
  access_token: 'session-security-test-access-token',
  refresh_token: 'session-security-test-refresh-token',
  expires_in: 3_600,
  token_type: 'bearer',
  user,
} as Session;

if (!storedSnapshot) writeAdminSessionSecuritySnapshot(initialSnapshot);

engine.state = {
  ...engine.getState(),
  user,
  session,
  roleName: 'owner',
  roles: ['owner'],
  isAuthenticated: true,
  isSessionLocked: initialSnapshot.lockedAt !== null,
  absoluteSessionStartedAt: initialSnapshot.absoluteSessionStartedAt,
  lastActivityAt: initialSnapshot.lastActivityAt,
  isLoading: false,
};
engine.initAuth = async () => undefined;
engine.startSessionSecurityTracking(initialSnapshot);
void engine.evaluateCurrentSessionSecurity();
engine.reauthenticateForUnlock = async (password, captchaToken) => {
  if (captchaToken !== 'test-turnstile-token' || password !== 'correct-password') {
    return {success: false, error: 'كلمة المرور غير صحيحة.'};
  }

  return engine.completeSessionUnlock();
};

let refreshCount = 0;
let protectedActionCount = 0;
for (const method of [
  'refreshOrdersFromSupabase',
  'refreshReferenceDataFromSupabase',
  'refreshStockNotificationsFromSupabase',
] as const) {
  (storeEngine[method] as unknown as () => Promise<void>) = async () => {
    refreshCount += 1;
  };
}

let turnstileCallback: ((token: string) => void) | null = null;
window.turnstile = {
  render: (_container, options) => {
    turnstileCallback = options.callback;
    window.queueMicrotask(() => options.callback('test-turnstile-token'));
    return 'session-security-test-widget';
  },
  remove: () => undefined,
  reset: () => undefined,
};

storeEngine.setCurrentUser({
  id: user.id,
  email: user.email,
  name: 'Owner test',
  role: 'Owner',
  isActive: true,
});

window.__ADMIN_SESSION_TEST_SET_LOCKED__ = (locked) => {
  engine.state.isSessionLocked = locked;
  engine.notify();
};
window.__ADMIN_SESSION_TEST_VERIFY_TURNSTILE__ = () => {
  turnstileCallback?.('test-turnstile-token');
};
window.__ADMIN_SESSION_TEST_AGE_ACTIVITY__ = (atLeastMs) => {
  const current = readAdminSessionSecuritySnapshot(user.id) || initialSnapshot;
  const now = Date.now();
  const agedSnapshot = {
    ...current,
    absoluteSessionStartedAt: Math.min(current.absoluteSessionStartedAt, now - atLeastMs),
    lastActivityAt: now - atLeastMs,
    lockedAt: null,
  };
  writeAdminSessionSecuritySnapshot(agedSnapshot);
  engine.startSessionSecurityTracking(agedSnapshot);
};
window.__ADMIN_SESSION_TEST_EVALUATE__ = () =>
  engine.evaluateCurrentSessionSecurity();
window.__ADMIN_SESSION_TEST_STATE__ = () => ({
  ...engine.getState(),
  storedSnapshot: readAdminSessionSecuritySnapshot(user.id),
  refreshCount,
  protectedActionCount,
});

createRoot(document.getElementById('root')!).render(
  <IPhoneContainer>
    <section data-testid="protected-admin-content">
      بيانات الإدارة الحساسة
      <button
        type="button"
        data-testid="protected-admin-action"
        onClick={() => {
          protectedActionCount += 1;
        }}
      >
        إجراء إداري محمي
      </button>
    </section>
  </IPhoneContainer>,
);

import React from 'react';
import {createRoot} from 'react-dom/client';
import type {User as SupabaseUser} from '@supabase/supabase-js';
import '../src/index.css';
import {IPhoneContainer} from '../src/components/layout/IPhoneContainer';
import {
  authStoreEngine,
  type AuthState,
} from '../src/stores/useAuthStore';
import {storeEngine} from '../src/stores/useAppStore';

declare global {
  interface Window {
    __ADMIN_SESSION_TEST_SET_LOCKED__: (locked: boolean) => void;
    __ADMIN_SESSION_TEST_VERIFY_TURNSTILE__: () => void;
  }
}

interface AuthHarnessEngine {
  state: AuthState;
  getState: () => AuthState;
  initAuth: () => Promise<void>;
  notify: () => void;
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

engine.state = {
  ...engine.getState(),
  user,
  roleName: 'owner',
  roles: ['owner'],
  isAuthenticated: true,
  isSessionLocked: false,
  absoluteSessionStartedAt: Date.now(),
  lastActivityAt: Date.now(),
  isLoading: false,
};
engine.initAuth = async () => undefined;
engine.reauthenticateForUnlock = async (password, captchaToken) => {
  if (captchaToken !== 'test-turnstile-token' || password !== 'correct-password') {
    return {success: false, error: 'كلمة المرور غير صحيحة.'};
  }

  engine.state.isSessionLocked = false;
  engine.notify();
  return {success: true};
};

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

createRoot(document.getElementById('root')!).render(
  <IPhoneContainer>
    <section data-testid="protected-admin-content">
      بيانات الإدارة الحساسة
    </section>
  </IPhoneContainer>,
);

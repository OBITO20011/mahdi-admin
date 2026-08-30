import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { MoreMenuView } from '../src/features/more/MoreMenuView';
import {
  authStoreEngine,
  type AuthState,
} from '../src/stores/useAuthStore';
import { storeEngine } from '../src/stores/useAppStore';

declare global {
  interface Window {
    __ADMIN_NAVIGATION_TEST_ACTIVE_TAB__: () => string;
    __ADMIN_NAVIGATION_TEST_CURRENT_MODAL__: () => string | null;
  }
}

interface AuthHarnessEngine {
  state: AuthState;
  getState: () => AuthState;
  initAuth: () => Promise<void>;
}

const engine = authStoreEngine as unknown as AuthHarnessEngine;
const requestedRole = new URLSearchParams(window.location.search).get('role');
const roleName = requestedRole || 'owner';

engine.state = {
  ...engine.getState(),
  roleName,
  roles: [roleName],
  isAuthenticated: true,
  isLoading: false,
};
engine.initAuth = async () => undefined;

storeEngine.setCurrentUser({
  id: 'navigation-test-user',
  name: 'مستخدم اختبار التنقل',
  role: roleName === 'owner' ? 'Owner' : 'View Only',
  themeMode: 'dark',
});

window.__ADMIN_NAVIGATION_TEST_ACTIVE_TAB__ = () =>
  storeEngine.getState().activeTab;
window.__ADMIN_NAVIGATION_TEST_CURRENT_MODAL__ = () =>
  storeEngine.getState().currentModal;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MoreMenuView />
  </React.StrictMode>,
);

import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { BottomTabs } from '../src/components/layout/BottomTabs';
import { QuickActionButton } from '../src/components/layout/QuickActionButton';
import { MoreMenuView } from '../src/features/more/MoreMenuView';
import {
  authStoreEngine,
  type AuthState,
} from '../src/stores/useAuthStore';
import {
  storeEngine,
  useAppStoreSelector,
  type AppState,
} from '../src/stores/useAppStore';

declare global {
  interface Window {
    __ADMIN_BOTTOM_NAV_ACTIVE_TAB__: () => string;
    __ADMIN_BOTTOM_NAV_QUICK_ACTION_OPEN__: () => boolean;
  }
}

interface AuthHarnessEngine {
  state: AuthState;
  getState: () => AuthState;
  initAuth: () => Promise<void>;
}

const engine = authStoreEngine as unknown as AuthHarnessEngine;
const params = new URLSearchParams(window.location.search);
const roleName = params.get('role') || 'owner';
const requestedStartTab = params.get('start');

engine.state = {
  ...engine.getState(),
  roleName,
  roles: [roleName],
  isAuthenticated: true,
  isLoading: false,
};
engine.initAuth = async () => undefined;

storeEngine.setCurrentUser({
  id: 'bottom-navigation-test-user',
  name: 'مستخدم اختبار التنقل السفلي',
  role: roleName === 'owner' ? 'Owner' : 'View Only',
  themeMode: 'dark',
});

const allowedStartTabs: readonly AppState['activeTab'][] = [
  'home',
  'orders',
  'inventory',
  'accounts',
  'more',
];
if (
  requestedStartTab &&
  allowedStartTabs.includes(requestedStartTab as AppState['activeTab'])
) {
  storeEngine.setActiveTab(requestedStartTab as AppState['activeTab']);
}

window.__ADMIN_BOTTOM_NAV_ACTIVE_TAB__ = () =>
  storeEngine.getState().activeTab;
window.__ADMIN_BOTTOM_NAV_QUICK_ACTION_OPEN__ = () =>
  storeEngine.getState().isQuickActionOpen;

const BottomNavigationHarness: React.FC = () => {
  const activeTab = useAppStoreSelector((state) => state.activeTab);

  return (
    <div
      dir="rtl"
      className="relative mx-auto flex h-[100dvh] w-full max-w-4xl flex-col overflow-hidden bg-slate-950 text-slate-100"
    >
      <main data-navigation-content className="min-h-0 flex-1 overflow-y-auto">
        <output data-testid="active-tab" className="sr-only">
          {activeTab}
        </output>
        {activeTab === 'more' ? (
          <MoreMenuView />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-300">
            الوجهة الحالية: {activeTab}
          </div>
        )}
      </main>
      <div
        data-navigation-action-dock
        className="relative h-16 shrink-0 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent pointer-events-none"
      >
        <QuickActionButton />
      </div>
      <BottomTabs />
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BottomNavigationHarness />
  </React.StrictMode>,
);

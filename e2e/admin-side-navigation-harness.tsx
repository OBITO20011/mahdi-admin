import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import { SideNav } from '../src/components/layout/SideNav';
import { authStoreEngine, type AuthState } from '../src/stores/useAuthStore';
import { storeEngine, useAppStoreSelector, type AppState } from '../src/stores/useAppStore';

declare global {
  interface Window {
    __ADMIN_SIDE_NAV_ACTIVE_TAB__: () => string;
    __ADMIN_SIDE_NAV_MODAL__: () => string | null;
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
const requestedTheme = params.get('theme') === 'dark' ? 'dark' : 'light';
const requestedStart = params.get('start');

document.documentElement.dataset.theme = requestedTheme;
document.documentElement.classList.toggle('theme-light', requestedTheme === 'light');
document.documentElement.classList.toggle('theme-dark', requestedTheme === 'dark');

engine.state = { ...engine.getState(), roleName, roles: [roleName], isAuthenticated: true, isLoading: false };
engine.initAuth = async () => undefined;

storeEngine.setCurrentUser({
  id: 'side-navigation-test-user',
  name: 'مهدي النواصرة',
  avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  role: roleName === 'owner' ? 'Owner' : 'Cashier',
  themeMode: requestedTheme,
});
(storeEngine as unknown as { state: AppState }).state.newOrdersCount = 6;
if (requestedStart === 'pos' || requestedStart === 'orders' || requestedStart === 'home') {
  storeEngine.setActiveTab(requestedStart);
}

window.__ADMIN_SIDE_NAV_ACTIVE_TAB__ = () => storeEngine.getState().activeTab;
window.__ADMIN_SIDE_NAV_MODAL__ = () => storeEngine.getState().currentModal ?? null;

const SideNavigationHarness: React.FC = () => {
  const activeTab = useAppStoreSelector((state) => state.activeTab);
  return (
    <div dir="rtl" className="flex h-[100dvh] w-full overflow-hidden bg-nw-bg font-sans text-nw-text">
      <SideNav collapsed={activeTab === 'pos'} />
      <main data-navigation-content className="flex min-w-0 flex-1 items-center justify-center p-8">
        <h1 className="text-xl font-bold">
          الوجهة الحالية: <output data-testid="active-tab">{activeTab}</output>
        </h1>
      </main>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SideNavigationHarness />
  </React.StrictMode>,
);

/**
 * Nawasrah Business Manager - Root Application Component
 * Standalone iPhone iOS Business & Accounting App Engine
 */

import React, { lazy, Suspense, useEffect, useRef } from 'react';
import {
  shallowEqual,
  useAppStoreActions,
  useAppStoreSelector,
} from './stores/useAppStore';
import { useAuthStore } from './stores/useAuthStore';
import { LoginView } from './features/auth/LoginView';
import { IPhoneContainer } from './components/layout/IPhoneContainer';
import { Header } from './components/common/Header';
import { BottomTabs } from './components/layout/BottomTabs';
import { QuickActionButton } from './components/layout/QuickActionButton';
import { BotMessageSquare, Building2, Loader2 } from 'lucide-react';
import { AppErrorBoundary } from './components/common/AppErrorBoundary';

const DashboardView = lazy(() =>
  import('./features/dashboard/DashboardView').then((module) => ({
    default: module.DashboardView,
  }))
);
const OrdersCenterView = lazy(() =>
  import('./features/orders/OrdersCenterView').then((module) => ({
    default: module.OrdersCenterView,
  }))
);
const PosView = lazy(() =>
  import('./features/pos/PosView').then((module) => ({
    default: module.PosView,
  }))
);
const ProductsView = lazy(() =>
  import('./features/products/ProductsView').then((module) => ({
    default: module.ProductsView,
  }))
);
const AccountsView = lazy(() =>
  import('./features/accounts/AccountsView').then((module) => ({
    default: module.AccountsView,
  }))
);
const InventoryView = lazy(() =>
  import('./features/inventory/InventoryView').then((module) => ({
    default: module.InventoryView,
  }))
);
const ExpensesView = lazy(() =>
  import('./features/expenses/ExpensesView').then((module) => ({
    default: module.ExpensesView,
  }))
);
const ShiftsView = lazy(() =>
  import('./features/shifts/ShiftsView').then((module) => ({
    default: module.ShiftsView,
  }))
);
const ReportsCenterView = lazy(() =>
  import('./features/reports/ReportsCenterView').then((module) => ({
    default: module.ReportsCenterView,
  }))
);
const UsersView = lazy(() =>
  import('./features/users/UsersView').then((module) => ({
    default: module.UsersView,
  }))
);
const MoreMenuView = lazy(() =>
  import('./features/more/MoreMenuView').then((module) => ({
    default: module.MoreMenuView,
  }))
);
const DirectReceivingView = lazy(() =>
  import('./features/directReceiving/DirectReceivingView').then((module) => ({
    default: module.DirectReceivingView,
  }))
);
const AdminAssistantView = lazy(() =>
  import('./features/assistant/AdminAssistantView').then((module) => ({
    default: module.AdminAssistantView,
  }))
);
const AllModals = lazy(() =>
  import('./components/modals/AllModals').then((module) => ({
    default: module.AllModals,
  }))
);

const ViewLoadingFallback: React.FC = () => (
  <div className="flex min-h-[50vh] items-center justify-center" dir="rtl">
    <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-xs font-bold text-slate-300 shadow-lg">
      <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
      <span>جاري فتح الشاشة...</span>
    </div>
  </div>
);

export const App: React.FC = () => {
  const {
    activeTab,
    currentModal,
    toast,
    themeMode,
    isBiometricsEnabled,
  } = useAppStoreSelector(
    (state) => ({
      activeTab: state.activeTab,
      currentModal: state.currentModal,
      toast: state.toast,
      themeMode: state.currentUser.themeMode,
      isBiometricsEnabled: state.isBiometricsEnabled,
    }),
    shallowEqual
  );
  const { setToast, lockWithFaceId, setActiveTab } = useAppStoreActions();
  const {
    isAuthenticated,
    isLoading: isAuthLoading,
    user: authenticatedUser,
    roleName,
  } = useAuthStore();
  const mainScrollRef = useRef<HTMLElement>(null);
  const biometricSessionUserRef = useRef<string | null>(null);
  const canUseAssistant = ['owner', 'admin', 'manager', 'accountant'].includes(
    roleName || '',
  );

  useEffect(() => {
    if (!isAuthenticated) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('screen') === 'orders') {
      setActiveTab('orders');
      params.delete('screen');
      params.delete('order');
      const query = params.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
      );
    }
  }, [isAuthenticated, setActiveTab]);

  useEffect(() => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  useEffect(() => {
    const activeThemeMode = themeMode === 'light' ? 'light' : 'dark';
    const root = document.documentElement;

    root.dataset.theme = activeThemeMode;
    root.classList.toggle('theme-light', activeThemeMode === 'light');
    root.classList.toggle('theme-dark', activeThemeMode === 'dark');
    root.style.colorScheme = activeThemeMode;

    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', activeThemeMode === 'light' ? '#f8fafc' : '#020617');
  }, [themeMode]);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    if (!isAuthenticated || !authenticatedUser?.id) {
      biometricSessionUserRef.current = null;
      return;
    }

    if (biometricSessionUserRef.current === authenticatedUser.id) {
      return;
    }

    biometricSessionUserRef.current = authenticatedUser.id;
    if (isBiometricsEnabled) {
      lockWithFaceId();
    }
  }, [
    authenticatedUser?.id,
    isAuthenticated,
    isAuthLoading,
    isBiometricsEnabled,
    lockWithFaceId,
  ]);

  useEffect(() => {
    let wasHidden = false;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wasHidden = true;
        return;
      }

      if (wasHidden && isAuthenticated && isBiometricsEnabled) {
        wasHidden = false;
        lockWithFaceId();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated, isBiometricsEnabled, lockWithFaceId]);

  const renderActiveTabContent = () => {
    switch (activeTab) {
      case 'home':
      case 'dashboard':
        return <DashboardView />;
      case 'orders':
        return <OrdersCenterView />;
      case 'pos':
        return <PosView />;
      case 'products':
        return <ProductsView />;
      case 'accounts':
        return <AccountsView />;
      case 'inventory':
        return <InventoryView />;
      case 'expenses':
        return <ExpensesView />;
      case 'shifts':
        return <ShiftsView />;
      case 'reports':
        return <ReportsCenterView />;
      case 'users':
        return <UsersView />;
      case 'purchases':
        return <DirectReceivingView />;
      case 'assistant':
        return <AdminAssistantView />;
      case 'more':
        return <MoreMenuView />;
      default:
        return <DashboardView />;
    }
  };

  // 1. Initial Session Check Screen
  if (isAuthLoading) {
    return (
      <IPhoneContainer>
        <div dir="rtl" className="min-h-full flex flex-col items-center justify-center p-6 text-slate-100 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center shadow-lg animate-pulse">
            <Building2 className="w-8 h-8" />
          </div>
          <div className="flex items-center gap-2.5 text-xs font-bold text-slate-300 bg-slate-900 border border-slate-800 px-4 py-2 rounded-2xl shadow">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            <span>جاري التحقق من جلسة الدخول والمصادقة...</span>
          </div>
        </div>
      </IPhoneContainer>
    );
  }

  // 2. Unauthenticated -> Login View Screen
  if (!isAuthenticated) {
    return (
      <IPhoneContainer>
        <LoginView />
      </IPhoneContainer>
    );
  }

  // 3. Authenticated -> Full Application Interface
  return (
    <IPhoneContainer>
      {/* Toast Notification Banner */}
      {toast && (
        <div
          onClick={() => setToast('', 'info')}
          className={`fixed top-12 left-4 right-4 z-50 p-3 rounded-2xl shadow-2xl text-xs font-bold transition-all transform animate-bounce flex items-center justify-between cursor-pointer border ${
            toast.type === 'error'
              ? 'bg-red-950 text-red-200 border-red-800'
              : toast.type === 'info'
              ? 'bg-amber-950 text-amber-200 border-amber-800'
              : 'bg-emerald-950 text-emerald-200 border-emerald-800'
          }`}
        >
          <span>{toast.message}</span>
          <span className="text-[10px] opacity-75">إغلاق ✕</span>
        </div>
      )}

      {/* Top Header Bar */}
      <Header />

      {/* Main Active View Scroll Area */}
      <main ref={mainScrollRef} className="flex-1 overflow-y-auto no-scrollbar">
        <AppErrorBoundary key={activeTab}>
          <Suspense fallback={<ViewLoadingFallback />}>
            {renderActiveTabContent()}
          </Suspense>
        </AppErrorBoundary>
      </main>

      {/* Speed Dial Quick Action Floating Button */}
      <QuickActionButton />

      {/* Bottom iOS Navigation Bar */}
      {canUseAssistant && activeTab !== 'assistant' && (
        <button
          type="button"
          onClick={() => setActiveTab('assistant')}
          aria-label="فتح المساعد الإداري الذكي"
          className="absolute bottom-20 left-3 z-20 flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-300/35 bg-gradient-to-br from-violet-500 to-indigo-700 text-white shadow-[0_14px_28px_-10px_rgba(139,92,246,0.95)] transition hover:from-violet-400 hover:to-indigo-600 active:scale-95"
        >
          <BotMessageSquare className="h-5 w-5" />
          <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-slate-950 bg-emerald-400" />
          <span className="sr-only">اسأل مساعد الإدارة</span>
        </button>
      )}
      <BottomTabs />

      {/* All Modal Sheets Dispatcher */}
      {currentModal && (
        <Suspense fallback={null}>
          <AllModals />
        </Suspense>
      )}
    </IPhoneContainer>
  );
};

export default App;

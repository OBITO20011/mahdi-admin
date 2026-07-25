/**
 * Nawasrah Business Manager - Root Application Component
 * Standalone iPhone iOS Business & Accounting App Engine
 */

import React from 'react';
import { useAppStore } from './stores/useAppStore';
import { useAuthStore } from './stores/useAuthStore';
import { LoginView } from './features/auth/LoginView';
import { IPhoneContainer } from './components/layout/IPhoneContainer';
import { Header } from './components/common/Header';
import { BottomTabs } from './components/layout/BottomTabs';
import { QuickActionButton } from './components/layout/QuickActionButton';
import { DashboardView } from './features/dashboard/DashboardView';
import { OrdersCenterView } from './features/orders/OrdersCenterView';
import { PosView } from './features/pos/PosView';
import { ProductsView } from './features/products/ProductsView';
import { AccountsView } from './features/accounts/AccountsView';
import { InventoryView } from './features/inventory/InventoryView';
import { AccountingView } from './features/accounting/AccountingView';
import { ExpensesView } from './features/expenses/ExpensesView';
import { ShiftsView } from './features/shifts/ShiftsView';
import { ReportsCenterView } from './features/reports/ReportsCenterView';
import { UsersView } from './features/users/UsersView';
import { MoreMenuView } from './features/more/MoreMenuView';
import { DirectReceivingView } from './features/directReceiving/DirectReceivingView';
import { SystemTestView } from './features/systemTest/SystemTestView';
import { AllModals } from './components/modals/AllModals';
import { Building2, Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const { activeTab, toast, setToast } = useAppStore();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuthStore();

  const renderActiveTabContent = () => {
    switch (activeTab) {
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
      case 'accounting':
        return <AccountingView />;
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
      case 'more':
        return <MoreMenuView />;
      case 'system_test':
        return <SystemTestView />;
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
      <main className="flex-1 overflow-y-auto no-scrollbar">
        {renderActiveTabContent()}
      </main>

      {/* Speed Dial Quick Action Floating Button */}
      <QuickActionButton />

      {/* Bottom iOS Navigation Bar */}
      <BottomTabs />

      {/* All Modal Sheets Dispatcher */}
      <AllModals />
    </IPhoneContainer>
  );
};

export default App;

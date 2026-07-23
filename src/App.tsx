/**
 * Nawasrah Business Manager - Root Application Component
 * Standalone iPhone iOS Business & Accounting App Engine
 */

import React from 'react';
import { useAppStore } from './stores/useAppStore';
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
import { AllModals } from './components/modals/AllModals';

export const App: React.FC = () => {
  const { activeTab, toast, setToast } = useAppStore();

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
      case 'more':
        return <MoreMenuView />;
      default:
        return <DashboardView />;
    }
  };

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

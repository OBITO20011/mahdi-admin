import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import { DashboardHome } from '../src/features/dashboard/DashboardHome';
import { DashboardView } from '../src/features/dashboard/DashboardView';
import { SideNav } from '../src/components/layout/SideNav';
import { Header } from '../src/components/common/Header';
import { BottomTabs } from '../src/components/layout/BottomTabs';
import { authStoreEngine, type AuthState } from '../src/stores/useAuthStore';
import { storeEngine, useAppStoreSelector, type AppState } from '../src/stores/useAppStore';
import { homeFixture, shiftFixture } from './package-f-home.fixture';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle('theme-light', theme === 'light');
document.documentElement.classList.toggle('theme-dark', theme === 'dark');
const auth = authStoreEngine as unknown as { state: AuthState; getState: () => AuthState; initAuth: () => Promise<void> };
const role = params.get('role') === 'cashier' ? 'cashier' : 'owner';
auth.state = { ...auth.getState(), roleName: role, roles: [role], isAuthenticated: true, isLoading: false };
auth.initAuth = async () => undefined;
storeEngine.setCurrentUser({ id: 'home-fixture-user', name: 'مهدي النواصرة', role: role === 'cashier' ? 'Cashier' : 'Owner', themeMode: theme, avatarUrl: '' });
const engine = storeEngine as unknown as { state: AppState; refreshOrdersFromSupabase: () => Promise<void>; refreshStockNotificationsFromSupabase: () => Promise<[]>; refreshExpenseShiftCenterFromSupabase: () => Promise<void> };
engine.state.newOrdersCount = 6;
engine.state.activeBranch = { id: 'branch-home', name: 'الفرع الرئيسي', address: '', city: 'الرمثا', phone: '', isMain: true };
engine.state.branches = [engine.state.activeBranch, { ...engine.state.activeBranch, id: 'branch-second', name: 'الفرع الثاني' }];
engine.state.notifications = [{ id: 'home-notification', title: 'تنبيه', message: 'تنبيه محلي للاختبار', type: 'stock', read: false, createdAt: homeFixture.generatedAt }];
engine.state.currentShift = params.has('noShift') ? null : shiftFixture;
engine.refreshOrdersFromSupabase = async () => undefined;
engine.refreshStockNotificationsFromSupabase = async () => [];
engine.refreshExpenseShiftCenterFromSupabase = async () => undefined;
storeEngine.setActiveTab('home');
const data = structuredClone(homeFixture);
if (params.has('unavailable')) data.financialFactsAvailable = false;
if (params.has('long')) {
  data.latestOrders[0].customerName = 'سوبرماركت الحي الكبير للمواد التموينية والمنتجات الغذائية والمشروبات';
  data.stockAlerts[0].nameAr = 'عصير البرتقال الطبيعي عبوة عائلية طويلة الاسم للمراجعة على الشاشات الصغيرة';
}
if (params.has('negative')) data.sevenDaySales[1].netSalesInMinorUnits = -150000;

const Harness = () => {
  const [action, setAction] = useState('');
  const headerState = useAppStoreSelector((state) => `${state.currentModal ?? ''}:${state.activeTab}:${state.activeBranch.id}`);
  return <div dir="rtl" className="flex h-[100dvh] bg-nw-bg font-sans text-nw-text">
    <SideNav />
    <div className="flex min-w-0 flex-1 flex-col">
      <Header />
      <main className="min-h-0 flex-1 overflow-y-auto" data-testid="home-scroll">
        {params.has('live') ? <DashboardView /> : <DashboardHome data={data} currentUserName="مهدي النواصرة" currentShift={engine.state.currentShift} loading={false} error={null} realtimeConnected={true}
          onRefresh={() => setAction('refresh')} onOrders={() => setAction('orders')} onAccounts={() => setAction('accounts')} onInventory={() => setAction('inventory')} onProducts={() => setAction('products')} onShift={() => setAction('shifts')} onSell={() => setAction('pos')} onReceive={(id) => setAction(`receive_goods:${id ?? ''}`)} onExpense={() => setAction('add_expense')} />}
        <output className="sr-only" data-testid="home-action">{action}</output>
        <output className="sr-only" data-testid="header-action">{headerState}</output>
      </main>
      <div className="lg:hidden"><BottomTabs /></div>
    </div>
  </div>;
};
createRoot(document.getElementById('root')!).render(<Harness />);

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import { OrdersCenterView, OrdersWorkbench } from '../src/features/orders/OrdersCenterView';
import { OrderDetailModal } from '../src/features/orders/OrderDetailModal';
import { SideNav } from '../src/components/layout/SideNav';
import { Header } from '../src/components/common/Header';
import { BottomTabs } from '../src/components/layout/BottomTabs';
import { authStoreEngine, type AuthState } from '../src/stores/useAuthStore';
import { storeEngine, type AppState } from '../src/stores/useAppStore';
import { matchesOperationalOrderFilter, type OperationalOrderFilter } from '../src/utils/orderCalculations';
import type { OperationalOrdersSort } from '../src/services/supabase/orders.service';
import { orderListFixture, ordersFixture } from './package-f-orders.fixture';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle('theme-light', theme === 'light');
document.documentElement.classList.toggle('theme-dark', theme === 'dark');
const auth = authStoreEngine as unknown as { state: AuthState; getState: () => AuthState; initAuth: () => Promise<void> };
auth.state = { ...auth.getState(), roleName: 'owner', roles: ['owner'], isAuthenticated: true, isLoading: false };
auth.initAuth = async () => undefined;
storeEngine.setCurrentUser({ id: 'orders-fixture-user', name: 'مهدي النواصرة', role: 'Owner', themeMode: theme, avatarUrl: '' });
const engine = storeEngine as unknown as { state: AppState; refreshOrdersFromSupabase: () => Promise<void>; refreshStockNotificationsFromSupabase: () => Promise<[]> };
engine.state.activeBranch = { id: 'orders-branch', name: 'الفرع الرئيسي', address: '', city: 'الرمثا', phone: '', isMain: true };
engine.state.branches = [engine.state.activeBranch];
engine.state.notifications = [];
engine.state.newOrdersCount = 1;
engine.refreshOrdersFromSupabase = async () => undefined;
engine.refreshStockNotificationsFromSupabase = async () => [];
storeEngine.setActiveTab('orders');
const fixture = structuredClone(ordersFixture);
const list = structuredClone(orderListFixture);
if (params.has('long')) {
  fixture[1].customerName = list[1].customerName = 'سوبرماركت الحي الكبير للمواد التموينية والمنتجات الغذائية والمشروبات';
  fixture[1].items[0].productName = 'عصير البرتقال الطبيعي عبوة عائلية طويلة الاسم للمراجعة على الشاشات الصغيرة';
}
const Harness = () => {
  const [filter, setFilter] = useState<OperationalOrderFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<OperationalOrdersSort>('newest');
  const [selected, setSelected] = useState<string | null>(params.has('select') || innerWidth >= 1024 ? fixture[1].id : null);
  const [action, setAction] = useState('');
  // Presentation fixture only; real reader and action contracts are exercised separately.
  const actions = storeEngine as unknown as Record<string, unknown>;
  for (const method of params.has('live') ? [] : ['confirmOrder', 'cancelOrder', 'advanceOrderStatus', 'startOrUpdateOrderDelivery', 'completeWebsiteOrderWithSettlement', 'openCustomerProfile']) {
    actions[method] = async (...args: unknown[]) => { setAction(JSON.stringify({ method, args })); return method === 'startOrUpdateOrderDelivery' ? { success: true, trackingUrl: '/#track=fixture', driverPhone: '0791234567' } : true; };
  }
  const rows = list.filter((order) => matchesOperationalOrderFilter(order.status, filter) && `${order.orderNumber} ${order.customerName} ${order.customerPhone}`.includes(search));
  if (sort === 'oldest') rows.reverse();
  const current = fixture.find((order) => order.id === selected);
  const counts = Object.fromEntries((['all', 'action', 'active', 'completed', 'returned', 'cancelled'] as OperationalOrderFilter[]).map((value) => [value, list.filter((order) => matchesOperationalOrderFilter(order.status, value)).length]));
  return <div dir="rtl" className="flex h-[100dvh] bg-nw-bg font-sans text-nw-text">
    <SideNav /><div className="flex min-w-0 flex-1 flex-col"><Header />
      <main data-testid="orders-scroll" className="min-h-0 flex-1 overflow-y-auto">
        {params.has('live') ? <OrdersCenterView /> : <OrdersWorkbench orders={rows} activeFilter={filter} counts={counts} summary={{ review: 1, active: 3, due: 0 }} searchQuery={search} sort={sort} page={1} totalCount={rows.length} totalPages={1} selectedOrderId={selected}
          sourceFor={(id) => fixture.find((order) => order.id === id)?.source} loading={false} refreshing={false} error={null}
          onOpen={setSelected} onFilter={setFilter} onSearch={setSearch} onSort={setSort} onPage={() => undefined} onRefresh={() => setAction('refresh')}
          detail={current && <OrderDetailModal key={current.id} embedded order={current} onClose={() => setSelected(null)} onOrderChanged={async () => setAction((value) => `${value}|changed`)} />} />}
        <output data-testid="orders-action" className="sr-only">{action}</output>
      </main><div className="lg:hidden"><BottomTabs /></div>
    </div>
  </div>;
};
createRoot(document.getElementById('root')!).render(<Harness />);

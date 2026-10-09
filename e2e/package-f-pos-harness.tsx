import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import { PosView } from '../src/features/pos/PosView';
import { SideNav } from '../src/components/layout/SideNav';
import { Header } from '../src/components/common/Header';
import { BottomTabs } from '../src/components/layout/BottomTabs';
import { authStoreEngine, type AuthState } from '../src/stores/useAuthStore';
import { storeEngine, useAppStoreSelector, type AppState } from '../src/stores/useAppStore';
import { supabase } from '../src/lib/supabase';
import { posFixtureIds, posFixtureProducts, posFixtureParcel } from './package-f-pos.fixture';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle('theme-light', theme === 'light');
document.documentElement.classList.toggle('theme-dark', theme === 'dark');
if (!supabase || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL).hostname)) {
  throw Error('POS preview requires the isolated loopback API;no external backend allowed.');
}
const auth = authStoreEngine as unknown as { state: AuthState; getState: () => AuthState; initAuth: () => Promise<void> };
auth.state = { ...auth.getState(), roleName: 'owner', roles: ['owner'], isAuthenticated: true, isLoading: false };
auth.initAuth = async () => undefined;
const engine = storeEngine as unknown as { state: AppState };
const branch = { id: posFixtureIds.branch, name: 'الفرع الرئيسي', address: '', city: 'الرمثا', phone: '', isMain: true };
engine.state = { ...engine.state, activeBranch: branch, branches: [branch], categories: [
  { id: 'drinks', nameAr: 'مشروبات', icon: 'Package' }, { id: 'food', nameAr: 'مواد غذائية', icon: 'Package' },
], warehouses: [{ id: posFixtureIds.warehouse, name: 'المستودع الرئيسي', branchId: branch.id, location: 'الرمثا' }] };
storeEngine.setCurrentUser({ id: posFixtureIds.actor, name: 'أحمد', role: 'Owner', themeMode: theme, avatarUrl: '' });
storeEngine.setActiveTab('pos');
supabase.auth.getUser = async () => ({ data: { user: { id: posFixtureIds.actor } }, error: null }) as Awaited<ReturnType<typeof supabase.auth.getUser>>;
const originalRpc = supabase.rpc.bind(supabase);
const client = supabase as unknown as { rpc: (name: string, args?: Record<string, unknown>) => unknown };
// Fixed READ fixtures only. Mutations still traverse the real service to the
// isolated API,where browser tests explicitly intercept them;never fake a sale.
client.rpc = (name, args) => {
  const success = (data: unknown) => Promise.resolve({ data, error: null });
  if (name === 'search_admin_products') {
    const search = String(args?.p_search ?? '').toLowerCase();
    return success(posFixtureProducts.filter(product =>
      (!args?.p_category_id || product.category_id === args.p_category_id) &&
      `${product.name_ar} ${product.sku} ${product.barcode}`.toLowerCase().includes(search)));
  }
  if (name === 'get_pos_configurable_parcel_options_v1') return success({ options: [posFixtureParcel] });
  if (name === 'get_open_pos_shift') return success({ success: true, hasOpenShift: !params.has('closed'),
    shift: { id: posFixtureIds.configuration, shiftNumber: 'SHIFT-42', branchId: branch.id, startTime: '2026-10-09T05:12:00Z' } });
  if (name === 'get_pos_customer_page') return success({ customers: [{ id: '55555555-5555-4555-8555-555555555555',
    full_name: 'سوبرماركت النور', phone: '0791234567' }], page: 1, page_size: 25, total_count: 1, has_more: false });
  return originalRpc(name, args);
};
function Harness() {
  const activeTab = useAppStoreSelector(state => state.activeTab);
  return <div dir="rtl" className="flex h-[100dvh] bg-nw-bg font-sans text-nw-text">
    <SideNav collapsed={activeTab === 'pos'} /><div className="flex min-w-0 flex-1 flex-col"><Header />
      <main data-testid="pos-scroll" className="min-h-0 flex-1 overflow-y-auto"><PosView /></main>
      <div className="lg:hidden"><BottomTabs /></div>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);

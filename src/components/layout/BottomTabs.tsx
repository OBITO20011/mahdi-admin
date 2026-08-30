/**
 * Nawasrah Business Manager - iOS Bottom Navigation Tabs
 */

import React from 'react';
import {
  shallowEqual,
  type AppState,
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import {
  Home,
  ShoppingBag,
  Boxes,
  Users,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react';

interface NavigationTab {
  id: AppState['activeTab'];
  label: string;
  icon: LucideIcon;
  badge?: number;
}

export const BottomTabs: React.FC = () => {
  const { activeTab, newOrdersCount } = useAppStoreSelector(
    (state) => ({
      activeTab: state.activeTab,
      newOrdersCount: state.orders.filter(
        (order) => order?.status === 'new' || order?.isNew,
      ).length,
    }),
    shallowEqual,
  );
  const { setActiveTab } = useAppStoreActions();

  const tabs: NavigationTab[] = [
    { id: 'home', label: 'الرئيسية', icon: Home },
    { id: 'orders', label: 'الطلبات', icon: ShoppingBag, badge: newOrdersCount },
    { id: 'inventory', label: 'المخزون', icon: Boxes },
    { id: 'accounts', label: 'العملاء', icon: Users },
    { id: 'more', label: 'المزيد', icon: MoreHorizontal },
  ];

  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="admin-bottom-tabs relative z-30 grid grid-cols-5 items-stretch border-t border-slate-800 bg-slate-900/95 px-1 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 shadow-2xl backdrop-blur-lg"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive =
          tab.id === 'home'
            ? activeTab === 'home' || activeTab === 'dashboard'
            : activeTab === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            data-bottom-tab={tab.id}
            onClick={() => setActiveTab(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center rounded-xl px-0.5 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
              isActive
                ? 'bg-blue-500/10 font-bold text-blue-300'
                : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
            }`}
          >
            <div className="relative shrink-0">
              <Icon
                className={`h-5 w-5 transition-transform ${
                  isActive ? 'scale-110' : ''
                }`}
              />
              {tab.badge && tab.badge > 0 ? (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold text-white motion-safe:animate-pulse">
                  {tab.badge}
                </span>
              ) : null}
            </div>
            <span className="mt-1 max-w-full truncate text-[10px] font-semibold tracking-tight">
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

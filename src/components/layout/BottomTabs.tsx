/**
 * Nawasrah Business Manager - phone bottom navigation (Package F spec §4.2).
 * Order from the right: Home, Orders, the raised centre "بيع" (POS),
 * Inventory, More. Customers & receivables now open from More.
 */

import React, { useEffect } from 'react';
import {
  shallowEqual,
  type AppState,
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import { subscribeToOrdersInSupabase } from '../../services/supabase/orders.service';
import {
  Home,
  ShoppingBag,
  Boxes,
  MoreHorizontal,
  Plus,
  type LucideIcon,
} from 'lucide-react';

interface NavigationTab {
  id: AppState['activeTab'];
  label: string;
  icon: LucideIcon;
  badge?: number;
  centre?: boolean;
}

const join = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');

export const BottomTabs: React.FC = () => {
  const { activeTab, newOrdersCount } = useAppStoreSelector(
    (state) => ({
      activeTab: state.activeTab,
      newOrdersCount: state.newOrdersCount,
    }),
    shallowEqual,
  );
  const { setActiveTab, refreshOrdersFromSupabase } = useAppStoreActions();

  useEffect(() => {
    void refreshOrdersFromSupabase();
    return subscribeToOrdersInSupabase(() => {
      void refreshOrdersFromSupabase();
    });
  }, [refreshOrdersFromSupabase]);

  const tabs: NavigationTab[] = [
    { id: 'home', label: 'الرئيسية', icon: Home },
    { id: 'orders', label: 'الطلبات', icon: ShoppingBag, badge: newOrdersCount },
    { id: 'pos', label: 'بيع', icon: Plus, centre: true },
    { id: 'inventory', label: 'المخزون', icon: Boxes },
    { id: 'more', label: 'المزيد', icon: MoreHorizontal },
  ];

  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="admin-bottom-tabs relative z-30 grid shrink-0 grid-cols-5 items-start border-t border-nw-border bg-nw-surface px-1 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-2 text-nw-muted"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive =
          tab.id === 'home'
            ? activeTab === 'home' || activeTab === 'dashboard'
            : activeTab === tab.id;

        if (tab.centre) {
          return (
            <button
              key={tab.id}
              type="button"
              data-bottom-tab={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className="relative -mt-[22px] flex min-h-14 min-w-0 flex-col items-center gap-[3px] rounded-xl text-xs font-bold text-nw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nw-accent focus-visible:ring-offset-2 focus-visible:ring-offset-nw-surface"
            >
              <span
                className={join(
                  'flex h-14 w-14 items-center justify-center rounded-[18px] bg-nw-accent text-nw-on-accent shadow-[0_8px_20px_rgba(226,115,31,0.35)] transition active:scale-95',
                  isActive && 'ring-4 ring-nw-warn-bg',
                )}
              >
                <Icon className="h-[26px] w-[26px]" strokeWidth={2.4} aria-hidden="true" />
              </span>
              {tab.label}
            </button>
          );
        }

        return (
          <button
            key={tab.id}
            type="button"
            data-bottom-tab={tab.id}
            onClick={() => setActiveTab(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            className={join(
              'relative flex min-h-14 min-w-0 flex-col items-center gap-[3px] rounded-xl px-0.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nw-accent',
              isActive ? 'font-bold text-nw-primary' : 'font-medium text-nw-muted hover:text-nw-text',
            )}
          >
            <span
              className={join(
                'relative flex h-[30px] w-[46px] items-center justify-center rounded-[10px]',
                isActive && 'bg-nw-tab-active-bg',
              )}
            >
              <Icon className="h-[22px] w-[22px]" strokeWidth={1.9} aria-hidden="true" />
              {tab.badge && tab.badge > 0 ? (
                <span className="nw-num absolute -right-1 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-nw-accent px-1 text-[10px] font-extrabold text-nw-on-accent">
                  {tab.badge}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

/**
 * Nawasrah Business Manager - iOS Bottom Navigation Tabs
 */

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Home, ShoppingBag, Boxes, MoreHorizontal, Plus } from 'lucide-react';

export const BottomTabs: React.FC = () => {
  const { activeTab, setActiveTab, orders, isQuickActionOpen, toggleQuickAction } = useAppStore();

  const newOrdersCount = (orders || []).filter((o) => o?.status === 'new' || o?.isNew).length;

  const tabs: { id: string; label: string; icon: any; badge?: number; isAction?: boolean }[] = [
    { id: 'home', label: 'الرئيسية', icon: Home },
    { id: 'orders', label: 'الطلبات', icon: ShoppingBag, badge: newOrdersCount },
    { id: 'quick-action', label: 'عملية', icon: Plus, isAction: true },
    { id: 'inventory', label: 'المخزون', icon: Boxes },
    { id: 'more', label: 'المزيد', icon: MoreHorizontal },
  ];

  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="relative z-30 grid grid-cols-5 items-end border-t border-slate-800 bg-slate-900/95 px-1 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 shadow-2xl backdrop-blur-lg"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive =
          tab.id === 'home'
            ? activeTab === 'home' || activeTab === 'dashboard'
            : activeTab === tab.id;

        if (tab.isAction) {
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => toggleQuickAction()}
              aria-label="فتح العمليات السريعة"
              aria-expanded={isQuickActionOpen}
              className="flex flex-col items-center justify-end text-blue-200 transition active:scale-95"
            >
              <span
                className={`-mt-6 flex h-12 w-12 items-center justify-center rounded-2xl border text-white shadow-[0_10px_24px_-8px_rgba(37,99,235,0.95)] transition ${
                  isQuickActionOpen
                    ? 'rotate-45 border-rose-300/50 bg-rose-600'
                    : 'border-blue-300/45 bg-gradient-to-br from-blue-500 to-indigo-700'
                }`}
              >
                <Icon className="h-6 w-6 stroke-[2.5]" />
              </span>
              <span className="mt-1 text-[9px] font-black">عملية</span>
            </button>
          );
        }

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`relative flex flex-col items-center justify-center rounded-xl py-1 transition ${
              isActive ? 'text-blue-400 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="relative">
              <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
              {tab.badge && tab.badge > 0 ? (
                <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[10px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
                  {tab.badge}
                </span>
              ) : null}
            </div>
            <span className="mt-1 text-[9px] tracking-tight">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

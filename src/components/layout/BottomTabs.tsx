/**
 * Nawasrah Business Manager - iOS Bottom Navigation Tabs
 */

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Home, ShoppingBag, Package, Users, MoreHorizontal } from 'lucide-react';

export const BottomTabs: React.FC = () => {
  const { activeTab, setActiveTab, orders } = useAppStore();

  const newOrdersCount = (orders || []).filter((o) => o?.status === 'new' || o?.isNew).length;

  const tabs: { id: string; label: string; icon: any; badge?: number }[] = [
    { id: 'home', label: 'الرئيسية', icon: Home },
    { id: 'orders', label: 'الطلبات', icon: ShoppingBag, badge: newOrdersCount },
    { id: 'products', label: 'المنتجات', icon: Package },
    { id: 'accounts', label: 'الحسابات', icon: Users },
    { id: 'more', label: 'المزيد', icon: MoreHorizontal },
  ];

  return (
    <div className="relative bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 px-2 py-2 flex items-center justify-between z-30 shadow-2xl">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative flex-1 flex flex-col items-center justify-center py-1 rounded-xl transition ${
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
            <span className="text-[10px] mt-1 tracking-tight">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};

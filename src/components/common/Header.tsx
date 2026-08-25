/**
 * Nawasrah Business Manager - iOS Header Component
 */

import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { subscribeToStockAlertChanges } from '../../services/supabase/stockAlerts.service';
import { Building2, Bell, ChevronDown, Check } from 'lucide-react';

export const Header: React.FC = () => {
  const {
    activeBranch,
    branches,
    setActiveBranch,
    currentUser,
    notifications,
    refreshStockNotificationsFromSupabase,
    openModal,
  } = useAppStore();

  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const unreadCount = (notifications || []).filter((n) => !n?.read).length;
  const knownStockAlertIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let isInitialLoad = true;

    const refreshAlerts = async () => {
      const latest = await refreshStockNotificationsFromSupabase();
      const newUnreadAlert = latest.find(
        (notification) =>
          !notification.read &&
          !knownStockAlertIds.current.has(notification.id)
      );

      if (
        !isInitialLoad &&
        newUnreadAlert &&
        document.hidden &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        new Notification(newUnreadAlert.title, {
          body: newUnreadAlert.message,
          tag: `stock-alert-${newUnreadAlert.id}`,
        });
      }

      knownStockAlertIds.current = new Set(
        latest.map((notification) => notification.id)
      );
      isInitialLoad = false;
    };

    refreshAlerts();
    const unsubscribe = subscribeToStockAlertChanges(refreshAlerts);
    return unsubscribe;
  }, [refreshStockNotificationsFromSupabase]);

  return (
    <header className="admin-app-header z-20 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2 shadow-md">
      {/* Branch Selector Dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowBranchDropdown(!showBranchDropdown)}
          className="flex max-w-[118px] items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-800/80 px-2 py-1.5 text-[10px] font-semibold text-slate-200 transition hover:bg-slate-800 active:scale-[0.98]"
        >
          <Building2 className="w-3.5 h-3.5 text-blue-400" />
          <span className="truncate">{activeBranch?.name || 'الفرع الرئيسي'}</span>
          <ChevronDown className="w-3 h-3 text-slate-400" />
        </button>

        {showBranchDropdown && (
          <div className="absolute top-full right-0 mt-1.5 w-56 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-1.5 z-50 text-xs">
            <div className="px-2 py-1.5 text-[10px] font-bold text-slate-400 border-b border-slate-800">
              اختر الفرع للتنقل:
            </div>
            {branches.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setActiveBranch(b.id);
                  setShowBranchDropdown(false);
                }}
                className={`w-full text-right px-3 py-2 rounded-xl flex items-center justify-between transition ${
                  activeBranch.id === b.id
                    ? 'bg-blue-600/20 text-blue-300 font-bold border border-blue-500/30'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div>
                  <div className="font-semibold">{b.name}</div>
                  <div className="text-[10px] text-slate-400">{b.city}</div>
                </div>
                {activeBranch.id === b.id && <Check className="w-4 h-4 text-blue-400" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Center Logo / Title */}
      <div className="min-w-0 flex-1 px-2 text-center">
        <h1 className="flex items-center justify-center gap-1 truncate text-[11px] font-black tracking-tight text-slate-100">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="truncate">نواصرة للمحاسبة</span>
        </h1>
      </div>

      {/* Right Controls: Notifications & Profile */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Notification Bell */}
        <button
          onClick={() => openModal('notifications')}
          className="relative flex h-8 w-8 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-800 text-slate-300 transition hover:text-white"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center animate-bounce">
              {unreadCount}
            </span>
          )}
        </button>

        {/* User Role Avatar */}
        <button
          onClick={() => openModal('profile')}
          className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 p-1 transition hover:bg-slate-750"
          title={currentUser.name}
        >
          <img
            src={currentUser.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'}
            alt={currentUser.name}
            className="w-6 h-6 rounded-lg object-cover border border-slate-600"
          />
          <div className="text-right hidden sm:block">
            <span className="text-[11px] font-bold text-slate-100 block leading-none">{currentUser.name}</span>
            <span className="text-[9px] font-medium text-blue-400 block mt-0.5">{currentUser.role}</span>
          </div>
        </button>
      </div>
    </header>
  );
};

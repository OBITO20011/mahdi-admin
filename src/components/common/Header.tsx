/**
 * Nawasrah Business Manager - iOS Header Component
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  shallowEqual,
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import { subscribeToStockAlertChanges } from '../../services/supabase/stockAlerts.service';
import { Building2, Bell, BotMessageSquare, ChevronDown, Check } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { UserAvatar } from '../ui';

export const Header: React.FC = () => {
  const {
    activeBranch,
    branches,
    notifications,
    currentUserName,
    currentUserRole,
    currentUserAvatarUrl,
    activeTab,
  } = useAppStoreSelector(
    (state) => ({
      activeBranch: state.activeBranch,
      branches: state.branches,
      notifications: state.notifications,
      currentUserName: state.currentUser.name,
      currentUserRole: state.currentUser.role,
      currentUserAvatarUrl: state.currentUser.avatarUrl,
      activeTab: state.activeTab,
    }),
    shallowEqual
  );
  const {
    setActiveBranch,
    refreshStockNotificationsFromSupabase,
    openModal,
    setActiveTab,
  } = useAppStoreActions();
  const { roleName } = useAuthStore();
  // Same role gate as before; on desktop the SideNav carries the assistant.
  const canUseAssistant = ['owner', 'admin', 'manager', 'accountant'].includes(
    roleName || '',
  );

  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const unreadCount = (notifications || []).filter((n) => !n?.read).length;
  const knownStockAlertIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let isInitialLoad = true;
    let initialRefreshTimer: number | null = null;

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

    // Let the active operational screen load first; alerts remain realtime and
    // are warmed shortly afterwards without competing with the first paint.
    initialRefreshTimer = window.setTimeout(() => {
      void refreshAlerts();
    }, 400);
    const unsubscribe = subscribeToStockAlertChanges(refreshAlerts);
    return () => {
      if (initialRefreshTimer) window.clearTimeout(initialRefreshTimer);
      unsubscribe();
    };
  }, [refreshStockNotificationsFromSupabase]);

  return (
    <header className="admin-app-header z-20 flex items-center justify-between border-b border-nw-border bg-nw-surface px-3 py-2 text-nw-text shadow-sm">
      {/* Branch Selector Dropdown */}
      <div className="relative">
        <button
          type="button"
          aria-label="اختيار الفرع"
          aria-expanded={showBranchDropdown}
          onClick={() => setShowBranchDropdown(!showBranchDropdown)}
          className="flex min-h-11 max-w-[118px] items-center gap-1.5 rounded-xl border border-nw-border bg-nw-surface-2 px-2 py-1.5 text-[10px] font-semibold text-nw-text transition hover:bg-nw-track active:scale-[0.98]"
        >
          <Building2 className="w-3.5 h-3.5 text-nw-primary" />
          <span className="truncate">{activeBranch?.name || 'الفرع الرئيسي'}</span>
          <ChevronDown className="w-3 h-3 text-nw-muted" />
        </button>

        {showBranchDropdown && (
          <div className="absolute top-full right-0 mt-1.5 w-56 bg-nw-surface border border-nw-border rounded-2xl shadow-2xl p-1.5 z-50 text-xs">
            <div className="px-2 py-1.5 text-[10px] font-bold text-nw-muted border-b border-nw-border">
              اختر الفرع للتنقل:
            </div>
            {branches.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setActiveBranch(b.id);
                  setShowBranchDropdown(false);
                }}
                className={`min-h-11 w-full text-right px-3 py-2 rounded-xl flex items-center justify-between transition ${
                  activeBranch.id === b.id
                    ? 'bg-nw-sel-row text-nw-primary font-bold border border-nw-border'
                    : 'text-nw-text hover:bg-nw-surface-2'
                }`}
              >
                <div>
                  <div className="font-semibold">{b.name}</div>
                  <div className="text-[10px] text-nw-muted">{b.city}</div>
                </div>
                {activeBranch.id === b.id && <Check className="w-4 h-4 text-nw-primary" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Center Logo / Title */}
      <div className="min-w-0 flex-1 px-2 text-center lg:hidden">
        <h1 className="flex items-center justify-center gap-1 truncate text-[11px] font-black tracking-tight text-nw-text">
          <span className="truncate">النواصرة</span>
        </h1>
      </div>

      {/* Right Controls: Notifications & Profile */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Assistant launcher (phone): replaces the former floating button. */}
        {canUseAssistant && activeTab !== 'assistant' && (
          <button
            type="button"
            onClick={() => setActiveTab('assistant')}
            aria-label="فتح المساعد الإداري الذكي"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-nw-border bg-nw-surface-2 text-nw-primary transition hover:bg-nw-track lg:hidden"
          >
            <BotMessageSquare className="w-4 h-4" />
          </button>
        )}

        {/* Notification Bell */}
        <button
          type="button"
          aria-label="الإشعارات"
          onClick={() => openModal('notifications')}
          className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-nw-border bg-nw-surface-2 text-nw-text transition hover:bg-nw-track"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-nw-accent text-nw-on-accent text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center animate-bounce">
              {unreadCount}
            </span>
          )}
        </button>

        {/* User Role Avatar */}
        <button
          type="button"
          aria-label={`الملف الشخصي: ${currentUserName}`}
          onClick={() => openModal('profile')}
          className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-nw-border bg-nw-surface-2 p-1 transition hover:bg-nw-track lg:hidden"
          title={currentUserName}
        >
          <UserAvatar name={currentUserName} src={currentUserAvatarUrl} className="h-6 w-6 text-xs" />
          <div className="text-right hidden sm:block">
            <span className="text-[11px] font-bold text-nw-text block leading-none">{currentUserName}</span>
            <span className="text-[11px] font-medium text-nw-muted block mt-0.5">{{Owner: 'المالك', Admin: 'مدير تنفيذي', Accountant: 'محاسب', Cashier: 'كاشير', 'Sales Employee': 'موظف مبيعات', 'Warehouse Employee': 'مسؤول مستودع', 'Orders Employee': 'متابع الطلبات', 'Delivery Driver': 'سائق توصيل', 'View Only': 'مشاهدة فقط'}[currentUserRole] || 'موظف'}</span>
          </div>
        </button>
      </div>
    </header>
  );
};

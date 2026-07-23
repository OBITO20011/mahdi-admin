/**
 * Nawasrah Business Manager - iOS Header Component
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Building2, Bell, Shield, ChevronDown, Check, WifiOff, AlertTriangle } from 'lucide-react';

export const Header: React.FC = () => {
  const {
    activeBranch,
    branches,
    setActiveBranch,
    currentUser,
    notifications,
    openModal,
    isOffline,
  } = useAppStore();

  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const unreadCount = (notifications || []).filter((n) => !n?.read).length;

  return (
    <header className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between z-20 shadow-md">
      {/* Branch Selector Dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowBranchDropdown(!showBranchDropdown)}
          className="flex items-center gap-2 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-200 transition active:scale-98"
        >
          <Building2 className="w-3.5 h-3.5 text-blue-400" />
          <span className="truncate max-w-[130px]">{activeBranch?.name || 'الفرع الرئيسي'}</span>
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
      <div className="text-center">
        <h1 className="text-xs font-black text-slate-100 tracking-tight flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span>نواصرة للمحاسبة</span>
        </h1>
        {isOffline && (
          <div className="flex items-center justify-center gap-1 text-[9px] text-amber-400 font-bold">
            <WifiOff className="w-2.5 h-2.5" />
            <span>محلي (Offline)</span>
          </div>
        )}
      </div>

      {/* Right Controls: Notifications & Profile */}
      <div className="flex items-center gap-2">
        {/* Notification Bell */}
        <button
          onClick={() => openModal('notifications')}
          className="relative w-8 h-8 rounded-xl bg-slate-800 border border-slate-700/80 flex items-center justify-center text-slate-300 hover:text-white transition"
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
          onClick={() => openModal('user_profile')}
          className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-750 transition"
        >
          <img
            src={currentUser.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'}
            alt={currentUser.name}
            className="w-6 h-6 rounded-lg object-cover border border-slate-600"
          />
          <span className="text-[10px] font-bold text-slate-300 hidden sm:inline">{currentUser.role}</span>
        </button>
      </div>
    </header>
  );
};

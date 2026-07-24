/**
 * Nawasrah Business Manager - More Options & Configuration Menu
 */

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import {
  Building2,
  Scan,
  Database,
  Radio,
  FileCheck2,
  Users,
  ChevronLeft,
  User as UserIcon,
  Moon,
  Sun,
  Edit3,
  LogOut,
  Terminal,
  ShoppingBag,
} from 'lucide-react';

export const MoreMenuView: React.FC = () => {
  const { signOut } = useAuthStore();
  const {
    activeBranch,
    branches,
    isBiometricsEnabled,
    toggleBiometrics,
    isOffline,
    toggleOfflineMode,
    currentUser,
    openModal,
    toggleThemeMode,
    setActiveTab,
  } = useAppStore();

  const isDarkMode = currentUser.themeMode !== 'light';

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Clickable User Card -> Profile Flow */}
      <button
        onClick={() => openModal('profile')}
        className="w-full flex items-center justify-between bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-slate-800 p-4 rounded-2xl shadow-lg hover:border-blue-500/50 transition group text-right"
      >
        <div className="flex items-center gap-3.5">
          <div className="relative">
            <img
              src={
                currentUser.avatarUrl ||
                'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'
              }
              alt={currentUser.name}
              className="w-13 h-13 rounded-2xl object-cover border-2 border-blue-500 shadow-md group-hover:scale-105 transition"
            />
            <div className="absolute -bottom-1 -right-1 bg-blue-600 text-white p-1 rounded-lg border border-slate-900 shadow">
              <Edit3 className="w-2.5 h-2.5" />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-extrabold text-blue-400 bg-blue-950/80 px-2 py-0.5 rounded-full border border-blue-800/80">
                {currentUser.role}
              </span>
              <span className="text-[10px] font-bold text-slate-300 bg-slate-950 px-2 py-0.5 rounded-full border border-slate-800">
                {branches.find((b) => b.id === currentUser.branchId)?.name || activeBranch.name}
              </span>
            </div>

            <h3 className="font-black text-slate-100 text-sm mt-1 flex items-center gap-2">
              <span>{currentUser.name}</span>
              <span className="text-[10px] text-blue-400 font-normal underline">
                (عرض وتعديل الملف)
              </span>
            </h3>

            <p className="text-[10px] text-slate-400 font-mono mt-0.5">
              {currentUser.email} | {currentUser.phone}
            </p>
          </div>
        </div>

        <ChevronLeft className="w-5 h-5 text-slate-500 group-hover:text-blue-400 group-hover:-translate-x-1 transition" />
      </button>

      {/* Profile & Main Options Group */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-2 space-y-1 shadow text-xs">
        {/* Profile Details */}
        <button
          onClick={() => openModal('profile')}
          className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-800 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center">
              <UserIcon className="w-4 h-4" />
            </div>
            <div className="text-right">
              <h4 className="font-bold text-slate-200">إدارة الملف الشخصي وتعديل البيانات</h4>
              <p className="text-[10px] text-slate-400">تحديث الاسم، الهاتف، البريد الإلكتروني والصورة</p>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </button>

        {/* Theme Light / Dark mode toggle */}
        <div className="flex items-center justify-between p-3 rounded-xl border-t border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-600/20 text-amber-400 flex items-center justify-center">
              {isDarkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </div>
            <div className="text-right">
              <h4 className="font-bold text-slate-200">الوضع الليلة الداكن (Dark / Light Mode)</h4>
              <p className="text-[10px] text-slate-400">
                المظهر الحالي: {isDarkMode ? 'الوضع الداكن' : 'الوضع الفاتح'}
              </p>
            </div>
          </div>
          <button
            onClick={() => toggleThemeMode()}
            className="bg-slate-950 border border-slate-800 text-slate-200 px-2.5 py-1 rounded-lg text-[10px] font-bold hover:bg-slate-800 transition"
          >
            تغيير المظهر
          </button>
        </div>

        {/* Branches */}
        <button
          onClick={() => openModal('branches_list')}
          className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-800 transition border-t border-slate-800/80"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="text-right">
              <h4 className="font-bold text-slate-200">إعدادات الفروع والمستودعات</h4>
              <p className="text-[10px] text-slate-400">الفرع الحالي: {activeBranch.name}</p>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </button>

        {/* Purchases & Wholesale Module */}
        <button
          onClick={() => setActiveTab('purchases')}
          className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-800 transition border-t border-slate-800/80"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div className="text-right">
              <h4 className="font-bold text-slate-200">إدارة المشتريات واستلام البضائع</h4>
              <p className="text-[10px] text-slate-400">طلبات الشراء، توريد المخازن، وسندات الصرف للموردين</p>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </button>

        {/* Users & Permissions */}
        <button
          onClick={() => openModal('users')}
          className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-800 transition border-t border-slate-800/80"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <div className="text-right">
              <h4 className="font-bold text-slate-200">إدارة المستخدمين والصلاحيات</h4>
              <p className="text-[10px] text-slate-400">تخصيص أدوار الموظفين وسجل الأمان</p>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </button>

        {/* Biometrics Face ID */}
        <div className="flex items-center justify-between p-3 rounded-xl border-t border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center">
              <Scan className="w-4 h-4" />
            </div>
            <div className="text-right">
              <h4 className="font-bold text-slate-200">الأمان ببصمة الوجه (Face ID)</h4>
              <p className="text-[10px] text-slate-400">تأكيد الهوية عند فتح التطبيق</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={isBiometricsEnabled}
            onChange={toggleBiometrics}
            className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
          />
        </div>

        {/* Offline Mode Switch */}
        <div className="flex items-center justify-between p-3 rounded-xl border-t border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-rose-600/20 text-rose-400 flex items-center justify-center">
              <Radio className="w-4 h-4" />
            </div>
            <div className="text-right">
              <h4 className="font-bold text-slate-200">العمل دون إنترنت (Offline Mode)</h4>
              <p className="text-[10px] text-slate-400">التخزين المحلي والمزامنة التلقائية</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={isOffline}
            onChange={toggleOfflineMode}
            className="w-4 h-4 accent-amber-600 rounded cursor-pointer"
          />
        </div>

        {/* Supabase SQL Files Exporter */}
        <button
          onClick={() => openModal('supabase_sql_preview')}
          className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-800 transition border-t border-slate-800/80"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-teal-600/20 text-teal-400 flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
            <div className="text-right">
              <h4 className="font-bold text-slate-200">ملفات وتصميم قاعدة البيانات Supabase SQL</h4>
              <p className="text-[10px] text-slate-400">عرض schema.sql وseed.sql وRLS Policies</p>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </button>

        {/* Automated QA Integration Test Runner */}
        <button
          onClick={() => openModal('qa_tests')}
          className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-800 transition border-t border-slate-800/80"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center">
              <FileCheck2 className="w-4 h-4" />
            </div>
            <div className="text-right">
              <h4 className="font-bold text-slate-200">منصة اختبارات الجودة QA Unit Tests</h4>
              <p className="text-[10px] text-slate-400">تشغيل فحص الحسابات وحجز المخزون والضرائب</p>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </button>

        {/* System Test Screen (Owner Only) */}
        <button
          onClick={() => setActiveTab('system_test')}
          className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-800 transition border-t border-slate-800/80"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center">
              <Terminal className="w-4 h-4" />
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5">
                <h4 className="font-bold text-slate-200">شاشة تجارب النظام (System Test)</h4>
                <span className="text-[9px] font-extrabold bg-red-950 text-red-400 border border-red-800/60 px-1.5 py-0.2 rounded-full">
                  Owner
                </span>
              </div>
              <p className="text-[10px] text-slate-400">اختبار تنفيذ Supabase RPCs وحجز المخزون الحقيقي</p>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      {/* Sign Out Button */}
      <button
        onClick={() => signOut()}
        className="w-full bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 text-red-300 font-bold p-3.5 rounded-2xl transition shadow-lg flex items-center justify-center gap-2.5 active:scale-98 text-xs"
      >
        <LogOut className="w-4 h-4 text-red-400" />
        <span>تسجيل الخروج من الحساب</span>
      </button>

      {/* App Info Footer */}
      <div className="text-center py-4 text-slate-500 text-[11px] space-y-1">
        <p className="font-bold text-slate-400">Nawasrah Business Manager v1.0.0 (Expo iOS Build)</p>
        <p>جميع الحقوق محفوظة لمؤسسة نواصرة التجارية © 2026</p>
      </div>
    </div>
  );
};

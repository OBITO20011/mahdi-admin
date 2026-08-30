/**
 * Nawasrah Business Manager - Grouped mobile settings and operations menu
 */

import React, { useEffect, useState } from 'react';
import {
  shallowEqual,
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { isDeviceBiometricAvailable } from '../../services/deviceBiometrics.service';
import { InstallAppPanel } from './InstallAppPanel';
import {
  ADMIN_NAVIGATION_GROUPS,
  getNextOpenNavigationGroup,
  type AdminNavigationAction,
  type AdminNavigationGroupId,
} from './adminNavigation.config';
import {
  BotMessageSquare,
  ChevronDown,
  ChevronLeft,
  LogOut,
  Moon,
  Scan,
  Sun,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

interface MenuItemProps {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  onClick: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({
  id,
  title,
  description,
  icon: Icon,
  tone,
  onClick,
}) => (
  <button
    type="button"
    data-navigation-id={id}
    onClick={onClick}
    className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-right transition hover:bg-slate-800/75 active:scale-[0.99]"
  >
    <span className="flex min-w-0 items-center gap-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-black text-slate-100">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[10px] leading-4 text-slate-400">
          {description}
        </span>
      </span>
    </span>
    <ChevronLeft className="h-4 w-4 shrink-0 text-slate-600" />
  </button>
);

interface MenuSectionProps {
  id: AdminNavigationGroupId;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  iconTone: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const MenuSection: React.FC<MenuSectionProps> = ({
  id,
  title,
  description,
  icon: Icon,
  iconTone,
  isOpen,
  onToggle,
  children,
}) => {
  const reduceMotion = useReducedMotion();
  const triggerId = `admin-navigation-trigger-${id}`;
  const panelId = `admin-navigation-panel-${id}`;

  return (
    <section
      data-navigation-group={id}
      className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-sm"
    >
      <button
        id={triggerId}
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex min-h-14 w-full items-center justify-between gap-3 p-3 text-right transition hover:bg-slate-800/50 active:scale-[0.995]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconTone}`}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-black text-slate-100">{title}</span>
            <span className="mt-0.5 block truncate text-[10px] leading-4 text-slate-400">
              {description}
            </span>
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform motion-reduce:transition-none ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={panelId}
            role="region"
            aria-labelledby={triggerId}
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
            className="overflow-hidden border-t border-slate-800"
          >
            <div className="px-2 py-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

export const MoreMenuView: React.FC = () => {
  const { signOut, roleName } = useAuthStore();
  const {
    activeBranch,
    branches,
    isBiometricsEnabled,
    currentUserName,
    currentUserRole,
    currentUserAvatarUrl,
    currentUserBranchId,
    themeMode,
  } = useAppStoreSelector(
    (state) => ({
      activeBranch: state.activeBranch,
      branches: state.branches,
      isBiometricsEnabled: state.isBiometricsEnabled,
      currentUserName: state.currentUser.name,
      currentUserRole: state.currentUser.role,
      currentUserAvatarUrl: state.currentUser.avatarUrl,
      currentUserBranchId: state.currentUser.branchId,
      themeMode: state.currentUser.themeMode,
    }),
    shallowEqual,
  );
  const { toggleBiometrics, openModal, toggleThemeMode, setActiveTab } =
    useAppStoreActions();

  const isDarkMode = themeMode !== 'light';
  const [isBiometricSupported, setIsBiometricSupported] = useState<boolean | null>(null);
  const [isUpdatingBiometrics, setIsUpdatingBiometrics] = useState(false);
  const [openSection, setOpenSection] = useState<AdminNavigationGroupId | null>('sales');

  useEffect(() => {
    let isMounted = true;

    void isDeviceBiometricAvailable().then((isAvailable) => {
      if (isMounted) setIsBiometricSupported(isAvailable);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleBiometricToggle = async () => {
    setIsUpdatingBiometrics(true);
    await toggleBiometrics();
    setIsUpdatingBiometrics(false);
  };

  const toggleSection = (section: AdminNavigationGroupId) => {
    setOpenSection((current) => getNextOpenNavigationGroup(current, section));
  };

  const handleNavigationAction = (action: AdminNavigationAction) => {
    if (action.type === 'tab') {
      setActiveTab(action.destination);
      return;
    }

    openModal(action.destination);
  };

  const canUseAssistant = ['owner', 'admin', 'manager', 'accountant'].includes(
    roleName || '',
  );
  const userBranch =
    branches.find((branch) => branch.id === currentUserBranchId)?.name ||
    activeBranch.name;

  return (
    <div dir="rtl" className="mx-auto max-w-2xl space-y-3 p-3 pb-6 sm:p-4 sm:pb-8">
      <header className="flex items-center justify-between gap-3 px-1 pt-1">
        <div>
          <h2 className="text-base font-black text-white">إدارة التطبيق</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">
            اختر ما تحتاجه فقط، دون ازدحام القوائم
          </p>
        </div>
        <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[9px] font-black text-blue-300">
          {activeBranch.name}
        </span>
      </header>

      {canUseAssistant && (
        <button
          type="button"
          data-navigation-id="assistant-shortcut"
          onClick={() => setActiveTab('assistant')}
          className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-violet-500/25 bg-gradient-to-l from-violet-950/70 to-slate-900 p-3 text-right shadow-sm transition hover:border-violet-400/40 active:scale-[0.99]"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
              <BotMessageSquare className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-black text-slate-100">
                المساعد الإداري الذكي
              </span>
              <span className="mt-0.5 block truncate text-[10px] leading-4 text-slate-400">
                وصول سريع مستقل بنفس الصلاحيات الحالية
              </span>
            </span>
          </span>
          <ChevronLeft className="h-4 w-4 shrink-0 text-violet-300" />
        </button>
      )}

      <div className="space-y-2" aria-label="أقسام التنقل الإداري">
        {ADMIN_NAVIGATION_GROUPS.map((group) => {
          const visibleItems = group.items.filter(
            (item) => item.visibility !== 'owner' || roleName === 'owner',
          );
          const GroupIcon = group.icon;

          return (
            <MenuSection
              key={group.id}
              id={group.id}
              title={group.label}
              description={group.description}
              icon={GroupIcon}
              iconTone={group.iconTone}
              isOpen={openSection === group.id}
              onToggle={() => toggleSection(group.id)}
            >
              {group.id === 'administration-store' && (
                <button
                  type="button"
                  data-navigation-id="profile-summary"
                  onClick={() => openModal('profile')}
                  className="mb-1 flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-right transition hover:bg-slate-800/75 active:scale-[0.99]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <img
                      src={
                        currentUserAvatarUrl ||
                        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'
                      }
                      alt={currentUserName}
                      className="h-10 w-10 shrink-0 rounded-xl border border-blue-500/50 object-cover"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-black text-slate-100">
                        {currentUserName}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] leading-4 text-slate-400">
                        {currentUserRole} · {userBranch}
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1 rounded-lg bg-blue-500/10 px-2 py-1 text-[9px] font-bold text-blue-300">
                    الملف <ChevronLeft className="h-3 w-3" />
                  </span>
                </button>
              )}

              {visibleItems.map((item) => (
                <MenuItem
                  key={item.id}
                  id={item.id}
                  title={item.label}
                  description={
                    item.classification === 'unclassified'
                      ? `الفرع الحالي: ${activeBranch.name} · Unclassified/Needs Decision`
                      : item.description
                  }
                  icon={item.icon}
                  tone={item.tone}
                  onClick={() => handleNavigationAction(item.action)}
                />
              ))}

              {group.id === 'administration-store' && (
                <>
                  <div data-navigation-id="install-app" className="border-t border-slate-800 py-2">
                    <InstallAppPanel />
                  </div>

                  <div
                    data-navigation-id="theme-toggle"
                    className="flex min-h-12 items-center justify-between gap-3 border-t border-slate-800 px-2 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300">
                        {isDarkMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[11px] font-black text-slate-100">مظهر التطبيق</span>
                        <span className="mt-0.5 block text-[10px] leading-4 text-slate-400">
                          {isDarkMode ? 'الوضع الداكن مفعّل' : 'الوضع الفاتح مفعّل'}
                        </span>
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleThemeMode()}
                      className="min-h-10 shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-[9px] font-black text-slate-200 transition hover:bg-slate-800"
                    >
                      {isDarkMode ? 'فاتح' : 'داكن'}
                    </button>
                  </div>

                  <div
                    data-navigation-id="biometric-toggle"
                    className="flex min-h-12 items-center justify-between gap-3 border-t border-slate-800 px-2 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-300">
                        <Scan className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[11px] font-black text-slate-100">قفل Face ID</span>
                        <span className="mt-0.5 block truncate text-[10px] leading-4 text-slate-400">
                          {isBiometricSupported === null
                            ? 'جاري التحقق من دعم الجهاز'
                            : isBiometricSupported
                              ? 'قفل إضافي عند فتح التطبيق'
                              : 'غير مدعوم على هذا الجهاز أو الاتصال غير آمن'}
                        </span>
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      aria-label="تفعيل قفل Face ID"
                      checked={isBiometricsEnabled}
                      onChange={() => void handleBiometricToggle()}
                      disabled={
                        isUpdatingBiometrics ||
                        (!isBiometricsEnabled && isBiometricSupported !== true)
                      }
                      className="h-5 w-5 shrink-0 cursor-pointer rounded accent-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                </>
              )}
            </MenuSection>
          );
        })}
      </div>

      <button
        type="button"
        data-navigation-id="sign-out"
        onClick={() => signOut()}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-800/60 bg-red-950/35 p-3 text-[11px] font-black text-red-300 transition hover:bg-red-900/55 active:scale-[0.99]"
      >
        <LogOut className="h-4 w-4" />
        تسجيل الخروج
      </button>

      <p className="pb-1 text-center text-[10px] leading-4 text-slate-400">
        نواصرة للمحاسبة وإدارة الأعمال · بياناتك محفوظة بأمان في Supabase
      </p>
    </div>
  );
};

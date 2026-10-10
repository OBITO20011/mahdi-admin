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
import { SECONDARY_QUICK_ACTIONS } from '../../components/layout/quickActions';
import { UserAvatar, Card, PageHeader, UiButton } from '../../components/ui';
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
  <UiButton variant="plain"
    type="button"
    data-navigation-id={id}
    onClick={onClick}
    className="!h-auto flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-right transition hover:bg-nw-surface active:scale-[0.99]"
  >
    <span className="flex min-w-0 items-center gap-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block break-words text-sm font-black text-nw-text">
          {title}
        </span>
        <span className="mt-0.5 block break-words text-xs leading-4 text-nw-muted">
          {description}
        </span>
      </span>
    </span>
    <ChevronLeft className="h-4 w-4 shrink-0 text-nw-muted" />
  </UiButton>
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
    <Card padded={false}
      data-navigation-group={id}
      className="overflow-hidden rounded-2xl border border-nw-border bg-nw-surface shadow-sm"
    >
      <UiButton variant="plain"
        id={triggerId}
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="!h-auto flex min-h-14 w-full items-center justify-between gap-3 p-3 text-right transition hover:bg-nw-surface active:scale-[0.995]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconTone}`}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-black text-nw-text">{title}</span>
            <span className="mt-0.5 block break-words text-xs leading-4 text-nw-muted">
              {description}
            </span>
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-nw-muted transition-transform motion-reduce:transition-none ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </UiButton>
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
            className="overflow-hidden border-t border-nw-border"
          >
            <div className="px-2 py-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
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
    <div dir="rtl" className="mx-auto max-w-2xl space-y-3 bg-nw-bg p-3 pb-6 text-nw-text sm:p-4 sm:pb-8">
      <PageHeader title="إدارة التطبيق" description="اختر ما تحتاجه فقط، دون ازدحام القوائم"
        actions={<span className="rounded-full bg-nw-info-bg px-3 py-1 text-xs font-bold text-nw-info">{activeBranch.name}</span>} />

      {/* Former floating quick actions (Package F §4.2); "بيع" is the centre tab. */}
      <section aria-label="إجراءات سريعة" className="grid grid-cols-3 gap-2">
        {SECONDARY_QUICK_ACTIONS.map((quickAction) => {
          const QuickIcon = quickAction.icon;
          return (
            <UiButton variant="plain"
              key={quickAction.id}
              type="button"
              data-navigation-id={quickAction.id}
              onClick={() => handleNavigationAction(quickAction.action)}
              className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl border border-nw-border bg-nw-surface p-2 text-center text-sm font-bold text-nw-text transition hover:bg-nw-surface active:scale-[0.98]"
            >
              <QuickIcon className="h-5 w-5 text-nw-warn" aria-hidden="true" />
              {quickAction.shortLabel}
            </UiButton>
          );
        })}
      </section>

      {canUseAssistant && (
        <UiButton variant="plain"
          type="button"
          data-navigation-id="assistant-shortcut"
          onClick={() => setActiveTab('assistant')}
          className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-nw-info bg-nw-surface-2 p-3 text-right shadow-sm transition hover:border-nw-info active:scale-[0.99]"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-nw-info-bg text-nw-info">
              <BotMessageSquare className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-black text-nw-text">
                المساعد الإداري الذكي
              </span>
              <span className="mt-0.5 block break-words text-xs leading-4 text-nw-muted">
                وصول سريع مستقل بنفس الصلاحيات الحالية
              </span>
            </span>
          </span>
          <ChevronLeft className="h-4 w-4 shrink-0 text-nw-info" />
        </UiButton>
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
                <UiButton variant="plain"
                  type="button"
                  data-navigation-id="profile-summary"
                  onClick={() => openModal('profile')}
                  className="!h-auto mb-1 flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-right transition hover:bg-nw-surface active:scale-[0.99]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <UserAvatar name={currentUserName} src={currentUserAvatarUrl} className="h-10 w-10" />
                    <span className="min-w-0">
                      <span className="block break-words text-xs font-black text-nw-text">
                        {currentUserName}
                      </span>
                      <span className="mt-0.5 block break-words text-xs leading-4 text-nw-muted">
                        {currentUserRole} · {userBranch}
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1 rounded-lg bg-nw-info-bg px-2 py-1 text-xs font-bold text-nw-info">
                    الملف <ChevronLeft className="h-3 w-3" />
                  </span>
                </UiButton>
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
                  <div data-navigation-id="install-app" className="border-t border-nw-border py-2">
                    <InstallAppPanel />
                  </div>

                  <div
                    data-navigation-id="theme-toggle"
                    className="flex min-h-12 items-center justify-between gap-3 border-t border-nw-border px-2 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-nw-warn-bg text-nw-warn">
                        {isDarkMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-black text-nw-text">مظهر التطبيق</span>
                        <span className="mt-0.5 block text-xs leading-4 text-nw-muted">
                          {isDarkMode ? 'الوضع الداكن مفعّل' : 'الوضع الفاتح مفعّل'}
                        </span>
                      </span>
                    </span>
                    <UiButton variant="plain"
                      type="button"
                      onClick={() => toggleThemeMode()}
                      className="min-h-11 shrink-0 rounded-lg border border-nw-border bg-nw-surface-2 px-3 py-1.5 text-xs font-black text-nw-text transition hover:bg-nw-surface"
                    >
                      {isDarkMode ? 'فاتح' : 'داكن'}
                    </UiButton>
                  </div>

                  <div
                    data-navigation-id="biometric-toggle"
                    className="flex min-h-12 items-center justify-between gap-3 border-t border-nw-border px-2 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-nw-info-bg text-nw-info">
                        <Scan className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-black text-nw-text">قفل Face ID</span>
                        <span className="mt-0.5 block break-words text-xs leading-4 text-nw-muted">
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
                      className="h-11 w-11 shrink-0 cursor-pointer rounded accent-nw-primary disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                </>
              )}
            </MenuSection>
          );
        })}
      </div>

      <UiButton variant="plain"
        type="button"
        data-navigation-id="sign-out"
        onClick={() => signOut()}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-nw-bad bg-nw-bad-bg p-3 text-sm font-black text-nw-bad transition hover:bg-nw-bad-bg active:scale-[0.99]"
      >
        <LogOut className="h-4 w-4" />
        تسجيل الخروج
      </UiButton>

      <p className="pb-1 text-center text-xs leading-4 text-nw-muted">
        النواصرة · إدارة الأعمال
      </p>
    </div>
  );
};

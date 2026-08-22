/**
 * Nawasrah Business Manager - Grouped mobile settings and operations menu
 */

import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { isDeviceBiometricAvailable } from '../../services/deviceBiometrics.service';
import { InstallAppPanel } from './InstallAppPanel';
import {
  BarChart3,
  Building2,
  Boxes,
  ChevronDown,
  ChevronLeft,
  LogOut,
  Moon,
  Package,
  ReceiptText,
  Scan,
  ShoppingBag,
  Store,
  Sun,
  TicketPercent,
  UserRound,
  Users,
  WalletCards,
} from 'lucide-react';

interface MenuItemProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  onClick: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({
  title,
  description,
  icon: Icon,
  tone,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-right transition hover:bg-slate-800/75 active:scale-[0.99]"
  >
    <span className="flex min-w-0 items-center gap-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-black text-slate-100">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[9px] text-slate-500">
          {description}
        </span>
      </span>
    </span>
    <ChevronLeft className="h-4 w-4 shrink-0 text-slate-600" />
  </button>
);

interface MenuSectionProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  iconTone: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const MenuSection: React.FC<MenuSectionProps> = ({
  title,
  description,
  icon: Icon,
  iconTone,
  isOpen,
  onToggle,
  children,
}) => (
  <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-sm">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className="flex w-full items-center justify-between gap-3 p-3 text-right transition hover:bg-slate-800/50"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconTone}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-black text-slate-100">{title}</span>
          <span className="mt-0.5 block truncate text-[9px] text-slate-500">
            {description}
          </span>
        </span>
      </span>
      <ChevronDown
        className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${
          isOpen ? 'rotate-180' : ''
        }`}
      />
    </button>
    {isOpen && <div className="border-t border-slate-800 px-2 py-1">{children}</div>}
  </section>
);

export const MoreMenuView: React.FC = () => {
  const { signOut } = useAuthStore();
  const {
    activeBranch,
    branches,
    isBiometricsEnabled,
    toggleBiometrics,
    currentUser,
    openModal,
    toggleThemeMode,
    setActiveTab,
  } = useAppStore();

  const isDarkMode = currentUser.themeMode !== 'light';
  const [isBiometricSupported, setIsBiometricSupported] = useState<boolean | null>(null);
  const [isUpdatingBiometrics, setIsUpdatingBiometrics] = useState(false);
  const [openSection, setOpenSection] = useState<'daily' | 'store' | 'app' | null>('daily');

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

  const toggleSection = (section: 'daily' | 'store' | 'app') => {
    setOpenSection((current) => (current === section ? null : section));
  };

  const userBranch =
    branches.find((branch) => branch.id === currentUser.branchId)?.name ||
    activeBranch.name;

  return (
    <div dir="rtl" className="mx-auto max-w-2xl space-y-3 p-3 pb-28 sm:p-4">
      <header className="flex items-center justify-between gap-3 px-1 pt-1">
        <div>
          <h2 className="text-base font-black text-white">إدارة التطبيق</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">
            اختر ما تحتاجه فقط، دون ازدحام القوائم
          </p>
        </div>
        <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[9px] font-black text-blue-300">
          {activeBranch.name}
        </span>
      </header>

      <button
        type="button"
        onClick={() => openModal('profile')}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-gradient-to-l from-slate-900 via-slate-900 to-slate-950 p-3 text-right shadow-lg transition hover:border-blue-500/35 active:scale-[0.99]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <img
            src={
              currentUser.avatarUrl ||
              'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'
            }
            alt={currentUser.name}
            className="h-10 w-10 shrink-0 rounded-xl border border-blue-500/50 object-cover"
          />
          <span className="min-w-0">
            <span className="block truncate text-xs font-black text-slate-100">
              {currentUser.name}
            </span>
            <span className="mt-0.5 block truncate text-[9px] text-slate-500">
              {currentUser.role} · {userBranch}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-1 rounded-lg bg-blue-500/10 px-2 py-1 text-[9px] font-bold text-blue-300">
          الملف <ChevronLeft className="h-3 w-3" />
        </span>
      </button>

      <InstallAppPanel />

      <MenuSection
        title="إدارة العمل اليومي"
        description="البيع، الموردون، العملاء، الصندوق والتقارير"
        icon={WalletCards}
        iconTone="border border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
        isOpen={openSection === 'daily'}
        onToggle={() => toggleSection('daily')}
      >
        <MenuItem
          title="الأصناف والمنتجات"
          description="الأسعار، طرد البيع، الصور والأقسام"
          icon={Package}
          tone="bg-blue-500/10 text-blue-300"
          onClick={() => setActiveTab('products')}
        />
        <MenuItem
          title="العملاء والذمم"
          description="كشف العميل، الدفعات والمبالغ المستحقة"
          icon={Users}
          tone="bg-violet-500/10 text-violet-300"
          onClick={() => setActiveTab('accounts')}
        />
        <MenuItem
          title="استلام البضائع من الموردين"
          description="تحديث المخزون وتكلفة الصنف ومستحقات المورد"
          icon={ShoppingBag}
          tone="bg-cyan-500/10 text-cyan-300"
          onClick={() => setActiveTab('purchases')}
        />
        <MenuItem
          title="الصندوق والورديات"
          description="فتح وإغلاق ومطابقة الكاش وCliQ"
          icon={WalletCards}
          tone="bg-emerald-500/10 text-emerald-300"
          onClick={() => setActiveTab('shifts')}
        />
        <MenuItem
          title="المصروفات التشغيلية"
          description="مصروف كاش أو CliQ مرتبط بالوردية"
          icon={ReceiptText}
          tone="bg-amber-500/10 text-amber-300"
          onClick={() => setActiveTab('expenses')}
        />
        <MenuItem
          title="التقارير والحسابات"
          description="المبيعات والربح والمخزون والذمم مع PDF"
          icon={BarChart3}
          tone="bg-indigo-500/10 text-indigo-300"
          onClick={() => setActiveTab('reports')}
        />
      </MenuSection>

      <MenuSection
        title="المتجر الإلكتروني"
        description="إعدادات الطلب والتوصيل والعروض"
        icon={Store}
        iconTone="border border-orange-500/20 bg-orange-500/10 text-orange-300"
        isOpen={openSection === 'store'}
        onToggle={() => toggleSection('store')}
      >
        <MenuItem
          title="إعدادات المتجر والتوصيل"
          description="واتساب وCliQ والحد الأدنى ورسوم التوصيل"
          icon={Store}
          tone="bg-orange-500/10 text-orange-300"
          onClick={() => openModal('storefront_settings')}
        />
        <MenuItem
          title="رموز الخصم للموقع"
          description="إنشاء البروموكود وصلاحيته وحدود استخدامه"
          icon={TicketPercent}
          tone="bg-violet-500/10 text-violet-300"
          onClick={() => openModal('promotion_codes')}
        />
      </MenuSection>

      <MenuSection
        title="التطبيق والحماية"
        description="الملف، الفروع، المظهر وقفل الجهاز"
        icon={Scan}
        iconTone="border border-blue-500/20 bg-blue-500/10 text-blue-300"
        isOpen={openSection === 'app'}
        onToggle={() => toggleSection('app')}
      >
        <MenuItem
          title="الملف الشخصي"
          description="الاسم والهاتف والبريد والصورة"
          icon={UserRound}
          tone="bg-blue-500/10 text-blue-300"
          onClick={() => openModal('profile')}
        />
        <MenuItem
          title="الفروع والمستودعات"
          description={`الفرع الحالي: ${activeBranch.name}`}
          icon={Building2}
          tone="bg-emerald-500/10 text-emerald-300"
          onClick={() => openModal('branches_list')}
        />
        <MenuItem
          title="المخزون الفعلي"
          description="الأرصدة المتاحة والمحجوزة وسجل الحركات"
          icon={Boxes}
          tone="bg-cyan-500/10 text-cyan-300"
          onClick={() => setActiveTab('inventory')}
        />
        <div className="flex items-center justify-between gap-3 border-t border-slate-800 px-2 py-2.5">
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300">
              {isDarkMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-black text-slate-100">مظهر التطبيق</span>
              <span className="mt-0.5 block text-[9px] text-slate-500">
                {isDarkMode ? 'الوضع الداكن مفعّل' : 'الوضع الفاتح مفعّل'}
              </span>
            </span>
          </span>
          <button
            type="button"
            onClick={() => toggleThemeMode()}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[9px] font-black text-slate-200 transition hover:bg-slate-800"
          >
            {isDarkMode ? 'فاتح' : 'داكن'}
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-800 px-2 py-2.5">
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-300">
              <Scan className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-black text-slate-100">قفل Face ID</span>
              <span className="mt-0.5 block truncate text-[9px] text-slate-500">
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
            className="h-4 w-4 shrink-0 cursor-pointer rounded accent-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </MenuSection>

      <button
        type="button"
        onClick={() => signOut()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-800/60 bg-red-950/35 p-3 text-[11px] font-black text-red-300 transition hover:bg-red-900/55 active:scale-[0.99]"
      >
        <LogOut className="h-4 w-4" />
        تسجيل الخروج
      </button>

      <p className="pb-1 text-center text-[9px] text-slate-600">
        نواصرة للمحاسبة وإدارة الأعمال · بياناتك محفوظة بأمان في Supabase
      </p>
    </div>
  );
};

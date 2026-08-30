import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Boxes,
  Building2,
  Package,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  Store,
  TicketPercent,
  Truck,
  UserRound,
  Users,
  WalletCards,
} from 'lucide-react';
import type { AppState } from '../../stores/useAppStore';

export type AdminNavigationGroupId =
  | 'sales'
  | 'products-inventory'
  | 'customers'
  | 'suppliers-purchases'
  | 'finance-reports'
  | 'administration-store';

export type AdminNavigationAction =
  | { type: 'tab'; destination: AppState['activeTab'] }
  | { type: 'modal'; destination: string };

export interface AdminNavigationItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: string;
  action: AdminNavigationAction;
  visibility?: 'all' | 'owner';
  classification?: 'classified' | 'unclassified';
}

export interface AdminNavigationGroup {
  id: AdminNavigationGroupId;
  label: string;
  description: string;
  icon: LucideIcon;
  iconTone: string;
  items: readonly AdminNavigationItem[];
}

export const ADMIN_NAVIGATION_GROUPS: readonly AdminNavigationGroup[] = [
  {
    id: 'sales',
    label: 'المبيعات',
    description: 'نقطة البيع ومتابعة طلبات العملاء',
    icon: ShoppingBag,
    iconTone: 'border border-blue-500/20 bg-blue-500/10 text-blue-300',
    items: [
      {
        id: 'sales-pos',
        label: 'نقطة البيع POS',
        description: 'فاتورة بيع جملة مباشرة مع الطباعة والتحصيل',
        icon: ReceiptText,
        tone: 'bg-emerald-500/10 text-emerald-300',
        action: { type: 'tab', destination: 'pos' },
      },
      {
        id: 'sales-orders',
        label: 'الطلبات',
        description: 'متابعة الطلبات والتجهيز والتوصيل والمرتجعات',
        icon: ShoppingBag,
        tone: 'bg-blue-500/10 text-blue-300',
        action: { type: 'tab', destination: 'orders' },
      },
    ],
  },
  {
    id: 'products-inventory',
    label: 'المنتجات والمخزون',
    description: 'الأصناف والأرصدة والمستودعات والحركات',
    icon: Boxes,
    iconTone: 'border border-cyan-500/20 bg-cyan-500/10 text-cyan-300',
    items: [
      {
        id: 'catalog-products',
        label: 'الأصناف والمنتجات',
        description: 'الأسعار، طرد البيع، الصور والأقسام',
        icon: Package,
        tone: 'bg-blue-500/10 text-blue-300',
        action: { type: 'tab', destination: 'products' },
      },
      {
        id: 'inventory-current',
        label: 'المخزون الفعلي',
        description: 'الأرصدة المتاحة والمحجوزة وسجل الحركات',
        icon: Boxes,
        tone: 'bg-cyan-500/10 text-cyan-300',
        action: { type: 'tab', destination: 'inventory' },
      },
    ],
  },
  {
    id: 'customers',
    label: 'العملاء والذمم',
    description: 'دليل العملاء والدفعات وكشوف الحساب',
    icon: Users,
    iconTone: 'border border-violet-500/20 bg-violet-500/10 text-violet-300',
    items: [
      {
        id: 'customer-accounts',
        label: 'العملاء والذمم',
        description: 'كشف العميل، الدفعات والمبالغ المستحقة',
        icon: Users,
        tone: 'bg-violet-500/10 text-violet-300',
        action: { type: 'tab', destination: 'accounts' },
      },
    ],
  },
  {
    id: 'suppliers-purchases',
    label: 'الموردون والمشتريات',
    description: 'الاستلام والموردون والمدفوعات والسجل',
    icon: Truck,
    iconTone: 'border border-teal-500/20 bg-teal-500/10 text-teal-300',
    items: [
      {
        id: 'supplier-receiving',
        label: 'استلام البضائع من الموردين',
        description: 'الاستلامات وذمم الموردين والمدفوعات وسجل المشتريات',
        icon: Truck,
        tone: 'bg-teal-500/10 text-teal-300',
        action: { type: 'tab', destination: 'purchases' },
      },
    ],
  },
  {
    id: 'finance-reports',
    label: 'المالية والتقارير',
    description: 'الورديات والمصروفات والربح والتقارير',
    icon: WalletCards,
    iconTone: 'border border-amber-500/20 bg-amber-500/10 text-amber-300',
    items: [
      {
        id: 'finance-shifts',
        label: 'الصندوق والورديات',
        description: 'فتح وإغلاق ومطابقة الكاش وCliQ',
        icon: WalletCards,
        tone: 'bg-emerald-500/10 text-emerald-300',
        action: { type: 'tab', destination: 'shifts' },
      },
      {
        id: 'finance-expenses',
        label: 'المصروفات التشغيلية',
        description: 'مصروف كاش أو CliQ مرتبط بالوردية',
        icon: ReceiptText,
        tone: 'bg-amber-500/10 text-amber-300',
        action: { type: 'tab', destination: 'expenses' },
      },
      {
        id: 'finance-reports',
        label: 'التقارير والحسابات',
        description: 'المبيعات والربح والمخزون والذمم مع PDF',
        icon: BarChart3,
        tone: 'bg-indigo-500/10 text-indigo-300',
        action: { type: 'tab', destination: 'reports' },
      },
    ],
  },
  {
    id: 'administration-store',
    label: 'الإدارة والمتجر',
    description: 'الحساب والصلاحيات والمتجر وحماية التطبيق',
    icon: Store,
    iconTone: 'border border-orange-500/20 bg-orange-500/10 text-orange-300',
    items: [
      {
        id: 'admin-users',
        label: 'المستخدمون والصلاحيات',
        description: 'إضافة الموظفين وتحديد دورهم وتعطيل الحسابات بأمان',
        icon: ShieldCheck,
        tone: 'bg-violet-500/10 text-violet-300',
        action: { type: 'tab', destination: 'users' },
        visibility: 'owner',
      },
      {
        id: 'admin-storefront',
        label: 'إعدادات المتجر والتوصيل',
        description: 'واتساب وCliQ والحد الأدنى ورسوم التوصيل',
        icon: Store,
        tone: 'bg-orange-500/10 text-orange-300',
        action: { type: 'modal', destination: 'storefront_settings' },
      },
      {
        id: 'admin-promotions',
        label: 'رموز الخصم للموقع',
        description: 'إنشاء البروموكود وصلاحيته وحدود استخدامه',
        icon: TicketPercent,
        tone: 'bg-violet-500/10 text-violet-300',
        action: { type: 'modal', destination: 'promotion_codes' },
      },
      {
        id: 'admin-profile',
        label: 'الملف الشخصي',
        description: 'البيانات الشخصية والأمان والجلسات والإشعارات',
        icon: UserRound,
        tone: 'bg-blue-500/10 text-blue-300',
        action: { type: 'modal', destination: 'profile' },
      },
      {
        id: 'unclassified-branches',
        label: 'الفروع والمستودعات',
        description: 'المدخل القديم محفوظ كما هو ويحتاج قرارًا لعدم وجود شاشة مسجّلة له',
        icon: Building2,
        tone: 'bg-emerald-500/10 text-emerald-300',
        action: { type: 'modal', destination: 'branches_list' },
        classification: 'unclassified',
      },
    ],
  },
] as const;

export const getNextOpenNavigationGroup = (
  current: AdminNavigationGroupId | null,
  requested: AdminNavigationGroupId,
): AdminNavigationGroupId | null => (current === requested ? null : requested);

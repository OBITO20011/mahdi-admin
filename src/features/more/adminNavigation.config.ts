import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Activity,
  Boxes,
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
import type { ModalNameCallableWithoutPayload } from '../../stores/modalTypes';

export type AdminNavigationGroupId =
  | 'sales'
  | 'products-inventory'
  | 'customers'
  | 'suppliers-purchases'
  | 'finance-reports'
  | 'administration-store';

export type AdminNavigationAction =
  | { type: 'tab'; destination: AppState['activeTab'] }
  | { type: 'modal'; destination: ModalNameCallableWithoutPayload };

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
    iconTone: 'border border-nw-info bg-nw-info-bg text-nw-info',
    items: [
      {
        id: 'sales-pos',
        label: 'نقطة البيع POS',
        description: 'فاتورة بيع جملة مباشرة مع الطباعة والتحصيل',
        icon: ReceiptText,
        tone: 'bg-nw-ok-bg text-nw-ok',
        action: { type: 'tab', destination: 'pos' },
      },
      {
        id: 'sales-orders',
        label: 'الطلبات',
        description: 'متابعة الطلبات والتجهيز والتوصيل والمرتجعات',
        icon: ShoppingBag,
        tone: 'bg-nw-info-bg text-nw-info',
        action: { type: 'tab', destination: 'orders' },
      },
    ],
  },
  {
    id: 'products-inventory',
    label: 'المنتجات والمخزون',
    description: 'المنتجات والأرصدة والمستودعات والحركات',
    icon: Boxes,
    iconTone: 'border border-nw-info bg-nw-info-bg text-nw-info',
    items: [
      {id:'parcel-configuration',label:'إعداد الطرود المرنة',description:'الأصناف وعدد القطع والنكهات وحالة الميزة',
        icon:Package,tone:'bg-nw-info-bg text-nw-info',visibility:'owner',
        action:{type:'modal',destination:'parcel_configuration'}},
      {
        id: 'catalog-products',
        label: 'المنتجات',
        description: 'الأسعار، طرد البيع، الصور والأقسام',
        icon: Package,
        tone: 'bg-nw-info-bg text-nw-info',
        action: { type: 'tab', destination: 'products' },
      },
      {
        id: 'inventory-current',
        label: 'المخزون الفعلي',
        description: 'الأرصدة المتاحة والمحجوزة وسجل الحركات',
        icon: Boxes,
        tone: 'bg-nw-info-bg text-nw-info',
        action: { type: 'tab', destination: 'inventory' },
      },
    ],
  },
  {
    id: 'customers',
    label: 'العملاء والذمم',
    description: 'دليل العملاء والدفعات وكشوف الحساب',
    icon: Users,
    iconTone: 'border border-nw-info bg-nw-info-bg text-nw-info',
    items: [
      {
        id: 'customer-accounts',
        label: 'العملاء والذمم',
        description: 'كشف العميل، الدفعات والمبالغ المستحقة',
        icon: Users,
        tone: 'bg-nw-info-bg text-nw-info',
        action: { type: 'tab', destination: 'accounts' },
      },
    ],
  },
  {
    id: 'suppliers-purchases',
    label: 'الموردون والمشتريات',
    description: 'الاستلام والموردون والمدفوعات والسجل',
    icon: Truck,
    iconTone: 'border border-nw-info bg-nw-info-bg text-nw-info',
    items: [
      {
        id: 'supplier-receiving',
        label: 'استلام البضائع من الموردين',
        description: 'الاستلامات وذمم الموردين والمدفوعات وسجل المشتريات',
        icon: Truck,
        tone: 'bg-nw-info-bg text-nw-info',
        action: { type: 'tab', destination: 'purchases' },
      },
    ],
  },
  {
    id: 'finance-reports',
    label: 'المالية والتقارير',
    description: 'الورديات والمصروفات والربح والتقارير',
    icon: WalletCards,
    iconTone: 'border border-nw-warn bg-nw-warn-bg text-nw-warn',
    items: [
      {
        id: 'finance-shifts',
        label: 'الصندوق والورديات',
        description: 'فتح وإغلاق ومطابقة الكاش وCliQ',
        icon: WalletCards,
        tone: 'bg-nw-ok-bg text-nw-ok',
        action: { type: 'tab', destination: 'shifts' },
      },
      {
        id: 'finance-expenses',
        label: 'المصروفات التشغيلية',
        description: 'مصروف كاش أو CliQ مرتبط بالوردية',
        icon: ReceiptText,
        tone: 'bg-nw-warn-bg text-nw-warn',
        action: { type: 'tab', destination: 'expenses' },
      },
      {
        id: 'finance-reports',
        label: 'التقارير والحسابات',
        description: 'المبيعات والربح والمخزون والذمم مع PDF',
        icon: BarChart3,
        tone: 'bg-nw-info-bg text-nw-info',
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
        tone: 'bg-nw-info-bg text-nw-info',
        action: { type: 'tab', destination: 'users' },
        visibility: 'owner',
      },
      {
        id: 'admin-monitoring',
        label: 'مراقبة صحة النظام',
        description: 'الخدمات والنسخ والـCI وسلامة البيانات — قراءة فقط',
        icon: Activity,
        tone: 'bg-nw-ok-bg text-nw-ok',
        action: { type: 'modal', destination: 'monitoring_dashboard' },
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
        tone: 'bg-nw-info-bg text-nw-info',
        action: { type: 'modal', destination: 'promotion_codes' },
      },
      {
        id: 'admin-profile',
        label: 'الملف الشخصي',
        description: 'البيانات الشخصية والأمان والجلسات والإشعارات',
        icon: UserRound,
        tone: 'bg-nw-info-bg text-nw-info',
        action: { type: 'modal', destination: 'profile' },
      },
    ],
  },
] as const;

export const getNextOpenNavigationGroup = (
  current: AdminNavigationGroupId | null,
  requested: AdminNavigationGroupId,
): AdminNavigationGroupId | null => (current === requested ? null : requested);

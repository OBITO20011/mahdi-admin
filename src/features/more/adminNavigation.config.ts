import {canReadSalesHistory} from '../../utils/salesHistory';
import type { LucideIcon } from 'lucide-react';
import {
  BotMessageSquare,
  HandCoins,
  RotateCcw,
  TriangleAlert,
  BarChart3,
  Activity,
  ClipboardCheck,
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
  | { type: 'tab'; destination: AppState['activeTab'];intent?:'customer_return'|'owner_withdrawals' }
  | { type: 'modal'; destination: ModalNameCallableWithoutPayload };

export interface AdminNavigationItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: string;
  action: AdminNavigationAction;
  visibility?: 'all' | 'owner' | 'cheque-managers' | 'order-readers';
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

const NAVIGATION_DEFINITIONS: readonly AdminNavigationGroup[] = [
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
      {id:'sales-history',label:'سجل المبيعات',description:'كل الفواتير من نقطة البيع والمتجر',icon:ReceiptText,tone:'bg-nw-info-bg text-nw-info',action:{type:'tab',destination:'sales_history'},visibility:'order-readers'},
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
      {id:'finance-cheques',label:'الشيكات',description:'الشيكات الواردة والصادرة والمُجيّرة ومواعيد الاستحقاق',
        icon:WalletCards,tone:'bg-nw-info-bg text-nw-info',action:{type:'tab',destination:'cheques'},visibility:'cheque-managers'},
    ],
  },
  {
    id: 'administration-store',
    label: 'الإدارة والمتجر',
    description: 'الحساب والصلاحيات والمتجر وحماية التطبيق',
    icon: Store,
    iconTone: 'border border-nw-warn/20 bg-nw-warn-bg text-nw-warn',
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
        id:'admin-warehouses',label:'الفروع والمستودعات',description:'إضافة المستودعات وتعديل أسمائها وربطها بالفروع',
        icon:Boxes,tone:'bg-nw-info-bg text-nw-info',visibility:'owner',action:{type:'tab',destination:'warehouses'},
      },
      {
        id: 'admin-go-live',
        label: 'بداية التشغيل',
        description: 'المنتجات والبضاعة الموجودة وأرصدة العملاء والموردين قبل النظام',
        icon: ClipboardCheck,
        tone: 'bg-nw-warn-bg text-nw-warn',
        action: { type: 'tab', destination: 'go_live' },
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
        tone: 'bg-nw-warn-bg text-nw-warn',
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


// These UI boundaries mirror accepted205 RPC guards;the database remains authoritative.
export const ERP_READER_ROLES = ['owner','admin','manager','accountant','cashier','sales','warehouse_keeper','orders','delivery_driver','view_only'] as const;
const ORDER_READERS = ['owner','admin','manager','accountant','cashier','sales','orders','delivery_driver'] as const;
const CASH_READERS = ['owner','admin','manager','accountant'] as const;
const STOCK_WRITERS = ['owner','admin','manager','warehouse_keeper'] as const;
const SALES_WRITERS = ['owner','admin','manager','sales'] as const;
const RECEIPT_READERS = ['owner','admin','manager','accountant','warehouse_keeper'] as const;
const HOME_READERS = ['owner','admin','manager','accountant','sales','warehouse_keeper','delivery_driver'] as const;
const tabRoles:Partial<Record<AppState['activeTab'],readonly string[]>> = {
  home:HOME_READERS,dashboard:HOME_READERS,more:ERP_READER_ROLES,products:ERP_READER_ROLES,
  inventory:ERP_READER_ROLES,accounts:ERP_READER_ROLES,orders:ORDER_READERS,sales_history:ORDER_READERS,
  pos:SALES_WRITERS,purchases:RECEIPT_READERS,
  shifts:CASH_READERS,expenses:CASH_READERS,reports:CASH_READERS,cheques:['owner','manager'],
  users:['owner'],warehouses:['owner'],go_live:['owner'],assistant:CASH_READERS,
};
const modalRoles:Partial<Record<ModalNameCallableWithoutPayload,readonly string[]>> = {
  profile:ERP_READER_ROLES,profile_settings:ERP_READER_ROLES,notifications:ERP_READER_ROLES,
  storefront_settings:['owner','admin','manager'],promotion_codes:SALES_WRITERS,
  parcel_configuration:['owner'],monitoring_dashboard:['owner'],add_product:STOCK_WRITERS,
  receive_goods:RECEIPT_READERS,add_expense:CASH_READERS,damage_stock_selection:STOCK_WRITERS,
  supplier_replacement:['owner','manager','warehouse_keeper'],
};
export function hasNavigationRole(allowed:readonly string[],roleName:string|null|undefined,roles?:readonly string[]):boolean {
  const membership=new Set([...(roles??[]),roleName].filter((role):role is string=>typeof role==='string'));
  return allowed.some(role=>membership.has(role));
}
export function canUseNavigationAction(action:AdminNavigationAction,roleName:string|null|undefined,roles?:readonly string[]):boolean {
  return hasNavigationRole((action.type==='tab'?tabRoles[action.destination]:modalRoles[action.destination])??[],roleName,roles);
}
export const isNavigationItemVisible=(item:AdminNavigationItem,roleName:string|null|undefined,roles?:readonly string[])=>
  canUseNavigationAction(item.action,roleName,roles) && (item.visibility==='order-readers'?canReadSalesHistory(roles,roleName)
    :item.visibility==='owner'?hasNavigationRole(['owner'],roleName,roles)
    :item.visibility==='cheque-managers'?hasNavigationRole(['owner','manager'],roleName,roles):true);

const byId=new Map(NAVIGATION_DEFINITIONS.flatMap(group=>group.items).map(item=>[item.id,item]));
function item(id:string,label?:string):AdminNavigationItem {
  const value=byId.get(id);if(!value)throw new Error('Unknown navigation item:'+id);
  return label?{...value,label}:value;
}
export const ADMIN_NAVIGATION_GROUPS:readonly AdminNavigationGroup[] = [
  {id:'sales',label:'البيع',description:'',icon:ShoppingBag,iconTone:'text-nw-info',items:[
    item('sales-pos','نقطة البيع'),item('sales-orders','الطلبات'),item('sales-history'),item('customer-accounts','العملاء'),
    {id:'customer-returns',label:'مرتجع زبون',description:'ابحث عن الفاتورة وافتح المرتجعات والاستبدال',icon:RotateCcw,tone:'bg-nw-info-bg text-nw-info',visibility:'order-readers',action:{type:'tab',destination:'sales_history',intent:'customer_return'}},
  ]},
  {id:'products-inventory',label:'المخزون والشراء',description:'',icon:Boxes,iconTone:'text-nw-info',items:[
    item('catalog-products'),item('supplier-receiving','الاستلام'),item('inventory-current','المخزون'),item('parcel-configuration'),
    {id:'inventory-damage',label:'بضاعة تالفة',description:'اختر المنتج ثم سجل التالف',icon:TriangleAlert,tone:'bg-nw-warn-bg text-nw-warn',action:{type:'modal',destination:'damage_stock_selection'}},
    {id:'supplier-replacement',label:'استبدال المورد',description:'المعلّق واستلام البديل والتالف',icon:RotateCcw,tone:'bg-nw-info-bg text-nw-info',action:{type:'modal',destination:'supplier_replacement'}},
  ]},
  {id:'finance-reports',label:'المال',description:'',icon:WalletCards,iconTone:'text-nw-warn',items:[
    item('finance-shifts'),item('finance-expenses','المصاريف'),item('finance-reports','التقارير'),item('finance-cheques'),
    {id:'finance-withdrawals',label:'سحوبات المالك',description:'فتح السحوبات داخل الصندوق والورديات',icon:HandCoins,tone:'bg-nw-warn-bg text-nw-warn',visibility:'owner',action:{type:'tab',destination:'shifts',intent:'owner_withdrawals'}},
  ]},
  {id:'administration-store',label:'الإدارة',description:'',icon:Store,iconTone:'text-nw-info',items:[
    item('admin-users'),item('admin-warehouses'),item('admin-storefront','إعدادات المتجر'),item('admin-promotions','رموز الخصم'),item('admin-go-live'),item('admin-monitoring','مراقبة النظام'),
    {id:'admin-assistant',label:'المساعد',description:'المساعد الإداري',icon:BotMessageSquare,tone:'bg-nw-info-bg text-nw-info',action:{type:'tab',destination:'assistant'}},
  ]},
];

export function searchNavigationGroups(search:string,roleName:string|null|undefined,roles?:readonly string[]):AdminNavigationGroup[] {
  const normalize=(value:string)=>value.normalize('NFKC').replace(/[\u064B-\u065F\u0670]/gu,'').replace(/[أإآ]/gu,'ا').toLocaleLowerCase('ar');
  const query=normalize(search.trim());
  return ADMIN_NAVIGATION_GROUPS.map(group=>({...group,items:group.items.filter(entry=>isNavigationItemVisible(entry,roleName,roles)&&(!query||normalize(entry.label+' '+entry.description).includes(query)))})).filter(group=>group.items.length>0);
}

export const getNextOpenNavigationGroup = (
  current: AdminNavigationGroupId | null,
  requested: AdminNavigationGroupId,
): AdminNavigationGroupId | null => (current === requested ? null : requested);

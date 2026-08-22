/**
 * Nawasrah Business Manager - Constants & Design System
 */

import { Permission, Role } from '../types';

export const CURRENCY = 'د.أ';
export const CURRENCY_FULL = 'دينار أردني';

export const PURCHASE_PACKAGE_OPTIONS = [
  { code: 'CTN', nameAr: 'كرتونة' },
  { code: 'BOX', nameAr: 'صندوق' },
  { code: 'PKT', nameAr: 'باكيت' },
  { code: 'SHRINK', nameAr: 'شرنك' },
  { code: 'BAG', nameAr: 'كيس' },
  { code: 'SACK', nameAr: 'شوال' },
  { code: 'BUNDLE', nameAr: 'ربطة' },
  { code: 'CASE', nameAr: 'حافظة' },
  { code: 'CAN', nameAr: 'علبة' },
  { code: 'BTL', nameAr: 'قنينة / زجاجة' },
  { code: 'PCS', nameAr: 'حبة / قطعة' },
] as const;

export const APP_NAME = 'Nawasrah Business Manager';
export const APP_NAME_AR = 'نواصرة للمحاسبة والإدارة';

export const COLORS = {
  navyDark: '#002B66',
  navyPrimary: '#0F2C59',
  bluePrimary: '#1055C9',
  blueLight: '#EFF6FF',
  greenSuccess: '#10B981',
  greenLight: '#ECFDF5',
  amberWarning: '#F59E0B',
  amberLight: '#FEF3C7',
  redDanger: '#EF4444',
  redLight: '#FEF2F2',
  slateDark: '#1E293B',
  slateMuted: '#64748B',
  slateLight: '#F8FAFC',
  border: '#E2E8F0',
};

export const JORDAN_GOVERNORATES = [
  'عمان',
  'إربد',
  'الزرقاء',
  'البلقاء',
  'المفرق',
  'جرش',
  'عجلون',
  'مأدبا',
  'الكرك',
  'الطفيلة',
  'معان',
  'العقبة',
];

export const ROLE_PERMISSIONS_MAP: Record<Role, Permission[]> = {
  Owner: [
    'view_sales',
    'view_profits',
    'view_cost',
    'add_product',
    'edit_product',
    'delete_product',
    'edit_inventory',
    'execute_stock_count',
    'create_invoice',
    'edit_invoice',
    'cancel_invoice',
    'grant_discount',
    'approve_high_discount',
    'manage_customers',
    'manage_suppliers',
    'manage_expenses',
    'manage_users',
    'export_reports',
    'close_financial_period',
  ],
  Admin: [
    'view_sales',
    'view_profits',
    'view_cost',
    'add_product',
    'edit_product',
    'delete_product',
    'edit_inventory',
    'execute_stock_count',
    'create_invoice',
    'edit_invoice',
    'cancel_invoice',
    'grant_discount',
    'approve_high_discount',
    'manage_customers',
    'manage_suppliers',
    'manage_expenses',
    'export_reports',
  ],
  Accountant: [
    'view_sales',
    'view_profits',
    'view_cost',
    'create_invoice',
    'edit_invoice',
    'cancel_invoice',
    'grant_discount',
    'manage_customers',
    'manage_suppliers',
    'manage_expenses',
    'export_reports',
    'close_financial_period',
  ],
  Cashier: ['view_sales', 'create_invoice', 'grant_discount', 'manage_customers'],
  'Sales Employee': ['view_sales', 'create_invoice', 'grant_discount', 'manage_customers'],
  'Warehouse Employee': [
    'add_product',
    'edit_product',
    'edit_inventory',
    'execute_stock_count',
  ],
  'Orders Employee': [
    'view_sales',
    'create_invoice',
    'grant_discount',
    'manage_customers',
  ],
  'Delivery Driver': ['view_sales'],
  'View Only': ['view_sales'],
};

export const DEFAULT_BRANCHES = [
  {
    id: 'b-ramtha-main',
    name: 'محلات النواصرة - الرمثا',
    address: 'الرمثا - محلات النواصرة',
    city: 'الرمثا',
    phone: '065800111',
    isMain: true,
  },
  {
    id: 'b-irbid',
    name: 'فرع إربد',
    address: 'شارع الحصن، المنطقة التجاريّة',
    city: 'إربد',
    phone: '027200222',
    isMain: false,
  },
  {
    id: 'b-zarqa',
    name: 'فرع الزرقاء',
    address: 'شارع السعادة، مجمع رقم 3',
    city: 'الزرقاء',
    phone: '053900333',
    isMain: false,
  },
];

export const DEFAULT_WAREHOUSES = [
  { id: 'w-main', name: 'مستودع محلات النواصرة - الرمثا', branchId: 'b-ramtha-main', location: 'الرمثا - محلات النواصرة' },
  { id: 'w-irbid', name: 'مستودع فرع إربد', branchId: 'b-irbid', location: 'إربد - المدينة الصناعية' },
  { id: 'w-zarqa', name: 'مستودع فرع الزرقاء', branchId: 'b-zarqa', location: 'الزرقاء - المنطقة الحرة' },
  { id: 'w-cold', name: 'مستودع التبريد المركزي', branchId: 'b-ramtha-main', location: 'الرمثا' },
];

export const DEFAULT_CATEGORIES = [
  { id: 'cat-1', nameAr: 'مشروبات وعصائر', icon: 'Coffee', productsCount: 24 },
  { id: 'cat-2', nameAr: 'شوكولاتة وحلويات', icon: 'Candy', productsCount: 38 },
  { id: 'cat-3', nameAr: 'مكسرات ومسالي', icon: 'Nut', productsCount: 15 },
  { id: 'cat-4', nameAr: 'معلبات ومؤن', icon: 'Package', productsCount: 42 },
  { id: 'cat-5', nameAr: 'قطع غيار إلكترونية', icon: 'Cpu', productsCount: 18 },
];

import { Account } from '../types';

export const DEFAULT_CHART_OF_ACCOUNTS: Account[] = [
  { id: 'acc-1010', code: '1010', nameAr: 'صندوق عمان الرئيسي', type: 'asset', balance: 3820, isSystem: true },
  { id: 'acc-1020', code: '1020', nameAr: 'البنك العربي - حساب جارٍ', type: 'asset', balance: 12450, isSystem: true },
  { id: 'acc-1030', code: '1030', nameAr: 'حساب CliQ التفاعلي', type: 'asset', balance: 2890.45, isSystem: true },
  { id: 'acc-1100', code: '1100', nameAr: 'حسابات العملاء (الذمم المدينة)', type: 'asset', balance: 12600, isSystem: true },
  { id: 'acc-1200', code: '1200', nameAr: 'بضاعة آخر المدة (المخزون)', type: 'asset', balance: 45820, isSystem: true },
  { id: 'acc-2100', code: '2100', nameAr: 'حسابات الموردين (الذمم الدائنة)', type: 'liability', balance: 18450, isSystem: true },
  { id: 'acc-3100', code: '3100', nameAr: 'رأس المال المكتتب', type: 'equity', balance: 50000, isSystem: true },
  { id: 'acc-4100', code: '4100', nameAr: 'إيرادات المبيعات', type: 'revenue', balance: 28400, isSystem: true },
  { id: 'acc-5100', code: '5100', nameAr: 'تكلفة البضاعة المباعة', type: 'expense', balance: 16200, isSystem: true },
  { id: 'acc-5200', code: '5200', nameAr: 'مصروفات الإيجار والخدمات', type: 'expense', balance: 2450, isSystem: true },
  { id: 'acc-5300', code: '5300', nameAr: 'مصروفات الرواتب والأجور', type: 'expense', balance: 3200, isSystem: true },
];

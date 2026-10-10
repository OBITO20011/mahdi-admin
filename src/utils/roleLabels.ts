/** Shared role display labels only; never permission decisions. */
export const ROLE_LABELS: Readonly<Record<string, string>> = {
  Owner: 'المالك',
  Admin: 'مدير تنفيذي',
  Accountant: 'محاسب',
  Cashier: 'كاشير',
  'Sales Employee': 'موظف مبيعات',
  'Warehouse Employee': 'مسؤول مستودع',
  'Orders Employee': 'متابع الطلبات',
  'Delivery Driver': 'سائق توصيل',
  'View Only': 'مشاهدة فقط',
};

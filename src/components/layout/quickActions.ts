/**
 * The four daily shortcuts that used to live in the floating quick-action
 * button. Package F (spec §4.2) moves them: "بيع" becomes the centre tab, and
 * the desktop SideNav and the phone "More" screen render this shared list.
 */

import { DollarSign, PackagePlus, Receipt, Truck, type LucideIcon } from 'lucide-react';
import type { AdminNavigationAction } from '../../features/more/adminNavigation.config';

export interface QuickAction {
  id: 'pos-sale' | 'goods-receipt' | 'add-expense' | 'add-product';
  title: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  action: AdminNavigationAction;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: 'pos-sale',
    title: 'إنشاء فاتورة بيع (POS)',
    shortLabel: 'بيع جديد',
    description: 'بيع مباشر سريع مع طباعة الفاتورة',
    icon: Receipt,
    action: { type: 'tab', destination: 'pos' },
  },
  {
    id: 'goods-receipt',
    title: 'استلام بضاعة لمخزن',
    shortLabel: 'استلام بضاعة',
    description: 'إضافة كميات مشتريات وتحديث التكلفة',
    icon: Truck,
    action: { type: 'modal', destination: 'receive_goods' },
  },
  {
    id: 'add-expense',
    title: 'تسجيل مصروف جديد',
    shortLabel: 'مصروف',
    description: 'تسجيل إيجار، كهرباء، رواتب وصيانة',
    icon: DollarSign,
    action: { type: 'modal', destination: 'add_expense' },
  },
  {
    id: 'add-product',
    title: 'إضافة منتج',
    shortLabel: 'صنف جديد',
    description: 'منتج جديد مع الأسعار والطرد',
    icon: PackagePlus,
    action: { type: 'modal', destination: 'add_product' },
  },
];

/** The shortcuts other than "new sale" (which has its own prominent button). */
export const SECONDARY_QUICK_ACTIONS = QUICK_ACTIONS.filter((action) => action.id !== 'pos-sale');

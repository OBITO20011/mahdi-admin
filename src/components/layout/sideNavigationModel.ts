/**
 * Desktop side navigation model (Package F spec §4.1).
 * Built from the canonical ADMIN_NAVIGATION_GROUPS so labels, destinations and
 * owner-only visibility stay identical to the phone "More" menu.
 */

import { Home, Settings2, type LucideIcon } from 'lucide-react';
import {
  ADMIN_NAVIGATION_GROUPS,
  type AdminNavigationAction,
  type AdminNavigationItem,
} from '../../features/more/adminNavigation.config';
import type { AppState } from '../../stores/useAppStore';

export interface SideNavItem {
  id: string;
  label: string;
  railLabel: string;
  icon: LucideIcon;
  action: AdminNavigationAction;
}

export interface SideNavGroup {
  id: string;
  label: string;
  items: SideNavItem[];
}

const toSideItem = (item: AdminNavigationItem): SideNavItem => ({
  id: item.id,
  label: item.label,
  railLabel: RAIL_LABELS[item.id],
  icon: item.icon,
  action: item.action,
});

const RAIL_LABELS: Readonly<Record<string, string>> = {
  'sales-pos': 'بيع', 'sales-orders': 'الطلبات', 'parcel-configuration': 'الطرود',
  'catalog-products': 'المنتجات', 'inventory-current': 'المخزون',
  'customer-accounts': 'العملاء', 'supplier-receiving': 'الاستلام',
  'finance-shifts': 'الصندوق', 'finance-expenses': 'المصروفات',
  'finance-reports': 'التقارير', 'admin-users': 'الفريق',
  'admin-monitoring': 'المراقبة', 'admin-storefront': 'المتجر',
  'admin-promotions': 'الخصم', 'admin-profile': 'حسابي',
};

/** Same rule as MoreMenuView: owner-only items are shown to the owner only. */
export const isVisibleToRole = (item: AdminNavigationItem, roleName: string | null | undefined) =>
  item.visibility !== 'owner' || roleName === 'owner';

export const SIDE_NAV_HOME: SideNavItem = {
  id: 'home',
  label: 'الرئيسية',
  railLabel: 'الرئيسية',
  icon: Home,
  action: { type: 'tab', destination: 'home' },
};

/** Profile, security, theme, install and sign-out live on the More screen. */
export const SIDE_NAV_MORE: SideNavItem = {
  id: 'more',
  label: 'الإعدادات والمزيد',
  railLabel: 'المزيد',
  icon: Settings2,
  action: { type: 'tab', destination: 'more' },
};

export function buildSideNavigation(roleName: string | null | undefined): SideNavGroup[] {
  const groups: SideNavGroup[] = [{ id: 'today', label: 'اليوم', items: [SIDE_NAV_HOME] }];
  for (const group of ADMIN_NAVIGATION_GROUPS) {
    const items = group.items.filter((item) => isVisibleToRole(item, roleName)).map(toSideItem);
    if (items.length > 0) groups.push({ id: group.id, label: group.label, items });
  }
  return groups;
}

/** Whether a nav item represents the screen currently shown. */
export function isSideItemActive(item: SideNavItem, activeTab: AppState['activeTab']): boolean {
  if (item.action.type !== 'tab') return false;
  if (item.action.destination === 'home') return activeTab === 'home' || activeTab === 'dashboard';
  return item.action.destination === activeTab;
}

/**
 * Desktop and landscape-tablet side navigation (Package F spec §4.1).
 * Hidden below 1024px, where the phone bottom tab bar is used instead.
 * `collapsed` turns it into the 76px icon rail used by the POS screen.
 */

import React from 'react';
import {ROLE_LABELS} from '../../utils/roleLabels';
import { Plus } from 'lucide-react';
import {useNavigationDrawer} from './navigationDrawerContext';
import {canUseNavigationAction} from '../../features/more/adminNavigation.config';
import { SECONDARY_QUICK_ACTIONS } from './quickActions';
import {
  shallowEqual,
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import type { AdminNavigationAction } from '../../features/more/adminNavigation.config';
import {
  SIDE_NAV_MORE,
  buildSideNavigation,
  isSideItemActive,
  type SideNavItem,
} from './sideNavigationModel';

const join = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');

interface SideNavProps {
  collapsed?: boolean;
  mobile?: boolean;
}

export const SideNav: React.FC<SideNavProps> = ({ collapsed = false, mobile = false }) => {
  const drawer=useNavigationDrawer();
  const { activeTab, newOrdersCount, currentUserName, currentUserRole } = useAppStoreSelector(
    (state) => ({
      activeTab: state.activeTab,
      newOrdersCount: state.newOrdersCount,
      currentUserName: state.currentUser.name,
      currentUserRole: state.currentUser.role,
    }),
    shallowEqual,
  );
  const { setActiveTab, openModal } = useAppStoreActions();
  const { roleName,roles } = useAuthStore();
  const groups = buildSideNavigation(roleName,roles);


  const run = (action: AdminNavigationAction) => {
    if(!canUseNavigationAction(action,roleName,roles))return;
    drawer?.close();
    drawer?.setEntryIntent(action.type==='tab'?action.intent??null:null);
    if (action.type === 'tab') {
      setActiveTab(action.destination);
      return;
    }
    openModal(action.destination);
  };

  const badgeFor = (item: SideNavItem) =>
    item.action.type === 'tab' && item.action.destination === 'orders' && newOrdersCount > 0
      ? newOrdersCount
      : null;

  const renderItem = (item: SideNavItem) => {
    const active = isSideItemActive(item, activeTab);
    const badge = badgeFor(item);
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        data-side-nav={item.action.type === 'tab' ? item.action.destination : item.id}
        data-side-nav-item={item.id}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        onClick={() => run(item.action)}
        className={join(
          'relative flex items-center rounded-[10px] text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nw-accent',
          collapsed ? 'h-14 w-14 flex-col justify-center gap-1 px-1 text-[10px] font-semibold' : 'min-h-11 w-full gap-2.5 px-3 py-2 text-right',
          active
            ? 'bg-nw-side-active font-bold text-nw-side-active-text'
            : 'font-medium text-nw-side-text hover:bg-white/10',
        )}
      >
        <Icon className={collapsed ? 'h-5 w-5' : 'h-[18px] w-[18px] shrink-0'} aria-hidden="true" />
        {collapsed ? (
          <span data-rail-label className="max-w-full whitespace-nowrap">{item.railLabel}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        )}
        {badge !== null && (
          <span
            className={join(
              'nw-num rounded-full bg-nw-accent px-[7px] text-xs font-bold text-nw-on-accent',
              collapsed && 'absolute -top-1 left-0',
            )}
          >
            {badge}
          </span>
        )}
        {active && !collapsed && <span className="h-2 w-2 shrink-0 rounded-full bg-nw-accent" aria-hidden="true" />}
      </button>
    );
  };

  const quickActions = SECONDARY_QUICK_ACTIONS.filter(action=>canUseNavigationAction(action.action,roleName,roles)).map((action) => ({
    id: action.id,
    label: action.shortLabel,
    icon: action.icon,
    onClick: () => run(action.action),
  }));

  return (
    <nav
      aria-label="القائمة الجانبية"
      data-side-nav-root
      className={join(
        mobile?'flex min-h-0 flex-1 shrink-0 flex-col overflow-y-auto bg-nw-side text-nw-side-text':'hidden shrink-0 flex-col overflow-y-auto bg-nw-side text-nw-side-text lg:flex',
        mobile?'w-full gap-1 px-3.5 py-3':collapsed ? 'w-[76px] items-center gap-2 px-2 py-5' : 'w-[264px] gap-1 px-3.5 py-5',
      )}
    >
      <div className={join('flex items-center gap-2.5', collapsed ? 'mb-3' : 'px-2 pb-3')}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-nw-accent text-lg font-bold text-nw-on-accent">
          <img src="/nawasrah-store-logo.jpg" alt="" className="h-full w-full rounded-xl object-contain" />
        </div>
        {!collapsed && (
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-bold leading-6">النواصرة لتجارة الجملة والمواد الغذائية</span>
            <span className="text-xs text-nw-side-muted">لوحة الإدارة</span>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="mb-3 flex flex-col gap-2 px-1">
          {canUseNavigationAction({type:'tab',destination:'pos'},roleName,roles) && <button
            type="button"
            data-side-nav-action="pos-sale"
            onClick={() => run({type:'tab',destination:'pos'})}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-nw-accent text-sm font-bold text-nw-on-accent transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            بيع جديد
          </button>}
          <div className="grid grid-cols-3 gap-1.5">
            {quickActions.map((action) => (
              <button
                key={action.id}
                type="button"
                data-side-nav-action={action.id}
                onClick={action.onClick}
                className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg bg-white/10 px-1 text-[11px] font-semibold text-nw-side-text transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nw-accent"
              >
                <action.icon className="h-4 w-4" aria-hidden="true" />
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.id} className={join('flex flex-col gap-0.5', collapsed ? 'items-center' : 'mb-2')}>
          {!collapsed && (
            <span className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-nw-side-muted">{group.label}</span>
          )}
          {group.items.map(renderItem)}
        </div>
      ))}

      <div className={join('mt-auto flex flex-col gap-1.5 pt-3', collapsed && 'items-center')}>
        {renderItem(SIDE_NAV_MORE)}
        {!collapsed && (
          <button
            type="button"
            onClick={() => run({type:'modal',destination:'profile'})}
            className="mt-1 flex min-h-12 items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2 text-right transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nw-accent"
            aria-label={`الملف الشخصي: ${currentUserName}`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-nw-accent text-sm font-bold text-nw-on-accent">
              {(currentUserName || 'م').trim().charAt(0)}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-bold">{currentUserName}</span>
              <span className="text-[11px] text-nw-side-muted">{ROLE_LABELS[currentUserRole] || 'موظف'}</span>
            </span>
          </button>
        )}
      </div>
    </nav>
  );
};

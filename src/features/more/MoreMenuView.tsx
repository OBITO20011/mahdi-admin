import React, {useEffect, useState} from 'react';
import {ChevronLeft, LogOut, Moon, Scan, Sun} from 'lucide-react';
import {shallowEqual, useAppStoreActions, useAppStoreSelector} from '../../stores/useAppStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {isDeviceBiometricAvailable} from '../../services/deviceBiometrics.service';
import {UserAvatar, Card, PageHeader, SearchField, UiButton} from '../../components/ui';
import {useNavigationDrawer} from '../../components/layout/navigationDrawerContext';
import {ROLE_LABELS} from '../../utils/roleLabels';
import {InstallAppPanel} from './InstallAppPanel';
import {canUseNavigationAction, searchNavigationGroups, type AdminNavigationAction, type AdminNavigationItem} from './adminNavigation.config';

function NavigationItem({item, list, onClick}: {item: AdminNavigationItem; list: boolean; onClick: () => void}) {
  const Icon=item.icon;
  return <UiButton variant="plain" type="button" data-navigation-id={item.id} onClick={onClick}
    className={list?'!h-auto flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-right text-sm text-nw-text hover:bg-nw-surface-2':'!h-auto flex min-h-[88px] min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-nw-border bg-nw-surface px-2 py-3 text-center text-[13px] font-semibold leading-5 text-nw-text hover:bg-nw-surface-2'}>
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${item.tone}`}><Icon className="h-5 w-5" aria-hidden="true"/></span>
    <span className="min-w-0 break-words">{item.label}</span>
    {list&&<ChevronLeft className="ms-auto h-4 w-4 shrink-0 text-nw-muted" aria-hidden="true"/>}
  </UiButton>;
}

export const MoreMenuView: React.FC = () => {
  const {signOut, roleName, roles}=useAuthStore();
  const state=useAppStoreSelector(value=>({activeBranch:value.activeBranch,branches:value.branches,
    isBiometricsEnabled:value.isBiometricsEnabled,currentUserName:value.currentUser.name,currentUserRole:value.currentUser.role,
    currentUserAvatarUrl:value.currentUser.avatarUrl,currentUserBranchId:value.currentUser.branchId,themeMode:value.currentUser.themeMode}),shallowEqual);
  const {toggleBiometrics, openModal, toggleThemeMode, setActiveTab}=useAppStoreActions();
  const drawer=useNavigationDrawer();
  const [search,setSearch]=useState('');
  const [isBiometricSupported,setIsBiometricSupported]=useState<boolean|null>(null);
  const [isUpdatingBiometrics,setIsUpdatingBiometrics]=useState(false);
  const isDarkMode=state.themeMode!=='light';
  const userBranch=state.branches.find(branch=>branch.id===state.currentUserBranchId)?.name||state.activeBranch.name;
  const groups=searchNavigationGroups(search,roleName,roles);
  useEffect(()=>{let active=true;void isDeviceBiometricAvailable().then(value=>{if(active)setIsBiometricSupported(value);});return()=>{active=false;};},[]);
  const handleBiometricToggle=async()=>{setIsUpdatingBiometrics(true);try{await toggleBiometrics();}finally{setIsUpdatingBiometrics(false);}};
  const run=(action:AdminNavigationAction)=>{
    if(!canUseNavigationAction(action,roleName,roles))return;
    drawer?.close();
    drawer?.setEntryIntent(action.type==='tab'?action.intent??null:null);
    if(action.type==='tab')setActiveTab(action.destination);else openModal(action.destination);
  };
  return <div dir="rtl" className="mx-auto min-w-0 max-w-2xl space-y-4 bg-nw-bg p-3 pb-6 text-nw-text sm:p-4">
    <PageHeader title={<><span className="lg:hidden">المزيد</span><span className="hidden lg:inline">حسابي</span></>}
      actions={<span className="block text-xs leading-5 text-nw-muted">{state.activeBranch.name}</span>}/>
    <div className="space-y-5 lg:hidden">
      <SearchField label="ابحث عن شاشة" placeholder="ابحث عن شاشة" value={search} onChange={event=>setSearch(event.target.value)}/>
      <div aria-label="أقسام التنقل الإداري" className="space-y-5">
        {groups.map(group=><section key={group.id} aria-labelledby={`navigation-section-${group.id}`} data-navigation-group={group.id}>
          <h2 id={`navigation-section-${group.id}`} className="mb-2 text-sm font-bold">{group.label}</h2>
          <div className={group.id==='administration-store'?'divide-y divide-nw-border rounded-xl border border-nw-border bg-nw-surface p-1':'grid grid-cols-3 gap-2'}>
            {group.items.map(item=><NavigationItem key={item.id} item={item} list={group.id==='administration-store'} onClick={()=>run(item.action)}/>)}
          </div>
        </section>)}
        {groups.length===0&&<p role="status" className="rounded-xl border border-nw-border p-4 text-sm text-nw-muted">لا توجد شاشة مطابقة.</p>}
      </div>
    </div>
    <section aria-label="الحساب والأمان" className="space-y-3">
      <Card padded={false}>
        <UiButton variant="plain" type="button" data-navigation-id="profile-summary" onClick={()=>openModal('profile')}
          className="!h-auto flex min-h-16 w-full items-center gap-3 px-3 py-3 text-right">
          <UserAvatar name={state.currentUserName} src={state.currentUserAvatarUrl} className="h-10 w-10"/>
          <span className="min-w-0 flex-1"><span className="block break-words font-bold">{state.currentUserName}</span><span className="mt-1 block text-xs text-nw-muted">{ROLE_LABELS[state.currentUserRole]||state.currentUserRole} · {userBranch}</span></span>
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true"/>
        </UiButton>
        <div data-navigation-id="theme-toggle" className="flex min-h-12 items-center justify-between gap-3 border-t border-nw-border px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm">{isDarkMode?<Moon className="h-4 w-4" aria-hidden="true"/>:<Sun className="h-4 w-4" aria-hidden="true"/>}مظهر التطبيق</span>
          <UiButton onClick={()=>toggleThemeMode()}>{isDarkMode?'فاتح':'داكن'}</UiButton>
        </div>
        <div data-navigation-id="biometric-toggle" className="flex min-h-12 items-center justify-between gap-3 border-t border-nw-border px-3 py-2">
          <span className="min-w-0"><span className="flex items-center gap-2 text-sm"><Scan className="h-4 w-4" aria-hidden="true"/>قفل Face ID</span><span className="mt-1 block text-xs leading-5 text-nw-muted">{isBiometricSupported===null?'جاري التحقق من دعم الجهاز':isBiometricSupported?'قفل إضافي عند فتح التطبيق':'غير مدعوم على هذا الجهاز أو الاتصال غير آمن'}</span></span>
          <input type="checkbox" aria-label="تفعيل قفل Face ID" checked={state.isBiometricsEnabled} onChange={()=>void handleBiometricToggle()}
            disabled={isUpdatingBiometrics||(!state.isBiometricsEnabled&&isBiometricSupported!==true)} className="h-11 w-11 shrink-0 accent-nw-primary"/>
        </div>
        <div data-navigation-id="install-app" className="border-t border-nw-border p-3"><InstallAppPanel/></div>
      </Card>
    </section>
    <UiButton variant="plain" type="button" data-navigation-id="sign-out" onClick={()=>signOut()} className="min-h-11 text-sm text-nw-bad"><LogOut className="h-4 w-4" aria-hidden="true"/>تسجيل الخروج</UiButton>
  </div>;
};

import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {NavigationShell} from '../src/components/layout/NavigationShell';
import {SideNav} from '../src/components/layout/SideNav';
import {Header} from '../src/components/common/Header';
import {BottomTabs} from '../src/components/layout/BottomTabs';
import {AllModals} from '../src/components/modals/AllModals';
import {MoreMenuView} from '../src/features/more/MoreMenuView';
import {DashboardHome} from '../src/features/dashboard/DashboardHome';
import {SalesHistoryView} from '../src/features/salesHistory/SalesHistoryView';
import {ShiftsView} from '../src/features/shifts/ShiftsView';
import {homeFixture,shiftFixture} from './package-f-home.fixture';
import {recentSalesFixture} from './package-f-sales-history.fixture';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {storeEngine,useAppStoreSelector,type AppState} from '../src/stores/useAppStore';
import {supabase} from '../src/lib/supabase';
declare global{interface Window{__NAV206_LOCK__:(locked:boolean)=>void;}}
const params=new URLSearchParams(location.search),role=params.get('role')??'owner',theme=params.get('theme')??'light';
if(!supabase||!['localhost','127.0.0.1','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL??'').hostname))throw Error('Navigation206 preview requires loopback');
// Synthetic identity for the real208 durable-intent adapter; transport remains loopback.
supabase.auth.getUser=async()=>({data:{user:{id:'92600000-0000-4000-8000-000000000001'}},error:null}) as Awaited<ReturnType<NonNullable<typeof supabase>['auth']['getUser']>>;
document.documentElement.dataset.theme=theme;document.documentElement.classList.add(theme==='dark'?'theme-dark':'theme-light');
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
auth.state={...auth.getState(),roleName:role,roles:params.has('multi')?[role,'owner']:[role],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const engine=storeEngine as unknown as {state:AppState;refreshOrdersFromSupabase:()=>Promise<void>;refreshStockNotificationsFromSupabase:()=>Promise<[]>;refreshExpenseShiftCenterFromSupabase:()=>Promise<void>};
const branch={id:'92600000-0000-4000-8000-000000000200',name:'الفرع الرئيسي',address:'',city:'الرمثا',phone:''};
const shift={...shiftFixture,id:'92600000-0000-4000-8000-000000000999',branchId:branch.id,openingCash:500,totalCashSales:0,cashReceipts:0,cashExpenses:90,cashSupplierPayments:20,cashRefunds:0,cliqReceipts:8,cliqSupplierPayments:7,expectedCash:390};
engine.state={...engine.state,activeBranch:branch,branches:[branch],currentShift:shift,recentShifts:[],notifications:[]};
engine.refreshOrdersFromSupabase=async()=>undefined;engine.refreshStockNotificationsFromSupabase=async()=>[];engine.refreshExpenseShiftCenterFromSupabase=async()=>undefined;
storeEngine.setCurrentUser({id:'92600000-0000-4000-8000-000000000001',name:'المالك',role:role==='owner'?'Owner':'Cashier',themeMode:theme==='dark'?'dark':'light',avatarUrl:''});
storeEngine.setActiveTab(params.get('start')==='more'?'more':params.get('start')==='shifts'?'shifts':'home');
const data=structuredClone(homeFixture);data.summary.todayCashCollectedInMinorUnits=0;data.summary.todayCliqCollectedInMinorUnits=0;
data.summary.todayCollections={cashInMinorUnits:0,cliqInMinorUnits:0,bankTransferInMinorUnits:0,chequeInMinorUnits:0,otherInMinorUnits:0,totalInMinorUnits:0};
data.access.canViewProfit=['owner','admin','manager','accountant'].includes(role);
function Harness(){
  const [locked,setLocked]=useState(false);window.__NAV206_LOCK__=setLocked;
  const tab=useAppStoreSelector(state=>state.activeTab),modal=useAppStoreSelector(state=>state.currentModal);
  const go=(destination:AppState['activeTab'])=>storeEngine.setActiveTab(destination);
  if(locked)return <main><button onClick={()=>setLocked(false)}>فك قفل الاختبار</button></main>;
  return <NavigationShell><div dir="rtl" className="flex h-[100dvh] bg-nw-bg font-sans text-nw-text"><SideNav/><div className="flex min-w-0 flex-1 flex-col"><Header/>
    <main data-testid="navigation206-scroll" className="min-h-0 flex-1 overflow-y-auto">
      {tab==='more'?<MoreMenuView/>:tab==='shifts'?<ShiftsView/>:tab==='sales_history'?<SalesHistoryView/>:tab==='home'?<DashboardHome data={data} currentUserName="المالك" currentShift={shift} loading={false} error={null} realtimeConnected onRefresh={()=>undefined} onOrders={()=>go('orders')} onAccounts={()=>go('accounts')} onInventory={()=>go('inventory')} onProducts={()=>go('products')} onShift={()=>go('shifts')} onSell={()=>go('pos')} onReceive={()=>storeEngine.openModal('receive_goods')} onExpense={()=>storeEngine.openModal('add_expense')} salesHistory={{data:recentSalesFixture,loading:false,error:null,unavailable:false,reload:async()=>undefined}} onSalesHistory={()=>go('sales_history')}/>:<output aria-label="الوجهة المختارة">{tab}</output>}
      <output className="sr-only" data-testid="navigation206-state">{tab}:{modal??''}</output>
    </main><div className="lg:hidden"><BottomTabs/></div></div></div><AllModals/></NavigationShell>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness/></React.StrictMode>);

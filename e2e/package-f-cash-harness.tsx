import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {ShiftsView} from '../src/features/shifts/ShiftsView';
import {SideNav} from '../src/components/layout/SideNav';
import {Header} from '../src/components/common/Header';
import {BottomTabs} from '../src/components/layout/BottomTabs';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {storeEngine,type AppState} from '../src/stores/useAppStore';
import {supabase} from '../src/lib/supabase';
import {cashIds,cashShift,recentCashShifts,shiftRpcFixture,cashReportFixture} from './package-f-cash.fixture';

const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light';
const previewShift=params.has('withdrawals')?{...cashShift,ownerWithdrawals:20,ownerWithdrawalReturns:0,expectedCash:790.3}:cashShift;
const recentRows=params.has('missing-difference')?recentCashShifts.map(s=>({...s,cashDiscrepancy:undefined})):recentCashShifts;
document.documentElement.classList.toggle('theme-light',theme==='light');document.documentElement.classList.toggle('theme-dark',theme==='dark');document.documentElement.dataset.theme=theme;
if(!supabase||!['127.0.0.1','localhost','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL ?? '').hostname))throw Error('Cash harness requires loopback API only');
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
const role=params.has('cashier')?'cashier':'owner';auth.state={...auth.getState(),roleName:role,roles:[role],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const engine=storeEngine as unknown as {state:AppState};
const branch={id:cashIds.branch,name:'الفرع الرئيسي',address:'',city:'الرمثا',phone:''};
engine.state={...engine.state,activeBranch:branch,branches:[branch],currentShift:params.has('closed')?null:{...previewShift},recentShifts:recentRows,notifications:[]};
storeEngine.setCurrentUser({id:cashIds.actor,name:'أحمد',role:role==='owner'?'Owner':'Cashier',themeMode:theme,avatarUrl:''});storeEngine.setActiveTab('shifts');
const original=supabase.rpc.bind(supabase),client=supabase as unknown as {rpc:(name:string,args?:Record<string,unknown>)=>unknown};
// Read fixtures only. Actual mutations continue through unmodified store/service.
client.rpc=(name,args)=>{
  if(params.has('live'))return original(name,args);
  const ok=(data:unknown)=>Promise.resolve({data,error:null});
  if(name==='get_expense_shift_center')return ok({success:true,currentShift:params.has('closed')?null:{...shiftRpcFixture(previewShift),...(params.has('withdrawals')?{ownerWithdrawalsInMinorUnits:20000,ownerWithdrawalReturnsInMinorUnits:0}:{})},recentShifts:recentRows.map(shiftRpcFixture),expenses:[]});
  if(name==='get_cash_shift_archive_page')return ok({success:true,items:recentRows.map(shiftRpcFixture),totalCount:64,limit:25,offset:args?.p_offset||0,hasMore:true,cashiers:[{id:cashIds.actor,name:'أحمد'}]});
  if(name==='get_cash_shift_closing_report')return ok({...cashReportFixture,shift:shiftRpcFixture([previewShift,...recentCashShifts].find(s=>s.id===args?.p_shift_id)||previewShift),...(params.has('withdrawals')?{
    reconciliation:{...cashReportFixture.reconciliation,expectedCashInMinorUnits:790300},
    ownerWithdrawals:{sectionVersion:1,withdrawnInMinorUnits:20000,returnedInMinorUnits:0,netInMinorUnits:20000,netMovementAfterWithdrawalsInMinorUnits:1049300,
      items:[{kind:'withdrawal',withdrawalNumber:'OW-000001',amountInMinorUnits:20000,at:'2026-10-16T06:00:00Z'}]}}:{})});
  return original(name,args);
};
createRoot(document.getElementById('root')!).render(<div dir="rtl" className="flex h-[100dvh] bg-nw-bg font-sans text-nw-text"><SideNav/><div className="flex min-w-0 flex-1 flex-col"><Header/>
  <main data-testid="cash-scroll" className="min-h-0 flex-1 overflow-y-auto"><ShiftsView/></main><div className="lg:hidden"><BottomTabs/></div></div></div>);

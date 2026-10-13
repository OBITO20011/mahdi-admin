import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {ExpensesView} from '../src/features/expenses/ExpensesView';
import {ExpenseFormModal} from '../src/features/expenses/ExpenseFormModal';
import {ReportsCenterView} from '../src/features/reports/ReportsCenterView';
import {Modal} from '../src/components/common/Modal';
import {UiButton} from '../src/components/ui';
import {storeEngine,useAppStoreSelector,type AppState} from '../src/stores/useAppStore';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {supabase} from '../src/lib/supabase';
import {cashIds} from './package-f-cash.fixture';
import {expenseCenter,financialReport} from './package-f-financial.fixture';
const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.classList.toggle('theme-light',theme==='light');document.documentElement.classList.toggle('theme-dark',theme==='dark');
if(!supabase||!['localhost','127.0.0.1','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL ?? '').hostname))throw Error('Financial preview requires loopback');
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
auth.state={...auth.getState(),roleName:'owner',roles:['owner'],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const app=storeEngine as unknown as {state:AppState;getState:()=>AppState};
app.state={...app.getState(),activeBranch:{id:cashIds.branch,name:'فرع الرمثا',address:'وسط البلد',city:'الرمثا',phone:''},currentUser:{...app.getState().currentUser,id:cashIds.actor,name:'مهدي',role:'Owner',themeMode:theme,avatarUrl:''}};
const rpc=supabase.rpc.bind(supabase),client=supabase as unknown as {rpc:(n:string,a?:Record<string,unknown>)=>unknown};
client.rpc=(name,args)=>{
 const response=(data:unknown)=>Promise.resolve({data,error:null});
 if(name==='get_expense_shift_center')return response(expenseCenter(params.get('shift')==='closed'));
 if(name==='get_operational_business_report'){
  if(params.get('report')==='error')return Promise.resolve({data:null,error:{message:'تعذر قراءة التقرير في المعاينة'}});
  return response(financialReport);
 }
 if(name==='get_aftercare_integrity_status')return response({status:params.get('integrity')==='critical'?'critical':'healthy',checkedAt:new Date().toISOString()});
 return rpc(name,args); // No fabricated successful mutations;original isolated transport.
};
await storeEngine.refreshExpenseShiftCenterFromSupabase();
function Harness(){
 const [view,setView]=useState(params.get('view')??'expenses');
 const modalType=useAppStoreSelector(state=>state.currentModal);
 return <main dir="rtl" data-testid="financial-workbench" className="min-h-[100dvh] min-w-0 bg-nw-bg text-nw-text font-sans">
  <nav aria-label="شاشات المعاينة" className="flex flex-wrap gap-2 p-4"><UiButton onClick={()=>setView('expenses')}>المصروفات</UiButton><UiButton onClick={()=>setView('reports')}>التقارير</UiButton><UiButton onClick={()=>setView('expense-form')}>تسجيل مصروف</UiButton></nav>
  {view==='reports'?<ReportsCenterView/>:<ExpensesView/>}
  <Modal isOpen={view==='expense-form'||modalType==='add_expense'} onClose={()=>{storeEngine.closeModal();setView('expenses');}} title="مصروف جديد"><ExpenseFormModal onClose={()=>{storeEngine.closeModal();setView('expenses');}}/></Modal>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);

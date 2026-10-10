import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {AccountsView} from '../src/features/accounts/AccountsView';
import {SideNav} from '../src/components/layout/SideNav';
import {Header} from '../src/components/common/Header';
import {BottomTabs} from '../src/components/layout/BottomTabs';
import {storeEngine} from '../src/stores/useAppStore';
import {authStoreEngine, type AuthState} from '../src/stores/useAuthStore';
import {supabase} from '../src/lib/supabase';
import {customersFixture,customerAgingFixture} from './package-f-customers.fixture';

const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.classList.toggle('theme-light',theme==='light');
document.documentElement.classList.toggle('theme-dark',theme==='dark');document.documentElement.dataset.theme=theme;
if(!supabase || !['localhost','127.0.0.1','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL).hostname))throw Error('Customers harness requires loopback');
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
auth.state={...auth.getState(),roleName:'owner',roles:['owner'],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
storeEngine.setCurrentUser({id:'customers-actor',name:'مهدي',role:'Owner',themeMode:theme,avatarUrl:''});
storeEngine.setActiveTab('accounts');
const original=supabase.rpc.bind(supabase);
const client=supabase as unknown as {rpc:(name:string,args?:Record<string,unknown>)=>unknown};
client.rpc=(name,args)=>{
  if(params.has('live'))return original(name,args);
  if(name==='get_crm_customer_page'){
    const status=String(args?.p_status??'all'),search=String(args?.p_search??'');
    const rows=customersFixture.filter(row=>(row.full_name.includes(search)||row.phone.includes(search))&&(
      status==='all'||status==='active'&&row.is_active&&!row.is_blocked
      ||status==='vip'&&row.is_vip||status==='inactive'&&!row.is_active&&!row.is_blocked||status==='blocked'&&row.is_blocked
      ||status==='has_debt'&&row.current_balance_in_minor_units>0
      ||status==='overdue'&&customerAgingFixture(row.id).days_over_30_in_minor_units>0
      ||status==='over_limit'&&row.credit_limit_in_minor_units>0&&row.current_balance_in_minor_units>row.credit_limit_in_minor_units
      ||status==='wholesale'&&row.customer_type==='wholesale'));
    const size=Number(args?.p_page_size??8),offset=(Number(args?.p_page??1)-1)*size;
    return Promise.resolve({data:{customers:rows.slice(offset,offset+size),total_count:rows.length},error:null});
  }
  if(name==='get_customer_debt_aging')return Promise.resolve({data:params.has('unavailable')?null:customerAgingFixture(args?.p_customer_id as string|null),error:null});
  if(name==='get_crm_customer_detail_page'){
    const customer=customersFixture.find(row=>row.id===args?.p_customer_id);
    return Promise.resolve({data:{customer,addresses:[],stats:{total_orders:24,total_spending_in_minor_units:4500000,
      outstanding_in_minor_units:customer?.current_balance_in_minor_units??0},orders:[{id:'fa100000-0000-4000-8000-000000000001',order_number:'W-10479',
        status:'completed',total_in_minor_units:1000000,amount_paid_in_minor_units:500000,amount_due_in_minor_units:500000,
        payment_status:'partially_paid',source:'website',created_at:'2026-10-09T10:18:00Z'}],history_page:1,history_page_size:25,history_total_count:1,history_has_more:false},error:null});
  }
  return original(name,args); // No fake financial mutations or successes.
};
createRoot(document.getElementById('root')!).render(<div dir="rtl" className="flex h-[100dvh] bg-nw-bg font-sans text-nw-text">
  <SideNav/><div className="flex min-w-0 flex-1 flex-col"><Header/><main data-testid="customers-scroll" className="min-h-0 flex-1 overflow-y-auto"><AccountsView/></main><div className="lg:hidden"><BottomTabs/></div></div>
</div>);

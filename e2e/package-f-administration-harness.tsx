import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {UsersView} from '../src/features/users/UsersView';
import {MonitoringDashboardModal} from '../src/features/more/MonitoringDashboardModal';
import {StorefrontSettingsModal} from '../src/features/more/StorefrontSettingsModal';
import {PromotionCodesModal} from '../src/features/more/PromotionCodesModal';
import {Modal} from '../src/components/common/Modal';
import {UiButton} from '../src/components/ui';
import {storeEngine,type AppState} from '../src/stores/useAppStore';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {supabase} from '../src/lib/supabase';
import {cashIds} from './package-f-cash.fixture';
import {auditRows,staffRows,storefrontSettings,promotionRows,monitoringDashboard} from './package-f-administration.fixture';
const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.classList.toggle('theme-light',theme==='light');document.documentElement.classList.toggle('theme-dark',theme==='dark');
if(!supabase||!['localhost','127.0.0.1','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL).hostname))throw Error('Administration preview requires loopback');
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
auth.state={...auth.getState(),roleName:params.get('role')==='cashier'?'cashier':'owner',roles:params.get('role')==='cashier'?['cashier']:['owner'],user:{id:cashIds.actor} as NonNullable<AuthState['user']>,isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const app=storeEngine as unknown as {state:AppState;getState:()=>AppState};
app.state={...app.getState(),branches:[{id:cashIds.branch,name:'فرع الرمثا',address:'وسط البلد',city:'الرمثا',phone:''}],currentUser:{...app.getState().currentUser,id:cashIds.actor,name:'مهدي',role:'Owner',themeMode:theme,avatarUrl:''}};
const rpc=supabase.rpc.bind(supabase),client=supabase as unknown as {rpc:(n:string,a?:Record<string,unknown>)=>unknown};
client.rpc=(name,args)=>{
 const response=(data:unknown)=>Promise.resolve({data,error:null});
 if(name==='get_public_storefront_settings')return response(storefrontSettings);
 if(name==='get_promotion_codes')return response({success:true,codes:promotionRows});
 if(name==='get_advanced_monitoring_dashboard')return params.get('monitoring')==='error'?Promise.resolve({data:null,error:{message:'ISOLATED_READ_FAILURE'}}):response(monitoringDashboard);
 return rpc(name,args); // Original loopback transport for mutations;no fabricated committed result.
};
const functions=supabase.functions,invoke=functions.invoke.bind(functions);
// Supabase's functions getter creates a new client;pin the fixture client locally.
Object.defineProperty(supabase,'functions',{value:functions});
functions.invoke=((name,options)=>{
 const body=options?.body,action=body&&typeof body==='object'&&'action' in body?body.action:undefined;
 if(name==='manage-staff-users'&&['list','audit'].includes(String(action)))return Promise.resolve({data:{data:action==='list'?staffRows:auditRows},error:null});
 return invoke(name,options);
}) as typeof supabase.functions.invoke;
function Harness(){
 const [view,setView]=useState(params.get('view')??'users');
 const title=view==='monitoring'?'المراقبة':view==='settings'?'إعدادات المتجر':'رموز الخصم';
 return <main dir="rtl" data-testid="administration-workbench" className="min-h-[100dvh] min-w-0 bg-nw-bg text-nw-text font-sans">
  <nav aria-label="شاشات المعاينة" className="flex flex-wrap gap-2 p-4">{[['users','المستخدمون'],['monitoring','المراقبة'],['settings','إعدادات المتجر'],['promotions','رموز الخصم']].map(([id,label])=><UiButton key={id} onClick={()=>setView(id)}>{label}</UiButton>)}</nav>
  <UsersView/>
  <Modal isOpen={view!=='users'} onClose={()=>setView('users')} title={title}>
   {view==='monitoring'?<MonitoringDashboardModal/>:view==='settings'?<StorefrontSettingsModal/>:<PromotionCodesModal/>}
  </Modal>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);

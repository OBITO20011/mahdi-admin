import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {MoreMenuView} from '../src/features/more/MoreMenuView';
import {ProfileModal} from '../src/features/more/ProfileModal';
import {InstallAppPanel} from '../src/features/more/InstallAppPanel';
import {PushNotificationControls} from '../src/features/more/PushNotificationControls';
import {Modal} from '../src/components/common/Modal';
import {Card,PageHeader,UiButton} from '../src/components/ui';
import {storeEngine,type AppState,useAppStoreSelector} from '../src/stores/useAppStore';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {supabase} from '../src/lib/supabase';

const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.classList.toggle('theme-light',theme==='light');
document.documentElement.classList.toggle('theme-dark',theme==='dark');document.documentElement.dataset.theme=theme;
if(!supabase||!['localhost','127.0.0.1','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL).hostname))throw Error('More harness requires loopback');
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
const role=params.get('role')==='cashier'?'cashier':'owner';
auth.state={...auth.getState(),roleName:role,roles:[role],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const store=storeEngine as unknown as {state:AppState;getState:()=>AppState};
const branch={id:'more-fixture-branch',name:'فرع الرمثا',city:'الرمثا',address:'وسط البلد',phone:'0790000000'};
store.state={...store.getState(),activeBranch:branch,branches:[branch],isBiometricsEnabled:false};
storeEngine.setCurrentUser({id:'more-fixture-user',name:'مهدي النواصرة',role:role==='owner'?'Owner':'Cashier',themeMode:theme,
  phone:'0790000000',email:'fixture@example.invalid',avatarUrl:'',branchId:branch.id,jobTitle:'مدير المحل',language:'ar',timezone:'Asia/Amman',
  address:'الرمثا — وسط البلد',whatsapp:'0790000000',activeSessions:[{id:'fixture-session',device:'كمبيوتر المحل',ip:'127.0.0.1',lastActive:'منذ 5 دقائق',isCurrent:true}]});
storeEngine.setActiveTab('more');

// Display-only browser capabilities. No fake subscription/auth/profile mutation succeeds.
const push=params.get('push')??'default';
if(push==='unsupported')Object.defineProperty(window,'PushManager',{value:undefined,configurable:true});
else if(!('PushManager' in window))Object.defineProperty(window,'PushManager',{value:class {},configurable:true});
Object.defineProperty(window,'Notification',{value:class {
  static permission=push==='enabled'?'granted':push==='denied'?'denied':'default';
  static async requestPermission(){throw Error('Preview only:permission mutation is not simulated');}
},configurable:true});
if(push==='unsupported')Reflect.deleteProperty(window,'PushManager');
Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>push==='enabled'?{
  pushManager:{getSubscription:async()=>({endpoint:'http://127.0.0.1:4176/preview-push',unsubscribe:async()=>{throw Error('Preview only');}})},
}:undefined},configurable:true});
const original=supabase.rpc.bind(supabase);
const client=supabase as unknown as {rpc:(name:string,args?:Record<string,unknown>)=>unknown};
client.rpc=(name,args)=>name==='get_push_subscription_status'?Promise.resolve({data:{active_device_count:2},error:null}):original(name,args);
// MFA read fixture only; mutation implementations remain unchanged.
supabase.auth.getSession=async()=>({data:{session:{user:{id:'more-fixture-user'},expires_at:2000000000}},error:null}) as Awaited<ReturnType<typeof supabase.auth.getSession>>;
supabase.auth.mfa.listFactors=async()=>({data:{all:[],totp:[],phone:[],webauthn:[]},error:null});
supabase.auth.mfa.getAuthenticatorAssuranceLevel=async()=>({data:{currentLevel:'aal1',nextLevel:'aal1',currentAuthenticationMethods:[]},error:null});

function Harness(){
  const view=params.get('view')??'more';
  const currentModal=useAppStoreSelector(state=>state.currentModal);
  const [profile,setProfile]=useState(view==='profile'),[form,setForm]=useState(view==='form');
  const [busy,setBusy]=useState(false);
  const close=()=>{setProfile(false);storeEngine.closeModal();};
  return <main dir="rtl" data-testid="more-workbench" className="min-h-[100dvh] bg-nw-bg font-sans text-nw-text">
    {view==='more'?<MoreMenuView/>:<div className="mx-auto max-w-2xl space-y-4 p-4">
      <PageHeader title={view==='push'?'إشعارات الطلبات':view==='install'?'تثبيت التطبيق':'الملف الشخصي'} />
      {view==='install'?<InstallAppPanel/>:view==='push'?<PushNotificationControls/>:
        <Card><UiButton onClick={()=>setProfile(true)}>فتح الملف الشخصي</UiButton><UiButton onClick={()=>setForm(true)}>فتح نموذج الاختبار</UiButton></Card>}
    </div>}
    <Modal isOpen={profile||currentModal==='profile'} onClose={close} title="الملف الشخصي وإعدادات الحساب" subtitle="إدارة بياناتك الشخصية،الأمان والجلسات">
      <ProfileModal onClose={close}/>
    </Modal>
    <Modal isOpen={form} onClose={()=>setForm(false)} title="نموذج الحقول المشتركة" closeDisabled={busy}>
      <div aria-busy={busy} className="space-y-4">
        <label className="block">حقل الاختبار<input aria-label="حقل الاختبار" placeholder="أدخل النص" className="block w-full rounded-xl border px-3"/></label>
        <label className="block">اختيار<select aria-label="اختيار" className="block w-full rounded-xl border px-3"><option>خيار ثابت</option></select></label>
        <UiButton onClick={()=>setBusy(value=>!value)}>تغيير الانشغال</UiButton>
        <UiButton onClick={()=>setForm(false)}>إلغاء النموذج</UiButton>
      </div>
    </Modal>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);

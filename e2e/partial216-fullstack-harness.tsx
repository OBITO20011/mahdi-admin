import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {PosView} from '../src/features/pos/PosView';
import {supabase} from '../src/lib/supabase';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {storeEngine,useAppStoreSelector,type AppState} from '../src/stores/useAppStore';

async function start(){
 if(!supabase||!['127.0.0.1','localhost'].includes(new URL(import.meta.env.VITE_SUPABASE_URL??'').hostname))throw Error('LOCAL_ONLY');
 const fixture=await(await fetch('/__tc216_fixture')).json();
 const session={access_token:fixture.accessToken,user:{id:fixture.ownerId}};
 // Identity protocol only is synthetic. No RPC,reader or mutation is mocked.
 supabase.auth.getUser=async()=>({data:{user:session.user},error:null}) as never;
 supabase.auth.getSession=async()=>({data:{session},error:null}) as never;
 const auth=authStoreEngine as unknown as{state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
 auth.state={...auth.getState(),roleName:'owner',roles:['owner'],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
 const branch={id:fixture.branch,name:'فرع تجربة216',address:'',city:'الرمثا',phone:'',isMain:true};
 const engine=storeEngine as unknown as{state:AppState};
 engine.state={...engine.state,activeBranch:branch,branches:[branch],warehouses:[{id:fixture.warehouse,name:'مستودع التجربة',branchId:branch.id,location:''}]};
 storeEngine.setCurrentUser({id:fixture.ownerId,name:'مالك اختبار216',role:'Owner',themeMode:'light',avatarUrl:''});
 storeEngine.setActiveTab('pos');
 function Harness(){const toast=useAppStoreSelector(s=>s.toast);return <div dir="rtl" className="h-[100dvh] overflow-y-auto bg-nw-bg font-sans text-nw-text"><PosView/>{toast&&<p data-testid="local-toast" role="status">{toast.message}</p>}</div>;}
 createRoot(document.getElementById('root')!).render(<Harness/>);
}
void start();

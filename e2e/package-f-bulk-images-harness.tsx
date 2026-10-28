import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {BulkProductImagesPanel} from '../src/features/products/BulkProductImagesPanel';
import {compressProductImage} from '../src/features/products/bulkImages/compress';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {supabase} from '../src/lib/supabase';
import type {Session} from '@supabase/supabase-js';
if(!supabase||!['127.0.0.1','localhost'].includes(new URL(import.meta.env.VITE_SUPABASE_URL??'').hostname))throw Error('LOCAL_BULK_IMAGE_HARNESS_ONLY');
const live=(window as unknown as {bulkImageLiveSession?:Session}).bulkImageLiveSession;
const owner=live?.user.id??'11000000-0000-4000-8000-000000000001',role=new URLSearchParams(location.search).get('role')??'owner';
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
auth.state={...auth.getState(),user:{id:owner} as AuthState['user'],profile:{id:owner,is_active:true},roleName:role,roles:[role],isAuthenticated:true,isLoading:false,isSessionLocked:false,mfaRequired:false,mfaCurrentLevel:'aal2'};auth.initAuth=async()=>undefined;
const bridge=window as unknown as {bulkCompress:typeof compressProductImage};bridge.bulkCompress=compressProductImage;
document.documentElement.classList.add('theme-light');document.documentElement.dataset.theme='light';
async function start(){
 if(!supabase)throw Error('LOCAL_CLIENT_REQUIRED');
 if(live){const result=await supabase.auth.setSession({access_token:live.access_token,refresh_token:live.refresh_token});if(result.error)throw Error('LOCAL_BULK_SESSION_FAILED');}
 else supabase.auth.getSession=async()=>({data:{session:{user:{id:owner},access_token:'isolated-fixture-access',refresh_token:'isolated-fixture-refresh',token_type:'bearer',expires_in:3600}},error:null}) as Awaited<ReturnType<NonNullable<typeof supabase>['auth']['getSession']>>;
 createRoot(document.getElementById('root')!).render(<React.StrictMode><main className="mx-auto max-w-5xl p-3"><BulkProductImagesPanel/></main></React.StrictMode>);
}
void start();

import React from 'react';import {createRoot} from 'react-dom/client';import '../src/index.css';
import {ParcelConfigurationModal} from '../src/features/more/ParcelConfigurationModal';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';import {sanitizedSupabaseUrl} from '../src/lib/supabase';
if(!['127.0.0.1','localhost'].includes(new URL(sanitizedSupabaseUrl).hostname))throw Error('LOCAL_ONLY');
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};auth.state={...auth.getState(),roleName:'owner',roles:['owner'],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
createRoot(document.getElementById('root')!).render(<main dir="rtl" className="mx-auto max-w-xl p-4"><ParcelConfigurationModal/></main>);

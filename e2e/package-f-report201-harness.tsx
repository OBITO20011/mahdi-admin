import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {ReportsCenterView} from '../src/features/reports/ReportsCenterView';
import {storeEngine,type AppState} from '../src/stores/useAppStore';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {supabase} from '../src/lib/supabase';
import {cashIds} from './package-f-cash.fixture';

const theme=new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light';
document.documentElement.classList.toggle('theme-light',theme==='light');
document.documentElement.classList.toggle('theme-dark',theme==='dark');
if(!supabase||!['localhost','127.0.0.1','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL ?? '').hostname))throw Error('Report201 preview requires loopback');
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
auth.state={...auth.getState(),roleName:'owner',roles:['owner'],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const app=storeEngine as unknown as {state:AppState;getState:()=>AppState};
app.state={...app.getState(),activeBranch:{id:cashIds.branch,name:'فرع الرمثا',address:'وسط البلد',city:'الرمثا',phone:''},currentUser:{...app.getState().currentUser,id:cashIds.actor,name:'مهدي',role:'Owner',themeMode:theme,avatarUrl:''}};
// Keep the real report service and HTTP transport; Playwright supplies only
// explicit loopback read responses. This harness has no successful mutations.
createRoot(document.getElementById('root')!).render(<main dir="rtl" className="min-h-[100dvh] min-w-0 bg-nw-bg text-nw-text font-sans"><ReportsCenterView/></main>);

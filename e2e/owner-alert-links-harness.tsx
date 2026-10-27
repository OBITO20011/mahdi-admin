import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {App} from '../src/App';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {storeEngine} from '../src/stores/useAppStore';

declare global {interface Window {__OWNER_ALERT_TAB__:()=>string}}
const params=new URLSearchParams(location.search),role=params.get('role')||'owner';
const authenticated=params.get('auth')!=='no'&&role!=='unassigned';
const engine=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
engine.state={...engine.getState(),roleName:role==='unassigned'?null:role,roles:role==='unassigned'?[]:[role],isAuthenticated:authenticated,isLoading:false};
engine.initAuth=async()=>undefined;
storeEngine.setCurrentUser({id:'10000000-0000-4000-8000-000000000001',name:'مالك اختبار معزول',role:role==='owner'?'Owner':'View Only',themeMode:'light',avatarUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='});
storeEngine.setActiveTab('home');
window.__OWNER_ALERT_TAB__=()=>storeEngine.getState().activeTab;
// Prevent the isolated login UI from requesting a hosted captcha script.
Object.defineProperty(window,'turnstile',{value:{render:()=> 'isolated-owner-alert-captcha',reset:()=>undefined,remove:()=>undefined},configurable:true});
createRoot(document.getElementById('root')!).render(<App/>);

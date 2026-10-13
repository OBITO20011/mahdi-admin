import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {LoginView} from '../src/features/auth/LoginView';
import {AdminAssistantView} from '../src/features/assistant/AdminAssistantView';
import {IPhoneContainer} from '../src/components/layout/IPhoneContainer';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {storeEngine,type AppState} from '../src/stores/useAppStore';

declare global {interface Window {
 __PACKAGE_F_AUTH_CALLS__:Array<{method:string;args:unknown[]}>;
 __PACKAGE_F_VERIFY_CAPTCHA__:()=>void;
}}
if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)||!['localhost','127.0.0.1','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL ?? '').hostname))throw Error('Auth preview requires isolated loopback');
const params=new URLSearchParams(location.search),view=params.get('view')??'login',theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.classList.toggle('theme-dark',theme==='dark');document.documentElement.classList.toggle('theme-light',theme==='light');
const locked=view==='lock'||view==='biometric'||view==='lock-mfa';
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>;signIn:(...args:unknown[])=>Promise<unknown>;verifyMfa:(...args:unknown[])=>Promise<unknown>;cancelMfa:()=>Promise<void>;reauthenticateForUnlock:(...args:unknown[])=>Promise<unknown>;verifyUnlockMfa:(...args:unknown[])=>Promise<unknown>;unlockSession:()=>Promise<unknown>};
auth.state={...auth.getState(),isLoading:false,isAuthenticated:locked||view==='assistant',isSessionLocked:locked,mfaRequired:view==='mfa',authError:null,roles:['owner'],roleName:'owner',user:locked||view==='assistant'?{id:'00000000-0000-4000-8000-000000000001',email:'owner@example.test'} as NonNullable<AuthState['user']>:null};
auth.initAuth=async()=>undefined;
window.__PACKAGE_F_AUTH_CALLS__=[];
for(const method of ['signIn','verifyMfa','reauthenticateForUnlock','verifyUnlockMfa','unlockSession'] as const)auth[method]=async(...args:unknown[])=>{
 window.__PACKAGE_F_AUTH_CALLS__.push({method,args});
 return method==='reauthenticateForUnlock'&&view==='lock-mfa'?{success:true,mfaRequired:true}:{success:false,error:'تعذر التحقق في المعاينة المعزولة.'};
};
auth.cancelMfa=async()=>{window.__PACKAGE_F_AUTH_CALLS__.push({method:'cancelMfa',args:[]});};
const app=storeEngine as unknown as {state:AppState;getState:()=>AppState;unlockFaceId:()=>Promise<boolean>};
app.state={...app.getState(),isBiometricsEnabled:view==='biometric',isLockedWithFaceId:false,currentUser:{...app.getState().currentUser,id:'00000000-0000-4000-8000-000000000001',name:'مهدي النواصرة',email:'owner@example.test',themeMode:theme}};
app.unlockFaceId=async()=>{window.__PACKAGE_F_AUTH_CALLS__.push({method:'unlockFaceId',args:[]});return false;};
let verify:(token:string)=>void=()=>undefined;
window.turnstile={render:(container,options)=>{
 verify=options.callback;
 const box=document.createElement('div');box.textContent='التحقق البشري — معاينة معزولة';box.className='p-3 text-sm text-nw-muted';container.appendChild(box);
 if(params.get('captcha')!=='pending')queueMicrotask(()=>options.callback('isolated-human-token'));
 return 'isolated-widget';
},remove:()=>undefined,reset:()=>undefined};
window.__PACKAGE_F_VERIFY_CAPTCHA__=()=>verify('isolated-human-token');
createRoot(document.getElementById('root')!).render(<main data-testid="auth-assistant-workbench" className="min-h-[100dvh] bg-nw-bg text-nw-text" dir="rtl">
 <IPhoneContainer><div className="h-full min-h-0 overflow-y-auto">{view==='assistant'?<AdminAssistantView/>:locked?<p data-testid="protected-content">محتوى محمي لا يظهر أثناء القفل</p>:<LoginView/>}</div></IPhoneContainer>
</main>);

import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {AdminAftercarePanel} from '../src/features/orders/AdminAftercarePanel';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {supabase} from '../src/lib/supabase';
import {wizard215Scenario} from './aftercare215-wizard.fixture';
const params=new URLSearchParams(location.search),role=params.get('role')==='manager'?'manager':'owner';
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
auth.state={...auth.getState(),roleName:role,roles:[role],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
if(supabase)supabase.auth.getUser=async()=>({data:{user:{id:'92600000-0000-4000-8000-000000000070'}},error:null}) as Awaited<ReturnType<NonNullable<typeof supabase>['auth']['getUser']>>;
function Harness(){const [message,setMessage]=useState(''),{order}=wizard215Scenario(params.get('scenario')??'cash');
  return <main className="mx-auto min-h-screen max-w-3xl space-y-3 bg-nw-surface p-3 text-nw-text"><output role="status">{message}</output>
    <AdminAftercarePanel order={order} onContractResolved={()=>undefined} onChanged={async()=>undefined} notify={setMessage}/></main>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness/></React.StrictMode>);

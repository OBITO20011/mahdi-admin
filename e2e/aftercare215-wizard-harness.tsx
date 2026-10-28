import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {AftercareWizard215} from '../src/features/orders/AftercareWizard215';
import {wizard215Scenario} from './aftercare215-wizard.fixture';
import {supabase} from '../src/lib/supabase';
// Synthetic actor only; network fixtures supply no hosted credentials/session.
if(supabase)supabase.auth.getUser=async()=>({data:{user:{id:'92600000-0000-4000-8000-000000000070'}},error:null}) as Awaited<ReturnType<NonNullable<typeof supabase>['auth']['getUser']>>;
function Harness(){
  const {order,context}=wizard215Scenario(new URLSearchParams(location.search).get('scenario')??'cash');
  const [busy,setBusy]=useState(false),[owner,setOwner]=useState(true),[message,setMessage]=useState('');
  return <main className="mx-auto min-h-screen max-w-xl space-y-3 bg-nw-surface p-3 text-nw-text"><button className="min-h-11" onClick={()=>setOwner(!owner)}>تجربة تبديل الحساب</button>
    <p role="status">{message}</p><AftercareWizard215 key={String(owner)} order={order} context={context} ownerAllowed={owner} disabled={busy}
      onBusyChange={setBusy} onRecoveryChange={async()=>undefined} onChanged={async()=>undefined} notify={setMessage}/></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness/></React.StrictMode>);

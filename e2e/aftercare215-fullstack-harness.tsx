import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {supabase} from '../src/lib/supabase';
import {fetchOrderByIdFromSupabase} from '../src/services/supabase/orders.service';
import {fetchAdminAftercareContext,type AdminAftercareModernContext} from '../src/services/supabase/salesAftercare.service';
import {AftercareWizard215} from '../src/features/orders/AftercareWizard215';
import type {Order} from '../src/types';
function Harness(){
 const [state,setState]=useState<{order:Order;context:AdminAftercareModernContext}|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{void(async()=>{
  // Only the identity/session protocol is synthetic. Every business reader,
  // preview,writer and recovery RPC below reaches real local PostgreSQL/RLS.
  const fixture=await(await fetch('/__tb215_fixture')).json();if(!supabase)throw Error('LOCAL_CLIENT_REQUIRED');
  const session={access_token:fixture.accessToken,user:{id:fixture.ownerId}};
  supabase.auth.getUser=async()=>({data:{user:session.user},error:null}) as never;
  supabase.auth.getSession=async()=>({data:{session},error:null}) as never;
  const order=await fetchOrderByIdFromSupabase(fixture.orderId),context=await fetchAdminAftercareContext(fixture.orderId);
  if(!order.success||!order.order||!context.success||context.data?.capability!=='phase43_modern')throw Error(order.error||context.error||'LOCAL_CONTEXT_INVALID');
  setState({order:order.order,context:context.data});
 })().catch(error=>setMessage(error.message));},[]);
 return <main className="mx-auto min-h-screen max-w-xl space-y-3 p-3"><p role="status">{message}</p>{state&&<AftercareWizard215 {...state} ownerAllowed disabled={busy} onBusyChange={setBusy} onChanged={async()=>undefined} onRecoveryChange={async()=>undefined} notify={setMessage}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);

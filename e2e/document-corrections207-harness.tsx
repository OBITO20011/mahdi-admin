import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import '../src/index.css';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {supabase} from '../src/lib/supabase';
import {DocumentCorrectionAction} from '../src/features/corrections/DocumentCorrectionAction';
import {correctionActions} from '../src/utils/documentCorrection';
const actorId='66660000-0000-4000-8000-000000000001';
// Synthetic identity only;actual service,storage,shared locks and RPC transport.
if(supabase)supabase.auth.getUser=async()=>({data:{user:{id:actorId}},error:null}) as Awaited<ReturnType<NonNullable<typeof supabase>['auth']['getUser']>>;
const engine=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
const role=new URLSearchParams(location.search).get('role')??'owner';
engine.state={...engine.getState(),roleName:role,roles:[role],isAuthenticated:true,isLoading:false};engine.initAuth=async()=>undefined;
function Harness(){const [saved,setSaved]=useState(0);return <main dir="rtl" className="min-h-screen bg-nw-bg p-4 text-nw-text"><h1>المستندات الحالية</h1><p data-testid="saved">تحديثات المستند: {saved}</p><div className="grid gap-4">{correctionActions.map((action,i)=><article key={action} data-action={action} className="rounded-xl border border-nw-border p-3"><h2>{action}</h2><DocumentCorrectionAction action={action} recordId={`66660000-0000-4000-8000-00000000000${i+2}`} onChanged={()=>setSaved(n=>n+1)}/></article>)}</div></main>;}
createRoot(document.getElementById('root')!).render(<Harness/>);

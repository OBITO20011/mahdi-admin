import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import '../src/index.css';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {storeEngine} from '../src/stores/useAppStore';
import {supabase} from '../src/lib/supabase';
import {SupplierReplacementPanel} from '../src/features/inventory/SupplierReplacementPanel';
import {Modal} from '../src/components/common/Modal';
import {UiButton} from '../src/components/ui';
const actorId='88880000-0000-4000-8000-000000000001',role=new URLSearchParams(location.search).get('role')??'owner';
if(supabase)supabase.auth.getUser=async()=>({data:{user:{id:actorId}},error:null}) as Awaited<ReturnType<NonNullable<typeof supabase>['auth']['getUser']>>;
const engine=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
engine.state={...engine.getState(),user:{id:actorId} as AuthState['user'],roleName:role,roles:[role],isAuthenticated:true,isLoading:false};engine.initAuth=async()=>undefined;
let saved=0;storeEngine.refreshProductsFromSupabase=async()=>{saved++;document.querySelector('[data-testid="saved"]')!.textContent=String(saved);};storeEngine.refreshInventoryMovementsFromSupabase=async()=>undefined;
function Harness(){const [open,setOpen]=useState(true);return <main dir="rtl" className="min-h-screen bg-nw-bg p-4 text-nw-text"><h1>استبدال المورد</h1><p data-testid="saved">0</p><UiButton onClick={()=>setOpen(true)}>فتح الاستبدال</UiButton><Modal isOpen={open} onClose={()=>setOpen(false)} title="استبدال المورد" maxWidth="max-w-2xl"><SupplierReplacementPanel damageOnly={role==='admin'}/></Modal></main>;}
createRoot(document.getElementById('root')!).render(<Harness/>);

import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '../src/index.css';
import {WarehousesView} from '../src/features/warehouses/WarehousesView';
import {WarehouseChoice} from '../src/components/ui/WarehouseChoice';
import {authStoreEngine} from '../src/stores/useAuthStore';
import {storeEngine} from '../src/stores/useAppStore';
import {supabase} from '../src/lib/supabase';
import type {WarehouseAdministration} from '../src/services/supabase/warehouses.service';
const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.classList.add('theme-'+theme);document.documentElement.dataset.theme=theme;
if(!supabase||new URL(import.meta.env.VITE_SUPABASE_URL??'').hostname!=='127.0.0.1')throw Error('Loopback required');
const role=params.get('role')==='cashier'?'cashier':'owner';
Reflect.set(authStoreEngine,'state',{...authStoreEngine.getState(),roleName:role,roles:[role],isAuthenticated:true,isLoading:false});
authStoreEngine.initAuth=async()=>undefined;
storeEngine.refreshReferenceDataFromSupabase=async()=>undefined;
const stamp='2026-10-19T00:00:00+00:00';
const data:WarehouseAdministration={branches:[{id:'branch-main',code:'BR-MAIN',name:'الفرع الرئيسي',isActive:true}],warehouses:[
  {id:'warehouse-main',code:'WH-MAIN',name:'المستودع الرئيسي',branchId:'branch-main',isActive:true,updatedAt:stamp,hasStockOrReservations:true,hasMovements:true,hasProductAssociations:true},
  {id:'warehouse-empty',code:'WH-EMPTY',name:'مستودع فارغ',branchId:'branch-main',isActive:true,updatedAt:stamp,hasStockOrReservations:false,hasMovements:false,hasProductAssociations:false},
  {id:'warehouse-history',code:'WH-HISTORY',name:'مستودع بحركة ورصيد صفر',branchId:'branch-main',isActive:true,updatedAt:stamp,hasStockOrReservations:false,hasMovements:true,hasProductAssociations:true},
  {id:'warehouse-product',code:'WH-PRODUCT',name:'مستودع بصنف ورصيد صفر',branchId:'branch-main',isActive:true,updatedAt:stamp,hasStockOrReservations:false,hasMovements:false,hasProductAssociations:true},
  {id:'warehouse-inactive',code:'WH-OLD',name:'مستودع متوقف',branchId:'branch-main',isActive:false,updatedAt:stamp,hasStockOrReservations:true,hasMovements:true,hasProductAssociations:true},
]};
const calls:{name:string;args:Record<string,unknown>|undefined}[]=[];
Object.defineProperty(window,'warehouseCalls',{value:calls});
Object.defineProperty(supabase,'rpc',{value:async(name:string,args?:Record<string,unknown>)=>{
  calls.push({name,args});
  if(name==='get_owner_warehouses_v1')return {data:structuredClone(data),error:null};
  if(name==='save_owner_warehouse_v1'){
    if(!args)throw Error('Missing payload');
    const w=data.warehouses.find(w=>w.id===args.p_id);
    if(w){w.name=String(args.p_name);w.isActive=args.p_is_active===true;}
    else data.warehouses.push({id:String(args.p_id),code:String(args.p_code),name:String(args.p_name),branchId:String(args.p_branch_id),isActive:true,updatedAt:stamp,hasStockOrReservations:false,hasMovements:false,hasProductAssociations:false});
    return {data:{idempotentReplay:false},error:null};
  }
  throw Error('Unexpected RPC '+name);
}});
function ChoiceHarness(){
  const [many,setMany]=useState(false),[value,setValue]=useState('');
  const choices=many?data.warehouses.filter(w=>w.isActive):data.warehouses.slice(0,1);
  return <div className="p-4"><h1>اختيار المستودع</h1><button onClick={()=>setMany(!many)} className="min-h-11">تغيير عدد المستودعات</button>
    <WarehouseChoice options={choices} branchId="branch-main" value={value} onSingle={setValue}>
      <label>المستودع<select value={value} onChange={e=>setValue(e.target.value)}><option value="">اختر المستودع</option>{choices.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
    </WarehouseChoice><output aria-label="المعرف المرسل">{value}</output></div>;
}
createRoot(document.getElementById('root')!).render(<main dir="rtl" className="min-h-screen bg-nw-bg font-sans text-nw-text">
  {params.has('choice')?<ChoiceHarness/>:<WarehousesView/>}
</main>);

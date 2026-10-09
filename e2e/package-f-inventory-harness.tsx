import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {InventoryView} from '../src/features/inventory/InventoryView';
import {SideNav} from '../src/components/layout/SideNav';
import {Header} from '../src/components/common/Header';
import {BottomTabs} from '../src/components/layout/BottomTabs';
import {storeEngine, type AppState} from '../src/stores/useAppStore';
import {authStoreEngine, type AuthState} from '../src/stores/useAuthStore';
import {supabase} from '../src/lib/supabase';
import {inventoryProducts,inventoryMetrics,inventoryMovementRows} from './package-f-inventory.fixture';

const params = new URLSearchParams(location.search), theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.classList.toggle('theme-light',theme === 'light');
document.documentElement.classList.toggle('theme-dark',theme === 'dark');
document.documentElement.dataset.theme = theme;
if (!supabase || !['localhost','127.0.0.1','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL).hostname)) throw Error('Inventory harness requires loopback only.');
const auth = authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
const role = params.has('viewOnly') ? 'view_only' : 'owner';
auth.state = {...auth.getState(),roleName:role,roles:[role],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const engine = storeEngine as unknown as {state:AppState;notify:()=>void;refreshOrdersFromSupabase:()=>Promise<void>;refreshStockNotificationsFromSupabase:()=>Promise<[]>};
engine.state.activeBranch={id:'inventory-branch',name:'الفرع الرئيسي',address:'',city:'الرمثا',phone:''};
engine.state.branches=[engine.state.activeBranch];
engine.state.warehouses=[{id:'inventory-warehouse',name:'المستودع الرئيسي',branchId:'inventory-branch',location:'الرمثا'}];
engine.state.categories=[{id:'drinks',nameAr:'مشروبات',icon:'Package'}];
engine.state.notifications=[];
engine.refreshOrdersFromSupabase=async()=>undefined;engine.refreshStockNotificationsFromSupabase=async()=>[];
storeEngine.setCurrentUser({id:'inventory-actor',name:'أحمد',role:role === 'owner' ? 'Owner' : 'View Only',themeMode:theme,avatarUrl:''});
storeEngine.setActiveTab('inventory');
const originalRpc=supabase.rpc.bind(supabase);
const client=supabase as unknown as {rpc:(name:string,args?:Record<string,unknown>)=>unknown};
client.rpc=(name,args)=>{
  if(params.has('live'))return originalRpc(name,args);
  // Fixed read fixture only; all mutations still go to the isolated API.
  if(name==='get_admin_inventory_product_page') {
    if(params.has('unavailable')) return Promise.resolve({data:null,error:{message:'تعذر تحميل صفحة المخزون.'}});
    const search=String(args?.p_search??'').toLowerCase(),status=String(args?.p_status??'all');
    const rows=inventoryProducts.filter(p=>`${p.name_ar} ${p.sku} ${p.barcode}`.toLowerCase().includes(search)
      &&(status==='all'||(status==='low_stock'&&p.available_quantity>0&&p.available_quantity<=p.min_stock_level)
        ||(status==='out_of_stock'&&p.available_quantity<=0)));
    return Promise.resolve({data:{products:rows,total_count:rows.length,metrics:inventoryMetrics},error:null});
  }
  if(name==='get_inventory_movement_page') {
    const rows=inventoryMovementRows.filter(row=>!args?.p_product_id||row.product_id===args.p_product_id);
    return Promise.resolve({data:{rows:rows.slice(0,25),total_count:rows.length,
      product_movement_counts:Object.fromEntries(inventoryProducts.map(product=>[product.id,3])),
      sales_product_ids:inventoryProducts.map(product=>product.id)},error:null});
  }
  return originalRpc(name,args);
};
declare global {interface Window {__INVENTORY_RELOAD__:()=>void;}}
window.__INVENTORY_RELOAD__=()=>{engine.state.productDataRevision+=1;engine.notify();};
createRoot(document.getElementById('root')!).render(<div dir="rtl" className="flex h-[100dvh] bg-nw-bg font-sans text-nw-text">
  <SideNav /><div className="flex min-w-0 flex-1 flex-col"><Header /><main data-testid="inventory-scroll" className="min-h-0 flex-1 overflow-y-auto"><InventoryView /></main><div className="lg:hidden"><BottomTabs /></div></div>
</div>);

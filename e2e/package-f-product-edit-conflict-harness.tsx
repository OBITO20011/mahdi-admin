import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {ProductFormModal} from '../src/features/products/ProductFormModal';
import {ProductDetailModal} from '../src/features/products/ProductDetailModal';
import {Modal} from '../src/components/common/Modal';
import {storeEngine,type AppState,useAppStoreSelector} from '../src/stores/useAppStore';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {supabase} from '../src/lib/supabase';
import {mapAdminProductRecord} from '../src/services/supabase/products.service';
import {inventoryProducts} from './package-f-inventory.fixture';

// Two tabs of one browser context share this fake database through
// localStorage, with the same version rule as migration 170: a save carries
// the updated_at it opened and is refused when the row moved since.
const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.classList.toggle('theme-light',theme==='light');
document.documentElement.classList.toggle('theme-dark',theme==='dark');document.documentElement.dataset.theme=theme;
if(!supabase||!['localhost','127.0.0.1','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL ?? '').hostname))throw Error('Edit conflict preview requires loopback');

type Row=Record<string,unknown>&{id:string;updated_at:string};
const unitIds:Record<string,string>={'باكيت':'77777777-7777-4777-8777-000000000001','كرتونة':'77777777-7777-4777-8777-000000000002'};
const unit=(name:string,code:string)=>({id:unitIds[name],name_ar:name,code});
const familyId='88888888-8888-4888-8888-000000000005',categoryId='77777777-7777-4777-8777-000000000010';
const seed=():Row[]=>{
  const base={...inventoryProducts[0],category_id:categoryId,image_url:'',warehouse_id:'inventory-warehouse',base_unit:unit('باكيت','PKT'),
    purchase_unit:unit('كرتونة','CTN'),sale_unit:unit('كرتونة','CTN'),updated_at:'2026-10-15T09:00:00.000001+00:00'};
  return [base,
    {...base,id:familyId,name_ar:'عائلة شيبس',sku:'MIX-001',barcode:'',is_flavor_master:true,updated_at:'2026-10-15T09:00:00.000002+00:00'},
    {...base,id:'88888888-8888-4888-8888-000000000006',name_ar:'عائلة شيبس - جبنة',sku:'MIX-CH',barcode:'6251234500600',
      flavor_master_product_id:familyId,flavor_name_ar:'جبنة',flavor_sort_order:1,updated_at:'2026-10-15T09:00:00.000003+00:00'}];
};
const KEY='nawasrah-edit-conflict-db';
if(params.has('reset'))localStorage.removeItem(KEY);
const load=():Row[]=>JSON.parse(localStorage.getItem(KEY)||'null')??seed();
const save=(rows:Row[])=>localStorage.setItem(KEY,JSON.stringify(rows));
save(load());
let tick=0;
const nextVersion=()=>`2026-10-15T10:${String(Math.floor(Date.now()/1000)%60).padStart(2,'0')}:00.${String((Date.now()%1000)*1000+(++tick%1000)).padStart(6,'0')}+00:00`;
const snapshot=(row:Row)=>({productId:row.id,updatedAt:row.updated_at,nameAr:row.name_ar,sku:row.sku,barcode:row.barcode||null,
  description:row.description??null,categoryId:row.category_id,brandId:row.brand_id??null,unitName:(row.base_unit as Row).name_ar,
  purchasePackage:(row.purchase_unit as Row).name_ar,unitsPerPackage:row.units_per_purchase_unit,
  defaultPurchasePriceInMinorUnits:row.default_purchase_price_in_minor_units,salePackage:(row.sale_unit as Row).name_ar,
  unitsPerSalePackage:row.units_per_sale_unit,salePackagePriceInMinorUnits:row.default_sale_price_in_minor_units,
  costPriceInMinorUnits:row.cost_price_in_minor_units,minStockLevel:row.min_stock_level,maxStockLevel:row.max_stock_level??null,
  isActive:row.is_active,flavorNameAr:row.flavor_name_ar??null,imageUrl:row.image_url||null});
const conflict=(row:Row)=>({data:null,error:{code:'P0001',message:'PRODUCT_EDIT_CONFLICT: عدّل مستخدم آخر هذا المنتج قبل قليل.',
  details:JSON.stringify(snapshot(row)),hint:'اعرض القيم الحالية ثم أعد تطبيق تعديلاتك.'}});
const calls:{name:string;args:Record<string,unknown>}[]=[];
Object.assign(window,{__editCalls:calls,__db:load,
  // Another user's save, written straight into the shared fake database.
  __otherUserEdit:(id:string,changes:Record<string,unknown>)=>{const rows=load();const row=rows.find(r=>r.id===id)!;
    Object.assign(row,changes,{updated_at:nextVersion()});save(rows);}});

const client=supabase as unknown as {rpc:(name:string,args?:Record<string,unknown>)=>unknown;from:(table:string)=>unknown};
const original=client.rpc.bind(supabase),originalFrom=client.from.bind(supabase);
client.rpc=(name,args={})=>{
  calls.push({name,args});
  const rows=load();
  if(name==='get_admin_product_page')return Promise.resolve({data:{products:rows,total_count:rows.length,metrics:{low_stock:0,out_of_stock:0}},error:null});
  // The store's product refresh reads through search_admin_products.
  if(name==='search_admin_products')return Promise.resolve({data:args.p_product_id?rows.filter(r=>r.id===args.p_product_id):rows,error:null});
  if(name==='update_product_master_v4'){
    const row=rows.find(r=>r.id===args.p_product_id)!;
    if(args.p_expected_updated_at!==row.updated_at)return Promise.resolve(conflict(row));
    Object.assign(row,{name_ar:args.p_name_ar,sku:args.p_sku,barcode:args.p_barcode??'',description:args.p_description,
      category_id:args.p_category_id,units_per_purchase_unit:args.p_units_per_purchase_unit,
      default_purchase_price_in_minor_units:args.p_default_purchase_price_in_minor_units,units_per_sale_unit:args.p_units_per_sale_unit,
      default_sale_price_in_minor_units:args.p_default_sale_price_in_minor_units,cost_price_in_minor_units:args.p_cost_price_in_minor_units,
      min_stock_level:args.p_min_stock_level,max_stock_level:args.p_max_stock_level,is_active:args.p_is_active,updated_at:nextVersion()});
    save(rows);return Promise.resolve({data:{success:true,productId:row.id,updatedAt:row.updated_at},error:null});
  }
  if(name==='update_product_flavor_v2'){
    const row=rows.find(r=>r.id===args.p_flavor_product_id)!;
    if(args.p_expected_updated_at!==row.updated_at)return Promise.resolve(conflict(row));
    Object.assign(row,{flavor_name_ar:args.p_flavor_name_ar,name_ar:'عائلة شيبس - '+String(args.p_flavor_name_ar),
      barcode:args.p_barcode??'',is_active:args.p_is_active,updated_at:nextVersion()});
    save(rows);return Promise.resolve({data:{success:true,productId:row.id,updatedAt:row.updated_at},error:null});
  }
  return original(name,args);
};
client.from=(table)=>{
  if(table!=='units')return originalFrom(table);
  let name='';
  const result=()=>({data:unitIds[name]?[{id:unitIds[name]}]:[],error:null});
  // Unit lookups by name for the save, and the reference list read on refresh.
  const list={data:Object.entries(unitIds).map(([name_ar,id])=>({id,name_ar,code:name_ar==='باكيت'?'PKT':'CTN',is_active:true})),error:null};
  const chain={select:()=>chain,eq:(_column:string,value:string)=>{name=value;return chain;},limit:()=>Promise.resolve(result()),
    order:()=>Promise.resolve(list)};
  return chain;
};

const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
auth.state={...auth.getState(),roleName:'owner',roles:['owner'],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const store=storeEngine as unknown as {state:AppState;getState:()=>AppState};
store.state={...store.getState(),products:load().map(mapAdminProductRecord),categories:[{id:categoryId,nameAr:'مشروبات وتسالي'}],brands:[],
  warehouses:[{id:'inventory-warehouse',name:'المستودع الرئيسي',branchId:'fixture-branch',location:'الرمثا'}],
  activeBranch:{id:'fixture-branch',name:'فرع الرمثا',address:'وسط البلد',city:'الرمثا',phone:'0790000000'}};
storeEngine.setCurrentUser({id:'fixture-owner',name:'مهدي',role:'Owner',themeMode:theme,avatarUrl:''});
// Categories/units/warehouses are fixtures here; product rows still refresh from the shared fake database.
(storeEngine as unknown as {refreshReferenceDataFromSupabase:()=>Promise<void>}).refreshReferenceDataFromSupabase=async()=>undefined;

function Harness(){
  const products=useAppStoreSelector(s=>s.products),toast=useAppStoreSelector(s=>s.toast);
  const [open,setOpen]=React.useState(true);
  const view=params.get('view')??'form';
  // The editor keeps the product exactly as it was when the tab opened it.
  const [opened]=React.useState(()=>products.find(p=>p.id===(view==='detail'?familyId:inventoryProducts[0].id))!);
  return <main dir="rtl" data-testid="product-edit-workbench" className="min-h-[100dvh] bg-nw-bg font-sans text-nw-text">
    {!open&&<p role="status" data-testid="product-edit-closed" className="p-4">أُغلق النموذج بعد الحفظ.</p>}
    {toast&&<p data-testid="product-edit-toast" className="p-4 text-sm">{toast.message}</p>}
    <Modal isOpen={open} onClose={()=>setOpen(false)} title={view==='detail'?'تفاصيل المنتج':'تعديل المنتج'} maxWidth="max-w-2xl">
      <div data-testid="product-edit-surface">
        {view==='detail'?<ProductDetailModal product={opened} onClose={()=>setOpen(false)}/>
          :<ProductFormModal initialProduct={opened} onClose={()=>setOpen(false)}/>}
      </div>
    </Modal>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);

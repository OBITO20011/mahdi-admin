import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {ProductsView} from '../src/features/products/ProductsView';
import {ProductDetailModal} from '../src/features/products/ProductDetailModal';
import {ProductFormModal} from '../src/features/products/ProductFormModal';
import {StockAdjustmentModal} from '../src/features/products/StockAdjustmentModal';
import {ParcelConfigurationModal} from '../src/features/more/ParcelConfigurationModal';
import {Modal} from '../src/components/common/Modal';
import {UiButton} from '../src/components/ui';
import {storeEngine,type AppState,useAppStoreSelector} from '../src/stores/useAppStore';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {supabase} from '../src/lib/supabase';
import {mapAdminProductRecord} from '../src/services/supabase/products.service';
import {inventoryProducts} from './package-f-inventory.fixture';

const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.classList.toggle('theme-light',theme==='light');
document.documentElement.classList.toggle('theme-dark',theme==='dark');document.documentElement.dataset.theme=theme;
if(!supabase||!['localhost','127.0.0.1','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL).hostname))throw Error('Products preview requires loopback');
const warehouseId='88888888-8888-4888-8888-000000000099',familyId=inventoryProducts[4].id;
const rows=inventoryProducts.slice(0,7).map((p,i)=>({...p,warehouse_id:warehouseId,image_url:'',
 name_ar:i===4?'عائلة شيبس بنكهاته':i===5?'شيبس جبنة':i===6?'شيبس فلفل':p.name_ar,
 is_flavor_master:i===4,flavor_master_product_id:i>4?familyId:null,flavor_name_ar:i===5?'جبنة':i===6?'فلفل':null,
 flavor_sort_order:i>4?i-4:0,on_hand_quantity:i===4?0:p.on_hand_quantity,available_quantity:i===4?0:p.available_quantity}));
const products=rows.map(mapAdminProductRecord);
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
auth.state={...auth.getState(),roleName:'owner',roles:['owner'],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const store=storeEngine as unknown as {state:AppState;getState:()=>AppState};
store.state={...store.getState(),products,categories:[{id:'drinks',nameAr:'مشروبات وتسالي'}],
 brands:[],warehouses:[{id:warehouseId,name:'المستودع الرئيسي',branchId:'fixture-branch',location:'الرمثا'}],
 activeBranch:{id:'fixture-branch',name:'فرع الرمثا',address:'وسط البلد',city:'الرمثا',phone:'0790000000'}};
storeEngine.setCurrentUser({id:'fixture-owner',name:'مهدي',role:'Owner',themeMode:theme,avatarUrl:''});
const original=supabase.rpc.bind(supabase);
const client=supabase as unknown as {rpc:(name:string,args?:Record<string,unknown>)=>unknown};
client.rpc=(name,args)=>{
 // Display reads only: all mutations retain the original isolated transport.
 if(name==='get_admin_product_page'){
  const search=String(args?.p_search??'').toLowerCase(),status=String(args?.p_status??'all');
  const filtered=rows.filter(p=>(p.name_ar+' '+p.sku+' '+p.barcode).toLowerCase().includes(search)
   &&(status==='all'||status==='healthy'&&p.available_quantity>p.min_stock_level||status==='low_stock'&&p.available_quantity>0&&p.available_quantity<=p.min_stock_level||status==='out_of_stock'&&p.available_quantity===0||status==='hidden'&&!p.is_active));
  return Promise.resolve({data:{products:filtered,total_count:filtered.length,metrics:{low_stock:7,out_of_stock:2,inventory_cost_in_minor_units:18642300,potential_profit_in_minor_units:3840000}},error:null});
 }
 if(name==='get_admin_parcel_configuration_context_v1')return Promise.resolve({data:{featureState:'ENABLED',products:[
 {familyProductId:products[0].id,nameAr:products[0].nameAr,sku:products[0].sku,isFlavorMaster:false,unitsPerParcel:24,parcelPriceInMinorUnits:21600,
 configuration:{id:'88888888-8888-4888-8888-000000000090',composition_mode:'single_sku',is_active:true,configuration_revision:2},
 allowedProductIds:[products[0].id],components:[{productId:products[0].id,nameAr:products[0].nameAr,sku:products[0].sku,flavorNameAr:null,packetPriceInMinorUnits:900}]},
 {familyProductId:familyId,nameAr:'عائلة شيبس بنكهاته',sku:'MIX-001',isFlavorMaster:true,unitsPerParcel:24,parcelPriceInMinorUnits:24000,
 configuration:{id:'88888888-8888-4888-8888-000000000091',composition_mode:'configurable_mix',is_active:true,configuration_revision:3},
 allowedProductIds:[products[5].id,products[6].id],components:products.slice(5).map(p=>({productId:p.id,nameAr:p.nameAr,sku:p.sku,flavorNameAr:p.flavorNameAr??null,packetPriceInMinorUnits:p.id===products[6].id?0:1000}))}
 ]},error:null});
 return original(name,args);
};

function Harness(){
 const currentModal=useAppStoreSelector(s=>s.currentModal),data=useAppStoreSelector(s=>s.modalData);
 const [view,setView]=useState(params.get('view')??'products');
 const chosen=(params.has('family')?products[4]:products[0]);
 const close=()=>{setView('products');storeEngine.closeModal();};
 const modal=currentModal|| (view==='products'?null:view);
 const target=(data&&'product' in data?data.product:data??chosen) as typeof chosen;
 const form=modal==='form'||modal==='add_product'||modal==='edit_product';
 const detail=modal==='detail'||modal==='view_product',stock=modal==='stock',parcel=modal==='parcel';
 const title=form?'بيانات المنتج':detail?'تفاصيل المنتج':stock?'تعديل المخزون':'إعداد الطرود المرنة';
 return <main dir="rtl" data-testid="products-workbench" className="min-h-[100dvh] bg-nw-bg font-sans text-nw-text">
  <nav aria-label="شاشات المعاينة" className="flex flex-wrap gap-2 p-4">
   {['products','detail','form','stock','parcel'].map((key,i)=><UiButton key={key} onClick={()=>{storeEngine.closeModal();setView(key);}}>{['المنتجات','تفاصيل','نموذج المنتج','تعديل مخزون','إعداد الطرود'][i]}</UiButton>)}
  </nav>
  <ProductsView/>
  <Modal isOpen={Boolean(form||detail||stock||parcel)} onClose={close} title={title} maxWidth="max-w-2xl">
   {form?<ProductFormModal initialProduct={modal==='edit_product'?target:undefined} onClose={close}/>:detail?<ProductDetailModal product={target} onClose={close}/>:stock?<StockAdjustmentModal product={chosen} onClose={close}/>:parcel?<ParcelConfigurationModal/>:null}
  </Modal>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);

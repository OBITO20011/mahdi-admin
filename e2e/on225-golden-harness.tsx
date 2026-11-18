import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '../src/index.css';
import {Modal} from '../src/components/common/Modal';
import {AdminToast} from '../src/components/layout/AdminToast';
import {InventoryOpeningSetupModal} from '../src/features/inventory/InventoryOpeningSetupModal';
import {CreateDirectReceiptModal} from '../src/features/directReceiving/CreateDirectReceiptModal';
import {ProductFormModal} from '../src/features/products/ProductFormModal';
import {PosView} from '../src/features/pos/PosView';
import {ShiftsView} from '../src/features/shifts/ShiftsView';
import {supabase} from '../src/lib/supabase';
import {mapAdminProductRecord} from '../src/services/supabase/products.service';
import {storeEngine,useAppStoreSelector,type AppState} from '../src/stores/useAppStore';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import type {Product} from '../src/types';

const url=new URL(import.meta.env.VITE_SUPABASE_URL ?? '/unconfigured',location.origin);
if(!supabase || url.origin!==location.origin || url.hostname!=='127.0.0.1')throw Error('ON225_GOLDEN_LOCAL_ONLY');
const client=supabase;
const view=new URLSearchParams(location.search).get('view');
const auth=authStoreEngine as unknown as {state:AuthState;initAuth:()=>Promise<void>};
const store=storeEngine as unknown as {state:AppState};

interface Fixture {
  ownerId:string;
  accessToken:string;
  product:Parameters<typeof mapAdminProductRecord>[0];
  branch:AppState['branches'][number];
  warehouse:AppState['warehouses'][number];
  units:AppState['units'];
  categories:AppState['categories'];
}

function Harness(){
  const toast=useAppStoreSelector(state=>state.toast);
  const [product,setProduct]=useState<Product|null>(null);
  const [closed,setClosed]=useState(false);
  const [failure,setFailure]=useState('');
  useEffect(()=>{
    void(async()=>{
      const response=await fetch('/__on225_fixture');
      if(!response.ok)throw Error('ON225_GOLDEN_FIXTURE_REQUIRED');
      const fixture=await response.json() as Fixture;
      const user={id:fixture.ownerId};
      client.auth.getUser=async()=>({data:{user},error:null}) as never;
      client.auth.getSession=async()=>({data:{session:{user,access_token:fixture.accessToken}},error:null}) as never;
      auth.state={...authStoreEngine.getState(),user:user as NonNullable<AuthState['user']>,roleName:'owner',
        roles:['owner'],isAuthenticated:true,isLoading:false};
      auth.initAuth=async()=>undefined;
      const mapped=mapAdminProductRecord(fixture.product);
      store.state={...storeEngine.getState(),activeBranch:fixture.branch,branches:[fixture.branch],
        warehouses:[fixture.warehouse],products:[mapped],units:fixture.units,categories:fixture.categories,brands:[]};
      storeEngine.setCurrentUser({id:fixture.ownerId,name:'مالك يوم الاختبار',role:'Owner',themeMode:'light',avatarUrl:''});
      setProduct(mapped);
    })().catch(error=>setFailure(String(error.message)));
  },[]);
  const close=()=>setClosed(true);
  if(failure)return <p role="alert">{failure}</p>;
  if(!product)return <p role="status">جاري تحميل يوم الاختبار</p>;
  return <main className="mx-auto min-h-screen max-w-7xl p-2">
    <AdminToast toast={toast}/>
    {closed?<p data-testid="on225-saved">تمت العملية</p>:<>
      {view==='opening'&&<Modal isOpen onClose={close} title="تهيئة المخزون الافتتاحي" maxHeight="max-h-[96vh]" maxWidth="max-w-5xl">
        <InventoryOpeningSetupModal onClose={close}/>
      </Modal>}
      {view==='receiving'&&<Modal isOpen onClose={close} title="استلام بضاعة">
        <CreateDirectReceiptModal onClose={close}/>
      </Modal>}
      {view==='product'&&<Modal isOpen onClose={close} title="تعديل بطاقة المنتج">
        <ProductFormModal initialProduct={product} operatingMode="full" modeVerified onClose={close}/>
      </Modal>}
      {view==='pos'&&<PosView operatingMode="full"/>}
      {view==='shift'&&<ShiftsView operatingMode="full"/>}
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);

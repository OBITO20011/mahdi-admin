import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {AllModals} from '../src/components/modals/AllModals';
import {storeEngine} from '../src/stores/useAppStore';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {PosProductCard} from '../src/features/pos/PosProductCard';
import type {Product} from '../src/types';

const params=new URLSearchParams(location.search);
const engine=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
engine.state={...engine.getState(),roleName:'owner',isLoading:false};engine.initAuth=async()=>undefined;
const product={id:'94300000-0000-4000-8000-000000000100',nameAr:'عائلة اختبار وهمية',sku:'TEST-PARCEL',barcode:'',unit:'باكيت',salePackage:'باكيت',purchasePackage:'باكيت',retailPrice:1.1,salePackagePrice:1.1,unitsPerSalePackage:7,parcelOnly:false,reorderLevel:0} as Product;
if(params.get('view')==='pos'){
 createRoot(document.getElementById('root')!).render(<main dir="rtl" className="max-w-lg p-4"><PosProductCard product={product} quantityTracked={params.has('full')} manualAvailable stock={100} parcelQuantity={0} unitQuantity={0} disabled={false} onAdd={()=>undefined} onReduce={()=>undefined}/></main>);
}else{
 storeEngine.openModal('parcel_configuration');
 createRoot(document.getElementById('root')!).render(<AllModals operatingMode={params.has('full')?'full':'sales-only'} modeVerified={!params.has('unverified')}/>);
}

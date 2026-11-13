import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {AllModals} from '../src/components/modals/AllModals';
import {storeEngine} from '../src/stores/useAppStore';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {PosProductCard} from '../src/features/pos/PosProductCard';
import type {Product} from '../src/types';
import {ProductDetailsModal} from '../customer-web/src/components/ProductDetailsModal';
import type {CatalogProduct} from '../customer-web/src/types/catalog';

const params=new URLSearchParams(location.search);
const engine=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
engine.state={...engine.getState(),roleName:'owner',isLoading:false};engine.initAuth=async()=>undefined;
const product={id:'94300000-0000-4000-8000-000000000100',nameAr:'عائلة اختبار وهمية',sku:'TEST-PARCEL',barcode:'',unit:'باكيت',salePackage:'باكيت',purchasePackage:'باكيت',retailPrice:1.1,salePackagePrice:1.1,unitsPerSalePackage:7,parcelOnly:false,reorderLevel:0} as Product;
if(params.get('view')==='store'){
 const item:CatalogProduct={id:product.id,sku:product.sku,barcode:'',nameAr:product.nameAr,description:'',categoryId:'',categoryCode:'',categoryNameAr:'',brandId:'',brandNameAr:'',unitId:'',unitNameAr:'باكيت',saleUnitId:'',saleUnitNameAr:params.has('valid')?'صندوق':'باكيت',unitsPerSalePackage:7,parcelOnly:false,salePriceInMinorUnits:1100,salePackagePriceInMinorUnits:params.has('valid')?7700:1100,quantityTracked:params.has('full')?undefined:false,availableQuantity:100,availableSalePackages:14,minimumOrderPackages:1,imageUrl:'',isAvailable:true,createdAt:'2026-11-13T00:00:00Z',soldPackagesLast90Days:0,isFlavorMaster:false,flavorMasterProductId:'',flavorNameAr:'',flavorSortOrder:0,variants:[]};
 const add=()=>{document.documentElement.dataset.parcelAdded='true';};
 createRoot(document.getElementById('root')!).render(<ProductDetailsModal product={item} cartQuantityByProduct={new Map()} reservedBaseUnits={new Map()} relatedProducts={[]} onClose={()=>undefined} onAddQuantity={add} onAddBaseUnit={()=>{document.documentElement.dataset.unitAdded='true';}} onOpenParcelBuilder={()=>undefined} onOpenProduct={()=>undefined} storeWhatsAppNumber="" isFavorite={false} onToggleFavorite={()=>undefined} onOpenAssistant={()=>undefined}/>);
}else if(params.get('view')==='pos'){
 createRoot(document.getElementById('root')!).render(<main dir="rtl" className="max-w-lg p-4"><PosProductCard product={product} quantityTracked={params.has('full')} manualAvailable stock={100} parcelQuantity={0} unitQuantity={0} disabled={false} onAdd={()=>undefined} onReduce={()=>undefined}/></main>);
}else{
 storeEngine.openModal('parcel_configuration');
 createRoot(document.getElementById('root')!).render(<AllModals operatingMode={params.has('full')?'full':'sales-only'} modeVerified={!params.has('unverified')}/>);
}

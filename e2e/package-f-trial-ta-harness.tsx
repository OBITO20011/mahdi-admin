import React from 'react';
import {createRoot} from 'react-dom/client';
import '../customer-web/src/index.css';
import {ParcelBuilderModal} from '../customer-web/src/components/ParcelBuilderModal';
import {mapCatalogProduct} from '../customer-web/src/services/catalog.service';
import {createConfigurableParcelCartItem} from '../customer-web/src/utils/cart';
import {buildGuestOrderV2Lines} from '../customer-web/src/utils/checkout';
import type {PublicConfigurableParcelOption} from '../customer-web/src/types/catalog';
if(!['127.0.0.1','localhost'].includes(location.hostname))throw Error('LOCAL_TRIAL_TA_ONLY');
const id=(n:number)=>'12800000-0000-4000-8000-'+String(n).padStart(12,'0');
const product=mapCatalogProduct({id:id(1),sku:'TA',nameAr:'صنف وهمي',unitNameAr:'قنينة',saleUnitNameAr:'كرتونة',unitsPerSalePackage:3,salePackagePriceInMinorUnits:1500,salePriceInMinorUnits:500,availableQuantity:30,availableSalePackages:10,isAvailable:true});
const option:PublicConfigurableParcelOption={familyProductId:id(1),parcelConfigurationId:id(2),configurationRevision:7,compositionMode:'configurable_mix',unitsPerParcel:3,parcelPriceInMinorUnits:1500,baseUnitNameAr:'قنينة / زجاجة',saleUnitNameAr:'كرتونة',components:[{productId:id(3),sku:'TA-B',nameAr:'توت',flavorNameAr:'توت',unitNameAr:'قنينة',imageUrl:'',availableQuantity:20},{productId:id(4),sku:'TA-O',nameAr:'برتقال',flavorNameAr:'برتقال',unitNameAr:'علبة',imageUrl:'',availableQuantity:10}]};
const initial=JSON.stringify({product,option});
createRoot(document.getElementById('root')!).render(<main dir="rtl"><ParcelBuilderModal option={option} reservedByProductId={new Map()} onClose={()=>undefined} onSave={instance=>{
 const item=createConfigurableParcelCartItem(product,option,instance);
 (window as unknown as {trialTA:unknown}).trialTA={payload:buildGuestOrderV2Lines([item]),savedUnit:item.saleUnitNameAr,componentUnits:item.parcelInstances[0].components.map(c=>c.unitNameAr),catalogUnchanged:initial===JSON.stringify({product,option})};
}}/></main>);

import type {CatalogProduct} from '../types/catalog';
import {parcelDiscountInMinorUnits} from '../../../src/utils/independentParcelPrices';
import {storefrontPackageDescription,storefrontUnitName} from './storefrontUnits';

export const liteParcelSaving=(product:CatalogProduct)=>product.quantityTracked===false&&!product.parcelOnly&&product.unitsPerSalePackage>1
 ?parcelDiscountInMinorUnits(product.unitsPerSalePackage,product.salePriceInMinorUnits,product.salePackagePriceInMinorUnits):0;
export function liteProductPriceRows(product:CatalogProduct){
 const unit=storefrontUnitName(product.unitNameAr,false);
 if(product.unitsPerSalePackage<=1)return [{kind:'single' as const,label:unit,price:product.salePackagePriceInMinorUnits}];
 return [
  ...(!product.parcelOnly?[{kind:'single' as const,label:unit,price:product.salePriceInMinorUnits}]:[]),
  {kind:'parcel' as const,label:storefrontPackageDescription(product),price:product.salePackagePriceInMinorUnits},
 ];
}
export function liteFamilyStartingPrice(product:CatalogProduct):number{
 const variants=product.variants.filter(v=>v.isAvailable),source=variants.length?variants:product.variants;
 const prices=source.flatMap(v=>liteProductPriceRows(v).map(r=>r.price)).filter(p=>Number.isSafeInteger(p)&&p>0);
 return prices.length?Math.min(...prices):product.salePackagePriceInMinorUnits;
}
export function liteProductDescription(product:CatalogProduct):string{
 const description=product.description??'',match=description.trim().match(/^([0-9٠-٩۰-۹]+)\s*حب[ةه]$/u);
 return match?`${storefrontUnitName(product.unitNameAr,false)} فيه ${match[1]} حبة`:description;
}

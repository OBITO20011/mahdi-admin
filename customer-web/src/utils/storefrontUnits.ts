import type {CatalogProduct, CartDisplayFields, CartItem} from '../types/catalog';
import {SINGLE_SALE_UNIT,singleSaleUnitLabel,packageSaleUnitLabel} from './saleUnitLabels';

export const storefrontUnitName = (name:string|undefined,quantityTracked?:boolean) => singleSaleUnitLabel(name,quantityTracked===false);
export const storefrontSaleUnit = (product: CatalogProduct) =>
  product.unitsPerSalePackage > 1 ? packageSaleUnitLabel(product.saleUnitNameAr,undefined,product.quantityTracked===false) : storefrontUnitName(product.unitNameAr,product.quantityTracked);
export const storefrontPackageDescription = (product: CatalogProduct) => product.unitsPerSalePackage > 1
  ? `${storefrontSaleUnit(product)} (${product.unitsPerSalePackage.toLocaleString('ar-JO')} ${storefrontUnitName(product.unitNameAr,product.quantityTracked)})`
  : storefrontUnitName(product.unitNameAr,product.quantityTracked);
export function storefrontStock(product: CatalogProduct): string {
  if(product.quantityTracked===false)return product.isAvailable?'متوفر':'غير متوفر';
  const size = Math.max(1, product.unitsPerSalePackage);
  const quantity = Math.max(0, Math.floor(product.availableQuantity??0));
  if (size === 1) return `${quantity.toLocaleString('ar-JO')} ${storefrontUnitName(product.unitNameAr)}`;
  const parcels = Math.floor(quantity / size), loose = quantity % size;
  return [`${parcels.toLocaleString('ar-JO')} طرد`, loose ? `${loose.toLocaleString('ar-JO')} ${storefrontUnitName(product.unitNameAr)}` : ''].filter(Boolean).join(' + ');
}
export function remainingStorefrontUnits(product: CatalogProduct, reserved: number): number|null {
  if(product.quantityTracked===false)return product.isAvailable?null:0;
  return Math.max(0, Math.floor(product.availableQuantity??0) - Math.max(0, Math.floor(reserved)));
}
export function remainingStorefrontParcels(product: CatalogProduct, reserved: number): number|null {
  if(product.quantityTracked===false)return product.isAvailable?null:0;
  return Math.min(product.availableSalePackages??0, Math.floor((remainingStorefrontUnits(product, reserved)??0) / Math.max(1, product.unitsPerSalePackage)));
}
/** Saved commercial kinds/quantities/prices stay untouched; only packaging copy changes. */
export function storefrontCartUnit(item: CartDisplayFields & {commercialLineKind: CartItem['commercialLineKind']}): string {
  if (item.commercialLineKind !== 'base_unit' && item.unitsPerSalePackage > 1) return packageSaleUnitLabel(item.saleUnitNameAr,undefined,item.quantityTracked===false);
  return storefrontUnitName(item.saleUnitNameAr,item.quantityTracked);
}
export function storefrontCartPackageDescription(item: CartDisplayFields & {commercialLineKind: CartItem['commercialLineKind']}): string {
  const unit=storefrontCartUnit(item);
  return item.unitsPerSalePackage>1 ? `${unit} (${item.unitsPerSalePackage.toLocaleString('ar-JO')} ${item.quantityTracked===false?singleSaleUnitLabel(item.baseUnitNameAr,true):SINGLE_SALE_UNIT})` : unit;
}

/** Null explicitly means quantity is not tracked,never a synthetic stock limit. */
export const capStorefrontQuantity=(requested:number,available:number|null):number=>{const n=Number.isSafeInteger(Math.floor(requested))?Math.max(0,Math.floor(requested)):0;return available===null?n:Math.min(n,Math.max(0,available));};

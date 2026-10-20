import type {CatalogProduct, CartDisplayFields, CartItem} from '../types/catalog';

export const storefrontUnitName = (name: string) => name || 'باكيت';
export const storefrontSaleUnit = (product: CatalogProduct) =>
  product.unitsPerSalePackage > 1 ? 'طرد' : storefrontUnitName(product.unitNameAr);
export const storefrontPackageDescription = (product: CatalogProduct) => product.unitsPerSalePackage > 1
  ? `طرد (${product.unitsPerSalePackage.toLocaleString('ar-JO')} ${storefrontUnitName(product.unitNameAr)})`
  : storefrontUnitName(product.unitNameAr);
export function storefrontStock(product: CatalogProduct): string {
  const size = Math.max(1, product.unitsPerSalePackage);
  const quantity = Math.max(0, Math.floor(product.availableQuantity));
  if (size === 1) return `${quantity.toLocaleString('ar-JO')} ${storefrontUnitName(product.unitNameAr)}`;
  const parcels = Math.floor(quantity / size), loose = quantity % size;
  return [`${parcels.toLocaleString('ar-JO')} طرد`, loose ? `${loose.toLocaleString('ar-JO')} ${storefrontUnitName(product.unitNameAr)}` : ''].filter(Boolean).join(' + ');
}
export function remainingStorefrontUnits(product: CatalogProduct, reserved: number): number {
  return Math.max(0, Math.floor(product.availableQuantity) - Math.max(0, Math.floor(reserved)));
}
export function remainingStorefrontParcels(product: CatalogProduct, reserved: number): number {
  return Math.min(product.availableSalePackages, Math.floor(remainingStorefrontUnits(product, reserved) / Math.max(1, product.unitsPerSalePackage)));
}
/** Saved commercial kinds/quantities/prices stay untouched; only packaging copy changes. */
export function storefrontCartUnit(item: CartDisplayFields & {commercialLineKind: CartItem['commercialLineKind']}): string {
  if (item.commercialLineKind !== 'base_unit' && item.unitsPerSalePackage > 1) return 'طرد';
  return storefrontUnitName(item.saleUnitNameAr);
}

import type {CartItem,CatalogProduct} from '../types/catalog';

/** Render-only projection. Never pass this array to storage, checkout or cart
 * setters. Locked/past transactions use their own immutable snapshots. */
export function cartUnitPresentation(items:CartItem[],products:CatalogProduct[]):CartItem[]{
  const byId=new Map(products.flatMap(p=>[p,...p.variants]).map(p=>[p.id,p]));
  return items.map(item=>{
    if(item.quantityTracked===false||item.commercialLineKind==='configurable_parcel')return item;
    const product=byId.get(item.productId);
    if(!product)return item;
    if(item.commercialLineKind==='legacy_single_sku_parcel'&&item.unitsPerSalePackage!==product.unitsPerSalePackage)return item;
    return {...item,baseUnitNameAr:item.commercialLineKind==='base_unit'?item.saleUnitNameAr:product.unitNameAr,
      saleUnitNameAr:item.commercialLineKind==='base_unit'||item.unitsPerSalePackage===1?item.saleUnitNameAr:product.saleUnitNameAr||'طرد'};
  });
}

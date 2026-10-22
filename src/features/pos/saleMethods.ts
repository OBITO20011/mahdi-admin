import type {Product} from '../../types';
import type {PosCartItem} from './posV2Cart';
export type PosSingleProductMode='base_unit'|'legacy_single_sku_parcel';
/** Only NEW lines select the product's allowed method. Saved carts and
 * immutable recovery requests are never rewritten. */
export function posSaleModeForProduct(product:Product,preferred:PosSingleProductMode):PosSingleProductMode {
  if(product.parcelOnly)return 'legacy_single_sku_parcel';
  if((product.unitsPerSalePackage??1)<=1)return 'base_unit';
  return preferred;
}
export function posCartSaleMethodConflict(items:PosCartItem[],products:ReadonlyMap<string,Product>):string|null {
  const invalid=items.find(item=>item.v2Line.commercial_line_kind==='base_unit'&&products.get(item.productId)?.parcelOnly);
  return invalid?`${invalid.productName} بيتباع بالطرد بس. احذف سطر المفرد وأضفه كطرد؛ لم تُغيّر السلة تلقائياً.`:null;
}

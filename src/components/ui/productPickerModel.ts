import type {Product} from '../../types';

/** Only non-financial display facts cross the shared product-picker boundary. */
export interface ProductPickerOption {
  id:string;name:string;image?:string;available:number|null;unit:string;
}
export const productPickerOption=(product:Product,warehouseId?:string):ProductPickerOption=>({
  id:product.id,name:product.nameAr,image:product.imageUrl,unit:product.unit,
  available:warehouseId?product.warehouseBalances?.find(balance=>balance.warehouseId===warehouseId)?.availableQuantity??0:product.availableQuantity,
});
export function orderProductChoices(options:readonly ProductPickerOption[]) {
  return options.map((item,index)=>({item,index})).sort((a,b)=>{
    const rank=(value:number|null)=>value===null?1:value>0?0:2;
    return rank(a.item.available)-rank(b.item.available)||a.index-b.index;
  }).map(({item})=>item);
}


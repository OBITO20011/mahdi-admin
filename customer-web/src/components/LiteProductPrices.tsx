import type {CatalogProduct} from '../types/catalog';
import {formatJod} from '../utils/money';
import {liteParcelSaving,liteProductPriceRows} from '../utils/liteProductPricing';

export function LiteParcelSaving({product,compact=false}:{product:CatalogProduct;compact?:boolean}){
 const saving=liteParcelSaving(product);
 return saving>0?<span data-parcel-saving className={`inline-block max-w-full break-words rounded-lg bg-emerald-50 px-2 py-1 font-bold text-emerald-700 ${compact?'text-[10px]':'text-xs'}`}>وفّر {formatJod(saving)} بالطرد</span>:null;
}
export function LiteProductPrices({product}:{product:CatalogProduct}){
 return <div className="min-w-0 space-y-2" data-lite-product-prices>
  <dl className="divide-y divide-slate-200">{liteProductPriceRows(product).map(row=><div key={row.kind} data-sale-price={row.kind} className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 py-2">
   <dt className="min-w-0 max-w-full break-words text-xs font-bold text-slate-700">{row.label}</dt>
   <dd dir="ltr" className="min-w-0 max-w-full text-left text-sm font-black text-orange-700 [overflow-wrap:anywhere] sm:text-lg">{formatJod(row.price)}</dd>
  </div>)}</dl>
  <LiteParcelSaving product={product} compact/>
 </div>;
}

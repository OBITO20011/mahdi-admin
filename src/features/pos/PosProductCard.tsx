import type {Product} from '../../types';
import {MoneyText,ProductGlyph,UiButton} from '../../components/ui';
import type {PosSingleProductMode} from './saleMethods';

export function PosProductCard({product,stock,parcelQuantity,unitQuantity,disabled,onAdd,onReduce}:{
  product:Product;stock:number;parcelQuantity:number;unitQuantity:number;disabled:boolean;
  onAdd:(mode:PosSingleProductMode)=>void;onReduce:(mode:PosSingleProductMode)=>void;
}){
  const parcel=(product.unitsPerSalePackage??1)>1,unit=!product.parcelOnly;
  const methods=[...(parcel?[{mode:'legacy_single_sku_parcel' as const,label:'طرد',price:product.salePackagePrice,quantity:parcelQuantity}]:[]),
    ...(unit?[{mode:'base_unit' as const,label:product.unit,price:product.retailPrice,quantity:unitQuantity}]:[])];
  return <article data-pos-product={product.id} className={'min-w-0 space-y-3 rounded-2xl border bg-nw-surface p-3 '+(parcelQuantity+unitQuantity>0?'border-nw-primary ring-1 ring-nw-primary':'border-nw-border')}>
    <div className="flex min-w-0 items-center gap-3">
      <ProductGlyph name={product.nameAr} image={product.imageUrl} className="h-14 w-14 shrink-0"/>
      <div className="min-w-0"><h3 className="break-words text-sm font-bold">{product.nameAr}</h3>
        <bdi dir="ltr" className="block break-all text-xs text-nw-muted">{product.barcode}</bdi>
        <p className={'text-xs '+(stock<=product.reorderLevel?'text-nw-warn':'text-nw-muted')}><bdi dir="ltr">{stock}</bdi> {product.unit} · {stock===0?'نفد':'متوفر'}</p>
      </div>
    </div>
    {product.parcelOnly&&<p className="text-xs font-bold text-nw-info">طرد فقط</p>}
    <div className="space-y-2">
      {methods.map((method,index)=>{
        const priceReady=typeof method.price==='number'&&Number.isFinite(method.price)&&method.price>=0;
        return <div key={method.mode} data-pos-sale-method={method.mode} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
          <UiButton data-pos-product-card={index===0?product.id:undefined} data-pos-add-method={method.mode}
            aria-label={`إضافة ${method.label} من ${product.nameAr}`} disabled={disabled||!priceReady||stock<(method.mode==='base_unit'?1:product.unitsPerSalePackage??1)}
            onKeyDown={event=>{if(event.key==='Enter'&&event.repeat)event.preventDefault();}}
            onClick={()=>onAdd(method.mode)} className="min-w-0 flex-wrap justify-start px-2 text-xs">
            + {method.label} {priceReady?<MoneyText amount={method.price!}/>:<span>السعر غير متاح</span>}
          </UiButton>
          <output data-pos-product-quantity={index===0?product.id:undefined} data-pos-method-quantity={method.mode}
            aria-label={`عدد ${method.label} ${product.nameAr}`} className="nw-num min-w-5 text-center font-bold">{method.quantity}</output>
          <UiButton aria-label={`تقليل ${method.label} من ${product.nameAr}`} disabled={disabled||method.quantity===0}
            className="w-11 px-0" onClick={()=>onReduce(method.mode)}>−</UiButton>
        </div>;
      })}
    </div>
  </article>;
}

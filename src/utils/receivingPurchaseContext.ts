export interface SalePriceQuote {grossInMinorUnits:number;baseQuantity:number}
export interface LastPurchaseQuote {
  receiptId:string;receiptNumber:string;source:'direct'|'purchase_order';receivedAt:string;
  supplierId:string|null;supplierName:string|null;grossInMinorUnits:number;baseQuantity:number;baseUnitName:string;
}
export interface ReceiptDisplayComponent {
  itemId:string;productId:string;nameAr:string|null;sku:string|null;baseQuantity:number;currentSaleUnitPriceInMinorUnits:number|null;
}
export interface ReceiptDisplayLine {
  id:string;kind:'base_unit'|'legacy_single_sku_parcel'|'configurable_parcel';commercialQuantity:number;
  unitsPerParcel:number|null;baseUnitName:string;baseQuantity:number;grossInMinorUnits:number;
  lineDiscountInMinorUnits:number;netInMinorUnits:number;acquisitionInMinorUnits:number|null;
  components:ReceiptDisplayComponent[];
}
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('بيانات قراءة الاستلام غير صالحة.');return v as Record<string,unknown>;};
const text=(v:unknown):string=>{if(typeof v!=='string'||!v.trim())throw Error('نص قراءة الاستلام غير صالح.');return v;};
const nullableText=(v:unknown)=>v===null?null:text(v);
const integer=(v:unknown,min=0):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min)throw Error('قيمة قراءة الاستلام غير صالحة.');return v;};
const array=(v:unknown):unknown[]=>{if(!Array.isArray(v))throw Error('بنود قراءة الاستلام غير صالحة.');return v;};
export function parsePurchaseContexts(payload:unknown,ids:string[]):Record<string,LastPurchaseQuote|null>{
  const result:Record<string,LastPurchaseQuote|null>={};
  for(const value of array(object(payload).products)){
    const row=object(value),id=text(row.productId);if(!ids.includes(id)||Object.hasOwn(result,id))throw Error('هوية قراءة آخر شراء غير مطابقة.');
    if(row.lastPurchase===null){result[id]=null;continue;}
    const q=object(row.lastPurchase),source=q.source;
    if(source!=='direct'&&source!=='purchase_order')throw Error('مصدر آخر شراء غير صالح.');
    const receivedAt=text(q.receivedAt);if(!Number.isFinite(Date.parse(receivedAt)))throw Error('تاريخ آخر شراء غير صالح.');
    result[id]={receiptId:text(q.receiptId),receiptNumber:text(q.receiptNumber),source,receivedAt,supplierId:nullableText(q.supplierId),supplierName:nullableText(q.supplierName),grossInMinorUnits:integer(q.grossInMinorUnits),baseQuantity:integer(q.baseQuantity,1),baseUnitName:text(q.baseUnitName)};
  }
  if(ids.some(id=>!Object.hasOwn(result,id)))throw Error('قراءة آخر شراء غير مكتملة.');
  return result;
}
export function parseReceiptDisplay(payload:unknown,receiptId:string):ReceiptDisplayLine[]{
  const value=object(payload);if(value.receiptId!==receiptId)throw Error('سند قراءة الأسعار غير مطابق.');
  const seen=new Set<string>();
  return array(value.lines).map(raw=>{
    const r=object(raw),kind=r.kind,id=text(r.id);if(seen.has(id))throw Error('سطر استلام مكرر.');seen.add(id);
    if(kind!=='base_unit'&&kind!=='legacy_single_sku_parcel'&&kind!=='configurable_parcel')throw Error('أساس سعر الاستلام غير صالح.');
    const components=array(r.components).map(rawComponent=>{const c=object(rawComponent);return {itemId:text(c.itemId),productId:text(c.productId),nameAr:nullableText(c.nameAr),sku:nullableText(c.sku),baseQuantity:integer(c.baseQuantity,1),currentSaleUnitPriceInMinorUnits:c.currentSaleUnitPriceInMinorUnits===null?null:integer(c.currentSaleUnitPriceInMinorUnits)};});
    const baseQuantity=integer(r.baseQuantity,1);if(!components.length||components.reduce((n,c)=>n+c.baseQuantity,0)!==baseQuantity)throw Error('كمية سند العرض غير مطابقة لبنوده.');
    return {id,kind,commercialQuantity:integer(r.commercialQuantity,1),unitsPerParcel:r.unitsPerParcel===null?null:integer(r.unitsPerParcel,1),baseUnitName:text(r.baseUnitName),baseQuantity,grossInMinorUnits:integer(r.grossInMinorUnits),lineDiscountInMinorUnits:integer(r.lineDiscountInMinorUnits),netInMinorUnits:integer(r.netInMinorUnits),acquisitionInMinorUnits:r.acquisitionInMinorUnits===null?null:integer(r.acquisitionInMinorUnits),components};
  });
}
/** Suggestions only, rounded once at the same existing money-input boundary. */
export function quoteForQuantity(quote:LastPurchaseQuote,baseUnits:number):number{
  return Math.round(quote.grossInMinorUnits*baseUnits/quote.baseQuantity);
}
/** Sale parcels use their stored gross quote;never reconstruct them from rounded unit prices. */
export function receivingSaleQuote(product:{salePackagePrice?:number;unitsPerSalePackage?:number;retailPrice:number}):SalePriceQuote|null {
  const units=Math.max(1,Math.floor(product.unitsPerSalePackage??1));
  const parcel=units>1&&Number.isFinite(product.salePackagePrice)&&(product.salePackagePrice??0)>0;
  const gross=Math.round((parcel?product.salePackagePrice!:product.retailPrice)*1000),quantity=parcel?units:1;
  return Number.isSafeInteger(gross)&&gross>=0&&Number.isSafeInteger(quantity)?{grossInMinorUnits:gross,baseQuantity:quantity}:null;
}
export function purchasePriceRise(quote:LastPurchaseQuote|null|undefined,priceInMinorUnits:number,units:number,saleQuote:SalePriceQuote|null){
  if(!quote||!Number.isSafeInteger(units)||units<1||!Number.isSafeInteger(priceInMinorUnits)||priceInMinorUnits<0)return null;
  if(BigInt(priceInMinorUnits)*BigInt(quote.baseQuantity)<=BigInt(quote.grossInMinorUnits)*BigInt(units))return null;
  const old=quoteForQuantity(quote,units),validSale=saleQuote&&Number.isSafeInteger(saleQuote.grossInMinorUnits)&&saleQuote.grossInMinorUnits>=0&&Number.isSafeInteger(saleQuote.baseQuantity)&&saleQuote.baseQuantity>0;
  return {oldPrice:old,newPrice:priceInMinorUnits,
    oldProfit:validSale?saleQuote.grossInMinorUnits-quote.grossInMinorUnits*saleQuote.baseQuantity/quote.baseQuantity:null,
    newProfit:validSale?saleQuote.grossInMinorUnits-priceInMinorUnits*saleQuote.baseQuantity/units:null,
    isLoss:Boolean(validSale&&BigInt(priceInMinorUnits)*BigInt(saleQuote.baseQuantity)>BigInt(saleQuote.grossInMinorUnits)*BigInt(units))};
}

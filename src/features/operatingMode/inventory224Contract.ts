export type InventoryFilter='all'|'low'|'zero';
export interface QuantityEvent224 {kind:'manual'|'sale'|'cancel'|'return';delta:number;at:string;actorDisplayName:string|null;source:string|null}
export interface InventoryCounter224 {
 productId:string;name:string;flavorName:string|null;familyId:string|null;familyName:string|null;sku:string;barcode:string|null;
 unitId:string;unitName:string;enabled:true;quantity:number;threshold:number;revision:number;updatedAt:string;
 status:'zero'|'low'|'available';lastEvent:QuantityEvent224|null;
}
export interface InventoryPage224 {contractVersion:'inventory224-v1';fullAccounting:false;counts:{tracked:number;low:number;zero:number};total:number;page:number;pageSize:number;items:InventoryCounter224[]}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const whole=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(v);
const nullableText=(v:unknown):v is string|null=>v===null||typeof v==='string';
const date=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export const inventoryReadError=()=>Error('تعذرت قراءة المخزون؛ أعد القراءة وتحقق من جلسة المالك.');
export function normalizeInventorySearch(text:string):string{
 return text.normalize('NFKC').replace(/[٠-٩۰-۹]/gu,c=>String(c.charCodeAt(0)-(c>='۰'?'۰':'٠').charCodeAt(0))).replace(/\s+/gu,' ').trim();
}
export function parseInventory224(data:unknown,request:{search:string;filter:InventoryFilter;page:number;pageSize:number}):InventoryPage224{
 if(!record(data)||data.contractVersion!=='inventory224-v1'||data.fullAccounting!==false||data.page!==request.page||data.pageSize!==request.pageSize
 ||!record(data.counts)||!whole(data.counts.tracked)||!whole(data.counts.low)||!whole(data.counts.zero)
 ||data.counts.zero>data.counts.low||data.counts.low>data.counts.tracked||!whole(data.total)||data.total>data.counts.tracked
 ||!Array.isArray(data.items)||data.items.length>request.pageSize||data.items.length>data.total)throw inventoryReadError();
 const seen=new Set<string>();
 const items=data.items.map((v:unknown):InventoryCounter224=>{
  if(!record(v)||!uuid(v.productId)||seen.has(v.productId)||typeof v.name!=='string'||typeof v.sku!=='string'||!uuid(v.unitId)
  ||!nullableText(v.flavorName)||!(v.familyId===null||uuid(v.familyId))||!nullableText(v.familyName)||!nullableText(v.barcode)
  ||typeof v.unitName!=='string'||!v.unitName.trim()||v.enabled!==true||!whole(v.quantity)||v.quantity>1_000_000_000
  ||!whole(v.threshold)||v.threshold>1_000_000_000||!whole(v.revision)||!date(v.updatedAt))throw inventoryReadError();
  const status=v.quantity===0?'zero':v.quantity<v.threshold?'low':'available';
  if(v.status!==status||(request.filter==='zero'&&status!=='zero')||(request.filter==='low'&&status==='available'))throw inventoryReadError();
  let lastEvent:QuantityEvent224|null=null;
  if(v.lastEvent!==null){const e=v.lastEvent;
   if(!record(e)||!['manual','sale','cancel','return'].includes(String(e.kind))||typeof e.delta!=='number'||!Number.isSafeInteger(e.delta)
   ||!date(e.at)||!nullableText(e.actorDisplayName)||!nullableText(e.source))throw inventoryReadError();
   lastEvent={kind:e.kind as QuantityEvent224['kind'],delta:e.delta,at:e.at,actorDisplayName:e.actorDisplayName,source:e.source};
  }
  seen.add(v.productId);
  return {productId:v.productId,name:v.name,flavorName:v.flavorName,familyId:v.familyId,familyName:v.familyName,sku:v.sku,barcode:v.barcode,
   unitId:v.unitId,unitName:v.unitName,enabled:true,quantity:v.quantity,threshold:v.threshold,revision:v.revision,updatedAt:v.updatedAt,status,lastEvent};
 });
 return {contractVersion:'inventory224-v1',fullAccounting:false,counts:{tracked:data.counts.tracked,low:data.counts.low,zero:data.counts.zero},total:data.total,page:request.page,pageSize:request.pageSize,items};
}
export function receivedQuantity224(current:number,added:number|null):number|null{
 if(!whole(current)||added===null||!whole(added))return null;
 const result=added===null?null:current+added;
 return result!==null&&whole(result)&&result<=1_000_000_000?result:null;
}

import {isSupabaseConfigured,supabase} from '../../lib/supabase';
import {normalizeDigits} from '../../features/goLive/goLiveImport';
import type {PosV2Line} from './posV2.service';

export interface OptionalQuantityRow {
 productId:string;name:string;flavorName:string|null;sku:string;unitId:string;unitName:string;
 enabled:boolean;quantity:number;threshold:number;revision:number;everEnabled:boolean;
 active:boolean;manualAvailable:boolean;effectiveAvailable:boolean;
}
export interface OptionalQuantityContext {
 contractVersion:'optional-quantity223-v1';fullAccounting:false;productId:string;isFamily:boolean;products:OptionalQuantityRow[];
}
type CounterRpc=(name:'lite3_counter_context223'|'lite3_set_counter223'|'lite3_pos_quantity_check223'|'lite3_low_counters223',args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(v);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const whole=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const unverified=()=>Error('OPTIONAL_QUANTITY_UNVERIFIED: تعذر تثبيت حالة العدّاد. أعد القراءة قبل التعديل.');
export function parseOptionalQuantityInput(text:string):number|null{
 const normalized=normalizeDigits(text);
 if(!/^\d{1,10}$/u.test(normalized))return null;
 const value=Number(normalized);return value<=1_000_000_000?value:null;
}
export function parseOptionalQuantityContext(data:unknown,productId:string):OptionalQuantityContext{
 if(!uuid(productId)||!record(data)||data.contractVersion!=='optional-quantity223-v1'||data.fullAccounting!==false
 ||typeof data.productId!=='string'||data.productId.toLowerCase()!==productId.toLowerCase()||typeof data.isFamily!=='boolean'
 ||!Array.isArray(data.products)||data.products.length>200)throw unverified();
 const seen=new Set<string>();
 const products=data.products.map((value:unknown):OptionalQuantityRow=>{
  if(!record(value)||!uuid(value.productId)||seen.has(value.productId.toLowerCase())||!uuid(value.unitId)
  ||typeof value.name!=='string'||typeof value.sku!=='string'||typeof value.unitName!=='string'||!value.unitName.trim()
  ||!(value.flavorName===null||typeof value.flavorName==='string')||!whole(value.quantity)||!whole(value.threshold)||!whole(value.revision)
  ||typeof value.enabled!=='boolean'||typeof value.everEnabled!=='boolean'||typeof value.active!=='boolean'
  ||typeof value.manualAvailable!=='boolean'||typeof value.effectiveAvailable!=='boolean'
  ||(value.manualAvailable&&!value.active)||value.effectiveAvailable!==(value.manualAvailable&&(!value.enabled||value.quantity>0)))throw unverified();
  if(!data.isFamily&&value.productId.toLowerCase()!==productId.toLowerCase())throw unverified();
  seen.add(value.productId.toLowerCase());
  return {productId:value.productId.toLowerCase(),name:value.name,flavorName:value.flavorName,sku:value.sku,unitId:value.unitId.toLowerCase(),unitName:value.unitName,
   enabled:value.enabled,quantity:value.quantity,threshold:value.threshold,revision:value.revision,everEnabled:value.everEnabled,
   active:value.active,manualAvailable:value.manualAvailable,effectiveAvailable:value.effectiveAvailable};
 });
 if(!data.isFamily&&products.length!==1)throw unverified();
 return {contractVersion:'optional-quantity223-v1',fullAccounting:false,productId:productId.toLowerCase(),isFamily:data.isFamily,products};
}
export async function readOptionalQuantityWithRpc(productId:string,execute:CounterRpc){
 if(!uuid(productId))throw unverified();
 const {data,error}=await execute('lite3_counter_context223',{p_product_id:productId});
 if(error)throw unverified();return parseOptionalQuantityContext(data,productId);
}
export async function setOptionalQuantityWithRpc(row:OptionalQuantityRow,values:{enabled:boolean;quantity:number;threshold:number},key:string,execute:CounterRpc){
 if(!uuid(row.productId)||!uuid(key)||!whole(row.revision)||typeof values.enabled!=='boolean'||!whole(values.quantity)||values.quantity>1_000_000_000
 ||!whole(values.threshold)||values.threshold>1_000_000_000)throw unverified();
 // One owner intent,one key,one CAS. A lost response requires an explicit READ.
 const {data,error}=await execute('lite3_set_counter223',{p_product_id:row.productId,p_enabled:values.enabled,p_quantity:values.quantity,p_low_threshold:values.threshold,p_expected_revision:row.revision,p_key:key});
 if(error||!record(data)||data.success!==true||data.productId!==row.productId||data.enabled!==values.enabled
 ||data.quantity!==values.quantity||data.threshold!==values.threshold||data.revision!==row.revision+1||typeof data.idempotentReplay!=='boolean')throw unverified();
 return {revision:row.revision+1};
}
export interface OptionalQuantityShortage {productId:string;name:string;unitName:string;quantity:number;required:number;revision:number}
export async function readOptionalQuantityShortagesWithRpc(lines:readonly PosV2Line[],execute:CounterRpc):Promise<OptionalQuantityShortage[]>{
 const ids=new Set(lines.flatMap(line=>line.commercial_line_kind==='configurable_parcel'
  ?line.parcel_instances.flatMap(instance=>instance.components.map(component=>component.product_id.toLowerCase())):[line.product_id.toLowerCase()]));
 const {data,error}=await execute('lite3_pos_quantity_check223',{p_lines:lines});
 if(error||!record(data)||data.contractVersion!=='optional-quantity223-v1'||data.fullAccounting!==false||!Array.isArray(data.shortages)||data.shortages.length>ids.size)throw unverified();
 const seen=new Set<string>();
 return data.shortages.map((value:unknown)=>{
  if(!record(value)||!uuid(value.productId)||!ids.has(value.productId.toLowerCase())||seen.has(value.productId.toLowerCase())
  ||typeof value.name!=='string'||typeof value.unitName!=='string'||!value.unitName.trim()
  ||!whole(value.quantity)||!whole(value.required)||!whole(value.revision)||value.required<=value.quantity)throw unverified();
  seen.add(value.productId.toLowerCase());
  return {productId:value.productId.toLowerCase(),name:value.name,unitName:value.unitName,quantity:value.quantity,required:value.required,revision:value.revision};
 });
}
export interface LowOptionalQuantity {productId:string;sku:string;name:string;unitName:string;quantity:number;threshold:number;revision:number}
export async function readLowOptionalQuantityWithRpc(page:number,execute:CounterRpc){
 if(!Number.isInteger(page)||page<1||page>100000)throw unverified();
 const {data,error}=await execute('lite3_low_counters223',{p_page:page,p_page_size:20});
 if(error||!record(data)||data.contractVersion!=='optional-quantity223-v1'||data.page!==page||data.pageSize!==20
 ||!whole(data.total)||!Array.isArray(data.products)||data.products.length>20||data.total<data.products.length)throw unverified();
 const seen=new Set<string>();
 const products=data.products.map((value:unknown):LowOptionalQuantity=>{
  if(!record(value)||!uuid(value.productId)||seen.has(value.productId.toLowerCase())||typeof value.name!=='string'||typeof value.sku!=='string'
  ||typeof value.unitName!=='string'||!value.unitName.trim()||!whole(value.quantity)||!whole(value.threshold)||!whole(value.revision)
  ||(value.quantity!==0&&value.quantity>=value.threshold))throw unverified();
  seen.add(value.productId.toLowerCase());
  return {productId:value.productId.toLowerCase(),sku:value.sku,name:value.name,unitName:value.unitName,quantity:value.quantity,threshold:value.threshold,revision:value.revision};
 });
 return {page,total:data.total,products};
}
const clientRpc:CounterRpc=(name,args)=>{
 if(!isSupabaseConfigured||!supabase)throw unverified();
 return supabase.rpc(name,args);
};
export const fetchOptionalQuantity=(productId:string)=>readOptionalQuantityWithRpc(productId,clientRpc);
export const saveOptionalQuantity=(row:OptionalQuantityRow,values:{enabled:boolean;quantity:number;threshold:number},key:string)=>setOptionalQuantityWithRpc(row,values,key,clientRpc);
export const fetchOptionalQuantityShortages=(lines:readonly PosV2Line[])=>readOptionalQuantityShortagesWithRpc(lines,clientRpc);
export const fetchLowOptionalQuantity=(page:number)=>readLowOptionalQuantityWithRpc(page,clientRpc);

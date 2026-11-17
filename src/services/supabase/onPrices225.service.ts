import {isSupabaseConfigured,supabase} from '../../lib/supabase';

type ReadResult={data:unknown;error:{code?:string;message?:string}|null;status?:number};
export const ON_PRICE_CONTEXT225_RPC='get_product_pricing_context225';

export function parseOnPriceCapability225({data,error,status}:ReadResult):boolean {
 if(data==null&&status===404&&error?.code==='PGRST202'&&error.message?.includes(ON_PRICE_CONTEXT225_RPC))return false;
 if(!error&&data&&typeof data==='object'&&!Array.isArray(data)){
  const value=data as Record<string,unknown>;
  if(value.contractVersion==='on-independent-prices225-v1'&&value.mode==='full')return true;
 }
 throw Error('PRICES225_CAPABILITY_UNVERIFIED');
}

export async function readOnPriceCapability225():Promise<boolean> {
 if(!isSupabaseConfigured||!supabase)throw Error('PRICES225_CAPABILITY_UNVERIFIED');
 return parseOnPriceCapability225(await supabase.rpc('get_product_pricing_context225',{p_product_id:null}));
}
export interface PriceLossRisk225 {
 name:string;
 wacInMinorUnitsExact:string;
 unitBelowCost:boolean;
 parcelBelowCost:boolean;
}

export interface PriceLossConfirmation225 {
 acknowledged:true;
 unitPrice:number;
 parcelPrice:number;
 unitsPerParcel:number;
 parcelEnabled:boolean;
 parcelOnly:boolean;
 risks:PriceLossRisk225[];
}

const PEER_WAC_WARNING='PRICES225_BELOW_WAC_CONFIRMATION_REQUIRED:';
const isRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const isPositiveMinorUnit=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;

export function readLossConfirmation225(error:unknown):PriceLossConfirmation225|null {
 if(!isRecord(error)||typeof error.message!=='string'||!error.message.startsWith(PEER_WAC_WARNING))return null;
 let value:unknown;
 try{value=JSON.parse(typeof error.details==='string'?error.details:'');}
 catch{throw Error('PRICES225_LOSS_PROOF_INVALID');}
 if(!isRecord(value)||value.acknowledged!==true||!isPositiveMinorUnit(value.unitPrice)||!isPositiveMinorUnit(value.parcelPrice)||
    !isPositiveMinorUnit(value.unitsPerParcel)||typeof value.parcelOnly!=='boolean'||typeof value.parcelEnabled!=='boolean'||
    !Array.isArray(value.risks)||!value.risks.length)throw Error('PRICES225_LOSS_PROOF_INVALID');
 const risks=value.risks;
 if(risks.some(risk=>!isRecord(risk)||typeof risk.name!=='string'||!risk.name.trim()||
    typeof risk.wacInMinorUnitsExact!=='string'||!/^\d+(?:\.\d+)?$/u.test(risk.wacInMinorUnitsExact)||
    typeof risk.unitBelowCost!=='boolean'||typeof risk.parcelBelowCost!=='boolean'||
    !(risk.unitBelowCost||risk.parcelBelowCost)))throw Error('PRICES225_LOSS_PROOF_INVALID');
 // Return the exact server proof, including product identity, to the writer
 // only after the caller explicitly accepts displayed current cost and prices.
 return value as unknown as PriceLossConfirmation225;
}
export type RestorePrice225='single'|'parcel';
export interface AccountingPrice225Write {
 singlePriceInMinorUnits:number;
 parcelEnabled?:boolean;
 restoreOriginal?:RestorePrice225;
 confirmLoss?:(proof:PriceLossConfirmation225)=>Promise<boolean>;
}

export interface OnPriceContext225 {
 productId:string;
 requestedProductId:string;
 updatedAt:string;
 parcelEnabled:boolean;
 originalUnitPrice:number|null;
 originalParcelPrice:number|null;
 currentWacInMinorUnitsExact:string;
}

export async function readOnPriceContext225(productId:string):Promise<OnPriceContext225|null> {
 if(!isSupabaseConfigured||!supabase)throw Error('PRICES225_CAPABILITY_UNVERIFIED');
 const {data,error,status}=await supabase.rpc('get_product_pricing_context225',{p_product_id:productId});
 if(data==null&&status===404&&error?.code==='PGRST202'&&error.message.includes(ON_PRICE_CONTEXT225_RPC))return null;
 if(error||!isRecord(data)||data.contractVersion!=='on-independent-prices225-v1'||
    typeof data.productId!=='string'||data.requestedProductId!==productId||typeof data.updatedAt!=='string'||
    !Number.isFinite(Date.parse(data.updatedAt))||typeof data.parcelEnabled!=='boolean'||
    !(data.originalUnitPrice===null||isPositiveMinorUnit(data.originalUnitPrice))||
    !(data.originalParcelPrice===null||isPositiveMinorUnit(data.originalParcelPrice))||
    typeof data.currentWacInMinorUnitsExact!=='string'||!/^\d+(?:\.\d+)?$/u.test(data.currentWacInMinorUnitsExact)){
  throw Error('PRICES225_CAPABILITY_UNVERIFIED');
 }
 return {
  productId:data.productId,requestedProductId:productId,updatedAt:data.updatedAt,parcelEnabled:data.parcelEnabled,
  originalUnitPrice:data.originalUnitPrice,originalParcelPrice:data.originalParcelPrice,
  currentWacInMinorUnitsExact:data.currentWacInMinorUnitsExact,
 };
}

export async function confirmProductPriceWrite225<T extends {error:unknown}>(
 call:(proof?:PriceLossConfirmation225)=>PromiseLike<T>,
 confirm:AccountingPrice225Write['confirmLoss'],
):Promise<T>{
 const first=await call();
 const proof=readLossConfirmation225(first.error);
 if(!proof)return first;
 if(!confirm||!(await confirm(proof)))throw Error('السعر تحت التكلفة ولم يُعتمد الحفظ.');
 const second=await call(proof);
 if(readLossConfirmation225(second.error))throw Error('تغيّرت تكلفة الصنف قبل الحفظ. راجع السعر والتكلفة ثم أعد المحاولة.');
 return second;
}
export interface ReceiptPriceWarning225 {
 productId:string;
 priceProductId:string;
 name:string;
 unit:string;
 parcelUnit:string;
 unitPrice:number;
 parcelPrice:number;
 originalUnitPrice:number|null;
 originalParcelPrice:number|null;
 parcelEnabled:boolean;
 wacInMinorUnitsExact:string;
 unitBelowCost:boolean;
 parcelBelowCost:boolean;
}

const isMinorPrice=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;

export async function readReceiptPriceWarnings225(productIds:readonly string[]):Promise<ReceiptPriceWarning225[]> {
 if(!isSupabaseConfigured||!supabase)throw Error('PRICES225_RECEIPT_UNVERIFIED');
 const client=supabase,ids=[...new Set(productIds)];
 const warnings:ReceiptPriceWarning225[]=[];
 const seen=new Set<string>();
 for(let i=0;i<ids.length;i+=100){
  const batch=ids.slice(i,i+100);
  const {data,error,status}=await client.rpc('get_receipt_pricing_warnings225',{p_product_ids:batch});
  if(i===0&&data==null&&status===404&&error?.code==='PGRST202'&&error.message.includes('get_receipt_pricing_warnings225'))return [];
  if(error||!Array.isArray(data)||data.length>batch.length)throw Error('PRICES225_RECEIPT_UNVERIFIED');
  for(const row of data){
   if(!isRecord(row)||typeof row.productId!=='string'||!batch.includes(row.productId)||seen.has(row.productId)||typeof row.priceProductId!=='string'||
      typeof row.name!=='string'||!isMinorPrice(row.unitPrice)||!isMinorPrice(row.parcelPrice)||
      !(row.originalUnitPrice===null||isPositiveMinorUnit(row.originalUnitPrice))||
      !(row.originalParcelPrice===null||isPositiveMinorUnit(row.originalParcelPrice))||
      typeof row.wacInMinorUnitsExact!=='string'||!/^\d+(?:\.\d+)?$/u.test(row.wacInMinorUnitsExact)||
      typeof row.parcelEnabled!=='boolean'||typeof row.unitBelowCost!=='boolean'||typeof row.parcelBelowCost!=='boolean'){
    throw Error('PRICES225_RECEIPT_UNVERIFIED');
   }
   seen.add(row.productId);
   warnings.push({
    productId:row.productId,priceProductId:row.priceProductId,name:row.name,
    unit:typeof row.unit==='string'&&row.unit?row.unit:'باكيت',
    parcelUnit:typeof row.parcelUnit==='string'&&row.parcelUnit?row.parcelUnit:'طرد',
    unitPrice:row.unitPrice,parcelPrice:row.parcelPrice,originalUnitPrice:row.originalUnitPrice,originalParcelPrice:row.originalParcelPrice,
    wacInMinorUnitsExact:row.wacInMinorUnitsExact,parcelEnabled:row.parcelEnabled,unitBelowCost:row.unitBelowCost,parcelBelowCost:row.parcelBelowCost,
   });
  }
 }
 return warnings;
}

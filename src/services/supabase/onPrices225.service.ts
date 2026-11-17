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

import type {Order} from '../../types';

const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** The selected FK identity must match. Missing joined evidence is an error,
 * never a default to stock/cost tracking for a non-legacy operation. */
export function orderTracksAccounting(row:Record<string,unknown>):boolean{
 if(row.operation_id==null)return true;
 const operation=row.creation_operation;
 if(typeof row.operation_id!=='string'||!record(operation)||operation.id!==row.operation_id||typeof operation.operation_type!=='string'||!operation.operation_type)throw Error('ORDER_CREATION_EVIDENCE_UNVERIFIED');
 return !['lite1_pos','lite1_guest'].includes(operation.operation_type);
}
function parseRecipientProposal(value:unknown):NonNullable<Order['recipientProposal']>{
 const invalid=()=>Error('ORDER_RECIPIENT_EVIDENCE_UNVERIFIED');
 if(!record(value)||typeof value.proposed!=='boolean'||!record(value.recipient)||!record(value.customerCard))throw invalid();
 const recipient:Record<string,string>={};
 for(const key of ['fullName','governorate','city','area','street','building','addressNotes']){
  const field=value.recipient[key];
  if((field==null||field==='')&&['building','addressNotes'].includes(key))continue;
  if(typeof field!=='string'||field.length>1000||!field.trim())throw invalid();recipient[key]=field;
 }
 const {fullName,governorate,defaultAddress}=value.customerCard;
 if(typeof fullName!=='string'||governorate!==null&&typeof governorate!=='string'||defaultAddress!==null&&typeof defaultAddress!=='string')throw invalid();
 return {proposed:value.proposed,recipient,customerCard:{fullName,governorate,defaultAddress}};
}

export function parseSalesOnlyOrderDetails(value:unknown,orderId:string){
 if(!record(value)||value.contractVersion!=='lite2-order-details-v1'||value.orderId!==orderId||value.accountingTracked!==false
  ||!Number.isSafeInteger(value.amountPaidInMinorUnits)||Number(value.amountPaidInMinorUnits)<0
  ||!Number.isSafeInteger(value.amountDueInMinorUnits)||Number(value.amountDueInMinorUnits)<0)throw Error('ORDER_LITE_FINANCIAL_EVIDENCE_UNVERIFIED');
 return {amountPaid:Number(value.amountPaidInMinorUnits)/1000,amountDue:Number(value.amountDueInMinorUnits)/1000,
  recipientProposal:value.recipientProposal===null?undefined:parseRecipientProposal(value.recipientProposal)};
}

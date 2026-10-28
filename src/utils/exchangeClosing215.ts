import {exactMinorText} from './aftercare215Money';
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
/** The215 closing reader adds an internal credit to both commercial sides,
 * never to cash flow. Reject an inconsistent/rounded legacy monetary group. */
export function exchangeClosingCredit215(payload:Record<string,unknown>):string|undefined{
  const sales=payload.sales;if(!record(sales)||sales.salesDefinitionVersion!==215)return undefined;
  const invalid=()=>new Error('دليل تفصيل التبديل في إغلاق الوردية غير مكتمل أو خارج نطاق العرض الدقيق.');
  const credit=exactMinorText(sales.internalExchangeCreditInMinorUnits);if(BigInt(credit)<=0n)throw invalid();
  const number=(v:unknown,signed=false)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||!signed&&v<0)throw invalid();return BigInt(v);};
  const amount=(key:string,signed=false)=>number(sales[key+'InMinorUnits'],signed);
  const gross=amount('grossSales'),direct=amount('collectedDirectSales'),initial=amount('initialReceiptPayments'),debt=amount('creditSales'),refund=amount('refunds'),debtReduction=amount('debtReduction'),entitlement=amount('returnEntitlement'),net=amount('netSales',true);
  if(gross!==direct+initial+debt+BigInt(credit)||entitlement!==refund+debtReduction+BigInt(credit)||net!==gross-entitlement
    ||initial!==amount('initialReceiptCash')+amount('initialReceiptCliq'))throw invalid();
  const collections=payload.collections;
  if(!record(collections)||number(collections.initialPaymentsInMinorUnits)!==initial||number(collections.initialCashInMinorUnits)!==amount('initialReceiptCash')||number(collections.initialCliqInMinorUnits)!==amount('initialReceiptCliq'))throw invalid();
  return credit;
}

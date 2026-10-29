import {exactMinorText,formatExactMinorJod} from './exactMoney';

export interface ExchangeReceiptFunding {
 internalCreditInMinorUnits:string;newTotalInMinorUnits:string;
 moneyReceivedInMinorUnits:string;moneyRefundInMinorUnits:string;differenceMethod:'cash'|'cliq'|null;
}
export function parseExchangeFunding(value:unknown):ExchangeReceiptFunding {
 const invalid=()=>new Error('AFTERCARE215_RESPONSE_INVALID: تفصيل مقابل التبديل غير مكتمل.');
 if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
 const row=value as Record<string,unknown>;
 const result:ExchangeReceiptFunding={internalCreditInMinorUnits:exactMinorText(row.internalCreditInMinorUnits),
  newTotalInMinorUnits:exactMinorText(row.newTotalInMinorUnits),moneyReceivedInMinorUnits:exactMinorText(row.moneyReceivedInMinorUnits),
  moneyRefundInMinorUnits:exactMinorText(row.moneyRefundInMinorUnits),differenceMethod:null};
 const credit=BigInt(result.internalCreditInMinorUnits),total=BigInt(result.newTotalInMinorUnits),paid=BigInt(result.moneyReceivedInMinorUnits),refund=BigInt(result.moneyRefundInMinorUnits);
 if(credit<=0n||total<=0n||credit+paid!==total||paid>0n&&refund>0n)throw invalid();
 if(paid>0n||refund>0n){if(row.differenceMethod!=='cash'&&row.differenceMethod!=='cliq')throw invalid();result.differenceMethod=row.differenceMethod;}
 else if(row.differenceMethod!==null)throw invalid();
 return result;
}
export function exchangeFundingLines(funding:ExchangeReceiptFunding):string[] {
 const value=parseExchangeFunding(funding),method=value.differenceMethod==='cliq'?'CliQ':'كاش';
 return [`مقابل التبديل: ${formatExactMinorJod(value.internalCreditInMinorUnits)}`,
  BigInt(value.moneyReceivedInMinorUnits)>0n?`الفرق المدفوع الآن: ${formatExactMinorJod(value.moneyReceivedInMinorUnits)} ${method}`:
   BigInt(value.moneyRefundInMinorUnits)>0n?`الفرق المرجع لك: ${formatExactMinorJod(value.moneyRefundInMinorUnits)} ${method}`:'فرق المال: 0.000 د.أ'];
}

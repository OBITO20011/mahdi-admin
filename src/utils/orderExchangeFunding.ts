import {parseExchangeFunding,type ExchangeReceiptFunding} from '../../customer-web/src/receipts/exchangeFunding';

/** Only the safe funding group is carried to the saved receipt. No token is created. */
export function orderExchangeFunding(orderId:string,value:unknown):ExchangeReceiptFunding {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('تفصيل مقابل التبديل غير مكتمل.');
  const row=value as Record<string,unknown>,funding=row.funding;
  if(row.contractVersion!==215||!funding||typeof funding!=='object'||Array.isArray(funding)
    ||(funding as Record<string,unknown>).newOrderId!==orderId)throw new Error('تفصيل مقابل التبديل غير مطابق للفاتورة.');
  return parseExchangeFunding(funding);
}

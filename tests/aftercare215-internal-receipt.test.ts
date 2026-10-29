import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {trialDOrder,trialDItems} from '../e2e/trial-d-receipt.fixture';
import {orderExchangeFunding} from '../src/utils/orderExchangeFunding';
import {orderReceipt} from '../src/features/receipts/saleReceipt';
import {ReceiptDocument} from '../customer-web/src/receipts/ReceiptDocument';
import {receiptDocumentShareText} from '../customer-web/src/receipts/commercialReceipt';
import {buildReceiptShareText} from '../src/utils/receipt';
import type {Order} from '../src/types';

const funding={internalCreditInMinorUnits:'9000',newTotalInMinorUnits:'12000',moneyReceivedInMinorUnits:'3000',moneyRefundInMinorUnits:'0',differenceMethod:'cash' as const};
const exchanged=():Order=>({...structuredClone(trialDOrder),paymentMethod:'exchange_credit',exchangeFunding:funding,
  items:[{...structuredClone(trialDItems[0]),totalPrice:12}],subtotal:12,totalAmount:12,discount:0,deliveryFee:0,amountPaid:12,amountDue:0});
test('215 internal funding is bound to the new saved invoice and excludes extra private values',()=>{
  const order=exchanged(),row={contractVersion:215,funding:{...funding,newOrderId:order.id,unitCost:'private',referenceNumber:'private'}};
  assert.deepEqual(orderExchangeFunding(order.id,row),funding);
  for(const bad of [null,{...row,contractVersion:214},{...row,funding:null},{...row,funding:{...row.funding,newOrderId:'wrong'}},{...row,funding:{...row.funding,moneyReceivedInMinorUnits:'2999'}}])assert.throws(()=>orderExchangeFunding(order.id,bad));
});
test('215 reprint, PDF template and share text display internal credit and only the real difference',()=>{
  for(const variant of [funding,{...funding,newTotalInMinorUnits:'7500',internalCreditInMinorUnits:'7500',moneyReceivedInMinorUnits:'0',moneyRefundInMinorUnits:'1500'},
    {...funding,newTotalInMinorUnits:'9000',moneyReceivedInMinorUnits:'0',differenceMethod:null}, {...funding,differenceMethod:'cliq' as const}]){
    const order={...exchanged(),exchangeFunding:variant},before=structuredClone(order),receipt=orderReceipt(order);
    const text=receiptDocumentShareText(receipt),html=renderToStaticMarkup(React.createElement(ReceiptDocument,{receipt}));
    assert.match(text,/تبديل · مقابل داخلي/u);assert.match(text,/مقابل التبديل:/u);assert.match(html,/مقابل التبديل/u);
    if(variant.moneyReceivedInMinorUnits==='3000')assert.ok(text.includes(`الفرق المدفوع الآن: 3.000 د.أ ${variant.differenceMethod==='cliq'?'CliQ':'كاش'}`));
    if(variant.moneyRefundInMinorUnits==='1500')assert.match(text,/الفرق المرجع لك: 1\.500 د.أ كاش/u);
    if(variant.differenceMethod===null)assert.match(text,/فرق المال: 0\.000/u);
    assert.deepEqual(order,before);
  }
});
test('215 missing or contradictory internal evidence prevents a misleading cash receipt',()=>{
  const order=exchanged();
  for(const bad of [{...order,exchangeFunding:undefined},{...order,items:[...order.items,...order.items]},
    {...order,discount:1},{...order,deliveryFee:1},{...order,amountDue:1},{...order,paymentMethod:'cash' as const}])assert.throws(()=>orderReceipt(bad));
  const big={...order,exchangeFunding:{...funding,internalCreditInMinorUnits:'9007199254740993',newTotalInMinorUnits:'9007199254740993',moneyReceivedInMinorUnits:'0',differenceMethod:null}};
  assert.match(receiptDocumentShareText(orderReceipt(big)),/9,007,199,254,740\.993/u);
  const input={businessName:'تجربة',branchName:'تجربة',invoiceNumber:'POS-X',customerName:'',createdAt:order.createdAt,
    items:order.items,subtotal:12,discount:0,totalAmount:12,paymentMethod:order.paymentMethod,paidAmount:12,remainingAmount:0,changeDue:0,exchangeFunding:funding};
  assert.match(buildReceiptShareText(input),/الفرق المدفوع الآن: 3\.000/u);
  assert.throws(()=>buildReceiptShareText({...input,exchangeFunding:undefined}));
});

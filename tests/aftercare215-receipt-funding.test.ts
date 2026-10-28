import test from 'node:test';
import assert from 'node:assert/strict';
import {parseExchangeFunding,exchangeFundingLines} from '../customer-web/src/receipts/exchangeFunding';
test('exchange receipt separates the internal credit from actual received/refunded cash',()=>{
 const paid={internalCreditInMinorUnits:'9000',newTotalInMinorUnits:'12000',moneyReceivedInMinorUnits:'3000',moneyRefundInMinorUnits:'0',differenceMethod:'cash'};
 assert.deepEqual(exchangeFundingLines(parseExchangeFunding(paid)),['مقابل التبديل: 9.000 د.أ','الفرق المدفوع الآن: 3.000 د.أ كاش']);
 assert.deepEqual(exchangeFundingLines(parseExchangeFunding({...paid,internalCreditInMinorUnits:'7500',newTotalInMinorUnits:'7500',moneyReceivedInMinorUnits:'0',moneyRefundInMinorUnits:'1500',differenceMethod:'cliq'})),['مقابل التبديل: 7.500 د.أ','الفرق المرجع لك: 1.500 د.أ CliQ']);
 assert.equal(exchangeFundingLines({...parseExchangeFunding(paid),internalCreditInMinorUnits:'12000',moneyReceivedInMinorUnits:'0',differenceMethod:null})[1],'فرق المال: 0.000 د.أ');
});
test('exchange receipt validates exact large text and rejects contradictory coverage or fabricated money',()=>{
 const p={internalCreditInMinorUnits:'9007199254740993',newTotalInMinorUnits:'9007199254740994',moneyReceivedInMinorUnits:'1',moneyRefundInMinorUnits:'0',differenceMethod:'cash'};
 assert.match(exchangeFundingLines(parseExchangeFunding(p))[0],/9,007,199,254,740\.993/u);
 for(const bad of [{...p,moneyReceivedInMinorUnits:1},{...p,moneyReceivedInMinorUnits:'2'},{...p,moneyRefundInMinorUnits:'1'},{...p,differenceMethod:null},{...p,internalCreditInMinorUnits:'0'}])assert.throws(()=>parseExchangeFunding(bad));
});

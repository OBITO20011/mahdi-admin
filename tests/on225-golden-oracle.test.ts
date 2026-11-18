import test from 'node:test';
import assert from 'node:assert/strict';
import {golden225AccountingOracle,round225Ratio} from '../scripts/testing/on225-golden-oracle.mjs';
test('ON225 independent golden day balances revenue, historical COGS, profit, cash, inventory and supplier liability',()=>{
 const result=golden225AccountingOracle();
 assert.deepEqual({revenue:result.revenue,cogs:result.cogs,profit:result.profit,cash:result.cash,inventory:result.inventoryValue,units:result.quantity,payable:result.supplierPayable},
  {revenue:12500,cogs:11258,profit:1242,cash:12500,inventory:10042,units:12,payable:13300});
 assert.equal(result.firstWacMicro,'804166667');
 assert.deepEqual(result.saleCogs,[1608,9650,804]);assert.equal(result.loss,-304);
 assert.equal(result.costAtReturnMicro,'839772728');assert.equal(result.finalWacMicro,'836805556');
 assert.equal(result.inventoryValueMicro,'10041666672');
 assert.equal(result.refund,1000);assert.equal(result.returnCogs,804);
 assert.equal(result.assets,22542);assert.equal(result.liabilitiesAndEquity,22542);
});
test('old invoice refund ignores current price; historical cost differs from the changed receipt WAC',()=>{
 const old=golden225AccountingOracle(),changed=golden225AccountingOracle(999999);
 assert.deepEqual({...old,currentPriceAtReturn:0},{...changed,currentPriceAtReturn:0});
 assert.equal(old.returnCogs,804);assert.notEqual(old.returnCogs,840);
 assert.equal(round225Ratio(19300n*12n,24n),9650n);
 assert.equal(round225Ratio(-1608500000n,1000000n),-1609n);
 assert.throws(()=>round225Ratio(1n,0n),/POSITIVE_DIVISOR/);
});

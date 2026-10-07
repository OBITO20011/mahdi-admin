import assert from 'node:assert/strict';
import test from 'node:test';
import {GoldenDayLedger, ReconciliationMismatch, decimalMicro, equalFact, roundedMinor}
  from '../scripts/testing/package-e-reconciliation.mjs';

test('Golden reconciliation fails with the exact field and expected/actual values', () => {
  assert.doesNotThrow(() => equalFact('drawer', 1234, 1234, 'close'));
  for (const actual of [1235, undefined, '1234', Number.NaN]) {
    assert.throws(() => equalFact('drawer', 1234, actual, 'close'), (error: unknown) => {
      assert.ok(error instanceof ReconciliationMismatch);
      assert.equal(error.evidence.field, 'drawer');assert.equal(error.evidence.expected, 1234);
      assert.ok(Object.is(error.evidence.actual, actual));return true;
    });
  }
});

test('CliQ collection, debt-first Cash refund and delivery remain separate', () => {
  const ledger = new GoldenDayLedger(50000);
  ledger.addOrder('coupon-sale', {customerId:'customer', total:10000, delivery:1000,
    cogs:4000, method:'cliq', paid:6000});
  assert.deepEqual(ledger.returnFinancial('coupon-sale',4500,'cash'),{entitlement:4500,debt:3000,refund:1500});
  assert.equal(ledger.drawer,48500);assert.equal(ledger.cliq,6000);
  assert.equal(ledger.sales.netSalesInMinorUnits,5500);
  assert.equal(ledger.sales.outstandingInMinorUnits,1000);
  assert.equal(ledger.sales.collectedInMinorUnits,6000);
  assert.equal(ledger.flows.cashNetFlowInMinorUnits,-1500);
});

test('Full receipt reversal on debt restores coverage once; a reversed expense restores Cash', () => {
  const ledger = new GoldenDayLedger(10000);
  ledger.addOrder('debt', {customerId:'customer',total:4000,cogs:800,method:'debt',paid:0});
  ledger.payment('debt','cash',2000);
  assert.equal(ledger.drawer,12000);assert.equal(ledger.sales.outstandingInMinorUnits,2000);
  ledger.reversePayment('debt','cash',2000);
  assert.equal(ledger.drawer,10000);assert.equal(ledger.sales.outstandingInMinorUnits,4000);
  ledger.cashExpense += 200;assert.equal(ledger.drawer,9800);
  ledger.cashExpense -= 200;assert.equal(ledger.drawer,10000);
});

test('Historical Return recovery reweights current WAC without repricing the original cost', () => {
  const ledger = new GoldenDayLedger(0);
  ledger.acquire('sku',100,20000n*1000000n,'receipt-A');
  ledger.acquire('sku',100,60000n*1000000n,'receipt-B');
  const original = ledger.consume('sku',10,'sale');assert.equal(original,4000n*1000000n);
  ledger.acquire('sku',40,32000n*1000000n,'receipt-C');
  assert.equal(decimalMicro(ledger.stock('sku').costMicro),'469.565217');
  ledger.acquire('sku',5,2000n*1000000n,'historical-return');
  assert.equal(decimalMicro(ledger.stock('sku').costMicro),'468.085106');
  assert.equal(original,4000n*1000000n);
  assert.equal(roundedMinor(473059360n),473);
  assert.equal(roundedMinor(473500000n),474);
});

test('Over-refund fixtures are rejected instead of becoming a false-green oracle', () => {
  const ledger = new GoldenDayLedger(0);
  ledger.addOrder('paid', {customerId:'customer',total:1000,cogs:100,method:'cash',paid:1000});
  assert.throws(() => ledger.returnFinancial('paid',2000,'cash'), /unsupported refund capacity/u);
});

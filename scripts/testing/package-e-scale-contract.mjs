import assert from 'node:assert/strict';

export const fullScale = Object.freeze({skus:5000,families:200,customers:10000,suppliers:100,
  orders:150000,modern:5000,receipts:20000,payments:200000,legacy_returns:10000,
  shifts:1460,movements:1200000,days:730});
export const smokeScale = Object.freeze({skus:50,families:2,customers:100,suppliers:1,
  orders:1500,modern:50,receipts:200,payments:2000,legacy_returns:100,
  shifts:15,movements:12000,days:8});
export function expectedCounts(p){return {skus:p.skus,families:p.families,customers:p.customers,suppliers:p.suppliers,
  orders:p.orders,items:p.orders*3,receipts:p.receipts,payments:p.payments,
  returns:p.legacy_returns+p.modern,replacements:p.modern,shifts:p.shifts,movements:p.movements};}
export function assertCounts(actual,p){assert.deepEqual(actual,expectedCounts(p),'No reduced/missing volume may be reported as full scale');}
export function timingSummary(values){
  assert.equal(values.length,20,'Exactly20 measured calls, after3 independent warmups');
  assert.ok(values.every(v=>Number.isFinite(v)&&v>=0));
  const sorted=[...values].sort((a,b)=>a-b);
  return {p50:sorted[9],p95:sorted[18],max:sorted[19],samples:20};
}
export function expectedFinance(p){
  const legacy=p.orders-p.modern;
  const gross=legacy*3000+p.modern*12000;
  const entitlement=p.legacy_returns*3000+p.modern*1000;
  return {gross,entitlement,net:gross-entitlement,
    collected:(legacy-p.payments/4)*3000+p.payments*500+p.modern*12000,
    due:p.payments/4*1000,supplierDue:p.receipts*150000,
    inventoryQuantity:p.skus*200+p.receipts*300-legacy*3+p.legacy_returns*3-p.modern*12,
    cogs:legacy*1500+p.modern*6000,replacementCost:p.modern*500,
    recovery:p.legacy_returns*1500+p.modern*500};
}

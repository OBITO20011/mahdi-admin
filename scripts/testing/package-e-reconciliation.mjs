// Independent test oracle. Values come from the day's inputs, not SQL reports.
export class ReconciliationMismatch extends Error {
  constructor(field, expected, actual, stage) {
    super(`RECONCILIATION_MISMATCH ${stage}: ${field}; expected=${expected}; actual=${actual}`);
    this.name = 'ReconciliationMismatch';
    this.evidence = {stage, field, expected, actual,
      difference: typeof expected === 'number' && typeof actual === 'number' ? actual - expected : null};
  }
}

export function equalFact(field, expected, actual, stage) {
  if (actual !== expected) throw new ReconciliationMismatch(field, expected, actual, stage);
}

const scale = 1_000_000n;
const roundDivision = (n, d) => (n * 2n + d) / (d * 2n);
export const roundedMinor = micro => Number(roundDivision(micro, scale));
export const decimalMicro = micro => `${micro / scale}.${String(micro % scale).padStart(6, '0')}`;

export class GoldenDayLedger {
  constructor(openingCash) {
    this.openingCash = openingCash;
    this.orders = new Map();
    this.inventory = new Map();
    this.suppliers = new Map();
    this.movements = [];
    this.inventoryRoundingMicro = 0n;
    this.cash = 0; this.cliq = 0; this.cashRefund = 0; this.cliqRefund = 0;
    this.cashSupplier = 0; this.cliqSupplier = 0;
    this.cashExpense = 0; this.cliqExpense = 0;
    this.entitlement = 0; this.debtReduction = 0; this.returnCount = 0;
    this.replacementCost = 0; this.restockRecoveryMicro = 0n;
  }
  stock(id) {
    if (!this.inventory.has(id)) this.inventory.set(id, {quantity: 0, costMicro: 0n});
    return this.inventory.get(id);
  }
  acquire(id, quantity, valueMicro, operationId) {
    const prior = this.stock(id);
    const before = prior.quantity;
    const resultingValue = prior.costMicro * BigInt(before) + valueMicro;
    prior.costMicro = roundDivision(resultingValue, BigInt(before + quantity));
    prior.quantity += quantity;
    this.inventoryRoundingMicro += prior.costMicro * BigInt(prior.quantity) - resultingValue;
    const identity=typeof operationId === 'object' && operationId !== null ? operationId : {operationId};
    this.movements.push({id, quantity, before, after: prior.quantity, ...identity, valueMicro});
  }
  consume(id, quantity, operationId) {
    const prior = this.stock(id);
    if (quantity > prior.quantity) throw Error('Golden fixture exceeds its known purchased inventory');
    const value = prior.costMicro * BigInt(quantity);
    const identity=typeof operationId === 'object' && operationId !== null ? operationId : {operationId};
    this.movements.push({id, quantity: -quantity, before: prior.quantity, after: prior.quantity - quantity, ...identity,valueMicro:-value});
    prior.quantity -= quantity;
    return value;
  }
  collect(method, amount) { this[method] += amount; }
  addOrder(id, {customerId, total, delivery = 0, cogs, method, paid}) {
    this.orders.set(id, {customerId, total, delivery, cogs, coverage: paid, debt: 0, refunds: 0});
    if (paid) this.collect(method, paid);
  }
  payment(id, method, amount) { this.orders.get(id).coverage += amount; this.collect(method, amount); }
  reversePayment(id, method, amount) { this.orders.get(id).coverage -= amount; this.collect(method, -amount); }
  returnFinancial(id, entitlement, method) {
    const order = this.orders.get(id);
    const outstanding = Math.max(order.total - order.coverage - order.debt, 0);
    const deliveryDebt = Math.min(order.delivery, outstanding);
    const debt = Math.min(entitlement, outstanding - deliveryDebt);
    const refund = entitlement - debt;
    const collectedCapacity = Math.max(order.coverage - order.refunds - (order.delivery - deliveryDebt), 0);
    if (refund > collectedCapacity) throw Error('Golden fixture requests unsupported refund capacity');
    order.debt += debt; order.refunds += refund;
    this.entitlement += entitlement; this.debtReduction += debt; this.returnCount++;
    if (refund) this[`${method}Refund`] += refund;
    return {entitlement, debt, refund};
  }
  due(order) { return Math.max(order.total - order.coverage - order.debt, 0); }
  get drawer() { return this.openingCash + this.cash - this.cashRefund - this.cashSupplier - this.cashExpense; }
  get sales() {
    const orders = [...this.orders.values()];
    const gross = orders.reduce((sum, o) => sum + o.total, 0);
    const delivery = orders.reduce((sum, o) => sum + o.delivery, 0);
    const cogs = orders.reduce((sum, o) => sum + o.cogs, 0);
    const recovery = roundedMinor(this.restockRecoveryMicro);
    const margin = gross - this.entitlement - cogs - this.replacementCost + recovery;
    return {grossSalesInMinorUnits: gross, deliveryFeesInMinorUnits: delivery,
      returnEntitlementInMinorUnits: this.entitlement, refundsInMinorUnits: this.cashRefund + this.cliqRefund,
      debtReductionInMinorUnits: this.debtReduction, netSalesInMinorUnits: gross - this.entitlement,
      cogsInMinorUnits: cogs, replacementCostInMinorUnits: this.replacementCost,
      restockRecoveryInMinorUnits: recovery, grossProfitInMinorUnits: gross - delivery - cogs,
      aftercareAdjustedMarginInMinorUnits: margin, netProfitInMinorUnits: margin - this.cashExpense - this.cliqExpense,
      collectedInMinorUnits: orders.reduce((sum, o) => sum + o.coverage, 0),
      outstandingInMinorUnits: orders.reduce((sum, o) => sum + this.due(o), 0),
      returnCount: this.returnCount, orderCount: orders.length, completedOrderCount: orders.length};
  }
  get flows() {
    return {cashCollectedInMinorUnits: this.cash, cliqCollectedInMinorUnits: this.cliq,
      cashRefundedInMinorUnits: this.cashRefund, cliqRefundedInMinorUnits: this.cliqRefund,
      cashNetFlowInMinorUnits: this.cash - this.cashRefund, cliqNetFlowInMinorUnits: this.cliq - this.cliqRefund};
  }
}

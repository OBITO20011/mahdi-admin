import type {CustomerCollectionsInMinorUnits} from '../utils/customerCollections';
export interface OperationalReportPeriod {
  dateFrom: string;
  dateTo: string;
  branchId: string;
  branchName: string;
}

export interface DamageLosses {
  total: number;
  additional: number;
  alreadyIncluded: number;
  reasons: Array<{code: string; count: number; quantity: number; amount: number; alreadyIncluded: number}>;
}

export interface OperationalBusinessReport {
  /** Owner only: withdrawals of the period next to the unchanged net profit. */
  ownerWithdrawals?: {
    withdrawn: number;
    returned: number;
    net: number;
    netProfit: number;
    /** Profit after withdrawals — not drawer, bank or available cash. */
    remainingAfterWithdrawals: number;
  };
  generatedAt: string;
  period: OperationalReportPeriod;
  sales: {
    damageLosses?: DamageLosses;
    orderCount: number;
    posOrderCount: number;
    websiteOrderCount: number;
    packageCount: number;
    baseUnitCount: number;
    uniqueProductCount: number;
    subtotal: number;
    discount: number;
    deliveryFees: number;
    grossSales: number;
    refunds: number;
    returnEntitlement: number;
    debtReduction: number;
    replacementCost: number;
    restockRecovery: number;
    aftercareAdjustedMargin: number;
    netSales: number;
    cogs: number;
    grossProfit: number;
    netProfit: number;
    collected: number;
    outstanding: number;
    returnCount: number;
  };
  cashFlow: {
    customerCollections?: CustomerCollectionsInMinorUnits;
    cashCollected: number;
    cliqCollected: number;
    cashRefunded: number;
    cliqRefunded: number;
    cashNetFlow: number;
    cliqNetFlow: number;
  };
  expenses: {
    count: number;
    total: number;
    cash: number;
    cliq: number;
    categories: Array<{
      category: string;
      count: number;
      amount: number;
    }>;
  };
  purchases: {
    receiptCount: number;
    total: number;
    paid: number;
    due: number;
  };
  balances: {
    customerOrderCount: number;
    customerCount: number;
    customerDue: number;
    supplierCount: number;
    supplierDue: number;
    supplierAdvances?: number;
  };
  inventory: {
    stockedProducts: number;
    baseUnitsOnHand: number;
    baseUnitsReserved: number;
    value: number;
    lowStockProducts: number;
  };
  inventoryMovements: {
    movementCount: number;
    affectedProducts: number;
    unitsIn: number;
    unitsOut: number;
    netUnits: number;
    types: Array<{
      movementType: string;
      movementCount: number;
      unitsIn: number;
      unitsOut: number;
      netUnits: number;
    }>;
    topProducts: Array<{
      productName: string;
      sku: string;
      movementCount: number;
      unitsIn: number;
      unitsOut: number;
      netUnits: number;
    }>;
  };
  paymentMethods: Array<{
    method: string;
    orderCount: number;
    amount: number;
  }>;
  topProducts: Array<{
    productName: string;
    sku: string;
    packageCount: number;
    revenue: number;
    profit: number;
  }>;
}

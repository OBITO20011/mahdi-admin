import {parseCustomerCollections} from '../../utils/customerCollections';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { OperationalBusinessReport } from '../../types';
import { minorUnitsToJod } from '../../utils/receivingCalculations';

type RpcRecord = Record<string, unknown>;

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة بيانات Supabase غير متاح.');
  }
  return supabase;
}

function recordValue(value: unknown): RpcRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RpcRecord)
    : {};
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyValue(value: unknown): number {
  return minorUnitsToJod(numberValue(value));
}

export async function fetchOperationalBusinessReportFromSupabase(
  branchId: string,
  dateFrom: string,
  dateTo: string
): Promise<OperationalBusinessReport> {
  if (!branchId) throw new Error('الفرع مطلوب لإنشاء التقرير.');
  if (!dateFrom || !dateTo) throw new Error('فترة التقرير مطلوبة.');

  const { data, error } = await requireClient().rpc(
    'get_operational_business_report',
    {
      p_branch_id: branchId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    }
  );

  if (error) {
    throw new Error(error.message || 'تعذر تحميل التقرير من قاعدة البيانات.');
  }

  const payload = recordValue(data);
  if (payload.success !== true) {
    throw new Error(textValue(payload.message) || 'تعذر إنشاء التقرير.');
  }

  const period = recordValue(payload.period);
  const sales = recordValue(payload.sales);
  const cashFlow = recordValue(payload.cashFlow);
  const customerCollections = parseCustomerCollections(cashFlow.customerCollections);
  const expenses = recordValue(payload.expenses);
  const purchases = recordValue(payload.purchases);
  const balances = recordValue(payload.balances);
  for (const [source, fields] of [
    [sales, ['returnEntitlementInMinorUnits', 'debtReductionInMinorUnits',
      'replacementCostInMinorUnits', 'restockRecoveryInMinorUnits', 'aftercareAdjustedMarginInMinorUnits',
      'grossSalesInMinorUnits', 'netSalesInMinorUnits', 'refundsInMinorUnits', 'cogsInMinorUnits',
      'grossProfitInMinorUnits', 'netProfitInMinorUnits', 'collectedInMinorUnits', 'outstandingInMinorUnits',
      'discountInMinorUnits']],
    [expenses, ['totalInMinorUnits']],
    [balances, ['customerDueInMinorUnits']],
    [cashFlow, ['cashCollectedInMinorUnits', 'cliqCollectedInMinorUnits',
      'cashRefundedInMinorUnits', 'cliqRefundedInMinorUnits', 'cashNetFlowInMinorUnits', 'cliqNetFlowInMinorUnits']],
  ] as const) {
    for (const field of fields) {
      if (typeof source[field] !== 'number' || !Number.isSafeInteger(source[field])) {
        throw new Error('بيانات التقرير غير مكتملة. يلزم إصدار تقارير الحزمة (أ) قبل عرض الأرقام.');
      }
    }
  }
  const damage = sales.damageLosses === undefined ? null : recordValue(sales.damageLosses);
  if (damage) {
    const validMoney = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
    const signedMoney = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);
    if (damage.contractVersion === 208) {
      if (!signedMoney(damage.totalInMinorUnits) || !signedMoney(damage.additionalInMinorUnits)
        || !validMoney(damage.alreadyIncludedInMinorUnits) || !validMoney(damage.grossInMinorUnits) || !validMoney(damage.recoveredInMinorUnits)
        || Number(damage.totalInMinorUnits) !== Number(damage.grossInMinorUnits) - Number(damage.recoveredInMinorUnits)
        || Number(damage.totalInMinorUnits) !== Number(damage.additionalInMinorUnits) + Number(damage.alreadyIncludedInMinorUnits)
        || !Array.isArray(damage.reasons) || damage.reasons.some((value) => {
          const row=recordValue(value);
          return !textValue(row.code) || !validMoney(row.count) || !validMoney(row.quantity) || !validMoney(row.alreadyIncludedInMinorUnits)
            || !signedMoney(row.amountInMinorUnits) || !validMoney(row.grossInMinorUnits) || !validMoney(row.recoveredInMinorUnits)
            || Number(row.amountInMinorUnits)!==Number(row.grossInMinorUnits)-Number(row.recoveredInMinorUnits);
        }) || damage.reasons.reduce((sum:number,value:unknown)=>sum+Number(recordValue(value).amountInMinorUnits),0)!==damage.totalInMinorUnits
        || damage.reasons.reduce((sum:number,value:unknown)=>sum+Number(recordValue(value).grossInMinorUnits),0)!==damage.grossInMinorUnits
        || damage.reasons.reduce((sum:number,value:unknown)=>sum+Number(recordValue(value).recoveredInMinorUnits),0)!==damage.recoveredInMinorUnits
        || damage.reasons.reduce((sum:number,value:unknown)=>sum+Number(recordValue(value).alreadyIncludedInMinorUnits),0)!==damage.alreadyIncludedInMinorUnits
        || new Set(damage.reasons.map((value:unknown)=>recordValue(value).code)).size!==damage.reasons.length
      ) throw new Error('بيانات صافي خسائر التلف 208 غير مكتملة. أعد تحميل التقرير.');
    } else if ((damage.contractVersion !== undefined && damage.contractVersion !== 201)
      || !validMoney(damage.totalInMinorUnits) || !validMoney(damage.additionalInMinorUnits)
      || !validMoney(damage.alreadyIncludedInMinorUnits) || !Array.isArray(damage.reasons)
      || Number(damage.totalInMinorUnits) !== Number(damage.additionalInMinorUnits) + Number(damage.alreadyIncludedInMinorUnits)
      || damage.reasons.some((value) => {
        const row = recordValue(value);
        return !textValue(row.code) || !validMoney(row.count) || !validMoney(row.quantity)
          || !validMoney(row.amountInMinorUnits) || !validMoney(row.alreadyIncludedInMinorUnits);
      })) throw new Error('بيانات خسائر التلف غير مكتملة. أعد تحميل التقرير.');
  }
  const inventory = recordValue(payload.inventory);
  const inventoryMovements = recordValue(payload.inventoryMovements);

  // Owner-only block (migration 181): absent for every other role.
  const ownerWithdrawals = payload.ownerWithdrawals === undefined ? null : recordValue(payload.ownerWithdrawals);
  return {
    ...(ownerWithdrawals ? { ownerWithdrawals: {
      withdrawn: moneyValue(ownerWithdrawals.withdrawnInMinorUnits),
      returned: moneyValue(ownerWithdrawals.returnedInMinorUnits),
      net: moneyValue(ownerWithdrawals.netInMinorUnits),
      netProfit: moneyValue(ownerWithdrawals.netProfitInMinorUnits),
      remainingAfterWithdrawals: moneyValue(ownerWithdrawals.remainingAfterWithdrawalsInMinorUnits),
    } } : {}),
    generatedAt: textValue(payload.generatedAt),
    period: {
      dateFrom: textValue(period.dateFrom) || dateFrom,
      dateTo: textValue(period.dateTo) || dateTo,
      branchId: textValue(period.branchId) || branchId,
      branchName: textValue(period.branchName) || 'الفرع الحالي',
    },
    sales: {
      ...(damage ? {damageLosses: {
        ...(damage.contractVersion===208?{contractVersion:208 as const,gross:moneyValue(damage.grossInMinorUnits),recovered:moneyValue(damage.recoveredInMinorUnits)}:{}),
        total: moneyValue(damage.totalInMinorUnits), additional: moneyValue(damage.additionalInMinorUnits),
        alreadyIncluded: moneyValue(damage.alreadyIncludedInMinorUnits),
        reasons: (damage.reasons as unknown[]).map((value) => {
          const row = recordValue(value);return {code: textValue(row.code),count: numberValue(row.count),quantity: numberValue(row.quantity),
            amount: moneyValue(row.amountInMinorUnits),alreadyIncluded: moneyValue(row.alreadyIncludedInMinorUnits)};
        }),
      }} : {}),
      orderCount: numberValue(sales.orderCount),
      posOrderCount: numberValue(sales.posOrderCount),
      websiteOrderCount: numberValue(sales.websiteOrderCount),
      packageCount: numberValue(sales.packageCount),
      baseUnitCount: numberValue(sales.baseUnitCount),
      uniqueProductCount: numberValue(sales.uniqueProductCount),
      subtotal: moneyValue(sales.subtotalInMinorUnits),
      discount: moneyValue(sales.discountInMinorUnits),
      deliveryFees: moneyValue(sales.deliveryFeesInMinorUnits),
      grossSales: moneyValue(sales.grossSalesInMinorUnits),
      refunds: moneyValue(sales.refundsInMinorUnits),
      returnEntitlement: moneyValue(sales.returnEntitlementInMinorUnits),
      debtReduction: moneyValue(sales.debtReductionInMinorUnits),
      replacementCost: moneyValue(sales.replacementCostInMinorUnits),
      restockRecovery: moneyValue(sales.restockRecoveryInMinorUnits),
      aftercareAdjustedMargin: moneyValue(sales.aftercareAdjustedMarginInMinorUnits),
      netSales: moneyValue(sales.netSalesInMinorUnits),
      cogs: moneyValue(sales.cogsInMinorUnits),
      grossProfit: moneyValue(sales.grossProfitInMinorUnits),
      netProfit: moneyValue(sales.netProfitInMinorUnits),
      collected: moneyValue(sales.collectedInMinorUnits),
      outstanding: moneyValue(sales.outstandingInMinorUnits),
      returnCount: numberValue(sales.returnCount),
    },
    cashFlow: {
      ...(customerCollections ? {customerCollections} : {}),
      cashCollected: moneyValue(cashFlow.cashCollectedInMinorUnits),
      cliqCollected: moneyValue(cashFlow.cliqCollectedInMinorUnits),
      cashRefunded: moneyValue(cashFlow.cashRefundedInMinorUnits),
      cliqRefunded: moneyValue(cashFlow.cliqRefundedInMinorUnits),
      cashNetFlow: moneyValue(cashFlow.cashNetFlowInMinorUnits),
      cliqNetFlow: moneyValue(cashFlow.cliqNetFlowInMinorUnits),
    },
    expenses: {
      count: numberValue(expenses.count),
      total: moneyValue(expenses.totalInMinorUnits),
      cash: moneyValue(expenses.cashInMinorUnits),
      cliq: moneyValue(expenses.cliqInMinorUnits),
      categories: Array.isArray(expenses.categories)
        ? expenses.categories.map((item) => {
            const row = recordValue(item);
            return {
              category: textValue(row.category) || 'غير مصنف',
              count: numberValue(row.count),
              amount: moneyValue(row.amountInMinorUnits),
            };
          })
        : [],
    },
    purchases: {
      receiptCount: numberValue(purchases.receiptCount),
      total: moneyValue(purchases.totalInMinorUnits),
      paid: moneyValue(purchases.paidInMinorUnits),
      due: moneyValue(purchases.dueInMinorUnits),
    },
    balances: {
      customerOrderCount: numberValue(balances.customerOrderCount),
      customerCount: numberValue(balances.customerCount),
      customerDue: moneyValue(balances.customerDueInMinorUnits),
      supplierCount: numberValue(balances.supplierCount),
      supplierDue: moneyValue(balances.supplierDueInMinorUnits),
      ...(balances.supplierAdvancesInMinorUnits !== undefined
        ? {supplierAdvances: moneyValue(balances.supplierAdvancesInMinorUnits)} : {}),
    },
    inventory: {
      stockedProducts: numberValue(inventory.stockedProducts),
      baseUnitsOnHand: numberValue(inventory.baseUnitsOnHand),
      baseUnitsReserved: numberValue(inventory.baseUnitsReserved),
      value: moneyValue(inventory.valueInMinorUnits),
      lowStockProducts: numberValue(inventory.lowStockProducts),
    },
    inventoryMovements: {
      movementCount: numberValue(inventoryMovements.movementCount),
      affectedProducts: numberValue(inventoryMovements.affectedProducts),
      unitsIn: numberValue(inventoryMovements.unitsIn),
      unitsOut: numberValue(inventoryMovements.unitsOut),
      netUnits: numberValue(inventoryMovements.netUnits),
      types: Array.isArray(inventoryMovements.types)
        ? inventoryMovements.types.map((item) => {
            const row = recordValue(item);
            return {
              movementType: textValue(row.movementType),
              movementCount: numberValue(row.movementCount),
              unitsIn: numberValue(row.unitsIn),
              unitsOut: numberValue(row.unitsOut),
              netUnits: numberValue(row.netUnits),
            };
          })
        : [],
      topProducts: Array.isArray(inventoryMovements.topProducts)
        ? inventoryMovements.topProducts.map((item) => {
            const row = recordValue(item);
            return {
              productName: textValue(row.productName) || 'منتج',
              sku: textValue(row.sku),
              movementCount: numberValue(row.movementCount),
              unitsIn: numberValue(row.unitsIn),
              unitsOut: numberValue(row.unitsOut),
              netUnits: numberValue(row.netUnits),
            };
          })
        : [],
    },
    paymentMethods: Array.isArray(payload.paymentMethods)
      ? payload.paymentMethods.map((item) => {
          const row = recordValue(item);
          return {
            method: textValue(row.method),
            orderCount: numberValue(row.orderCount),
            amount: moneyValue(row.amountInMinorUnits),
          };
        })
      : [],
    topProducts: Array.isArray(payload.topProducts)
      ? payload.topProducts.map((item) => {
          const row = recordValue(item);
          return {
            productName: textValue(row.productName) || 'منتج',
            sku: textValue(row.sku),
            packageCount: numberValue(row.packageCount),
            revenue: moneyValue(row.revenueInMinorUnits),
            profit: moneyValue(row.profitInMinorUnits),
          };
        })
      : [],
  };
}

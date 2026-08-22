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
  const expenses = recordValue(payload.expenses);
  const purchases = recordValue(payload.purchases);
  const balances = recordValue(payload.balances);
  const inventory = recordValue(payload.inventory);
  const inventoryMovements = recordValue(payload.inventoryMovements);

  return {
    generatedAt: textValue(payload.generatedAt),
    period: {
      dateFrom: textValue(period.dateFrom) || dateFrom,
      dateTo: textValue(period.dateTo) || dateTo,
      branchId: textValue(period.branchId) || branchId,
      branchName: textValue(period.branchName) || 'الفرع الحالي',
    },
    sales: {
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
      netSales: moneyValue(sales.netSalesInMinorUnits),
      cogs: moneyValue(sales.cogsInMinorUnits),
      grossProfit: moneyValue(sales.grossProfitInMinorUnits),
      netProfit: moneyValue(sales.netProfitInMinorUnits),
      collected: moneyValue(sales.collectedInMinorUnits),
      outstanding: moneyValue(sales.outstandingInMinorUnits),
      returnCount: numberValue(sales.returnCount),
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

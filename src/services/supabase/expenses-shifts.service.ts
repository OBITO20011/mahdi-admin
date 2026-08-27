import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { Expense, Shift, ShiftClosingReport } from '../../types';

type RpcRecord = Record<string, unknown>;

export interface ExpenseShiftCenter {
  expenses: Expense[];
  currentShift: Shift | null;
  recentShifts: Shift[];
}

export interface OperationalExpenseInput {
  branchId: string;
  category: string;
  description: string;
  amount: number;
  paymentMethod: 'cash' | 'cliq';
  referenceNumber?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const minorUnitsToJod = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 1000 : 0;
};

const jodToMinorUnits = (value: number): number =>
  Math.round(Math.max(0, value) * 1000);

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
  }
  return supabase;
}

function mapShift(payload: RpcRecord): Shift {
  const cashReceipts = minorUnitsToJod(payload.cashReceiptsInMinorUnits);
  const cliqReceipts = minorUnitsToJod(payload.cliqReceiptsInMinorUnits);
  const cashSupplierPayments = minorUnitsToJod(
    payload.cashSupplierPaymentsInMinorUnits
  );
  const cliqSupplierPayments = minorUnitsToJod(
    payload.cliqSupplierPaymentsInMinorUnits
  );
  const cashExpenses = minorUnitsToJod(payload.cashExpensesInMinorUnits);
  const cliqExpenses = minorUnitsToJod(payload.cliqExpensesInMinorUnits);
  const cashRefunds = minorUnitsToJod(payload.cashRefundsInMinorUnits);
  const cliqRefunds = minorUnitsToJod(payload.cliqRefundsInMinorUnits);

  return {
    id: textValue(payload.id),
    shiftNumber: textValue(payload.shiftNumber),
    branchId: textValue(payload.branchId),
    cashierName: textValue(payload.cashierName) || 'مستخدم النظام',
    startTime: textValue(payload.startTime),
    endTime: textValue(payload.endTime) || undefined,
    openingCash: minorUnitsToJod(payload.openingCashInMinorUnits),
    totalCashSales: minorUnitsToJod(payload.cashSalesInMinorUnits),
    totalCliqSales: minorUnitsToJod(payload.cliqSalesInMinorUnits),
    totalCardSales: minorUnitsToJod(payload.cardSalesInMinorUnits),
    totalReceipts: cashReceipts + cliqReceipts,
    totalPayments:
      cashSupplierPayments +
      cliqSupplierPayments +
      cashExpenses +
      cliqExpenses +
      cashRefunds +
      cliqRefunds,
    cashReceipts,
    cliqReceipts,
    cashSupplierPayments,
    cliqSupplierPayments,
    cashExpenses,
    cliqExpenses,
    cashRefunds,
    cliqRefunds,
    expectedCash: minorUnitsToJod(payload.expectedCashInMinorUnits),
    actualCash:
      payload.actualCashInMinorUnits === null ||
      payload.actualCashInMinorUnits === undefined
        ? undefined
        : minorUnitsToJod(payload.actualCashInMinorUnits),
    cashDiscrepancy:
      payload.cashDiscrepancyInMinorUnits === null ||
      payload.cashDiscrepancyInMinorUnits === undefined
        ? undefined
        : minorUnitsToJod(payload.cashDiscrepancyInMinorUnits),
    discrepancyReason: textValue(payload.discrepancyReason) || undefined,
    status:
      payload.status === 'cancelled'
        ? 'cancelled'
        : payload.status === 'closed'
          ? 'closed'
          : 'open',
    managerSignOffBy: textValue(payload.managerSignOffBy) || undefined,
    cancelledByName: textValue(payload.cancelledByName) || undefined,
    cancelledAt: textValue(payload.cancelledAt) || undefined,
    cancellationReason: textValue(payload.cancellationReason) || undefined,
  };
}

export async function fetchCashShiftClosingReportFromSupabase(
  shiftId: string
): Promise<ShiftClosingReport> {
  const { data, error } = await requireClient().rpc(
    'get_cash_shift_closing_report',
    { p_shift_id: shiftId }
  );
  if (error) {
    throw new Error(error.message || 'تعذر تحميل تقرير إغلاق الوردية.');
  }

  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(
      textValue(payload.message) || 'تعذر تحميل تقرير إغلاق الوردية.'
    );
  }

  const sales = (payload.sales || {}) as RpcRecord;
  const collections = (payload.collections || {}) as RpcRecord;
  const outflows = (payload.outflows || {}) as RpcRecord;
  const reconciliation = (payload.reconciliation || {}) as RpcRecord;

  return {
    generatedAt: textValue(payload.generatedAt),
    shift: mapShift((payload.shift || {}) as RpcRecord),
    sales: {
      orderCount: Number(sales.orderCount) || 0,
      posOrderCount: Number(sales.posOrderCount) || 0,
      websiteOrderCount: Number(sales.websiteOrderCount) || 0,
      packageCount: Number(sales.packageCount) || 0,
      uniqueProductCount: Number(sales.uniqueProductCount) || 0,
      grossSales: minorUnitsToJod(sales.grossSalesInMinorUnits),
      refunds: minorUnitsToJod(sales.refundsInMinorUnits),
      netSales: minorUnitsToJod(sales.netSalesInMinorUnits),
    },
    collections: {
      count: Number(collections.count) || 0,
      cash: minorUnitsToJod(collections.cashInMinorUnits),
      cliq: minorUnitsToJod(collections.cliqInMinorUnits),
    },
    outflows: {
      supplierPaymentCount: Number(outflows.supplierPaymentCount) || 0,
      cashSupplierPayments: minorUnitsToJod(
        outflows.cashSupplierPaymentsInMinorUnits
      ),
      cliqSupplierPayments: minorUnitsToJod(
        outflows.cliqSupplierPaymentsInMinorUnits
      ),
      expenseCount: Number(outflows.expenseCount) || 0,
      cashExpenses: minorUnitsToJod(outflows.cashExpensesInMinorUnits),
      cliqExpenses: minorUnitsToJod(outflows.cliqExpensesInMinorUnits),
      returnCount: Number(outflows.returnCount) || 0,
      cashRefunds: minorUnitsToJod(outflows.cashRefundsInMinorUnits),
      cliqRefunds: minorUnitsToJod(outflows.cliqRefundsInMinorUnits),
    },
    reconciliation: {
      totalInflows: minorUnitsToJod(
        reconciliation.totalInflowsInMinorUnits
      ),
      totalOutflows: minorUnitsToJod(
        reconciliation.totalOutflowsInMinorUnits
      ),
      netMovement: minorUnitsToJod(
        reconciliation.netMovementInMinorUnits
      ),
      netCliqMovement: minorUnitsToJod(
        reconciliation.netCliqMovementInMinorUnits
      ),
      openingCash: minorUnitsToJod(
        reconciliation.openingCashInMinorUnits
      ),
      expectedCash: minorUnitsToJod(
        reconciliation.expectedCashInMinorUnits
      ),
      actualCash:
        reconciliation.actualCashInMinorUnits === null ||
        reconciliation.actualCashInMinorUnits === undefined
          ? undefined
          : minorUnitsToJod(reconciliation.actualCashInMinorUnits),
      cashDiscrepancy:
        reconciliation.cashDiscrepancyInMinorUnits === null ||
        reconciliation.cashDiscrepancyInMinorUnits === undefined
          ? undefined
          : minorUnitsToJod(
              reconciliation.cashDiscrepancyInMinorUnits
            ),
      isBalanced:
        typeof reconciliation.isBalanced === 'boolean'
          ? reconciliation.isBalanced
          : undefined,
    },
    expenseBreakdown: Array.isArray(payload.expenseBreakdown)
      ? payload.expenseBreakdown.map((item) => {
          const record = item as RpcRecord;
          return {
            category: textValue(record.category),
            count: Number(record.count) || 0,
            amount: minorUnitsToJod(record.amountInMinorUnits),
          };
        })
      : [],
    returnBreakdown: Array.isArray(payload.returnBreakdown)
      ? payload.returnBreakdown.map((item) => {
          const record = item as RpcRecord;
          return {
            refundMethod: record.refundMethod === 'cliq' ? 'cliq' : 'cash',
            stockDisposition:
              record.stockDisposition === 'damaged' ? 'damaged' : 'restock',
            count: Number(record.count) || 0,
            amount: minorUnitsToJod(record.amountInMinorUnits),
          };
        })
      : [],
  };
}

function mapExpense(payload: RpcRecord): Expense {
  return {
    id: textValue(payload.id),
    expenseNumber: textValue(payload.expenseNumber),
    shiftId: textValue(payload.shiftId),
    category: textValue(payload.category),
    amount: minorUnitsToJod(payload.amountInMinorUnits),
    paymentMethod: payload.paymentMethod === 'cliq' ? 'cliq' : 'cash',
    referenceNumber: textValue(payload.referenceNumber) || undefined,
    description: textValue(payload.description),
    isApproved: true,
    approvedBy: textValue(payload.createdByName) || undefined,
    branchId: textValue(payload.branchId),
    createdByName: textValue(payload.createdByName) || 'مستخدم النظام',
    createdAt: textValue(payload.createdAt),
    isReversed: payload.isReversed === true,
    reversedAt: textValue(payload.reversedAt) || undefined,
    reversalReason: textValue(payload.reversalReason) || undefined,
    reversedByName: textValue(payload.reversedByName) || undefined,
  };
}

export async function fetchExpenseShiftCenterFromSupabase(
  branchId: string
): Promise<ExpenseShiftCenter> {
  const { data, error } = await requireClient().rpc(
    'get_expense_shift_center',
    { p_branch_id: branchId, p_expense_limit: 100 }
  );
  if (error) throw new Error(error.message || 'تعذر تحميل مركز الصندوق.');

  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(textValue(payload.message) || 'تعذر تحميل مركز الصندوق.');
  }

  return {
    expenses: Array.isArray(payload.expenses)
      ? payload.expenses.map((item) => mapExpense(item as RpcRecord))
      : [],
    currentShift:
      payload.currentShift && typeof payload.currentShift === 'object'
        ? mapShift(payload.currentShift as RpcRecord)
        : null,
    recentShifts: Array.isArray(payload.recentShifts)
      ? payload.recentShifts.map((item) => mapShift(item as RpcRecord))
      : [],
  };
}

export async function openCashShiftInSupabase(
  branchId: string,
  openingCash: number
): Promise<{ shift: Shift; message: string }> {
  const { data, error } = await requireClient().rpc('open_cash_shift', {
    p_branch_id: branchId,
    p_opening_cash_in_minor_units: jodToMinorUnits(openingCash),
  });
  if (error) throw new Error(error.message || 'تعذر فتح الوردية.');
  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(textValue(payload.message) || 'تعذر فتح الوردية.');
  }
  return {
    shift: mapShift(payload),
    message: textValue(payload.message) || 'تم فتح الوردية.',
  };
}

export async function createOperationalExpenseInSupabase(
  input: OperationalExpenseInput
): Promise<{ message: string }> {
  const { data, error } = await requireClient().rpc(
    'create_operational_expense',
    {
      p_branch_id: input.branchId,
      p_category: input.category.trim(),
      p_description: input.description.trim(),
      p_amount_in_minor_units: jodToMinorUnits(input.amount),
      p_payment_method: input.paymentMethod,
      p_reference_number: input.referenceNumber?.trim() || null,
    }
  );
  if (error) throw new Error(error.message || 'تعذر تسجيل المصروف.');
  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(textValue(payload.message) || 'تعذر تسجيل المصروف.');
  }
  return {
    message: textValue(payload.message) || 'تم تسجيل المصروف.',
  };
}

export async function reverseOperationalExpenseInSupabase(
  expenseId: string,
  reason: string
): Promise<{ message: string }> {
  const { data, error } = await requireClient().rpc(
    'reverse_operational_expense',
    {
      p_expense_id: expenseId,
      p_reason: reason.trim(),
    }
  );
  if (error) throw new Error(error.message || 'تعذر عكس المصروف.');
  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(textValue(payload.message) || 'تعذر عكس المصروف.');
  }
  return {
    message: textValue(payload.message) || 'تم عكس المصروف مع حفظ سجل المراجعة.',
  };
}

export async function closeCashShiftInSupabase(
  shiftId: string,
  actualCash: number,
  discrepancyReason?: string
): Promise<{ shift: Shift; message: string }> {
  const { data, error } = await requireClient().rpc('close_cash_shift', {
    p_shift_id: shiftId,
    p_actual_cash_in_minor_units: jodToMinorUnits(actualCash),
    p_discrepancy_reason: discrepancyReason?.trim() || null,
  });
  if (error) throw new Error(error.message || 'تعذر إغلاق الوردية.');
  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(textValue(payload.message) || 'تعذر إغلاق الوردية.');
  }
  return {
    shift: mapShift(payload),
    message: textValue(payload.message) || 'تم إغلاق الوردية.',
  };
}

export async function cancelEmptyCashShiftInSupabase(
  shiftId: string,
  reason: string
): Promise<{ shift: Shift; message: string }> {
  const { data, error } = await requireClient().rpc('cancel_empty_cash_shift', {
    p_shift_id: shiftId,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message || 'تعذر إلغاء الوردية.');
  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(textValue(payload.message) || 'تعذر إلغاء الوردية.');
  }
  return {
    shift: mapShift(payload),
    message:
      textValue(payload.message) ||
      'تم إلغاء الوردية الفارغة وحفظ السبب في سجل التدقيق.',
  };
}

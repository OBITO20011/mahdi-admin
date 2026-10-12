/**
 * Nawasrah Business Manager - RPC-backed operational expenses.
 */

import React, { useEffect, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  DollarSign,
  Plus,
  Smartphone,
  WalletCards,
} from 'lucide-react';
import {
  shallowEqual,
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import { CURRENCY } from '../../constants';
import {MobileActionMenu, Card, KpiCard, KpiGrid, MoneyText, UiButton, formatJod, formatUiDate} from '../../components/ui';

const money = (value: number) => `${formatJod(value)} ${CURRENCY}`;

export const ExpensesView: React.FC = () => {
  const {
    expenses,
    currentShift,
  } = useAppStoreSelector(
    (state) => ({
      expenses: state.expenses,
      currentShift: state.currentShift,
    }),
    shallowEqual
  );
  const { openModal, refreshExpenseShiftCenterFromSupabase, reverseExpense } =
    useAppStoreActions();
  const [reversingExpenseId, setReversingExpenseId] = useState<string | null>(null);

  useEffect(() => {
    void refreshExpenseShiftCenterFromSupabase().catch(() => undefined);
  }, [refreshExpenseShiftCenterFromSupabase]);

  const cashTotal = expenses
    .filter((expense) => !expense.isReversed && expense.paymentMethod === 'cash')
    .reduce((total, expense) => total + expense.amount, 0);
  const cliqTotal = expenses
    .filter((expense) => !expense.isReversed && expense.paymentMethod === 'cliq')
    .reduce((total, expense) => total + expense.amount, 0);

  return (
    <div data-testid="expenses-screen" className="space-y-4 p-4 pb-24 text-nw-text">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-nw-text">
            <DollarSign className="h-5 w-5 text-nw-warn" />
            المصروفات التشغيلية
          </h2>
          <p className="mt-1 text-[11px] text-nw-muted">
            سجل المصروفات وحركاتها حسب الوردية والفرع
          </p>
        </div>
        <UiButton variant="accent"
          type="button"
          onClick={() => openModal('add_expense')}
          className="shrink-0 whitespace-nowrap text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          مصروف جديد
        </UiButton>
      </div>

      <div
        className={`rounded-2xl border p-3 text-xs ${
          currentShift
            ? 'border-nw-border bg-nw-ok-bg text-nw-ok'
            : 'border-nw-border bg-nw-warn-bg text-nw-warn'
        }`}
      >
        {currentShift
          ? `الوردية المفتوحة: ${currentShift.shiftNumber} — أي مصروف جديد سيرتبط بها تلقائيًا.`
          : 'لا توجد وردية مفتوحة. افتح وردية الصندوق قبل تسجيل أي مصروف.'}
      </div>

      <KpiGrid>
        <KpiCard label="الإجمالي" value={<MoneyText amount={cashTotal + cliqTotal} currency />} badge={<WalletCards className="h-4 w-4 text-nw-primary" />} />
        <KpiCard label="كاش" value={<MoneyText amount={cashTotal} currency />} valueTone="ok" badge={<Banknote className="h-4 w-4" />} />
        <KpiCard label="CliQ" value={<MoneyText amount={cliqTotal} currency />} valueTone="info" badge={<Smartphone className="h-4 w-4" />} />
      </KpiGrid>

      <div className="space-y-2.5">
        {expenses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-nw-border bg-nw-surface p-8 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-nw-ok" />
            <h3 className="text-sm font-black text-nw-text">لا توجد مصروفات مسجلة</h3>
            <p className="mt-1 text-[11px] text-nw-muted">
              ستظهر المصروفات هنا بعد تسجيلها من الوردية المفتوحة.
            </p>
          </div>
        ) : (
          expenses.map((expense) => (
            <Card padded={false}
              key={expense.id}
              className={`space-y-2 rounded-2xl border p-3.5 text-xs shadow ${
                expense.isReversed
                  ? 'border-nw-border bg-nw-bad-bg'
                  : 'border-nw-border bg-nw-surface'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="rounded border border-nw-border bg-nw-warn-bg px-2 py-0.5 font-mono font-bold text-nw-warn">
                    {expense.expenseNumber}
                  </span>
                  <h4 className="truncate font-bold text-nw-text">{expense.category}</h4>
                </div>
                <strong className="shrink-0 text-sm text-nw-warn">
                  {money(expense.amount)}
                </strong>
              </div>
              <p className="text-[11px] text-nw-muted">{expense.description}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-nw-border pt-2 text-[10px] text-nw-muted">
                <span>
                  {formatUiDate(expense.createdAt, {dateStyle:'medium',timeStyle:'short'})} — {expense.createdByName}
                </span>
                <span
                  className={
                    expense.paymentMethod === 'cash'
                      ? 'font-bold text-nw-ok'
                      : 'font-bold text-nw-info'
                  }
                >
                  {expense.paymentMethod === 'cash' ? 'كاش' : 'CliQ'}
                  {expense.referenceNumber ? ` • ${expense.referenceNumber}` : ''}
                </span>
              </div>
              {expense.isReversed ? (
                <p className="rounded-xl border border-nw-border bg-nw-bad-bg p-2 text-[10px] text-nw-bad">
                  تم العكس{expense.reversalReason ? `: ${expense.reversalReason}` : ''}
                  {expense.reversedByName ? ` — ${expense.reversedByName}` : ''}
                </p>
              ) : currentShift?.id === expense.shiftId ? (
                <MobileActionMenu label={`إجراءات المصروف ${expense.expenseNumber}`}><UiButton variant="danger"
                  type="button"
                  disabled={reversingExpenseId === expense.id}
                  onClick={async () => {
                    const reason = window.prompt('اكتب سبب عكس المصروف (لا يمكن حذفه):');
                    if (!reason?.trim()) return;
                    setReversingExpenseId(expense.id);
                    await reverseExpense(expense.id, reason);
                    setReversingExpenseId(null);
                  }}
                  className="w-full text-xs"
                >
                  {reversingExpenseId === expense.id ? 'جاري العكس...' : 'عكس المصروف مع حفظ السجل'}
                </UiButton></MobileActionMenu>
              ) : null}
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

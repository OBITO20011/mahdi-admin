/**
 * Nawasrah Business Manager - RPC-backed operational expenses.
 */

import React, { useEffect } from 'react';
import {
  Banknote,
  CheckCircle2,
  DollarSign,
  Plus,
  Smartphone,
  WalletCards,
} from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { CURRENCY } from '../../constants';

const money = (value: number) => `${value.toFixed(3)} ${CURRENCY}`;

export const ExpensesView: React.FC = () => {
  const {
    expenses,
    currentShift,
    openModal,
    refreshExpenseShiftCenterFromSupabase,
  } = useAppStore();

  useEffect(() => {
    void refreshExpenseShiftCenterFromSupabase().catch(() => undefined);
  }, []);

  const cashTotal = expenses
    .filter((expense) => expense.paymentMethod === 'cash')
    .reduce((total, expense) => total + expense.amount, 0);
  const cliqTotal = expenses
    .filter((expense) => expense.paymentMethod === 'cliq')
    .reduce((total, expense) => total + expense.amount, 0);

  return (
    <div className="space-y-4 p-4 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-slate-100">
            <DollarSign className="h-5 w-5 text-amber-400" />
            المصروفات التشغيلية
          </h2>
          <p className="mt-1 text-[11px] text-slate-400">
            سجل حقيقي مرتبط بالوردية والفرع ومحفوظ في Supabase
          </p>
        </div>
        <button
          type="button"
          onClick={() => openModal('add_expense')}
          className="flex shrink-0 items-center gap-1 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white shadow transition hover:bg-amber-500"
        >
          <Plus className="h-3.5 w-3.5" />
          مصروف جديد
        </button>
      </div>

      <div
        className={`rounded-2xl border p-3 text-xs ${
          currentShift
            ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300'
            : 'border-amber-800/70 bg-amber-950/30 text-amber-300'
        }`}
      >
        {currentShift
          ? `الوردية المفتوحة: ${currentShift.shiftNumber} — أي مصروف جديد سيرتبط بها تلقائيًا.`
          : 'لا توجد وردية مفتوحة. افتح وردية الصندوق قبل تسجيل أي مصروف.'}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <WalletCards className="mb-2 h-4 w-4 text-amber-400" />
          <span className="block text-[10px] text-slate-500">الإجمالي</span>
          <b className="text-amber-300">{money(cashTotal + cliqTotal)}</b>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <Banknote className="mb-2 h-4 w-4 text-emerald-400" />
          <span className="block text-[10px] text-slate-500">كاش</span>
          <b className="text-emerald-300">{money(cashTotal)}</b>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <Smartphone className="mb-2 h-4 w-4 text-cyan-400" />
          <span className="block text-[10px] text-slate-500">CliQ</span>
          <b className="text-cyan-300">{money(cliqTotal)}</b>
        </div>
      </div>

      <div className="space-y-2.5">
        {expenses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-8 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
            <h3 className="text-sm font-black text-slate-200">لا توجد مصروفات مسجلة</h3>
            <p className="mt-1 text-[11px] text-slate-500">
              لا توجد بيانات تجريبية؛ ستظهر هنا المصروفات الحقيقية فقط.
            </p>
          </div>
        ) : (
          expenses.map((expense) => (
            <article
              key={expense.id}
              className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-3.5 text-xs shadow"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="rounded border border-amber-900 bg-amber-950/80 px-2 py-0.5 font-mono font-bold text-amber-400">
                    {expense.expenseNumber}
                  </span>
                  <h4 className="truncate font-bold text-slate-100">{expense.category}</h4>
                </div>
                <strong className="shrink-0 text-sm text-amber-400">
                  {money(expense.amount)}
                </strong>
              </div>
              <p className="text-[11px] text-slate-400">{expense.description}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2 text-[10px] text-slate-500">
                <span>
                  {new Date(expense.createdAt).toLocaleString('ar-JO')} — {expense.createdByName}
                </span>
                <span
                  className={
                    expense.paymentMethod === 'cash'
                      ? 'font-bold text-emerald-400'
                      : 'font-bold text-cyan-400'
                  }
                >
                  {expense.paymentMethod === 'cash' ? 'كاش' : 'CliQ'}
                  {expense.referenceNumber ? ` • ${expense.referenceNumber}` : ''}
                </span>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
};

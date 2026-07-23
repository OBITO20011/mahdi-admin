/**
 * Nawasrah Business Manager - Expenses Management View
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { DollarSign, Plus, CheckCircle2, FileText, Image as ImageIcon } from 'lucide-react';
import { CURRENCY } from '../../constants';

export const ExpensesView: React.FC = () => {
  const { expenses, openModal } = useAppStore();

  const totalExpenseAmount = expenses.reduce((acc, e) => acc + e.amount, 0);

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-slate-100 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-amber-400" />
            <span>إدارة المصروفات التشغيلية</span>
          </h2>
          <p className="text-[11px] text-slate-400">توثيق الفواتير، الإيجارات، الرواتب والكهرباء</p>
        </div>

        <button
          onClick={() => openModal('add_expense')}
          className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>مصروف جديد</span>
        </button>
      </div>

      {/* Summary Card */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-md flex items-center justify-between text-xs">
        <div>
          <span className="text-slate-400 font-bold block">إجمالي المصروفات المسجلة:</span>
          <span className="text-base font-black text-amber-400">
            {totalExpenseAmount.toFixed(2)} {CURRENCY}
          </span>
        </div>
        <span className="text-[10px] bg-amber-950/80 text-amber-300 px-2.5 py-1 rounded-xl border border-amber-800 font-bold">
          {expenses.length} فواتير
        </span>
      </div>

      {/* Expense List */}
      <div className="space-y-2.5">
        {expenses.map((exp) => (
          <div
            key={exp.id}
            className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow text-xs space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-amber-400 font-bold bg-amber-950/80 px-2 py-0.5 rounded border border-amber-900">
                  {exp.expenseNumber}
                </span>
                <h4 className="font-bold text-slate-100">{exp.category}</h4>
              </div>
              <span className="font-extrabold text-amber-400 text-sm">
                {exp.amount.toFixed(2)} {CURRENCY}
              </span>
            </div>

            <p className="text-slate-400 text-[11px]">{exp.description}</p>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500">
              <span>بواسطة: {exp.createdByName}</span>
              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-3 h-3" />
                <span>معتمد من الإدارة</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Nawasrah Business Manager - Double Entry Accounting & Ledger View
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import {
  BookOpen,
  Scale,
  FileCheck2,
  PieChart,
  Plus,
  CheckCircle2,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

export const AccountingView: React.FC = () => {
  const { accounts, journalEntries, openModal } = useAppStore();

  const [activeTab, setActiveTab] = useState<'chart' | 'entries' | 'income' | 'balance'>('chart');

  // Compute Income Statement totals
  const totalRevenues = accounts
    .filter((a) => a.type === 'revenue')
    .reduce((acc, a) => acc + a.balance, 0);

  const totalExpenses = accounts
    .filter((a) => a.type === 'expense')
    .reduce((acc, a) => acc + a.balance, 0);

  const netIncome = totalRevenues - totalExpenses;

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-slate-100 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-400" />
            <span>المحاسبة والقيود المزدوجة</span>
          </h2>
          <p className="text-[11px] text-slate-400">دليل الحسابات، القيود اليومية، والقوائم المالية</p>
        </div>

        <button
          onClick={() => openModal('add_journal_entry')}
          className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>قيد يدوي</span>
        </button>
      </div>

      {/* Mode Sub-Tabs */}
      <div className="flex items-center bg-slate-900 border border-slate-800 rounded-2xl p-1 text-xs font-bold overflow-x-auto no-scrollbar">
        {[
          { id: 'chart', label: 'دليل الحسابات' },
          { id: 'entries', label: 'القيود اليومية' },
          { id: 'income', label: 'قائمة الدخل' },
          { id: 'balance', label: 'الميزانية العمومية' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-1 py-2 px-3 rounded-xl shrink-0 transition text-center ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Chart of Accounts */}
      {activeTab === 'chart' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-300">
            <span>شجرة وميزان دليل الحسابات (Chart of Accounts):</span>
          </div>

          <div className="space-y-2">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="bg-slate-900 border border-slate-800 p-3 rounded-2xl flex items-center justify-between shadow text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-blue-400 font-bold bg-blue-950 px-2 py-0.5 rounded border border-blue-900">
                      {acc.code}
                    </span>
                    <h4 className="font-bold text-slate-100">{acc.nameAr}</h4>
                  </div>
                  <span className="text-[10px] text-slate-400 capitalize mt-1 block">
                    النوع: {acc.type === 'asset' ? 'أصول' : acc.type === 'liability' ? 'خصوم' : acc.type === 'equity' ? 'حقوق ملكية' : acc.type === 'revenue' ? 'إيرادات' : 'مصروفات'}
                  </span>
                </div>

                <div className="text-left font-black text-sm text-slate-100">
                  {acc.balance.toFixed(2)} {CURRENCY}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Income Statement View */}
      {activeTab === 'income' && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-md space-y-3 text-xs">
          <div className="border-b border-slate-800 pb-2">
            <h3 className="font-bold text-slate-100 text-sm">قائمة الدخل التقديرية (Income Statement)</h3>
            <p className="text-[10px] text-slate-400">عن الفترة الممتدة حتى اليوم</p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-emerald-400 font-bold text-xs p-2 bg-emerald-950/40 rounded-xl border border-emerald-900/50">
              <span>إجمالي إيرادات المبيعات:</span>
              <span>+{totalRevenues.toFixed(2)} {CURRENCY}</span>
            </div>

            <div className="flex justify-between text-red-400 font-bold text-xs p-2 bg-red-950/40 rounded-xl border border-red-900/50">
              <span>إجمالي المصروفات وتكلفة البضاعة:</span>
              <span>-{totalExpenses.toFixed(2)} {CURRENCY}</span>
            </div>

            <div className="flex justify-between text-white font-extrabold text-sm p-3 bg-blue-950/60 rounded-xl border border-blue-800 pt-2">
              <span>صافي الدخل الأخير (Net Profit):</span>
              <span className="text-emerald-400">+{netIncome.toFixed(2)} {CURRENCY}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

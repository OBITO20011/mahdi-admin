/**
 * Nawasrah Business Manager - Shift & Cash Register Closing View
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Clock, Wallet, DollarSign, AlertCircle, CheckCircle2 } from 'lucide-react';
import { CURRENCY } from '../../constants';

export const ShiftsView: React.FC = () => {
  const { currentShift, openShift, closeShift } = useAppStore();

  const [openingCashInput, setOpeningCashInput] = useState<number>(250);
  const [actualCashInput, setActualCashInput] = useState<number>(1665.5);
  const [discrepancyReason, setDiscrepancyReason] = useState<string>('');

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-slate-100 flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-400" />
            <span>إغلاق الوردية وحسابات الصندوق</span>
          </h2>
          <p className="text-[11px] text-slate-400">مطابقة المقبوضات النقدية ورصيد الخزينة</p>
        </div>
      </div>

      {currentShift ? (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-xl space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <span className="text-[10px] text-emerald-400 font-bold uppercase">وردية مفتوحة حالياً</span>
              <h3 className="font-extrabold text-slate-100 text-sm">{currentShift.shiftNumber}</h3>
            </div>
            <span className="text-[10px] text-slate-400">المحاسب: {currentShift.cashierName}</span>
          </div>

          <div className="space-y-2 bg-slate-800/50 p-3 rounded-xl border border-slate-700/60">
            <div className="flex justify-between text-slate-300">
              <span>الرصيد الافتتاحي:</span>
              <span className="font-bold">{currentShift.openingCash.toFixed(2)} {CURRENCY}</span>
            </div>
            <div className="flex justify-between text-emerald-400">
              <span>مبيعات الكاش (+):</span>
              <span className="font-bold">+{currentShift.totalCashSales.toFixed(2)} {CURRENCY}</span>
            </div>
            <div className="flex justify-between text-teal-400">
              <span>مبيعات CliQ:</span>
              <span className="font-bold">{currentShift.totalCliqSales.toFixed(2)} {CURRENCY}</span>
            </div>
            <div className="flex justify-between text-red-400">
              <span>مصروفات ومدفوعات (-):</span>
              <span className="font-bold">-{currentShift.totalPayments.toFixed(2)} {CURRENCY}</span>
            </div>
            <div className="flex justify-between text-white font-extrabold border-t border-slate-700 pt-2 text-sm">
              <span>الرصيد المتوقع بالصندوق:</span>
              <span className="text-blue-400">{currentShift.expectedCash.toFixed(2)} {CURRENCY}</span>
            </div>
          </div>

          {/* Actual Cash Input for Closing */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <label className="text-slate-300 font-bold block">أدخل الكاش الفعلي عند الجرد النهائي:</label>
            <input
              type="number"
              value={actualCashInput}
              onChange={(e) => setActualCashInput(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-slate-100 text-sm font-bold focus:border-blue-500 focus:outline-none"
            />

            {actualCashInput !== currentShift.expectedCash && (
              <div className="p-2.5 bg-amber-950/60 border border-amber-800 rounded-xl text-amber-300 text-[11px] space-y-1">
                <span className="font-bold block">
                  فرق الصندوق التقديري: {(actualCashInput - currentShift.expectedCash).toFixed(2)} {CURRENCY}
                </span>
                <input
                  type="text"
                  value={discrepancyReason}
                  onChange={(e) => setDiscrepancyReason(e.target.value)}
                  placeholder="سبب النقص أو الزيادة بالصندوق..."
                  className="w-full bg-slate-900 border border-amber-800 rounded-lg p-1.5 text-xs text-white placeholder-amber-600 focus:outline-none"
                />
              </div>
            )}

            <button
              onClick={() => closeShift(actualCashInput, discrepancyReason)}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-3 rounded-2xl shadow-lg transition active:scale-98 text-xs"
            >
              اعتماد إغلاق الوردية وترحيل الصندوق
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow text-center text-xs space-y-4">
          <Clock className="w-10 h-10 mx-auto text-slate-600" />
          <h3 className="font-bold text-slate-200">لا توجد وردية مفتوحة حالياً بالفرع</h3>
          <p className="text-slate-400 text-[11px]">يمكنك إدخال العهدة النقدية الافتتاحية وبدء الوردية الآن</p>

          <div className="max-w-xs mx-auto space-y-2">
            <label className="text-slate-400 font-bold block text-right">العهد الافتتاحية (الكاش):</label>
            <input
              type="number"
              value={openingCashInput}
              onChange={(e) => setOpeningCashInput(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white font-bold text-center"
            />
            <button
              onClick={() => openShift(openingCashInput)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl shadow transition"
            >
              فتح وردية جديدة
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

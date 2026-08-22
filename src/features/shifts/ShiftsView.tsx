/**
 * Nawasrah Business Manager - RPC-backed shift and cash reconciliation.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { CURRENCY } from '../../constants';
import { fetchCashShiftClosingReportFromSupabase } from '../../services/supabase/expenses-shifts.service';
import type { ShiftClosingReport } from '../../types';
import { ShiftClosingReportModal } from './ShiftClosingReportModal';

const money = (value: number) => `${value.toFixed(3)} ${CURRENCY}`;

export const ShiftsView: React.FC = () => {
  const {
    currentShift,
    recentShifts,
    openShift,
    closeShift,
    cancelEmptyShift,
    refreshExpenseShiftCenterFromSupabase,
  } = useAppStore();
  const [openingCashInput, setOpeningCashInput] = useState('');
  const [actualCashInput, setActualCashInput] = useState('');
  const [discrepancyReason, setDiscrepancyReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reportShiftId, setReportShiftId] = useState<string | null>(null);
  const [closingReport, setClosingReport] = useState<ShiftClosingReport | null>(
    null
  );
  const [reportError, setReportError] = useState('');
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [showCancelPanel, setShowCancelPanel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    void refreshExpenseShiftCenterFromSupabase().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (currentShift) {
      setActualCashInput(currentShift.expectedCash.toFixed(3));
      setDiscrepancyReason('');
    }
  }, [currentShift?.id]);

  const actualCash = Number(actualCashInput);
  const discrepancy = useMemo(
    () =>
      currentShift && Number.isFinite(actualCash)
        ? Number((actualCash - currentShift.expectedCash).toFixed(3))
        : 0,
    [actualCash, currentShift]
  );
  const needsReason = Math.abs(discrepancy) >= 0.001;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshExpenseShiftCenterFromSupabase();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleOpen = async () => {
    const openingCash = Number(openingCashInput);
    if (!Number.isFinite(openingCash) || openingCash < 0 || isSubmitting) return;
    setIsSubmitting(true);
    const success = await openShift(openingCash);
    setIsSubmitting(false);
    if (success) setOpeningCashInput('');
  };

  const handleOpenReport = async (shiftId: string) => {
    setReportShiftId(shiftId);
    setClosingReport(null);
    setReportError('');
    setIsReportLoading(true);
    try {
      const report = await fetchCashShiftClosingReportFromSupabase(shiftId);
      setClosingReport(report);
    } catch (error) {
      setReportError(
        error instanceof Error
          ? error.message
          : 'تعذر تحميل تقرير إغلاق الوردية.'
      );
    } finally {
      setIsReportLoading(false);
    }
  };

  const handleClose = async () => {
    if (
      !Number.isFinite(actualCash) ||
      actualCash < 0 ||
      (needsReason && discrepancyReason.trim().length < 2) ||
      isSubmitting
    ) {
      return;
    }
    const shiftId = currentShift?.id;
    setIsSubmitting(true);
    const success = await closeShift(actualCash, discrepancyReason);
    setIsSubmitting(false);
    if (success && shiftId) {
      await handleOpenReport(shiftId);
    }
  };

  const handleCancelEmptyShift = async () => {
    if (cancelReason.trim().length < 2 || isCancelling) return;
    setIsCancelling(true);
    const success = await cancelEmptyShift(cancelReason);
    setIsCancelling(false);
    if (success) {
      setShowCancelPanel(false);
      setCancelReason('');
    }
  };

  return (
    <div className="space-y-4 p-4 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-slate-100">
            <Clock className="h-5 w-5 text-blue-400" />
            الصندوق والورديات
          </h2>
          <p className="mt-1 text-[11px] text-slate-400">
            مطابقة الكاش الفعلي مع المبيعات والمقبوضات والمدفوعات الحقيقية
          </p>
        </div>
        <button
          type="button"
          disabled={isRefreshing}
          onClick={() => void handleRefresh()}
          className="rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-300 disabled:opacity-50"
          aria-label="تحديث حسابات الوردية"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {currentShift ? (
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-xs shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <span className="text-[10px] font-bold text-emerald-400">وردية مفتوحة الآن</span>
              <h3 className="text-sm font-extrabold text-slate-100">{currentShift.shiftNumber}</h3>
            </div>
            <div className="text-left text-[10px] text-slate-400">
              <span className="block">{currentShift.cashierName}</span>
              <span>{new Date(currentShift.startTime).toLocaleString('ar-JO')}</span>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-800/50 p-3">
            <div className="flex justify-between text-slate-300">
              <span>العهدة الافتتاحية</span>
              <b>{money(currentShift.openingCash)}</b>
            </div>
            <div className="flex justify-between text-emerald-400">
              <span>مبيعات الكاش (+)</span>
              <b>{money(currentShift.totalCashSales)}</b>
            </div>
            <div className="flex justify-between text-emerald-300">
              <span>سندات قبض كاش (+)</span>
              <b>{money(currentShift.cashReceipts)}</b>
            </div>
            <div className="flex justify-between text-rose-400">
              <span>دفعات الموردين كاش (−)</span>
              <b>{money(currentShift.cashSupplierPayments)}</b>
            </div>
            <div className="flex justify-between text-rose-300">
              <span>مصروفات كاش (−)</span>
              <b>{money(currentShift.cashExpenses)}</b>
            </div>
            <div className="flex justify-between text-orange-300">
              <span>مبالغ مرتجعات كاش (−)</span>
              <b>{money(currentShift.cashRefunds)}</b>
            </div>
            <div className="flex justify-between border-t border-slate-700 pt-2 text-sm font-extrabold text-white">
              <span>الكاش المتوقع في الصندوق</span>
              <span className="text-blue-400">{money(currentShift.expectedCash)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-cyan-900/70 bg-cyan-950/30 p-3">
              <Smartphone className="mb-1 h-4 w-4 text-cyan-400" />
              <span className="block text-[10px] text-slate-400">صافي حركة CliQ</span>
              <b className="text-cyan-300">
                {money(
                    currentShift.totalCliqSales +
                    currentShift.cliqReceipts -
                    currentShift.cliqSupplierPayments -
                    currentShift.cliqExpenses -
                    currentShift.cliqRefunds
                )}
              </b>
            </div>
            <div className="rounded-xl border border-indigo-900/70 bg-indigo-950/30 p-3">
              <Banknote className="mb-1 h-4 w-4 text-indigo-400" />
              <span className="block text-[10px] text-slate-400">مبيعات البطاقة</span>
              <b className="text-indigo-300">{money(currentShift.totalCardSales)}</b>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleOpenReport(currentShift.id)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-800 bg-blue-950/40 py-2.5 font-black text-blue-300 transition hover:bg-blue-900/50"
          >
            <FileText className="h-4 w-4" />
            عرض التقرير المالي الحي
          </button>

          <div className="space-y-2 border-t border-slate-800 pt-3">
            <label className="block font-bold text-slate-300">
              الكاش الفعلي بعد عدّ الصندوق
            </label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={actualCashInput}
              onChange={(event) => setActualCashInput(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-sm font-bold text-slate-100 focus:border-blue-500 focus:outline-none"
            />

            {needsReason && (
              <div className="space-y-2 rounded-xl border border-amber-800 bg-amber-950/60 p-3 text-amber-300">
                <div className="flex items-center gap-2 font-bold">
                  <AlertCircle className="h-4 w-4" />
                  فرق الصندوق: {money(discrepancy)}
                </div>
                <input
                  type="text"
                  value={discrepancyReason}
                  onChange={(event) => setDiscrepancyReason(event.target.value)}
                  placeholder="اكتب سبب النقص أو الزيادة (إجباري)"
                  className="w-full rounded-lg border border-amber-800 bg-slate-900 p-2 text-xs text-white placeholder:text-amber-600 focus:outline-none"
                />
              </div>
            )}

            <button
              type="button"
              disabled={
                isSubmitting ||
                !Number.isFinite(actualCash) ||
                actualCash < 0 ||
                (needsReason && discrepancyReason.trim().length < 2)
              }
              onClick={() => void handleClose()}
              className="w-full rounded-2xl bg-blue-600 py-3 font-black text-white shadow-lg transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? 'جاري الإغلاق...' : 'اعتماد الجرد وإغلاق الوردية'}
            </button>
          </div>

          <div className="space-y-2 border-t border-slate-800 pt-3">
            {!showCancelPanel ? (
              <button
                type="button"
                onClick={() => setShowCancelPanel(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-900/80 bg-rose-950/20 py-2.5 font-bold text-rose-300 transition hover:bg-rose-950/50"
              >
                <XCircle className="h-4 w-4" />
                إلغاء وردية فُتحت بالخطأ
              </button>
            ) : (
              <div className="space-y-3 rounded-xl border border-rose-900/80 bg-rose-950/30 p-3">
                <div className="flex items-start gap-2 text-rose-200">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="leading-5">
                    يُسمح بالإلغاء فقط إذا لم تُسجل أي عملية بيع أو قبض أو دفع أو
                    مصروف أو مرتجع. لن تُحذف الوردية وستبقى في سجل التدقيق.
                  </p>
                </div>
                <textarea
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="اكتب سبب الإلغاء (إجباري)"
                  className="w-full resize-none rounded-lg border border-rose-900 bg-slate-950 p-2.5 text-xs text-white placeholder:text-rose-700 focus:border-rose-600 focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isCancelling || cancelReason.trim().length < 2}
                    onClick={() => void handleCancelEmptyShift()}
                    className="rounded-lg bg-rose-700 py-2.5 font-black text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isCancelling ? 'جاري التحقق...' : 'نعم، إلغاء الوردية'}
                  </button>
                  <button
                    type="button"
                    disabled={isCancelling}
                    onClick={() => {
                      setShowCancelPanel(false);
                      setCancelReason('');
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-900 py-2.5 font-bold text-slate-300"
                  >
                    تراجع
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center text-xs shadow">
          <CheckCircle2 className="mx-auto h-10 w-10 text-slate-600" />
          <div>
            <h3 className="font-bold text-slate-200">لا توجد وردية مفتوحة حاليًا</h3>
            <p className="mt-1 text-[11px] text-slate-400">
              أدخل الكاش الموجود فعليًا في الدرج عند بداية العمل.
            </p>
          </div>
          <div className="mx-auto max-w-xs space-y-2">
            <label className="block text-right font-bold text-slate-400">
              العهدة الافتتاحية (د.أ)
            </label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={openingCashInput}
              onChange={(event) => setOpeningCashInput(event.target.value)}
              placeholder="0.000"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-center font-bold text-white"
            />
            <button
              type="button"
              disabled={
                isSubmitting ||
                openingCashInput === '' ||
                !Number.isFinite(Number(openingCashInput)) ||
                Number(openingCashInput) < 0
              }
              onClick={() => void handleOpen()}
              className="w-full rounded-xl bg-emerald-600 py-3 font-bold text-white shadow transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? 'جاري الفتح...' : 'فتح وردية جديدة'}
            </button>
          </div>
        </div>
      )}

      {recentShifts.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-black text-slate-300">
            آخر الورديات المغلقة والملغاة
          </h3>
          {recentShifts.map((shift) => (
            <article
              key={shift.id}
              className="rounded-2xl border border-slate-800 bg-slate-900 p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <b className="text-slate-100">{shift.shiftNumber}</b>
                    {shift.status === 'cancelled' && (
                      <span className="rounded-full border border-rose-800 bg-rose-950/60 px-2 py-0.5 text-[9px] font-black text-rose-300">
                        ملغاة
                      </span>
                    )}
                  </div>
                  <span className="mt-0.5 block text-[10px] text-slate-500">
                    {shift.endTime ? new Date(shift.endTime).toLocaleString('ar-JO') : ''}
                  </span>
                </div>
                {shift.status === 'closed' && (
                  <div className="text-left">
                    <span className="block text-[10px] text-slate-500">فرق الصندوق</span>
                    <b
                      className={
                        Math.abs(shift.cashDiscrepancy || 0) < 0.001
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }
                    >
                      {money(shift.cashDiscrepancy || 0)}
                    </b>
                  </div>
                )}
              </div>
              {shift.status === 'cancelled' ? (
                <div className="mt-3 rounded-xl border border-rose-950 bg-rose-950/20 p-2.5 text-[10px] leading-5 text-slate-400">
                  <span className="font-bold text-rose-300">سبب الإلغاء: </span>
                  {shift.cancellationReason || 'غير متاح'}
                  {shift.cancelledByName && (
                    <span className="mt-1 block">أُلغي بواسطة: {shift.cancelledByName}</span>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleOpenReport(shift.id)}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950/60 py-2 text-[11px] font-black text-blue-300 transition hover:border-blue-700"
                >
                  <FileText className="h-3.5 w-3.5" />
                  عرض تقرير الإغلاق الكامل
                </button>
              )}
            </article>
          ))}
        </section>
      )}

      <ShiftClosingReportModal
        isOpen={reportShiftId !== null}
        report={closingReport}
        isLoading={isReportLoading}
        error={reportError}
        onClose={() => {
          setReportShiftId(null);
          setClosingReport(null);
          setReportError('');
        }}
        onRetry={() => {
          if (reportShiftId) void handleOpenReport(reportShiftId);
        }}
      />
    </div>
  );
};

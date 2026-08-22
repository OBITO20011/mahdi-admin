import React from 'react';
import {
  Banknote,
  CheckCircle2,
  FileText,
  Loader2,
  PackageCheck,
  Printer,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Smartphone,
  TriangleAlert,
  WalletCards,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { CURRENCY } from '../../constants';
import type { ShiftClosingReport } from '../../types';

interface ShiftClosingReportModalProps {
  isOpen: boolean;
  report: ShiftClosingReport | null;
  isLoading: boolean;
  error?: string;
  onClose: () => void;
  onRetry: () => void;
}

const money = (value: number) => `${value.toFixed(3)} ${CURRENCY}`;

const Metric: React.FC<{
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'danger' | 'info';
}> = ({ label, value, tone = 'default' }) => {
  const toneClass = {
    default: 'text-slate-100',
    success: 'text-emerald-300',
    danger: 'text-rose-300',
    info: 'text-cyan-300',
  }[tone];

  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-950/60 p-3">
      <span className="block text-[10px] font-bold text-slate-500">{label}</span>
      <strong className={`mt-1 block text-sm ${toneClass}`}>{value}</strong>
    </div>
  );
};

export const ShiftClosingReportModal: React.FC<
  ShiftClosingReportModalProps
> = ({ isOpen, report, isLoading, error, onClose, onRetry }) => {
  const handlePrint = () => window.print();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="تقرير الإغلاق اليومي"
      subtitle="مبيعات ومقبوضات ومدفوعات ومرتجعات ومطابقة الصندوق"
      maxHeight="max-h-[94vh]"
    >
      {isLoading ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
          <span className="text-xs font-bold">جاري احتساب التقرير من قاعدة البيانات...</span>
        </div>
      ) : error ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
          <TriangleAlert className="h-9 w-9 text-rose-400" />
          <p className="max-w-sm text-xs leading-6 text-slate-300">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white"
          >
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </button>
        </div>
      ) : report ? (
        <div className="shift-closing-report space-y-4 text-xs">
          <style>{`
            @media print {
              body * { visibility: hidden !important; }
              .shift-closing-report, .shift-closing-report * { visibility: visible !important; }
              .shift-closing-report { position: absolute; inset: 0; padding: 16px; color: #0f172a; background: white; }
              .shift-report-actions { display: none !important; }
            }
          `}</style>

          <section className="rounded-2xl border border-blue-800/60 bg-gradient-to-br from-blue-950/90 to-slate-950 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-blue-300">
                  <FileText className="h-5 w-5" />
                  <strong className="text-sm">{report.shift.shiftNumber}</strong>
                </div>
                <p className="mt-1 text-[10px] text-slate-400">
                  الموظف: {report.shift.cashierName}
                </p>
              </div>
              <div className="text-left text-[10px] leading-5 text-slate-400">
                <span className="block">
                  الفتح: {new Date(report.shift.startTime).toLocaleString('ar-JO')}
                </span>
                <span className="block">
                  {report.shift.endTime
                    ? `الإغلاق: ${new Date(report.shift.endTime).toLocaleString('ar-JO')}`
                    : 'الوردية ما زالت مفتوحة'}
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-900/70 p-2.5">
              {report.shift.status === 'open' ? (
                <RefreshCw className="h-4 w-4 text-blue-400" />
              ) : report.reconciliation.isBalanced ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <TriangleAlert className="h-4 w-4 text-amber-400" />
              )}
              <span className="font-bold text-slate-200">
                {report.shift.status === 'open'
                  ? 'تقرير حي — الأرقام تتحدث حتى هذه اللحظة'
                  : report.reconciliation.isBalanced
                    ? 'الوردية مغلقة والصندوق مطابق'
                    : 'الوردية مغلقة ويوجد فرق صندوق موثق'}
              </span>
            </div>
          </section>

          <section>
            <h4 className="mb-2 flex items-center gap-2 font-black text-slate-200">
              <ShoppingCart className="h-4 w-4 text-emerald-400" />
              ملخص المبيعات
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <Metric label="إجمالي المبيعات" value={money(report.sales.grossSales)} />
              <Metric
                label="المبالغ المرتجعة"
                value={money(report.sales.refunds)}
                tone="danger"
              />
              <Metric
                label="صافي المبيعات"
                value={money(report.sales.netSales)}
                tone="success"
              />
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              <Metric label="الطلبات" value={`${report.sales.orderCount}`} />
              <Metric label="بيع مباشر" value={`${report.sales.posOrderCount}`} />
              <Metric label="طلبات الموقع" value={`${report.sales.websiteOrderCount}`} />
              <Metric label="الطرود المباعة" value={`${report.sales.packageCount}`} />
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              عدد الأصناف المختلفة المباعة: {report.sales.uniqueProductCount}
            </p>
          </section>

          <section className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-emerald-900/70 bg-emerald-950/30 p-3">
              <Banknote className="mb-1 h-4 w-4 text-emerald-400" />
              <span className="block text-[10px] text-slate-400">مبيعات كاش</span>
              <b className="text-emerald-300">{money(report.shift.totalCashSales)}</b>
            </div>
            <div className="rounded-xl border border-cyan-900/70 bg-cyan-950/30 p-3">
              <Smartphone className="mb-1 h-4 w-4 text-cyan-400" />
              <span className="block text-[10px] text-slate-400">مبيعات CliQ</span>
              <b className="text-cyan-300">{money(report.shift.totalCliqSales)}</b>
            </div>
            <div className="rounded-xl border border-indigo-900/70 bg-indigo-950/30 p-3">
              <WalletCards className="mb-1 h-4 w-4 text-indigo-400" />
              <span className="block text-[10px] text-slate-400">مبيعات بطاقة</span>
              <b className="text-indigo-300">{money(report.shift.totalCardSales)}</b>
            </div>
          </section>

          <section className="space-y-2 rounded-2xl border border-slate-700 bg-slate-800/40 p-3">
            <h4 className="font-black text-slate-200">الحركة المالية خلال الوردية</h4>
            <div className="flex justify-between text-emerald-300">
              <span>إجمالي الداخل</span>
              <b>{money(report.reconciliation.totalInflows)}</b>
            </div>
            <div className="flex justify-between text-rose-300">
              <span>إجمالي الخارج</span>
              <b>{money(report.reconciliation.totalOutflows)}</b>
            </div>
            <div className="flex justify-between border-t border-slate-700 pt-2 font-black text-white">
              <span>صافي الحركة</span>
              <b>{money(report.reconciliation.netMovement)}</b>
            </div>
          </section>

          <section className="space-y-2 rounded-2xl border border-blue-900/70 bg-blue-950/30 p-3">
            <h4 className="flex items-center gap-2 font-black text-blue-200">
              <Banknote className="h-4 w-4" />
              مطابقة درج الكاش
            </h4>
            <div className="flex justify-between text-slate-300">
              <span>العهدة الافتتاحية</span>
              <b>{money(report.reconciliation.openingCash)}</b>
            </div>
            <div className="flex justify-between text-blue-300">
              <span>الكاش المتوقع</span>
              <b>{money(report.reconciliation.expectedCash)}</b>
            </div>
            {report.reconciliation.actualCash !== undefined && (
              <div className="flex justify-between text-white">
                <span>الكاش المعدود فعليًا</span>
                <b>{money(report.reconciliation.actualCash)}</b>
              </div>
            )}
            {report.reconciliation.cashDiscrepancy !== undefined && (
              <div className="flex justify-between border-t border-blue-900 pt-2 font-black">
                <span>فرق الصندوق</span>
                <b
                  className={
                    Math.abs(report.reconciliation.cashDiscrepancy) < 0.001
                      ? 'text-emerald-300'
                      : 'text-amber-300'
                  }
                >
                  {money(report.reconciliation.cashDiscrepancy)}
                </b>
              </div>
            )}
            {report.shift.discrepancyReason && (
              <p className="rounded-lg bg-slate-950/60 p-2 text-[10px] text-amber-200">
                سبب الفرق: {report.shift.discrepancyReason}
              </p>
            )}
          </section>

          <section className="grid grid-cols-2 gap-2">
            <div className="space-y-2 rounded-2xl border border-cyan-900/60 bg-cyan-950/20 p-3">
              <h4 className="font-black text-cyan-200">CliQ</h4>
              <div className="flex justify-between text-slate-300">
                <span>سندات قبض</span>
                <b>{money(report.collections.cliq)}</b>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>دفعات موردين</span>
                <b>{money(report.outflows.cliqSupplierPayments)}</b>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>مصروفات</span>
                <b>{money(report.outflows.cliqExpenses)}</b>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>مرتجعات</span>
                <b>{money(report.outflows.cliqRefunds)}</b>
              </div>
              <div className="flex justify-between border-t border-cyan-900 pt-2 font-black text-cyan-200">
                <span>صافي CliQ</span>
                <b>{money(report.reconciliation.netCliqMovement)}</b>
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-rose-900/60 bg-rose-950/20 p-3">
              <h4 className="font-black text-rose-200">المدفوعات الخارجة</h4>
              <div className="flex justify-between text-slate-300">
                <span>دفعات الموردين ({report.outflows.supplierPaymentCount})</span>
                <b>
                  {money(
                    report.outflows.cashSupplierPayments +
                      report.outflows.cliqSupplierPayments
                  )}
                </b>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>المصروفات ({report.outflows.expenseCount})</span>
                <b>
                  {money(
                    report.outflows.cashExpenses + report.outflows.cliqExpenses
                  )}
                </b>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>المرتجعات ({report.outflows.returnCount})</span>
                <b>
                  {money(
                    report.outflows.cashRefunds + report.outflows.cliqRefunds
                  )}
                </b>
              </div>
            </div>
          </section>

          {report.expenseBreakdown.length > 0 && (
            <section className="rounded-2xl border border-slate-700 p-3">
              <h4 className="mb-2 font-black text-slate-200">تفصيل المصروفات حسب الفئة</h4>
              <div className="space-y-2">
                {report.expenseBreakdown.map((item) => (
                  <div
                    key={item.category}
                    className="flex items-center justify-between rounded-lg bg-slate-950/60 p-2 text-slate-300"
                  >
                    <span>{item.category} ({item.count})</span>
                    <b>{money(item.amount)}</b>
                  </div>
                ))}
              </div>
            </section>
          )}

          {report.returnBreakdown.length > 0 && (
            <section className="rounded-2xl border border-orange-900/70 bg-orange-950/20 p-3">
              <h4 className="mb-2 flex items-center gap-2 font-black text-orange-200">
                <RotateCcw className="h-4 w-4" />
                تفصيل المرتجعات
              </h4>
              <div className="space-y-2">
                {report.returnBreakdown.map((item) => (
                  <div
                    key={`${item.refundMethod}-${item.stockDisposition}`}
                    className="flex items-center justify-between rounded-lg bg-slate-950/60 p-2 text-slate-300"
                  >
                    <span>
                      {item.refundMethod === 'cliq' ? 'CliQ' : 'كاش'} •{' '}
                      {item.stockDisposition === 'restock'
                        ? 'عادت للمخزون'
                        : 'تالفة'}{' '}
                      ({item.count})
                    </span>
                    <b>{money(item.amount)}</b>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="flex items-center gap-2 rounded-xl bg-slate-950/70 p-3 text-[10px] text-slate-500">
            <PackageCheck className="h-4 w-4 shrink-0 text-emerald-400" />
            جميع الأرقام محسوبة داخل PostgreSQL من المبيعات وسندات القبض ودفعات الموردين والمصروفات والمرتجعات المرتبطة بهذه الوردية.
          </div>

          <button
            type="button"
            onClick={handlePrint}
            className="shift-report-actions flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3 font-black text-white shadow-lg hover:bg-blue-500"
          >
            <Printer className="h-4 w-4" />
            طباعة أو حفظ التقرير PDF
          </button>
        </div>
      ) : null}
    </Modal>
  );
};

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
import {UiButton, MoneyText} from '../../components/ui';
import type { ShiftClosingReport } from '../../types';

interface ShiftClosingReportModalProps {
  isOpen: boolean;
  report: ShiftClosingReport | null;
  isLoading: boolean;
  error?: string;
  onClose: () => void;
  onRetry: () => void;
}

const money = (value: number) => <MoneyText amount={value} currency/>;

const Metric: React.FC<{
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'success' | 'danger' | 'info';
}> = ({ label, value, tone = 'default' }) => {
  const toneClass = {
    default: 'text-nw-text',
    success: 'text-nw-ok',
    danger: 'text-nw-bad',
    info: 'text-nw-info',
  }[tone];

  return (
    <div className="min-w-0 rounded-xl border border-nw-border bg-nw-surface-2 p-3">
      <span className="block text-[10px] font-bold text-nw-muted">{label}</span>
      <strong className={`mt-1 block break-words text-sm ${toneClass}`}>{value}</strong>
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
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-nw-muted">
          <Loader2 className="h-8 w-8 animate-spin text-nw-info" />
          <span className="text-xs font-bold">جاري احتساب التقرير من قاعدة البيانات...</span>
        </div>
      ) : error ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
          <TriangleAlert className="h-9 w-9 text-nw-bad" />
          <p className="max-w-sm text-xs leading-6 text-nw-text">{error}</p>
          <UiButton
            type="button"
            onClick={onRetry}
            className="flex items-center gap-2 rounded-xl bg-nw-info-bg px-4 py-2 text-xs font-black text-nw-text"
          >
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </UiButton>
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

          <section className="rounded-2xl border border-nw-border bg-nw-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-nw-info">
                  <FileText className="h-5 w-5" />
                  <strong className="text-sm">{report.shift.shiftNumber}</strong>
                </div>
                <p className="mt-1 text-[10px] text-nw-muted">
                  الموظف: {report.shift.cashierName}
                </p>
              </div>
              <div className="text-left text-[10px] leading-5 text-nw-muted">
                <span className="block">
                  الفتح: {new Date(report.shift.startTime).toLocaleString('ar-JO-u-nu-latn')}
                </span>
                <span className="block">
                  {report.shift.endTime
                    ? `الإغلاق: ${new Date(report.shift.endTime).toLocaleString('ar-JO-u-nu-latn')}`
                    : 'الوردية ما زالت مفتوحة'}
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-nw-surface-2 p-2.5">
              {report.shift.status === 'open' ? (
                <RefreshCw className="h-4 w-4 text-nw-info" />
              ) : report.reconciliation.isBalanced ? (
                <CheckCircle2 className="h-4 w-4 text-nw-ok" />
              ) : (
                <TriangleAlert className="h-4 w-4 text-nw-warn" />
              )}
              <span className="font-bold text-nw-text">
                {report.shift.status === 'open'
                  ? 'تقرير حي — الأرقام تتحدث حتى هذه اللحظة'
                  : report.snapshotStatus === 'immutable'
                    ? 'لقطة الإغلاق محفوظة وثابتة للتدقيق والطباعة'
                    : report.snapshotStatus === 'legacy_recalculated'
                      ? 'تقرير تاريخي محسوب — لا توجد لقطة إغلاق محفوظة لهذه الوردية'
                  : report.reconciliation.isBalanced
                    ? 'الوردية مغلقة والصندوق مطابق'
                    : 'الوردية مغلقة ويوجد فرق صندوق موثق'}
              </span>
            </div>
          </section>

          <section>
            <h4 className="mb-2 flex items-center gap-2 font-black text-nw-text">
              <ShoppingCart className="h-4 w-4 text-nw-ok" />
              ملخص المبيعات
            </h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="إجمالي المبيعات" value={money(report.sales.grossSales)} />
              <Metric
                label={report.sales.returnEntitlement !== undefined ? 'المرتجعات' : 'المبالغ المرتجعة'}
                value={money(report.sales.returnEntitlement ?? report.sales.refunds)}
                tone="danger"
              />
              <Metric
                label="صافي المبيعات"
                value={money(report.sales.netSales)}
                tone="success"
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="الطلبات" value={`${report.sales.orderCount}`} />
              <Metric label="بيع مباشر" value={`${report.sales.posOrderCount}`} />
              <Metric label="طلبات الموقع" value={`${report.sales.websiteOrderCount}`} />
              <Metric label="الطرود المباعة" value={`${report.sales.packageCount}`} />
            </div>
            <p className="mt-2 text-[10px] text-nw-muted">
              عدد الأصناف المختلفة المباعة: {report.sales.uniqueProductCount}
            </p>
          </section>

          {report.sales.returnEntitlement !== undefined && (
            <section className="space-y-2 rounded-xl border border-nw-border bg-nw-warn-bg p-3">
              <h4 className="font-black text-nw-warn">توزيع استحقاق المرتجعات</h4>
              <div className="flex justify-between text-nw-text"><span>مبالغ مرجعة</span><b>{money(report.sales.refunds)}</b></div>
              <div className="flex justify-between text-nw-text"><span>تخفيض دين</span><b>{money(report.sales.debtReduction ?? 0)}</b></div>
              <p className="text-[10px] text-nw-muted">المرتجعات = المبالغ المرجعة + تخفيض الدين. تخفيض الدين يقلّل صافي المبيعات، ولا يخرج مصاري من الصندوق.</p>
            </section>
          )}

          {report.salesDetailStatus === 'unavailable' && <p role="status" className="text-xs text-nw-warn">تفصيل غير متاح؛ أرقام الصندوق والإغلاق محفوظة، ولا يُفترض توزيع مبيعات غير مثبت.</p>}

          <section className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-nw-border bg-nw-ok-bg p-3">
              <Banknote className="mb-1 h-4 w-4 text-nw-ok" />
              <span className="block text-[10px] text-nw-muted">مبيعات كاش</span>
              <b className="text-nw-ok">{money(report.shift.totalCashSales)}</b>
            </div>
            <div className="rounded-xl border border-nw-border bg-nw-info-bg p-3">
              <Smartphone className="mb-1 h-4 w-4 text-nw-info" />
              <span className="block text-[10px] text-nw-muted">مبيعات CliQ</span>
              <b className="text-nw-info">{money(report.shift.totalCliqSales)}</b>
            </div>
            {(report.sales.salesDefinitionVersion === 133 || report.shift.totalCardSales !== 0) && <div className="rounded-xl border border-nw-border bg-nw-info-bg p-3">
              <WalletCards className="mb-1 h-4 w-4 text-nw-info" />
              <span className="block text-[10px] text-nw-muted">
                {report.sales.salesDefinitionVersion === 133 ? 'آجل متبقي' : 'مبيعات بطاقة'}
              </span>
              <b className="text-nw-info">{money(report.sales.creditSales ?? report.shift.totalCardSales)}</b>
            </div>}
          </section>

          {report.sales.salesDefinitionVersion === 133 && report.shift.totalCardSales !== 0 && <p className="text-xs text-nw-info">مبيعات بطاقة (تاريخية): {money(report.shift.totalCardSales)}</p>}

          {report.sales.salesDefinitionVersion === 133 && (
            <section className="space-y-2 rounded-xl border border-nw-border bg-nw-info-bg p-3">
              <div className="flex justify-between text-nw-info">
                <span>دفعات أولى عند الاستلام (مسجلة ضمن سندات القبض)</span>
                <b>{money(report.sales.initialReceiptPayments ?? 0)}</b>
              </div>
              <p className="text-[10px] text-nw-text">
                كاش: {money(report.sales.initialReceiptCash ?? 0)} · CliQ: {money(report.sales.initialReceiptCliq ?? 0)}
              </p>
              <p className="text-[10px] text-nw-muted">
                الآجل هو غير المحصّل لحظة البيع، قبل السندات اللاحقة والمرتجعات. الدفعات الأولى ضمن السندات ولا تُضاف مرة أخرى إلى إجمالي الداخل.
              </p>
            </section>
          )}

          <section className="space-y-2 rounded-xl border border-nw-border bg-nw-surface-2 p-3">
            <h4 className="font-black text-nw-text">سندات القبض ({report.collections.count})</h4>
            <p className="text-nw-text">كاش: {money(report.collections.cash)} · CliQ: {money(report.collections.cliq)}</p>
            {report.collections.initialPayments !== undefined && (
              <p className="text-[10px] text-nw-muted">
                منها {money(report.collections.initialPayments)} دفعات أولى عند البيع
                {' '} (كاش: {money(report.collections.initialCash ?? 0)} · CliQ: {money(report.collections.initialCliq ?? 0)})
              </p>
            )}
          </section>

          <section className="space-y-2 rounded-2xl border border-nw-border bg-nw-surface-2 p-3">
            <h4 className="font-black text-nw-text">الحركة المالية خلال الوردية</h4>
            <div className="flex justify-between text-nw-ok">
              <span>إجمالي الداخل</span>
              <b>{money(report.reconciliation.totalInflows)}</b>
            </div>
            <div className="flex justify-between text-nw-bad">
              <span>إجمالي الخارج</span>
              <b>{money(report.reconciliation.totalOutflows)}</b>
            </div>
            <div className="flex justify-between border-t border-nw-border pt-2 font-black text-nw-text">
              <span>صافي الحركة</span>
              <b>{money(report.reconciliation.netMovement)}</b>
            </div>
          </section>

          <section className="space-y-2 rounded-2xl border border-nw-border bg-nw-info-bg p-3">
            <h4 className="flex items-center gap-2 font-black text-nw-info">
              <Banknote className="h-4 w-4" />
              مطابقة درج الكاش
            </h4>
            <div className="flex justify-between text-nw-text">
              <span>العهدة الافتتاحية</span>
              <b>{money(report.reconciliation.openingCash)}</b>
            </div>
            <div className="flex justify-between text-nw-info">
              <span>الكاش المتوقع</span>
              <b>{money(report.reconciliation.expectedCash)}</b>
            </div>
            {report.reconciliation.actualCash !== undefined && (
              <div className="flex justify-between text-nw-text">
                <span>الكاش المعدود فعليًا</span>
                <b>{money(report.reconciliation.actualCash)}</b>
              </div>
            )}
            {report.reconciliation.cashDiscrepancy !== undefined && (
              <div className="flex justify-between border-t border-nw-border pt-2 font-black">
                <span>فرق الصندوق</span>
                <b
                  className={
                    Math.abs(report.reconciliation.cashDiscrepancy) < 0.001
                      ? 'text-nw-ok'
                      : 'text-nw-warn'
                  }
                >
                  {money(report.reconciliation.cashDiscrepancy)}
                </b>
              </div>
            )}
            {report.shift.discrepancyReason && (
              <p className="rounded-lg bg-nw-surface-2 p-2 text-[10px] text-nw-warn">
                سبب الفرق: {report.shift.discrepancyReason}
              </p>
            )}
          </section>

          <section className="grid grid-cols-2 gap-2">
            <div className="space-y-2 rounded-2xl border border-nw-border bg-nw-info-bg p-3">
              <h4 className="font-black text-nw-info">CliQ</h4>
              <div className="flex justify-between text-nw-text">
                <span>سندات قبض</span>
                <b>{money(report.collections.cliq)}</b>
              </div>
              <div className="flex justify-between text-nw-text">
                <span>دفعات موردين</span>
                <b>{money(report.outflows.cliqSupplierPayments)}</b>
              </div>
              <div className="flex justify-between text-nw-text">
                <span>مصروفات</span>
                <b>{money(report.outflows.cliqExpenses)}</b>
              </div>
              <div className="flex justify-between text-nw-text">
                <span>مرتجعات</span>
                <b>{money(report.outflows.cliqRefunds)}</b>
              </div>
              <div className="flex justify-between border-t border-nw-border pt-2 font-black text-nw-info">
                <span>صافي CliQ</span>
                <b>{money(report.reconciliation.netCliqMovement)}</b>
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-nw-border bg-nw-bad-bg p-3">
              <h4 className="font-black text-nw-bad">المدفوعات الخارجة</h4>
              <div className="flex justify-between text-nw-text">
                <span>دفعات الموردين ({report.outflows.supplierPaymentCount})</span>
                <b>
                  {money(
                    report.outflows.cashSupplierPayments +
                      report.outflows.cliqSupplierPayments
                  )}
                </b>
              </div>
              <div className="flex justify-between text-nw-text">
                <span>المصروفات ({report.outflows.expenseCount})</span>
                <b>
                  {money(
                    report.outflows.cashExpenses + report.outflows.cliqExpenses
                  )}
                </b>
              </div>
              <div className="flex justify-between text-nw-text">
                <span>{report.sales.returnEntitlement !== undefined ? 'المبالغ المرجعة' : 'المرتجعات'} ({report.outflows.returnCount})</span>
                <b>
                  {money(
                    report.outflows.cashRefunds + report.outflows.cliqRefunds
                  )}
                </b>
              </div>
            </div>
          </section>

          {report.expenseBreakdown.length > 0 && (
            <section className="rounded-2xl border border-nw-border p-3">
              <h4 className="mb-2 font-black text-nw-text">تفصيل المصروفات حسب الفئة</h4>
              <div className="space-y-2">
                {report.expenseBreakdown.map((item) => (
                  <div
                    key={item.category}
                    className="flex items-center justify-between rounded-lg bg-nw-surface-2 p-2 text-nw-text"
                  >
                    <span>{item.category} ({item.count})</span>
                    <b>{money(item.amount)}</b>
                  </div>
                ))}
              </div>
            </section>
          )}

          {report.returnBreakdown.length > 0 && (
            <section className="rounded-2xl border border-nw-border bg-nw-warn-bg p-3">
              <h4 className="mb-2 flex items-center gap-2 font-black text-nw-warn">
                <RotateCcw className="h-4 w-4" />
                تفصيل المرتجعات
              </h4>
              {report.returnQuantityBreakdown === undefined && (
                <p className="text-[10px] text-nw-muted">تفصيل تاريخي على مستوى المرتجع؛ لا تتوفر كميات مكوّناته في لقطة الإغلاق.</p>
              )}
              <div className="space-y-2">
                {report.returnBreakdown.map((item) => (
                  <div
                    key={`${item.refundMethod}-${item.stockDisposition}`}
                    className="flex items-center justify-between rounded-lg bg-nw-surface-2 p-2 text-nw-text"
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

          {report.returnQuantityBreakdown !== undefined && report.returnQuantityBreakdown.length > 0 && (
            <section className="space-y-2 rounded-2xl border border-nw-border bg-nw-warn-bg p-3">
              <h4 className="font-black text-nw-warn">تفصيل كميات المرتجعات</h4>
              <p className="text-[10px] text-nw-muted">المبلغ المسترد محسوب لكل مرتجع في التفصيل أعلاه، ولا يوزّع على أصنافه أو أسباب التلف.</p>
              {report.returnQuantityBreakdown.map((item, index) => (
                <div key={`${item.eventId}-${item.productId}-${index}`} className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">
                  <b>{item.productName}</b>
                  <p>قابل للبيع: {item.sellableQuantity} · عيب/غير قابل للبيع: {item.defectQuantity} · ضرر عميل: {item.customerDamageQuantity}</p>
                </div>
              ))}
            </section>
          )}

          <div className="flex items-center gap-2 rounded-xl bg-nw-surface-2 p-3 text-[10px] text-nw-muted">
            <PackageCheck className="h-4 w-4 shrink-0 text-nw-ok" />
            جميع الأرقام محسوبة داخل PostgreSQL من المبيعات وسندات القبض ودفعات الموردين والمصروفات والمرتجعات المرتبطة بهذه الوردية.
          </div>

          <UiButton
            type="button"
            onClick={handlePrint}
            className="shift-report-actions flex w-full items-center justify-center gap-2 rounded-2xl bg-nw-info-bg py-3 font-black text-nw-text shadow-lg hover:bg-nw-info-bg"
          >
            <Printer className="h-4 w-4" />
            طباعة أو حفظ التقرير PDF
          </UiButton>
        </div>
      ) : null}
    </Modal>
  );
};

/**
 * Nawasrah Business Manager - RPC-backed shift and cash reconciliation.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import {
  shallowEqual,
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import {Card, PageHeader, SectionHeader, DetailLayout, MainColumn, StickyActionBar, StatusBadge, MoneyText, UiButton, ResponsiveActionPanel, CashDenominationCounter, formatUiDate, formatUiTime, TableShell, Th, Tr, Td} from '../../components/ui';
import {
  fetchCashShiftClosingReportFromSupabase,
  previewCashShiftFullReversalFromSupabase,
  type CashShiftFullReversalPreview,
} from '../../services/supabase/expenses-shifts.service';
import type { ShiftClosingReport } from '../../types';
import { ShiftClosingReportModal } from './ShiftClosingReportModal';
import { ShiftArchiveSection } from './ShiftArchiveSection';

const money = (value: number) => <MoneyText amount={value} currency/>;

export const ShiftsView: React.FC = () => {
  const {
    currentShift,
    recentShifts,
    currentUser,
    branches,
    activeBranch,
  } = useAppStoreSelector(
    (state) => ({
      currentShift: state.currentShift,
      recentShifts: state.recentShifts,
      currentUser: state.currentUser,
      branches: state.branches,
      activeBranch: state.activeBranch,
    }),
    shallowEqual
  );
  const {
    openShift,
    closeShift,
    cancelEmptyShift,
    reverseCashShiftWithOperations,
    refreshExpenseShiftCenterFromSupabase,
  } = useAppStoreActions();
  const [showClosePanel, setShowClosePanel] = useState(false);
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
  const [showFullReversalPanel, setShowFullReversalPanel] = useState(false);
  const [fullReversalReason, setFullReversalReason] = useState('');
  const [fullReversalConfirmation, setFullReversalConfirmation] = useState('');
  const [fullReversalPreview, setFullReversalPreview] = useState<CashShiftFullReversalPreview | null>(null);
  const [fullReversalError, setFullReversalError] = useState('');
  const [isFullReversalLoading, setIsFullReversalLoading] = useState(false);
  const [fullReversalReference, setFullReversalReference] = useState('');
  const [fullReversalKey, setFullReversalKey] = useState('');

  useEffect(() => {
    void refreshExpenseShiftCenterFromSupabase().catch(() => undefined);
  }, [refreshExpenseShiftCenterFromSupabase]);

  useEffect(() => {
    if (currentShift) {
      setDiscrepancyReason('');
    }
  }, [currentShift]);

  useEffect(() => {
    setActualCashInput('');
  }, [currentShift?.id]);

  const actualCash = actualCashInput.trim() === '' ? Number.NaN : Number(actualCashInput);
  const hasCountedCash = Number.isFinite(actualCash) && actualCash >= 0;
  const discrepancy = useMemo(
    () =>
      currentShift && hasCountedCash
        ? Number((actualCash - currentShift.expectedCash).toFixed(3))
        : 0,
    [actualCash, currentShift, hasCountedCash]
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
    try {
      const success = await openShift(openingCash);

      if (success) setOpeningCashInput('');

    } finally {
      setIsSubmitting(false);
    }
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
    try {
      const success = await closeShift(actualCash, discrepancyReason);

      if (success && shiftId) {
        await handleOpenReport(shiftId);
      }

    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelEmptyShift = async () => {
    if (cancelReason.trim().length < 2 || isCancelling) return;
    setIsCancelling(true);
    let success;
    try { success = await cancelEmptyShift(cancelReason); } finally { setIsCancelling(false); }
    if (success) {
      setShowCancelPanel(false);
      setCancelReason('');
    }
  };

  const resetFullReversalPanel = () => {
    setShowFullReversalPanel(false);
    setFullReversalReason('');
    setFullReversalConfirmation('');
    setFullReversalPreview(null);
    setFullReversalError('');
    setFullReversalReference('');
    setFullReversalKey('');
  };

  const handlePreviewFullReversal = async () => {
    if (!currentShift || isFullReversalLoading) return;
    setIsFullReversalLoading(true);
    setFullReversalError('');
    setFullReversalReference('');
    try {
      const preview = await previewCashShiftFullReversalFromSupabase(currentShift.id);
      setFullReversalPreview(preview);
      setFullReversalKey(
        globalThis.crypto?.randomUUID?.() ??
          `shift-reversal-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
    } catch (error) {
      setFullReversalError(
        error instanceof Error ? error.message : 'تعذر معاينة عكس الوردية.'
      );
    } finally {
      setIsFullReversalLoading(false);
    }
  };

  const handleExecuteFullReversal = async () => {
    if (
      !currentShift ||
      !fullReversalPreview?.canExecute ||
      fullReversalReason.trim().length < 3 ||
      fullReversalConfirmation.trim() !== 'إلغاء الوردية' ||
      !fullReversalKey ||
      isFullReversalLoading
    ) return;
    setIsFullReversalLoading(true);
    setFullReversalError('');
    const result = await reverseCashShiftWithOperations(
      currentShift.id,
      fullReversalReason,
      fullReversalKey
    );
    setIsFullReversalLoading(false);
    if (result) {
      setFullReversalReference(result.reversalId);
      setFullReversalPreview(null);
    }
  };

  const effectValue = (key: string) => fullReversalPreview?.summary[key] ?? 0;
  const reversalOperationLabel = (operationType: string) => ({
    pos_sale: 'بيع نقطة بيع',
    customer_payment: 'سند قبض عميل',
    supplier_payment: 'دفعة مورد',
    operational_expense: 'مصروف تشغيلي',
    unsupported_sales_return: 'مرتجع مبيعات غير مدعوم',
    phase42_sales_return: 'مرتجع مبيعات مسوّى',
    shift: 'الوردية',
  }[operationType] ?? operationType);
  const isOwner = currentUser.role === 'Owner';

  const closeDisabled = isSubmitting || !Number.isFinite(actualCash) || actualCash < 0 || (needsReason && discrepancyReason.trim().length < 2);
  const started = currentShift ? new Date(currentShift.startTime) : null;
  const elapsedMinutes = started && Number.isFinite(started.getTime()) ? Math.max(0, Math.floor((Date.now()-started.getTime())/60000)) : null;
  const recentHistory = <>
{recentShifts.length>0&&<Card padded={false} className="hidden overflow-hidden md:block">
            <div className="p-4"><SectionHeader title="الورديات السابقة" hint="آخر الورديات المغلقة والملغاة والمعكوسة"/></div>
            <TableShell caption="الورديات السابقة" minWidth={630} head={<><Th>الوردية</Th><Th>الكاشير</Th><Th>الحالة</Th><Th>المتوقع</Th><Th>المعدود</Th><Th>الفرق</Th><Th>التقرير</Th></>}>
              {recentShifts.map(shift=><Tr key={shift.id}>
                <Td><bdi dir="ltr" className="whitespace-nowrap font-semibold">{shift.shiftNumber}</bdi><p className="mt-1 text-xs text-nw-muted">{formatUiDate(shift.endTime||shift.startTime,{hour:'2-digit',minute:'2-digit'})}</p>
                  {shift.cancellationReason&&<p className="text-xs text-nw-bad">{shift.cancellationReason}</p>}{shift.reversalReason&&<p className="text-xs text-nw-warn">{shift.reversalReason}</p>}
                  {shift.cancelledByName&&<p className="text-xs text-nw-muted">أُلغي بواسطة: {shift.cancelledByName}</p>}{shift.reversedByName&&<p className="text-xs text-nw-muted">عُكست بواسطة: {shift.reversedByName}</p>}
                  {shift.reversalId&&<p className="break-all text-xs text-nw-muted">مرجع العكس: {shift.reversalId}</p>}</Td>
                <Td>{shift.cashierName}</Td><Td><StatusBadge tone={shift.status==='closed'?'ok':shift.status==='reversed'?'warn':'bad'}>{shift.status==='closed'?'مغلقة':shift.status==='reversed'?'معكوسة':'ملغاة'}</StatusBadge></Td>
                <Td><MoneyText amount={shift.expectedCash}/></Td><Td>{shift.actualCash===undefined?'غير متاح':<MoneyText amount={shift.actualCash}/>}</Td>
                <Td>{shift.status!=='closed'||shift.cashDiscrepancy===undefined?'غير متاح':<StatusBadge tone={Math.abs(shift.cashDiscrepancy)<0.001?'ok':'warn'}>{Math.abs(shift.cashDiscrepancy)<0.001?'مطابق':shift.cashDiscrepancy<0?'عجز':'زيادة'} <MoneyText amount={Math.abs(shift.cashDiscrepancy)}/></StatusBadge>}</Td>
                <Td>{shift.status==='closed'&&<UiButton aria-label={'تقرير '+shift.shiftNumber} onClick={()=>void handleOpenReport(shift.id)}><FileText className="h-4 w-4"/>التقرير</UiButton>}</Td>
              </Tr>)}
            </TableShell>
          </Card>}
      {recentShifts.length > 0 && (
        <section className="space-y-2 md:hidden">
          <h3 className="text-xs font-black text-nw-text">
            آخر الورديات المغلقة والملغاة والمعكوسة
          </h3>
          {recentShifts.map((shift) => (
            <article
              key={shift.id}
              className="rounded-2xl border border-nw-border bg-nw-surface-2 p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <b className="text-nw-text">{shift.shiftNumber}</b>
                    {shift.status === 'cancelled' && (
                      <span className="rounded-full border border-nw-border bg-nw-bad-bg px-2 py-0.5 text-[9px] font-black text-nw-bad">
                        ملغاة
                      </span>
                    )}
                    {shift.status === 'reversed' && (
                      <span className="rounded-full border border-nw-border bg-nw-warn-bg px-2 py-0.5 text-[9px] font-black text-nw-warn">
                        معكوسة
                      </span>
                    )}
                  </div>
                  <span className="mt-0.5 block text-[10px] text-nw-muted">
                    {shift.endTime ? formatUiDate(shift.endTime, {hour:'2-digit',minute:'2-digit'}) : ''}
                  </span>
                </div>
                {shift.status === 'closed' && (
                  <div className="text-left">
                    <span className="block text-[10px] text-nw-muted">فرق الصندوق</span>
                    <b
                      className={
                        shift.cashDiscrepancy === undefined ? 'text-nw-muted' : Math.abs(shift.cashDiscrepancy) < 0.001
                          ? 'text-nw-ok'
                          : 'text-nw-warn'
                      }
                    >
                      {shift.cashDiscrepancy === undefined ? 'غير متاح' : money(shift.cashDiscrepancy)}
                    </b>
                  </div>
                )}
              </div>
              {shift.status === 'cancelled' ? (
                <div className="mt-3 rounded-xl border border-nw-border bg-nw-bad-bg p-2.5 text-[10px] leading-5 text-nw-muted">
                  <span className="font-bold text-nw-bad">سبب الإلغاء: </span>
                  {shift.cancellationReason || 'غير متاح'}
                  {shift.cancelledByName && (
                    <span className="mt-1 block">أُلغي بواسطة: {shift.cancelledByName}</span>
                  )}
                </div>
              ) : shift.status === 'reversed' ? (
                <div className="mt-3 rounded-xl border border-nw-border bg-nw-warn-bg p-2.5 text-[10px] leading-5 text-nw-muted">
                  <span className="font-bold text-nw-warn">سبب العكس: </span>
                  {shift.reversalReason || 'غير متاح'}
                  {shift.reversedByName && (
                    <span className="mt-1 block">عُكست بواسطة: {shift.reversedByName}</span>
                  )}
                  {shift.reversalId && (
                    <span className="mt-1 block">مرجع العكس: {shift.reversalId}</span>
                  )}
                </div>
              ) : (
                <UiButton
                  type="button"
                  onClick={() => void handleOpenReport(shift.id)}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-nw-border bg-nw-surface-2 py-2 text-[11px] font-black text-nw-info transition hover:border-nw-border"
                >
                  <FileText className="h-3.5 w-3.5" />
                  عرض تقرير الإغلاق الكامل
                </UiButton>
              )}
            </article>
          ))}
        </section>
      )}
  </>;
  return (
    <div data-testid="cash-workbench" className="text-nw-text">
      <PageHeader title="الصندوق والورديات" description="كل حركة نقدية مرتبطة بوردية؛ طابق العدّ الفعلي قبل الإغلاق"
        actions={<UiButton disabled={isRefreshing} onClick={() => void handleRefresh()} aria-label="تحديث حسابات الوردية"><RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}/>تحديث</UiButton>}/>
      <div className="space-y-5 p-4 pb-36 sm:p-6">
      {currentShift ? <DetailLayout>
        <MainColumn>
          <Card padded={false} className="overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-4 bg-nw-hero p-5 text-nw-side-text [&_bdi_.text-nw-muted]:text-nw-side-muted">
              <div className="min-w-0 space-y-2">
                <h2 className="m-0 flex flex-wrap items-center gap-2 text-lg font-bold">الوردية الحالية · {currentShift.cashierName}<StatusBadge tone="ok">مفتوحة</StatusBadge></h2>
                <p className="m-0 text-xs text-nw-side-muted"><bdi dir="ltr">{currentShift.shiftNumber}</bdi> · بدأت <bdi dir="auto" data-testid="cash-start-time">{formatUiTime(currentShift.startTime)}</bdi></p>
                <p className="m-0 text-xs text-nw-side-muted">المدة: {elapsedMinutes===null?'غير متاح':<span>{Math.floor(elapsedMinutes/60)} ساعة و{elapsedMinutes%60} دقيقة</span>} · عدد العمليات: غير متاح</p>
              </div>
              <div data-testid="cash-expected"><p className="m-0 mb-1 text-xs text-nw-side-muted">النقد المتوقع بالدرج</p><strong className="text-4xl"><MoneyText amount={currentShift.expectedCash} currency/></strong></div>
            </header>
            <div className="p-4">
              <SectionHeader title="حركة الدرج"/>
              <div className="mt-3 grid gap-0 divide-y divide-nw-border lg:grid-cols-3">
                {[
                  ['رصيد افتتاحي',currentShift.openingCash,'text-nw-text'],
                  ['مبيعات كاش (+)',currentShift.totalCashSales,'text-nw-ok'],
                  ['سندات قبض كاش (+)',currentShift.cashReceipts,'text-nw-ok'],
                  ['مبالغ مرتجعات كاش (−)',currentShift.cashRefunds,'text-nw-bad'],
                  ['مصروفات من الدرج (−)',currentShift.cashExpenses,'text-nw-bad'],
                  ['دفعات الموردين كاش (−)',currentShift.cashSupplierPayments,'text-nw-bad'],
                ].map(([label,value,tone])=><div key={label} className="flex min-w-0 items-center justify-between gap-2 py-3 lg:px-3"><span className="text-xs text-nw-muted">{label}</span><strong className={String(tone)}><MoneyText amount={Number(value)}/></strong></div>)}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-nw-border pt-3 text-sm font-bold"><span>المتوقع</span><MoneyText amount={currentShift.expectedCash}/></div>
            </div>
            <div className="space-y-3 border-t border-nw-border bg-nw-surface-2 p-4">
              <SectionHeader title="خارج الدرج" hint="CliQ للحساب البنكي؛ المبيعات الآجلة للذمم"/>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-2"><span className="text-nw-muted">مبيعات CliQ</span><MoneyText amount={currentShift.totalCliqSales}/></div>
                <div className="flex justify-between gap-2"><span className="text-nw-muted">سندات قبض CliQ</span><MoneyText amount={currentShift.cliqReceipts}/></div>
                <div className="flex justify-between gap-2"><span className="text-nw-muted">دفعات الموردين CliQ</span><MoneyText amount={currentShift.cliqSupplierPayments}/></div>
                <div className="flex justify-between gap-2"><span className="text-nw-muted">مصروفات CliQ</span><MoneyText amount={currentShift.cliqExpenses}/></div>
                <div className="flex justify-between gap-2"><span className="text-nw-muted">مبالغ مرتجعات CliQ</span><MoneyText amount={currentShift.cliqRefunds}/></div>
                <div className="flex justify-between gap-2"><span className="text-nw-muted">مبيعات الدين للذمم</span><span>غير متاح</span></div>
                {currentShift.totalCardSales!==0&&<div className="flex justify-between gap-2"><span className="text-nw-muted">مبيعات بطاقة (تاريخية)</span><MoneyText amount={currentShift.totalCardSales}/></div>}
              </div>
            </div>
          </Card>
          <UiButton onClick={() => void handleOpenReport(currentShift.id)}><FileText className="h-4 w-4"/>عرض التقرير المالي الحي</UiButton>
          {recentHistory}
          <div className="space-y-2 border-t border-nw-border pt-3">
            {!showCancelPanel ? (
              <UiButton
                type="button"
                onClick={() => setShowCancelPanel(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-nw-border bg-nw-bad-bg py-2.5 font-bold text-nw-bad transition hover:bg-nw-bad-bg"
              >
                <XCircle className="h-4 w-4" />
                إلغاء وردية فُتحت بالخطأ
              </UiButton>
            ) : (
              <div className="space-y-3 rounded-xl border border-nw-border bg-nw-bad-bg p-3">
                <div className="flex items-start gap-2 text-nw-bad">
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
                  aria-label="سبب إلغاء الوردية" placeholder="اكتب سبب الإلغاء (إجباري)"
                  className="w-full resize-none rounded-lg border border-nw-border bg-nw-surface-2 p-2.5 text-xs text-nw-text placeholder:text-nw-bad focus:border-nw-border focus:outline-none min-h-11"
                />
                <div className="grid grid-cols-2 gap-2">
                  <UiButton
                    type="button"
                    disabled={isCancelling || cancelReason.trim().length < 2}
                    onClick={() => void handleCancelEmptyShift()}
                    className="rounded-lg bg-nw-bad-bg py-2.5 font-black text-nw-text transition hover:bg-nw-bad-bg disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isCancelling ? 'جاري التحقق...' : 'نعم، إلغاء الوردية'}
                  </UiButton>
                  <UiButton
                    type="button"
                    disabled={isCancelling}
                    onClick={() => {
                      setShowCancelPanel(false);
                      setCancelReason('');
                    }}
                    className="rounded-lg border border-nw-border bg-nw-surface-2 py-2.5 font-bold text-nw-text"
                  >
                    تراجع
                  </UiButton>
                </div>
              </div>
            )}
          </div>

          {isOwner && (
            <div className="space-y-2 border-t border-nw-border pt-3">
              {!showFullReversalPanel ? (
                <UiButton
                  type="button"
                  onClick={() => setShowFullReversalPanel(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-nw-border bg-nw-warn-bg py-2.5 font-black text-nw-warn transition hover:bg-nw-warn-bg"
                >
                  <ShieldAlert className="h-4 w-4" />
                  إلغاء الوردية وعكس جميع عملياتها
                </UiButton>
              ) : (
                <div className="space-y-3 rounded-xl border border-nw-border bg-nw-warn-bg p-3">
                  <div className="flex items-start gap-2 text-nw-warn">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <p className="leading-5">
                      عملية مالك النظام فقط وتتطلب MFA. يتم فحص كل عملية أولًا؛ إذا ظهر مانع فلن يُنفذ أي تعديل.
                    </p>
                  </div>
                  {!fullReversalPreview && !fullReversalReference && (
                    <UiButton type="button" disabled={isFullReversalLoading} onClick={() => void handlePreviewFullReversal()} className="w-full rounded-lg bg-nw-warn-bg py-2.5 font-black text-nw-text disabled:opacity-50">
                      {isFullReversalLoading ? 'جاري الفحص...' : 'معاينة العمليات والأثر المالي'}
                    </UiButton>
                  )}
                  {fullReversalError && <p className="rounded-lg border border-nw-border bg-nw-bad-bg p-2 text-[11px] text-nw-bad">{fullReversalError}</p>}
                  {fullReversalPreview && (
                    <>
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">الكاش: {money(effectValue('cash_in_minor_units') / 1000)}</div>
                        <div className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">CliQ: {money(effectValue('cliq_in_minor_units') / 1000)}</div>
                        <div className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">ذمم العملاء: {money(effectValue('customer_balance_in_minor_units') / 1000)}</div>
                        <div className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">ذمم الموردين: {money(effectValue('supplier_balance_in_minor_units') / 1000)}</div>
                        <div className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">المخزون: {effectValue('inventory_base_units_delta')} وحدة أساسية</div>
                        <div className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">المبيعات: {money(effectValue('sales_in_minor_units') / 1000)}</div>
                        <div className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">الخصم: {money(effectValue('discount_in_minor_units') / 1000)}</div>
                        <div className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">تكلفة البضاعة: {money(effectValue('cogs_in_minor_units') / 1000)}</div>
                        <div className="col-span-2 rounded-lg bg-nw-surface-2 p-2 text-nw-text">الربح: {money(effectValue('profit_in_minor_units') / 1000)}</div>
                      </div>
                      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-nw-border bg-nw-surface-2 p-2 text-[10px]">
                        {fullReversalPreview.operations.map((operation) => (
                          <div key={`${operation.operationType}-${operation.originalRecordId}`} className="rounded border border-nw-border p-2">
                            <b className={operation.status === 'SUPPORTED' || operation.status === 'ALREADY_REVERSED' ? 'text-nw-ok' : 'text-nw-bad'}>{operation.status}</b>{' '}
                            <span className="text-nw-text">{reversalOperationLabel(operation.operationType)}</span>
                            <span className="mt-1 block break-all text-nw-muted">المرجع: {operation.originalRecordId}</span>
                            {operation.reason && <span className="mt-1 block text-nw-muted">{operation.reason}</span>}
                          </div>
                        ))}
                      </div>
                      {fullReversalPreview.scopeNote && <p className="text-[10px] leading-5 text-nw-muted">{fullReversalPreview.scopeNote}</p>}
                      {fullReversalPreview.canExecute ? (
                        <>
                          <textarea value={fullReversalReason} onChange={(event) => setFullReversalReason(event.target.value)} maxLength={500} rows={2} aria-label="سبب عكس الوردية" placeholder="سبب عكس الوردية (إجباري)" className="w-full resize-none rounded-lg border border-nw-border bg-nw-surface-2 p-2.5 text-xs text-nw-text placeholder:text-nw-warn focus:outline-none min-h-11" />
                          <input type="text" value={fullReversalConfirmation} onChange={(event) => setFullReversalConfirmation(event.target.value)} aria-label="تأكيد عكس الوردية" placeholder="اكتب: إلغاء الوردية" className="w-full rounded-lg border border-nw-border bg-nw-surface-2 p-2.5 text-xs text-nw-text placeholder:text-nw-warn focus:outline-none min-h-11" />
                          <UiButton type="button" disabled={isFullReversalLoading || fullReversalReason.trim().length < 3 || fullReversalConfirmation.trim() !== 'إلغاء الوردية'} onClick={() => void handleExecuteFullReversal()} className="w-full rounded-lg bg-nw-bad-bg py-2.5 font-black text-nw-text disabled:cursor-not-allowed disabled:opacity-40">
                            {isFullReversalLoading ? 'جاري العكس الذرّي...' : 'تأكيد عكس الوردية بالكامل'}
                          </UiButton>
                        </>
                      ) : <p className="rounded-lg border border-nw-border bg-nw-bad-bg p-2 text-[11px] text-nw-bad">لا يمكن التأكيد: يجب إزالة جميع الموانع أولًا، ولم يُنفذ أي تعديل.</p>}
                    </>
                  )}
                  {fullReversalReference && <p className="rounded-lg border border-nw-border bg-nw-ok-bg p-2 text-[11px] text-nw-ok">تم العكس بنجاح. مرجع العملية: {fullReversalReference}</p>}
                  <UiButton type="button" disabled={isFullReversalLoading} onClick={resetFullReversalPanel} className="w-full rounded-lg border border-nw-border bg-nw-surface-2 py-2 text-xs font-bold text-nw-text">إغلاق</UiButton>
                </div>
              )}
            </div>
          )}
        </MainColumn>
        <ResponsiveActionPanel open={showClosePanel} onClose={()=>setShowClosePanel(false)} busy={isSubmitting} title="إغلاق الوردية" backLabel="رجوع للصندوق"
          footer={<UiButton data-testid="cash-close-submit" variant="accent" size="large" className="w-full" disabled={closeDisabled} onClick={() => void handleClose()}>{isSubmitting?'جاري الإغلاق...':'إغلاق الوردية وطباعة التقرير'}</UiButton>}>
          <p className="text-xs text-nw-muted">عدّ النقد بالدرج وأدخل العدد حسب الفئة، أو أدخل المبلغ مباشرة.</p>
          <CashDenominationCounter disabled={isSubmitting} onApply={setActualCashInput}/>
          <Card className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><span>المعدود</span><strong>{hasCountedCash?<MoneyText amount={actualCash}/>:<span className="text-nw-muted">غير مُدخل</span>}</strong></div>
            <div className="flex justify-between gap-2"><span>المتوقع</span><MoneyText amount={currentShift.expectedCash}/></div>
            {hasCountedCash?<div className="flex justify-between gap-2 border-t border-nw-border pt-2"><span>الفرق</span><StatusBadge tone={needsReason?'warn':'ok'}>{!needsReason?'مطابق':discrepancy<0?'عجز':'زيادة'} <MoneyText amount={Math.abs(discrepancy)}/></StatusBadge></div>:<p className="border-t border-nw-border pt-2 text-nw-muted">أدخل المبلغ المعدود</p>}
          </Card>
          <label className="block space-y-2 text-xs text-nw-muted"><span>الكاش الفعلي بعد عدّ الصندوق</span>
            <input type="number" min="0" step="0.001" value={actualCashInput} onChange={(event) => setActualCashInput(event.target.value)}
              className="h-11 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 text-sm font-bold text-nw-text" /></label>
          {needsReason&&<div className="space-y-2 rounded-xl border border-nw-border bg-nw-warn-bg p-3 text-nw-warn">
            <div className="flex flex-wrap items-center gap-2 text-sm font-bold"><AlertCircle className="h-4 w-4"/>فرق الصندوق: <MoneyText amount={discrepancy}/></div>
            <label className="block space-y-1 text-xs"><span>سبب النقص أو الزيادة (إجباري)</span><input type="text" value={discrepancyReason}
              onChange={(event) => setDiscrepancyReason(event.target.value)} placeholder="اكتب سبب النقص أو الزيادة (إجباري)" required
              className="h-11 w-full rounded-xl border border-nw-border bg-nw-surface px-3 text-sm text-nw-text placeholder:text-nw-muted"/></label>
          </div>}
        </ResponsiveActionPanel>
        <StickyActionBar><UiButton data-testid="cash-count-open" variant="accent" size="large" disabled={isSubmitting} onClick={()=>setShowClosePanel(true)}>عدّ الدرج وإغلاق الوردية</UiButton></StickyActionBar>
      </DetailLayout> : <Card className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-nw-muted"/><SectionHeader title="لا توجد وردية مفتوحة حاليًا" hint="أدخل الكاش الموجود فعليًا في الدرج عند بداية العمل."/>
        <div className="mx-auto max-w-xs space-y-3"><label className="block space-y-2 text-right text-xs text-nw-muted"><span>العهدة الافتتاحية (د.أ)</span>
          <input type="number" min="0" step="0.001" value={openingCashInput} onChange={(event) => setOpeningCashInput(event.target.value)} placeholder="0.000"
            className="h-11 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 text-center font-bold text-nw-text"/></label>
          <UiButton variant="accent" className="w-full" disabled={isSubmitting||openingCashInput===''||!Number.isFinite(Number(openingCashInput))||Number(openingCashInput)<0}
            onClick={() => void handleOpen()}>{isSubmitting?'جاري الفتح...':'فتح وردية جديدة'}</UiButton>
        </div>
      </Card>}
      {!currentShift && recentHistory}
      <ShiftArchiveSection
        branches={branches}
        initialBranchId={activeBranch?.id || ''}
        onOpenReport={(shiftId) => void handleOpenReport(shiftId)}
      />

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
    </div>
  );
};

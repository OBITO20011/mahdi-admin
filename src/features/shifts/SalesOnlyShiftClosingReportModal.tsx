import {Modal} from '../../components/common/Modal';
import {MoneyText,UiButton,formatUiDate,formatUiTime} from '../../components/ui';
import type {SalesOnlyShiftClosingReport} from '../../services/supabase/salesOnlyShiftReport';
import {CashFlowSummary} from './CashFlowSummary';

/** Same drawer/printing components;only fields actually present in the sealed
 * lite document are shown. No invented sales/cost or stock breakdowns. */
export function SalesOnlyShiftClosingReportModal({report,isOpen,onClose,isLoading,error,onRetry}:{report:SalesOnlyShiftClosingReport;isOpen:boolean;onClose:()=>void;isLoading:boolean;error?:string;onRetry:()=>void}){
 return <Modal isOpen={isOpen} onClose={onClose} title="تقرير إغلاق الوردية" subtitle={report.historyWithoutCost?'وردية تشمل مرتجع فاتورة قديمة بلا تكلفة':'مبيعات وذمم — بلا تتبع مخزون أو تكلفة'}>
  {isLoading?<p role="status">جارٍ قراءة تقرير الوردية…</p>:error?<div role="alert"><p>تعذر التحقق من تقرير الوردية؛ أعد قراءته ولا تعتمد أرقاماً ناقصة. (SHIFT-01)</p><UiButton onClick={onRetry}>إعادة قراءة التقرير</UiButton></div>:<div className="space-y-4" data-testid="lite-shift-closing-report">
   {report.historyWithoutCost&&<p role="note" className="rounded-lg border border-nw-border p-3 text-sm">تتضمن الوردية مرتجع فاتورة قبل تفعيل المخزون. حركة الدرج والعدد مثبتان؛ لا يمكن حساب ربح كامل لهذه الوردية.</p>}
   <h3 className="font-bold">{report.shift.shiftNumber}</h3>
   <p className="text-sm text-nw-muted">{report.snapshotStatus==='immutable'?'لقطة إغلاق محفوظة لا تُعاد حساباتها':'قراءة الوردية الحالية'} · {formatUiDate(report.shift.startTime,{year:'numeric',month:'long',day:'numeric'})} {formatUiTime(report.shift.startTime)}</p>
   <CashFlowSummary shift={report.shift} detailsAvailable={false} salesOnly/>
   <dl className="space-y-3 rounded-xl border border-nw-border p-3 text-sm">
    <div className="flex justify-between gap-2"><dt>الفواتير في لقطة الوردية</dt><dd>{report.orderCount}</dd></div>
    {report.historyWithoutCost?<><div className="flex justify-between gap-2"><dt>عدد عمليات المرتجع المالي</dt><dd>{report.returnCount}</dd></div><div className="flex justify-between gap-2"><dt>المبالغ المدفوعة للمرتجعات</dt><dd><MoneyText amount={report.returnMoneyInMinorUnits/1000} currency/></dd></div></>:<div className="flex justify-between gap-2"><dt>استحقاق المرتجعات (مال وتخفيض دين)</dt><dd><MoneyText amount={report.returnEntitlementInMinorUnits/1000} currency/></dd></div>}
    <div className="flex justify-between gap-2"><dt>صافي الحركة قبل سحوبات المالك</dt><dd><MoneyText amount={report.netMovementInMinorUnits/1000} currency/></dd></div>
    <div className="flex justify-between gap-2"><dt>الكاش المعدود</dt><dd>{report.shift.actualCash===undefined?'لم يُعدّ بعد':<MoneyText amount={report.shift.actualCash} currency/>}</dd></div>
    <div className="flex justify-between gap-2"><dt>فرق الدرج</dt><dd>{report.shift.cashDiscrepancy===undefined?'لم يُعدّ بعد':<MoneyText amount={report.shift.cashDiscrepancy} currency/>}</dd></div>
   </dl>
   <p className="text-xs text-nw-muted">تفصيل الأصناف والتكلفة والأرباح غير وارد في هذه اللقطة. مبالغ التحصيل والمرتجع والمصروفات وسحوبات المالك منفصلة في حركة الدرج.</p>
   <UiButton className="shift-report-actions" onClick={()=>window.print()}>طباعة أو حفظ التقرير PDF</UiButton>
  </div>}
 </Modal>;
}

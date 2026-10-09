import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Filter, RefreshCw } from 'lucide-react';
import type { Branch, Shift } from '../../types';
import {
  fetchCashShiftArchivePageFromSupabase,
  type CashShiftArchiveFilters,
} from '../../services/supabase/expenses-shifts.service';

import {Card, SearchField, UiButton, StatusBadge, MoneyText, TableShell, Th, Tr, Td, type UiTone} from '../../components/ui';

const PAGE_SIZE = 25;

const statusLabel: Record<Shift['status'], string> = {
  open: 'مفتوحة',
  closed: 'مغلقة',
  cancelled: 'ملغاة',
  reversed: 'معكوسة',
};

const statusTone: Record<Shift['status'], UiTone> = {open:'info',closed:'ok',cancelled:'bad',reversed:'warn'};

interface ShiftArchiveSectionProps {
  branches: Branch[];
  initialBranchId: string;
  onOpenReport: (shiftId: string) => void;
}

const emptyFilters = (branchId: string): CashShiftArchiveFilters => ({
  branchId,
  cashierId: '',
  status: undefined,
  shiftNumber: '',
  dateFrom: '',
  dateTo: '',
  limit: PAGE_SIZE,
  offset: 0,
});

export const ShiftArchiveSection: React.FC<ShiftArchiveSectionProps> = ({
  branches,
  initialBranchId,
  onOpenReport,
}) => {
  const [draft, setDraft] = useState(() => emptyFilters(initialBranchId));
  const [applied, setApplied] = useState(() => emptyFilters(initialBranchId));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [cashiers, setCashiers] = useState<Array<{ id: string; name: string }>>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadPage = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const page = await fetchCashShiftArchivePageFromSupabase(applied);
      setShifts(page.shifts);
      setCashiers(page.cashiers);
      setTotalCount(page.totalCount);
      setHasMore(page.hasMore);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'تعذر تحميل أرشيف الورديات.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setApplied({ ...draft, offset: 0 });
  };

  const changePage = (offset: number) => {
    if (offset < 0 || isLoading) return;
    setApplied((current) => ({ ...current, offset }));
  };

  const pageNumber = Math.floor(applied.offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <Card className="space-y-3" aria-label="أرشيف الورديات">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-nw-text">أرشيف الورديات</h3>
          <p className="mt-0.5 text-[11px] text-nw-muted">ابحث في كل الورديات السابقة وافتح تقرير الإغلاق نفسه.</p>
        </div>
        <span className="rounded-full bg-nw-surface-2 px-2.5 py-1 text-[10px] font-bold text-nw-text">{totalCount.toLocaleString('ar-JO-u-nu-latn')} وردية</span>
      </div>

      <form onSubmit={applyFilters} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <SearchField label="رقم الوردية" value={draft.shiftNumber || ''} onChange={(event) => setDraft((current) => ({ ...current, shiftNumber: event.target.value }))} placeholder="مثال: SHIFT-1001" />
        <label className="text-[11px] font-bold text-nw-muted">الفرع
          <select aria-label="الفرع" value={draft.branchId || ''} onChange={(event) => setDraft((current) => ({ ...current, branchId: event.target.value, cashierId: '' }))} className="mt-1 min-h-11 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-2 text-sm text-nw-text">
            <option value="">كل الفروع</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-bold text-nw-muted">الكاشير / فاتح الوردية
          <select aria-label="الكاشير / فاتح الوردية" value={draft.cashierId || ''} onChange={(event) => setDraft((current) => ({ ...current, cashierId: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-2 text-sm text-nw-text">
            <option value="">كل المستخدمين</option>
            {cashiers.map((cashier) => <option key={cashier.id} value={cashier.id}>{cashier.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-bold text-nw-muted">الحالة
          <select aria-label="الحالة" value={draft.status || ''} onChange={(event) => setDraft((current) => ({ ...current, status: (event.target.value || undefined) as Shift['status'] | undefined }))} className="mt-1 min-h-11 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-2 text-sm text-nw-text">
            <option value="">كل الحالات</option>
            {(Object.keys(statusLabel) as Shift['status'][]).map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-bold text-nw-muted">من تاريخ
          <input type="date" value={draft.dateFrom || ''} onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-2 text-sm text-nw-text" />
        </label>
        <label className="text-[11px] font-bold text-nw-muted">إلى تاريخ
          <input type="date" value={draft.dateTo || ''} onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-2 text-sm text-nw-text" />
        </label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
          <UiButton type="submit" className="min-h-11 flex-1 rounded-xl bg-nw-info-bg px-3 text-sm font-black text-nw-text hover:bg-nw-info-bg"><Filter className="ml-1 inline h-4 w-4" />تطبيق الفلاتر</UiButton>
          <UiButton type="button" onClick={() => { const next = emptyFilters(initialBranchId); setDraft(next); setApplied(next); }} className="min-h-11 rounded-xl border border-nw-border bg-nw-surface-2 px-3 text-xs font-bold text-nw-text">إعادة ضبط</UiButton>
          <UiButton type="button" onClick={() => void loadPage()} disabled={isLoading} aria-label="تحديث أرشيف الورديات" className="min-h-11 min-w-11 rounded-xl border border-nw-border bg-nw-surface-2 text-nw-text disabled:opacity-50"><RefreshCw className={`mx-auto h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /></UiButton>
        </div>
      </form>

      {error ? <div className="rounded-xl border border-nw-border bg-nw-bad-bg p-3 text-xs text-nw-bad"><p>{error}</p><UiButton type="button" onClick={() => void loadPage()} className="mt-2 rounded-lg border border-nw-border px-3 py-2 font-bold">إعادة المحاولة</UiButton></div> : null}
      {isLoading ? <div className="rounded-xl border border-nw-border bg-nw-surface-2 p-5 text-center text-xs text-nw-muted">جارٍ تحميل أرشيف الورديات…</div> : null}
      {!isLoading && !error && shifts.length === 0 ? <div className="rounded-xl border border-dashed border-nw-border p-6 text-center text-xs text-nw-muted">لا توجد ورديات تطابق الفلاتر المحددة.</div> : null}

      {!isLoading && !error && shifts.length > 0 ? <div className="space-y-2 md:hidden">
        {shifts.map((shift) => <article key={shift.id} className="rounded-xl border border-nw-border bg-nw-surface-2 p-3 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><div className="flex items-center gap-2"><b className="text-sm text-nw-text">{shift.shiftNumber}</b><StatusBadge tone={statusTone[shift.status]}>{statusLabel[shift.status]}</StatusBadge></div><p className="mt-1 text-nw-muted">{shift.cashierName} • {new Date(shift.startTime).toLocaleString('ar-JO-u-nu-latn')}</p>{shift.endTime ? <p className="mt-0.5 text-nw-muted">الإغلاق: {new Date(shift.endTime).toLocaleString('ar-JO-u-nu-latn')}</p> : null}</div>
            <UiButton type="button" onClick={() => onOpenReport(shift.id)} className="min-h-11 rounded-xl border border-nw-border bg-nw-info-bg px-3 text-[11px] font-black text-nw-info hover:bg-nw-info-bg"><FileText className="ml-1 inline h-4 w-4" />عرض التقرير</UiButton>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4"><span className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">المتوقع: <b>{shift.expectedCash.toFixed(3)}</b></span><span className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">الفعلي: <b>{shift.actualCash === undefined ? '—' : shift.actualCash.toFixed(3)}</b></span><span className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">Cash: <b>{shift.totalCashSales.toFixed(3)}</b></span><span className="rounded-lg bg-nw-surface-2 p-2 text-nw-text">CliQ: <b>{shift.totalCliqSales.toFixed(3)}</b></span></div>
        </article>)}
      </div> : null}

      {!isLoading && !error && shifts.length > 0 && <div className="hidden md:block"><TableShell caption="أرشيف الورديات" minWidth={760} head={<><Th>الوردية</Th><Th>الكاشير</Th><Th>الحالة</Th><Th>المتوقع</Th><Th>المعدود</Th><Th>الفرق</Th><Th>التقرير</Th></>}>
        {shifts.map(shift=><Tr key={shift.id}>
          <Td><bdi dir="ltr" className="whitespace-nowrap font-semibold">{shift.shiftNumber}</bdi><p className="mt-1 text-xs text-nw-muted">{new Date(shift.startTime).toLocaleString('ar-JO-u-nu-latn')}</p>
            {shift.cancellationReason&&<p className="text-xs text-nw-bad">{shift.cancellationReason}</p>}{shift.reversalReason&&<p className="text-xs text-nw-warn">{shift.reversalReason}</p>}</Td>
          <Td>{shift.cashierName}</Td><Td><StatusBadge tone={statusTone[shift.status]}>{statusLabel[shift.status]}</StatusBadge></Td>
          <Td><MoneyText amount={shift.expectedCash}/></Td><Td>{shift.actualCash===undefined?'غير متاح':<MoneyText amount={shift.actualCash}/>}</Td>
          <Td>{shift.cashDiscrepancy===undefined?'غير متاح':<StatusBadge tone={Math.abs(shift.cashDiscrepancy)<0.001?'ok':'warn'}>{Math.abs(shift.cashDiscrepancy)<0.001?'مطابق':shift.cashDiscrepancy<0?'عجز':'زيادة'} <MoneyText amount={Math.abs(shift.cashDiscrepancy)}/></StatusBadge>}</Td>
          <Td><UiButton onClick={() => onOpenReport(shift.id)} aria-label={'عرض التقرير: '+shift.shiftNumber}><FileText className="h-4 w-4"/>التقرير</UiButton></Td>
        </Tr>)}
      </TableShell></div>}
      <div className="flex items-center justify-between gap-2 border-t border-nw-border pt-3 text-xs text-nw-muted">
        <UiButton type="button" disabled={applied.offset === 0 || isLoading} onClick={() => changePage(Math.max(0, applied.offset - PAGE_SIZE))} className="min-h-11 rounded-xl border border-nw-border px-3 font-bold disabled:opacity-40">السابق</UiButton>
        <span>صفحة {pageNumber.toLocaleString('ar-JO-u-nu-latn')} من {pageCount.toLocaleString('ar-JO-u-nu-latn')}</span>
        <UiButton type="button" disabled={!hasMore || isLoading} onClick={() => changePage(applied.offset + PAGE_SIZE)} className="min-h-11 rounded-xl border border-nw-border px-3 font-bold disabled:opacity-40">التالي</UiButton>
      </div>
    </Card>
  );
};

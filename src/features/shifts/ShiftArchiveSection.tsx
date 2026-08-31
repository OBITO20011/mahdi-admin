import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Filter, RefreshCw, Search } from 'lucide-react';
import type { Branch, Shift } from '../../types';
import {
  fetchCashShiftArchivePageFromSupabase,
  type CashShiftArchiveFilters,
} from '../../services/supabase/expenses-shifts.service';

const PAGE_SIZE = 25;

const statusLabel: Record<Shift['status'], string> = {
  open: 'مفتوحة',
  closed: 'مغلقة',
  cancelled: 'ملغاة',
  reversed: 'معكوسة',
};

const statusTone: Record<Shift['status'], string> = {
  open: 'border-blue-800 bg-blue-950/40 text-blue-200',
  closed: 'border-emerald-800 bg-emerald-950/40 text-emerald-200',
  cancelled: 'border-rose-800 bg-rose-950/40 text-rose-200',
  reversed: 'border-amber-800 bg-amber-950/40 text-amber-200',
};

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
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3 sm:p-4" aria-label="أرشيف الورديات">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-100">أرشيف الورديات</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">ابحث في كل الورديات السابقة وافتح تقرير الإغلاق نفسه.</p>
        </div>
        <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-300">{totalCount.toLocaleString('ar-JO')} وردية</span>
      </div>

      <form onSubmit={applyFilters} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-[11px] font-bold text-slate-400">رقم الوردية
          <div className="relative mt-1"><Search className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-slate-500" />
            <input value={draft.shiftNumber || ''} onChange={(event) => setDraft((current) => ({ ...current, shiftNumber: event.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pr-8 pl-2 text-sm text-white" placeholder="مثال: SHIFT-1001" />
          </div>
        </label>
        <label className="text-[11px] font-bold text-slate-400">الفرع
          <select value={draft.branchId || ''} onChange={(event) => setDraft((current) => ({ ...current, branchId: event.target.value, cashierId: '' }))} className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-2 text-sm text-white">
            <option value="">كل الفروع</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-bold text-slate-400">الكاشير / فاتح الوردية
          <select value={draft.cashierId || ''} onChange={(event) => setDraft((current) => ({ ...current, cashierId: event.target.value }))} className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-2 text-sm text-white">
            <option value="">كل المستخدمين</option>
            {cashiers.map((cashier) => <option key={cashier.id} value={cashier.id}>{cashier.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-bold text-slate-400">الحالة
          <select value={draft.status || ''} onChange={(event) => setDraft((current) => ({ ...current, status: (event.target.value || undefined) as Shift['status'] | undefined }))} className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-2 text-sm text-white">
            <option value="">كل الحالات</option>
            {(Object.keys(statusLabel) as Shift['status'][]).map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-bold text-slate-400">من تاريخ
          <input type="date" value={draft.dateFrom || ''} onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))} className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-2 text-sm text-white" />
        </label>
        <label className="text-[11px] font-bold text-slate-400">إلى تاريخ
          <input type="date" value={draft.dateTo || ''} onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))} className="mt-1 min-h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-2 text-sm text-white" />
        </label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
          <button type="submit" className="min-h-11 flex-1 rounded-xl bg-blue-600 px-3 text-sm font-black text-white hover:bg-blue-500"><Filter className="ml-1 inline h-4 w-4" />تطبيق الفلاتر</button>
          <button type="button" onClick={() => { const next = emptyFilters(initialBranchId); setDraft(next); setApplied(next); }} className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-bold text-slate-300">إعادة ضبط</button>
          <button type="button" onClick={() => void loadPage()} disabled={isLoading} aria-label="تحديث أرشيف الورديات" className="min-h-11 min-w-11 rounded-xl border border-slate-700 bg-slate-950 text-slate-300 disabled:opacity-50"><RefreshCw className={`mx-auto h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /></button>
        </div>
      </form>

      {error ? <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-200"><p>{error}</p><button type="button" onClick={() => void loadPage()} className="mt-2 rounded-lg border border-rose-700 px-3 py-2 font-bold">إعادة المحاولة</button></div> : null}
      {isLoading ? <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5 text-center text-xs text-slate-400">جارٍ تحميل أرشيف الورديات…</div> : null}
      {!isLoading && !error && shifts.length === 0 ? <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-xs text-slate-400">لا توجد ورديات تطابق الفلاتر المحددة.</div> : null}

      {!isLoading && !error && shifts.length > 0 ? <div className="space-y-2">
        {shifts.map((shift) => <article key={shift.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><div className="flex items-center gap-2"><b className="text-sm text-white">{shift.shiftNumber}</b><span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${statusTone[shift.status]}`}>{statusLabel[shift.status]}</span></div><p className="mt-1 text-slate-400">{shift.cashierName} • {new Date(shift.startTime).toLocaleString('ar-JO')}</p>{shift.endTime ? <p className="mt-0.5 text-slate-500">الإغلاق: {new Date(shift.endTime).toLocaleString('ar-JO')}</p> : null}</div>
            <button type="button" onClick={() => onOpenReport(shift.id)} className="min-h-11 rounded-xl border border-blue-800 bg-blue-950/40 px-3 text-[11px] font-black text-blue-200 hover:bg-blue-900/50"><FileText className="ml-1 inline h-4 w-4" />عرض التقرير</button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4"><span className="rounded-lg bg-slate-900 p-2 text-slate-300">المتوقع: <b>{shift.expectedCash.toFixed(3)}</b></span><span className="rounded-lg bg-slate-900 p-2 text-slate-300">الفعلي: <b>{shift.actualCash === undefined ? '—' : shift.actualCash.toFixed(3)}</b></span><span className="rounded-lg bg-slate-900 p-2 text-slate-300">Cash: <b>{shift.totalCashSales.toFixed(3)}</b></span><span className="rounded-lg bg-slate-900 p-2 text-slate-300">CliQ: <b>{shift.totalCliqSales.toFixed(3)}</b></span></div>
        </article>)}
      </div> : null}

      <div className="flex items-center justify-between gap-2 border-t border-slate-800 pt-3 text-xs text-slate-400">
        <button type="button" disabled={applied.offset === 0 || isLoading} onClick={() => changePage(Math.max(0, applied.offset - PAGE_SIZE))} className="min-h-11 rounded-xl border border-slate-700 px-3 font-bold disabled:opacity-40">السابق</button>
        <span>صفحة {pageNumber.toLocaleString('ar-JO')} من {pageCount.toLocaleString('ar-JO')}</span>
        <button type="button" disabled={!hasMore || isLoading} onClick={() => changePage(applied.offset + PAGE_SIZE)} className="min-h-11 rounded-xl border border-slate-700 px-3 font-bold disabled:opacity-40">التالي</button>
      </div>
    </section>
  );
};

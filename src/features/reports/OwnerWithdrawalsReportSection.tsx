import React, { useCallback, useEffect, useId, useState } from 'react';
import { HandCoins, RotateCcw } from 'lucide-react';
import { Card, MoneyText, SectionHeader, StatusBadge, UiButton, formatUiDate } from '../../components/ui';
import {
  fetchOwnerWithdrawalsReport,
  newWithdrawalKey,
  reverseOwnerWithdrawal,
  type OwnerWithdrawalsReport,
  type OwnerWithdrawalsReportRow,
} from '../../services/supabase/ownerWithdrawals.service';
import type { OperationalBusinessReport } from '../../types';

const PAGE_SIZE = 25;
const fieldClass = 'h-11 w-full rounded-xl border border-nw-border bg-nw-surface px-3 text-sm text-nw-text';
const kindLabel: Record<OwnerWithdrawalsReportRow['kind'], string> = {
  withdrawal: 'سحب',
  return: 'إرجاع',
  return_voided: 'إلغاء إرجاع (عكس وردية)',
};

interface OwnerWithdrawalsReportSectionProps {
  branchId: string;
  dateFrom: string;
  dateTo: string;
  totals: NonNullable<OperationalBusinessReport['ownerWithdrawals']>;
  onChanged: () => void;
}

/**
 * Owner only: the report RPC returns the block only to the owner. The
 * remaining figure is profit after withdrawals — not drawer, bank or cash.
 */
export const OwnerWithdrawalsReportSection: React.FC<OwnerWithdrawalsReportSectionProps> = ({ branchId, dateFrom, dateTo, totals, onChanged }) => {
  const reasonId = useId();
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<OwnerWithdrawalsReport | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reverseKey, setReverseKey] = useState(() => newWithdrawalKey('owner-withdrawal-reversal'));

  const load = useCallback(async () => {
    try {
      setEvents(await fetchOwnerWithdrawalsReport({ branchId, dateFrom, dateTo, page, pageSize: PAGE_SIZE }));
    } catch (e) {
      setEvents(null);
      setError(e instanceof Error ? e.message : 'تعذر تحميل سحوبات المالك.');
    }
  }, [branchId, dateFrom, dateTo, page]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [branchId, dateFrom, dateTo]);

  const reverse = async (withdrawalId: string) => {
    setError(''); setNotice('');
    setBusy(true);
    try {
      const result = await reverseOwnerWithdrawal({ withdrawalId, reason, idempotencyKey: reverseKey });
      setNotice(result.replay ? 'العكس مسجّل مسبقاً.' : 'أُعيد المبلغ إلى درج الوردية المفتوحة.');
      setReversing(null); setReason(''); setReverseKey(newWithdrawalKey('owner-withdrawal-reversal'));
      await load(); onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر عكس السحب.');
    } finally { setBusy(false); }
  };

  const pages = events ? Math.max(1, Math.ceil(events.totalCount / PAGE_SIZE)) : 1;

  return (
    <section className="print-section space-y-3" data-testid="report-owner-withdrawals" aria-label="سحوبات المالك">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <span className="block text-[10px] font-bold text-nw-muted">صافي الربح</span>
          <strong className="mt-1 block text-xl font-bold"><bdi dir="ltr"><MoneyText amount={totals.netProfit} currency /></bdi></strong>
        </Card>
        <Card>
          <span className="block text-[10px] font-bold text-nw-muted">سحوبات المالك (صافي)</span>
          <strong className="mt-1 block text-xl font-bold text-nw-bad"><bdi dir="ltr"><MoneyText amount={totals.net} currency /></bdi></strong>
          <p className="m-0 mt-1 text-[10px] text-nw-muted">سحوبات <MoneyText amount={totals.withdrawn} /> · إرجاع <MoneyText amount={totals.returned} /></p>
        </Card>
        <Card>
          <span className="block text-[10px] font-bold text-nw-muted">المتبقي في المحل</span>
          <strong className={`mt-1 block text-xl font-bold ${totals.remainingAfterWithdrawals >= 0 ? 'text-nw-ok' : 'text-nw-bad'}`}>
            <bdi dir="ltr"><MoneyText amount={totals.remainingAfterWithdrawals} currency /></bdi>
          </strong>
          <p className="m-0 mt-1 text-[10px] text-nw-muted">صافي الربح ناقص صافي السحوبات؛ ليس رصيد الدرج أو البنك.</p>
        </Card>
      </div>

      <Card>
        <SectionHeader title={<span className="flex items-center gap-2"><HandCoins className="h-4 w-4 text-nw-warn" aria-hidden="true" />حركات سحوبات المالك</span>}
          hint="كل حركة بتاريخ حدوثها؛ الإرجاع لا يعدّل فترة السحب الأصلية." />
        {error && <p role="alert" className="m-0 mt-2 rounded-xl bg-nw-bad-bg p-2 text-sm text-nw-bad">{error}</p>}
        {notice && <p role="status" className="m-0 mt-2 rounded-xl bg-nw-ok-bg p-2 text-sm text-nw-ok">{notice}</p>}
        {events && events.rows.length === 0 && <p className="m-0 mt-3 text-sm text-nw-muted">لا توجد سحوبات في هذه الفترة.</p>}
        {events && events.rows.length > 0 && (
          <ul className="m-0 mt-3 list-none space-y-2 p-0" data-testid="report-owner-withdrawals-list">
            {events.rows.map(row => (
              <li key={`${row.kind}-${row.withdrawalId}-${row.at}`} className="rounded-xl border border-nw-border bg-nw-surface p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <StatusBadge tone={row.direction === 'out' ? 'bad' : 'ok'}>{kindLabel[row.kind]}</StatusBadge>{' '}
                    <bdi dir="ltr">{row.withdrawalNumber}</bdi> · {row.branchName} · <bdi dir="ltr">{row.shiftNumber}</bdi>
                    <span className="block text-xs text-nw-muted">
                      <bdi dir="ltr">{formatUiDate(row.at, { dateStyle: 'medium', timeStyle: 'short' })}</bdi> · {row.actorName}{row.reason && <> · {row.reason}</>}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <strong className={row.direction === 'out' ? 'text-nw-bad' : 'text-nw-ok'}>{row.direction === 'out' ? '−' : '+'}<MoneyText amount={row.amountInMinorUnits / 1000} /></strong>
                    {row.kind === 'withdrawal' && !row.isReversed && (
                      <UiButton variant="danger" disabled={busy} aria-label={`عكس السحب ${row.withdrawalNumber}`}
                        onClick={() => { setReversing(row.withdrawalId); setReason(''); setError(''); }}>
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />عكس
                      </UiButton>
                    )}
                  </span>
                </div>
                {reversing === row.withdrawalId && row.kind === 'withdrawal' && (
                  <div className="mt-2 grid gap-2">
                    <label htmlFor={reasonId} className="text-xs font-bold text-nw-muted">سبب العكس *</label>
                    <input id={reasonId} className={fieldClass} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
                    <p className="m-0 text-xs text-nw-muted">إن كانت وردية السحب مغلقة يُسجَّل الإرجاع في الوردية المفتوحة لنفس الفرع، وتبقى لقطة الوردية الأصلية كما هي.</p>
                    <div className="flex flex-wrap gap-2">
                      <UiButton variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => void reverse(row.withdrawalId)}>تأكيد العكس</UiButton>
                      <UiButton onClick={() => setReversing(null)} disabled={busy}>تراجع</UiButton>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {events && pages > 1 && (
          <nav className="mt-3 flex items-center justify-between gap-2" aria-label="صفحات سحوبات المالك">
            <UiButton disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</UiButton>
            <span className="text-xs text-nw-muted">صفحة {page} من {pages}</span>
            <UiButton disabled={page >= pages} onClick={() => setPage(p => p + 1)}>التالي</UiButton>
          </nav>
        )}
      </Card>
    </section>
  );
};

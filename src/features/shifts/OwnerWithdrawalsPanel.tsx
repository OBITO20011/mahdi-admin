import React, { useCallback, useEffect, useId, useState } from 'react';
import { HandCoins, RotateCcw } from 'lucide-react';
import { Card, FormFields, MoneyText, SectionHeader, StatusBadge, UiButton, formatUiTime } from '../../components/ui';
import {
  createOwnerWithdrawal,
  fetchShiftOwnerWithdrawals,
  newWithdrawalKey,
  reverseOwnerWithdrawal,
  type ShiftOwnerWithdrawals,
} from '../../services/supabase/ownerWithdrawals.service';
import type { Shift } from '../../types';

const fieldClass = 'h-11 w-full rounded-xl border border-nw-border bg-nw-surface px-3 text-sm text-nw-text';
const toMinor = (value: string) => {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/u.exec(value.trim());
  return match ? Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0')) : null;
};
const jod = (minor: number) => (minor / 1000).toFixed(3);
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'تعذر تنفيذ العملية.');

interface OwnerWithdrawalsPanelProps {
  shift: Shift;
  onChanged: () => void;
}

/**
 * Owner only (the database refuses every other role). A withdrawal is its own
 * cash movement out of this drawer — not an expense — and is capped by the
 * drawer's expected cash. A reversal returns the amount into this shift while
 * it is open; for a closed shift it goes into the branch's open shift.
 */
export const OwnerWithdrawalsPanel: React.FC<OwnerWithdrawalsPanelProps> = ({ shift, onChanged }) => {
  const ids = { amount: useId(), reason: useId(), reverseReason: useId(), title: useId() };
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(() => newWithdrawalKey('owner-withdrawal'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [state, setState] = useState<ShiftOwnerWithdrawals>({ withdrawals: [], returnsFromOtherShifts: [] });
  const [reversing, setReversing] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseKey, setReverseKey] = useState(() => newWithdrawalKey('owner-withdrawal-reversal'));
  const expectedMinor = Math.round(shift.expectedCash * 1000);

  const load = useCallback(async () => {
    try { setState(await fetchShiftOwnerWithdrawals(shift.id)); } catch { setState({ withdrawals: [], returnsFromOtherShifts: [] }); }
  }, [shift.id]);
  useEffect(() => { void load(); }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(''); setNotice('');
    const minor = toMinor(amount);
    if (!minor) { setError('أدخل مبلغاً أكبر من صفر بثلاث منازل عشرية كحد أقصى.'); return; }
    if (minor > expectedMinor) { setError(`بالدرج ${jod(Math.max(expectedMinor, 0))} د.أ فقط.`); return; }
    setBusy(true);
    try {
      const result = await createOwnerWithdrawal({ shiftId: shift.id, amountInMinorUnits: minor, reason, idempotencyKey: key });
      setNotice(`تم تسجيل السحب ${result.withdrawalNumber}.`);
      setAmount(''); setReason(''); setKey(newWithdrawalKey('owner-withdrawal'));
      await load(); onChanged();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const reverse = async (withdrawalId: string) => {
    setError(''); setNotice('');
    if (reverseReason.trim().length < 5) { setError('سبب العكس مطلوب (5 إلى 500 حرف).'); return; }
    setBusy(true);
    try {
      await reverseOwnerWithdrawal({ withdrawalId, reason: reverseReason, idempotencyKey: reverseKey });
      setNotice('أُعيد المبلغ إلى الدرج.');
      setReversing(null); setReverseReason(''); setReverseKey(newWithdrawalKey('owner-withdrawal-reversal'));
      await load(); onChanged();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Card data-testid="owner-withdrawals" aria-labelledby={ids.title}>
      <SectionHeader title={<span id={ids.title} className="flex items-center gap-2"><HandCoins className="h-4 w-4 text-nw-warn" aria-hidden="true" />سحوبات المالك</span>}
        hint="حركة نقدية مستقلة من الدرج، ليست مصروفاً ولا تغيّر الربح." />
      <FormFields>
        <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={event => void submit(event)} aria-busy={busy}>
          <div>
            <label htmlFor={ids.amount} className="mb-1 block text-xs font-bold text-nw-muted">مبلغ السحب (د.أ) *</label>
            <input id={ids.amount} className={fieldClass} dir="ltr" inputMode="decimal" placeholder="0.000" value={amount}
              onChange={event => setAmount(event.target.value)} required />
            <p className="m-0 mt-1 text-xs text-nw-muted">بالدرج الآن <bdi dir="ltr"><MoneyText amount={shift.expectedCash} /></bdi></p>
          </div>
          <div>
            <label htmlFor={ids.reason} className="mb-1 block text-xs font-bold text-nw-muted">السبب (اختياري)</label>
            <input id={ids.reason} className={fieldClass} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
          </div>
          {error && <p role="alert" className="sm:col-span-2 m-0 rounded-xl bg-nw-bad-bg p-2 text-sm text-nw-bad">{error}</p>}
          {notice && <p role="status" className="sm:col-span-2 m-0 rounded-xl bg-nw-ok-bg p-2 text-sm text-nw-ok">{notice}</p>}
          <div className="sm:col-span-2">
            <UiButton type="submit" variant="accent" disabled={busy}>سحب من الدرج</UiButton>
          </div>
        </form>
      </FormFields>

      {(state.withdrawals.length > 0 || state.returnsFromOtherShifts.length > 0) && (
        <ul className="m-0 mt-3 list-none space-y-2 p-0" data-testid="owner-withdrawals-list">
          {state.withdrawals.map(w => (
            <li key={w.withdrawalId} className="rounded-xl border border-nw-border bg-nw-surface p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><bdi dir="ltr">{w.withdrawalNumber}</bdi> · <bdi dir="ltr">{formatUiTime(w.createdAt)}</bdi>{w.reason && <> · {w.reason}</>}</span>
                <span className="flex items-center gap-2">
                  <strong className="text-nw-bad">−<MoneyText amount={w.amountInMinorUnits / 1000} /></strong>
                  {w.reversal
                    ? <StatusBadge tone="mute">{w.reversal.effectiveShiftId === shift.id ? 'أُعيد للدرج' : 'أُعيد في وردية أخرى'}</StatusBadge>
                    : <UiButton variant="danger" disabled={busy} aria-label={`عكس السحب ${w.withdrawalNumber}`}
                        onClick={() => { setReversing(w.withdrawalId); setReverseReason(''); }}><RotateCcw className="h-4 w-4" aria-hidden="true" />عكس</UiButton>}
                </span>
              </div>
              {reversing === w.withdrawalId && (
                <div className="mt-2 grid gap-2">
                  <label htmlFor={ids.reverseReason} className="text-xs font-bold text-nw-muted">سبب العكس *</label>
                  <input id={ids.reverseReason} className={fieldClass} maxLength={500} value={reverseReason}
                    onChange={event => setReverseReason(event.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <UiButton variant="danger" disabled={busy || reverseReason.trim().length < 5} onClick={() => void reverse(w.withdrawalId)}>تأكيد العكس</UiButton>
                    <UiButton onClick={() => setReversing(null)} disabled={busy}>تراجع</UiButton>
                  </div>
                </div>
              )}
            </li>
          ))}
          {state.returnsFromOtherShifts.map(r => (
            <li key={r.reversalId} className="rounded-xl border border-nw-border bg-nw-surface-2 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>إرجاع السحب <bdi dir="ltr">{r.withdrawalNumber}</bdi> من وردية سابقة · {r.reason}</span>
                <strong className="text-nw-ok">+<MoneyText amount={r.amountInMinorUnits / 1000} /></strong>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

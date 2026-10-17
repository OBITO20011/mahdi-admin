import React, { useCallback, useEffect, useId, useState } from 'react';
import { CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { FormFields, StatusBadge, UiButton, formatMinorUnits, formatUiDate } from '../../components/ui';
import { useAppStoreActions, useAppStoreSelector } from '../../stores/useAppStore';
import { parseJodToMinor } from '../goLive/goLiveImport';
import {ChequeRegistrationForm} from '../cheques/ChequeRegistrationForm';
import {
  collectCustomerBalance, fetchCustomerCollections, newIdempotencyKey, previewCustomerCollection, reverseCustomerCollection,
  type CollectionMethod, type CollectionOperation, type CollectionPreview,
} from '../../services/supabase/goLive.service';

interface CustomerCollectionModalProps {
  customerId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const Money: React.FC<{ minor: number }> = ({ minor }) => (
  <span className="whitespace-nowrap"><bdi dir="ltr" className="nw-num">{formatMinorUnits(minor)}</bdi> <span className="text-xs text-nw-muted">د.أ</span></span>
);
const methodLabel: Readonly<Record<string, string>> = { cash: 'كاش', cliq: 'CliQ', bank_transfer: 'تحويل بنكي',cheque:'شيك مؤجل' };
const fieldClass = 'h-11 w-full rounded-xl border border-nw-border bg-nw-surface px-3 text-sm text-nw-text';
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'تعذر تنفيذ العملية.');

/**
 * «تحصيل من الزبون»: one lump sum, allocated by the database oldest-first —
 * opening debts first by their original date, then open orders — and shown
 * as a preview before saving. Order parts use the existing order payment path.
 */
export const CustomerCollectionModal: React.FC<CustomerCollectionModalProps> = ({ customerId, onClose, onSuccess }) => {
  const ids = { amount: useId(), method: useId(), reference: useId(), notes: useId(), reason: useId() };
  const { setToast } = useAppStoreActions();
  const branchId = useAppStoreSelector(state => state.activeBranch?.id ?? null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<CollectionMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<(CollectionPreview & { minor: number; method: CollectionMethod }) | null>(null);
  const [key, setKey] = useState(() => newIdempotencyKey('collect'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<CollectionOperation[]>([]);
  const [reversing, setReversing] = useState<CollectionOperation | null>(null);
  const [reason, setReason] = useState('');
  const [receivingCheque,setReceivingCheque]=useState(false);

  const loadHistory = useCallback(async () => {
    try { setHistory(await fetchCustomerCollections(customerId)); } catch { setHistory([]); }
  }, [customerId]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const minor = parseJodToMinor(amount);
  const previewIsCurrent = preview !== null && minor !== null && preview.minor === Number(minor) && preview.method === method;

  const runPreview = async () => {
    setError('');
    if (!minor || minor === '0') { setError('أدخل مبلغاً أكبر من صفر بثلاث منازل عشرية كحد أقصى.'); return; }
    setBusy(true);
    try {
      const result = await previewCustomerCollection(customerId, Number(minor));
      setPreview({ ...result, minor: Number(minor), method });
      setKey(newIdempotencyKey('collect'));
      if (result.exceedsBalance) setError('المبلغ أكبر من مجموع دين العميل؛ خفّض المبلغ.');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!previewIsCurrent || !preview || preview.exceedsBalance) { await runPreview(); return; }
    if (method === 'cliq' && !reference.trim()) { setError('رقم مرجع CliQ مطلوب.'); return; }
    setBusy(true); setError('');
    try {
      const operation = await collectCustomerBalance({ customerId, amountInMinorUnits: preview.minor, method,
        branchId, reference, notes, idempotencyKey: key });
      setToast(`تم التحصيل ${operation.operationNumber}`, 'success');
      onSuccess(); onClose();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const reverse = async () => {
    if (!reversing) return;
    setBusy(true); setError('');
    try {
      await reverseCustomerCollection(reversing.operationId, reason);
      setReversing(null); setReason(''); await loadHistory(); onSuccess();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  if(receivingCheque)return <ChequeRegistrationForm direction="incoming" partyId={customerId} parties={[{id:customerId,name:'العميل المحدد للتحصيل'}]}
    branchId={branchId} onClose={()=>setReceivingCheque(false)} onSaved={()=>{onSuccess();onClose();}} />;
  return (
    <div dir="rtl" className="space-y-4" data-testid="customer-collection">
      <UiButton disabled={busy} onClick={()=>setReceivingCheque(true)}>استلام شيك مؤجل</UiButton>
      <FormFields>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => void save(event)} aria-busy={busy}>
          <div>
            <label htmlFor={ids.amount} className="mb-1 block text-[13px] font-semibold">المبلغ المقبوض (د.أ) *</label>
            <input id={ids.amount} className={fieldClass} inputMode="decimal" dir="ltr" value={amount}
              onChange={event => { setAmount(event.target.value); }} placeholder="0.000" required />
          </div>
          <div>
            <label htmlFor={ids.method} className="mb-1 block text-[13px] font-semibold">طريقة الدفع *</label>
            <select id={ids.method} className={fieldClass} value={method} onChange={event => setMethod(event.target.value as CollectionMethod)}>
              <option value="cash">كاش — يدخل درج الوردية المفتوحة</option>
              <option value="cliq">CliQ — على الوردية خارج الدرج</option>
              <option value="bank_transfer">تحويل بنكي — بلا وردية</option>
            </select>
          </div>
          {method !== 'cash' && (
            <div>
              <label htmlFor={ids.reference} className="mb-1 block text-[13px] font-semibold">{method === 'cliq' ? 'رقم مرجع CliQ *' : 'رقم مرجع التحويل'}</label>
              <input id={ids.reference} className={fieldClass} dir="ltr" maxLength={100} value={reference} onChange={event => setReference(event.target.value)} />
            </div>
          )}
          <div className={method === 'cash' ? 'sm:col-span-2' : ''}>
            <label htmlFor={ids.notes} className="mb-1 block text-[13px] font-semibold">ملاحظات (اختياري)</label>
            <input id={ids.notes} className={fieldClass} maxLength={300} value={notes} onChange={event => setNotes(event.target.value)} />
          </div>

          {preview && (
            <div className="sm:col-span-2 space-y-2 rounded-2xl border border-nw-border bg-nw-surface-2 p-3" data-testid="customer-collection-preview">
              <p className="m-0 text-sm font-bold">{`معاينة التوزيع من الأقدم (${previewIsCurrent ? 'محدّثة' : 'غيّرت المبلغ أو الطريقة؛ أعد المعاينة'})`}</p>
              <p className="m-0 text-[13px] text-nw-muted">مجموع الدين <Money minor={preview.totalOutstandingInMinorUnits} /> · ديون سابقة <Money minor={preview.openingOutstandingInMinorUnits} /> · طلبات <Money minor={preview.ordersOutstandingInMinorUnits} /></p>
              {Boolean(preview.compensationOutstandingInMinorUnits)&&<p className="m-0 text-sm text-nw-muted">قيود شيكات <Money minor={preview.compensationOutstandingInMinorUnits??0} /></p>}
              <ul className="m-0 list-none space-y-1 p-0">
                {preview.parts.filter(part => part.allocateInMinorUnits > 0).map(part => (
                  <li key={part.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-nw-surface p-2 text-[13px]">
                    <span className="min-w-0">
                      <StatusBadge tone={part.kind === 'opening' ? 'warn' : 'info'}>{part.kind === 'opening' ? 'رصيد سابق قبل النظام' : part.kind === 'compensation' ? 'قيد تعويض شيك' : 'طلب'}</StatusBadge>{' '}
                      <bdi dir="ltr">{part.reference}</bdi> · {part.debtAt ? <bdi>{formatUiDate(part.debtAt,{year:'numeric',month:'2-digit',day:'2-digit'})}</bdi> : 'تاريخ غير متاح'}
                    </span>
                    <span className="font-bold"><Money minor={part.allocateInMinorUnits} /> <span className="text-xs font-normal text-nw-muted">يتبقى <Money minor={part.remainingAfterInMinorUnits} /></span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p role="alert" className="sm:col-span-2 m-0 whitespace-pre-line rounded-xl bg-nw-bad-bg p-3 text-sm text-nw-bad">{error}</p>}
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <UiButton onClick={() => void runPreview()} disabled={busy}>معاينة التوزيع</UiButton>
            <UiButton type="submit" variant="accent" disabled={busy || !previewIsCurrent || Boolean(preview?.exceedsBalance)}>
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />جارٍ الحفظ…</> : <><CheckCircle2 className="h-4 w-4" aria-hidden="true" />حفظ التحصيل</>}
            </UiButton>
            <UiButton onClick={onClose} disabled={busy}>إغلاق</UiButton>
          </div>
        </form>
      </FormFields>

      {history.length > 0 && (
        <section aria-labelledby={`${ids.reason}-title`}>
          <h3 id={`${ids.reason}-title`} className="m-0 mb-2 text-[13px] font-bold text-nw-muted">آخر عمليات التحصيل</h3>
          <ul className="m-0 list-none space-y-2 p-0" data-testid="customer-collection-history">
            {history.map(operation => (
              <li key={operation.operationId} className="rounded-xl border border-nw-border bg-nw-surface p-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><bdi dir="ltr">{operation.operationNumber}</bdi> · {methodLabel[operation.paymentMethod] ?? operation.paymentMethod} · <Money minor={operation.amountInMinorUnits} /></span>
                  {operation.chequeId?<StatusBadge tone="info">إدارة الحالة من صفحة الشيكات</StatusBadge>:operation.isReversed
                    ? <StatusBadge tone="mute">معكوسة</StatusBadge>
                    : <UiButton variant="danger" disabled={busy} aria-label={`عكس العملية ${operation.operationNumber}`}
                        onClick={() => { setReversing(operation); setReason(''); }}><RotateCcw className="h-4 w-4" aria-hidden="true" />عكس</UiButton>}
                </div>
                {reversing?.operationId === operation.operationId && (
                  <FormFields className="mt-2 space-y-2">
                    <label htmlFor={ids.reason} className="block font-semibold">سبب عكس العملية كاملة</label>
                    <input id={ids.reason} className={fieldClass} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
                    <div className="flex flex-wrap gap-2">
                      <UiButton variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => void reverse()}>تأكيد العكس</UiButton>
                      <UiButton onClick={() => setReversing(null)} disabled={busy}>تراجع</UiButton>
                    </div>
                  </FormFields>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

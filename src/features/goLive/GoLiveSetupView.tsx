import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Boxes, CheckCircle2, Download, FileSpreadsheet, Lock, Package, PencilLine, ShieldAlert, Truck, Users } from 'lucide-react';
import { Card, PageHeader, SectionHeader, StatusBadge, StockBar, UiButton, FormFields, formatMinorUnits } from '../../components/ui';
import { useAppStoreActions, useAppStoreSelector } from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { readXlsxFirstSheet, writeXlsx, XLSX_MIME, XlsxError } from '../../lib/xlsx';
import { fetchInventoryOpeningSetupFromSupabase, applyInventoryOpeningSetupInSupabase } from '../../services/supabase/inventory-opening.service';
import {
  batchKey, dryRunBatch, fetchCustomerOpenings, fetchGoLiveStatus, fetchSupplierOpenings, finishGoLiveSetup,
  GoLiveRpcError, listActiveSuppliers, reverseOpening, saveBatch, searchCustomers,
  type GoLiveStatus, type OpeningEntry, type PartyOption,
} from '../../services/supabase/goLive.service';
import {
  ammanToday, chunk, GO_LIVE_BATCH_SIZE, GO_LIVE_COLUMNS, GO_LIVE_TEMPLATE_NOTES, mapServerErrors, mapSheet,
  parseJodToMinor, prepareCustomers, prepareProducts, prepareStock, prepareSuppliers, stripSourceRow, templateRows,
  type GoLiveKind, type RowError,
} from './goLiveImport';

export const GO_LIVE_CONFIRMATION = 'إنهاء بداية التشغيل';

const Money: React.FC<{ minor: number }> = ({ minor }) => (
  <span className="whitespace-nowrap"><bdi dir="ltr" className="nw-num">{formatMinorUnits(minor)}</bdi> <span className="text-xs text-nw-muted">د.أ</span></span>
);
const Num: React.FC<{ value: number }> = ({ value }) => <bdi dir="ltr" className="nw-num">{value}</bdi>;
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'تعذر تنفيذ العملية.');
const kindTitle: Readonly<Record<GoLiveKind, string>> = {
  products: 'المنتجات', stock: 'البضاعة الموجودة', customers: 'ديون العملاء القديمة', suppliers: 'أرصدة الموردين الافتتاحية',
};
const fieldClass = 'h-11 w-full rounded-xl border border-nw-border bg-nw-surface px-3 text-sm text-nw-text';

function downloadTemplate(kind: GoLiveKind) {
  const notes = GO_LIVE_TEMPLATE_NOTES[kind].map(line => [line]);
  const bytes = writeXlsx([
    { name: 'البيانات', rows: templateRows(kind), widths: GO_LIVE_COLUMNS[kind].map(column => column.width ?? 22) },
    { name: 'تعليمات', rows: [['تعليمات القالب'], ...notes, ['احذف سطر المثال قبل الاستيراد، ولا تغيّر عناوين الصف الأول.']], widths: [110] },
  ]);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_MIME }));
  const link = document.createElement('a');
  link.href = url; link.download = `go-live-${kind}-template.xlsx`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Preview {
  fileName: string;
  rowCount: number;
  errors: RowError[];
  batches: Record<string, unknown>[][];
  summary: { label: string; value: React.ReactNode }[];
  session: string;
}

const ErrorList: React.FC<{ errors: readonly RowError[] }> = ({ errors }) => (
  <div className="max-h-64 overflow-y-auto rounded-xl border border-nw-bad bg-nw-bad-bg p-3">
    <p className="m-0 mb-2 text-sm font-bold text-nw-bad">{`أسطر تحتاج تصحيحاً: ${errors.length}`}</p>
    <ul className="m-0 list-none space-y-1 p-0 text-[13px] text-nw-text">
      {errors.slice(0, 200).map((error, index) => (
        <li key={`${error.row}-${index}`}><span className="font-semibold">السطر <Num value={error.row} />:</span> {error.message}</li>
      ))}
    </ul>
  </div>
);

interface ImportPanelProps {
  kind: GoLiveKind;
  disabled: boolean;
  warehouseId?: string;
  onSaved: () => void;
}

/** Template → file → local checks → database dry run → summary → batched idempotent save. */
const ImportPanel: React.FC<ImportPanelProps> = ({ kind, disabled, warehouseId, onSaved }) => {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const analyse = async (file: File) => {
    setPreview(null); setMessage(null); setBusy('جارٍ قراءة الملف والتحقق من الأسطر…');
    try {
      const sheet = await readXlsxFirstSheet(await file.arrayBuffer());
      const { rows, fileErrors } = mapSheet(kind, sheet);
      if (fileErrors.length) { setMessage({ tone: 'bad', text: fileErrors.join(' ') }); return; }
      const session = Math.random().toString(36).slice(2, 10);
      let errors: RowError[] = [], payload: Record<string, unknown>[] = [], summary: Preview['summary'] = [];
      if (kind === 'stock') {
        if (!warehouseId) throw new Error('اختر المستودع أولاً.');
        const setup = await fetchInventoryOpeningSetupFromSupabase(warehouseId);
        const prepared = prepareStock(rows, setup.products);
        errors = prepared.errors; payload = prepared.payload as unknown as Record<string, unknown>[];
        summary = [{ label: 'أصناف صالحة', value: <Num value={prepared.payload.length} /> },
          { label: 'مجموع الحبات', value: <Num value={prepared.payload.reduce((sum, r) => sum + r.baseQuantity, 0)} /> }];
      } else {
        const prepared = kind === 'products' ? prepareProducts(rows) : kind === 'customers' ? prepareCustomers(rows) : prepareSuppliers(rows);
        errors = prepared.errors; payload = prepared.payload as unknown as Record<string, unknown>[];
        // The database is the authority: dry-run every batch (matching, duplicates, existing SKUs).
        for (const batch of chunk(payload as { sourceRow: number }[], GO_LIVE_BATCH_SIZE[kind])) {
          const dry = await dryRunBatch(kind, batch.map(stripSourceRow));
          errors = [...errors, ...mapServerErrors(batch, dry.errors)];
        }
        const valid = new Set(errors.map(e => e.row));
        const ok = (payload as { sourceRow: number }[]).filter(r => !valid.has(r.sourceRow)) as unknown as Record<string, string>[];
        const sum = (rows: Record<string, string>[]) => rows.reduce((total, r) => total + Number(r.amount_in_minor_units ?? 0), 0);
        summary = kind === 'products'
          ? [{ label: 'منتجات صالحة', value: <Num value={ok.length} /> }]
          : kind === 'customers'
            ? [{ label: 'ديون صالحة', value: <Num value={ok.length} /> }, { label: 'المجموع', value: <Money minor={sum(ok)} /> }]
            : [{ label: 'له (علينا للمورد)', value: <Money minor={sum(ok.filter(r => r.direction === 'payable'))} /> },
              { label: 'عليه (للمحل)', value: <Money minor={sum(ok.filter(r => r.direction === 'advance'))} /> }];
      }
      errors.sort((a, b) => a.row - b.row);
      const batches = chunk(payload as { sourceRow: number }[], GO_LIVE_BATCH_SIZE[kind]).map(batch => batch.map(stripSourceRow));
      setPreview({ fileName: file.name, rowCount: rows.length, errors, batches, summary, session });
    } catch (error) {
      setMessage({ tone: 'bad', text: error instanceof XlsxError || error instanceof Error ? error.message : 'تعذر قراءة الملف.' });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    if (!preview || preview.errors.length) return;
    setMessage(null);
    try {
      let saved = 0;
      for (const [index, batch] of preview.batches.entries()) {
        setBusy(`جارٍ حفظ الدفعة ${index + 1} من ${preview.batches.length}…`);
        const key = await batchKey(kind, preview.session, index, batch);
        if (kind === 'stock') {
          const result = await applyInventoryOpeningSetupInSupabase({
            warehouseId: warehouseId!, idempotencyKey: key, notes: 'بداية التشغيل - استيراد Excel',
            rows: batch.map(row => ({ productId: String(row.productId), packageCount: Number(row.packageCount), looseUnits: Number(row.looseUnits) })),
          });
          saved += result.itemCount;
        } else {
          saved += (await saveBatch(kind, key, batch)).created;
        }
      }
      setMessage({ tone: 'ok', text: `تم الحفظ بنجاح: ${saved} سطر في ${preview.batches.length} دفعة.` });
      setPreview(null); onSaved();
    } catch (error) {
      const rowErrors = error instanceof GoLiveRpcError ? error.rowErrors : [];
      setMessage({ tone: 'bad', text: `${errorText(error)} يمكنك إعادة الحفظ بأمان؛ الدفعات المحفوظة لا تتكرر.` });
      if (rowErrors.length) setPreview(current => current && { ...current, errors: rowErrors });
    } finally { setBusy(null); }
  };

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-nw-border bg-nw-surface-2 p-3" data-testid={`go-live-import-${kind}`}>
      <ul className="m-0 list-disc space-y-1 ps-5 text-[13px] text-nw-muted">
        {GO_LIVE_TEMPLATE_NOTES[kind].map(line => <li key={line}>{line}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <UiButton onClick={() => downloadTemplate(kind)}><Download className="h-4 w-4" aria-hidden="true" />تنزيل القالب</UiButton>
        <label htmlFor={inputId} className={`inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-nw-border bg-nw-surface px-4 text-sm font-semibold text-nw-text hover:bg-nw-surface-2 ${disabled || busy ? 'pointer-events-none opacity-60' : ''}`}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />اختيار ملف Excel
        </label>
        <input id={inputId} ref={fileRef} type="file" className="sr-only" disabled={disabled || Boolean(busy)}
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={event => { const file = event.target.files?.[0]; if (file) void analyse(file); }} />
      </div>
      {busy && <p role="status" className="m-0 text-sm text-nw-muted">{busy}</p>}
      {message && <p role={message.tone === 'bad' ? 'alert' : 'status'} className={`m-0 rounded-xl p-3 text-sm ${message.tone === 'bad' ? 'bg-nw-bad-bg text-nw-bad' : 'bg-nw-ok-bg text-nw-ok'}`}>{message.text}</p>}
      {preview && (
        <div className="space-y-3" data-testid={`go-live-preview-${kind}`}>
          <p className="m-0 text-sm font-semibold text-nw-text">{`معاينة الملف: ${preview.fileName}`}</p>
          <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
            <div className="rounded-xl bg-nw-surface p-3"><dt className="text-xs text-nw-muted">أسطر الملف</dt><dd className="m-0 text-base font-bold"><Num value={preview.rowCount} /></dd></div>
            {preview.summary.map(item => (
              <div key={item.label} className="rounded-xl bg-nw-surface p-3"><dt className="text-xs text-nw-muted">{item.label}</dt><dd className="m-0 text-base font-bold">{item.value}</dd></div>
            ))}
          </dl>
          {preview.errors.length > 0
            ? <ErrorList errors={preview.errors} />
            : <p className="m-0 flex items-center gap-2 text-sm text-nw-ok"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />كل الأسطر صالحة وجاهزة للحفظ.</p>}
          <div className="flex flex-wrap gap-2">
            <UiButton variant="primary" disabled={disabled || Boolean(busy) || preview.errors.length > 0} onClick={() => void save()}>
              {`حفظ ${preview.batches.reduce((n, b) => n + b.length, 0)} سطر`}
            </UiButton>
            <UiButton onClick={() => setPreview(null)} disabled={Boolean(busy)}>إلغاء المعاينة</UiButton>
          </div>
          {preview.errors.length > 0 && <p className="m-0 text-xs text-nw-muted">صحّح الأسطر في الملف ثم اختره من جديد. لا يُحفظ أي سطر ما دام في الملف خطأ.</p>}
        </div>
      )}
    </div>
  );
};

interface ManualOpeningFormProps {
  kind: 'customers' | 'suppliers';
  disabled: boolean;
  onSaved: () => void;
}

const ManualOpeningForm: React.FC<ManualOpeningFormProps> = ({ kind, disabled, onSaved }) => {
  const ids = { party: useId(), amount: useId(), date: useId(), notes: useId(), direction: useId(), search: useId() };
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<PartyOption[]>([]);
  const [partyId, setPartyId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [direction, setDirection] = useState<'payable' | 'advance'>('payable');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [session] = useState(() => Math.random().toString(36).slice(2, 10));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      (kind === 'customers' ? searchCustomers(search.trim()) : listActiveSuppliers())
        .then(found => { if (live) setOptions(kind === 'suppliers' && search.trim()
          ? found.filter(option => option.name.includes(search.trim())) : found); })
        .catch(error => { if (live) setMessage({ tone: 'bad', text: errorText(error) }); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [kind, search]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const minor = parseJodToMinor(amount);
    if (!partyId) return setMessage({ tone: 'bad', text: kind === 'customers' ? 'اختر العميل.' : 'اختر المورد.' });
    if (!minor || minor === '0') return setMessage({ tone: 'bad', text: 'أدخل مبلغاً أكبر من صفر بثلاث منازل كحد أقصى.' });
    if (!date || date > ammanToday()) return setMessage({ tone: 'bad', text: 'أدخل التاريخ الأصلي، ولا يكون في المستقبل.' });
    const row = kind === 'customers'
      ? { customer_id: partyId, amount_in_minor_units: minor, original_debt_date: date, ...(notes.trim() ? { notes: notes.trim() } : {}) }
      : { supplier_id: partyId, direction, amount_in_minor_units: minor, original_balance_date: date, ...(notes.trim() ? { notes: notes.trim() } : {}) };
    setBusy(true); setMessage(null);
    try {
      const dry = await dryRunBatch(kind, [row]);
      if (dry.errors.length) { setMessage({ tone: 'bad', text: dry.errors[0].message }); return; }
      await saveBatch(kind, await batchKey(kind + '-manual', session, attempt, [row]), [row]);
      setAttempt(n => n + 1); setAmount(''); setNotes('');
      setMessage({ tone: 'ok', text: 'تم حفظ الرصيد الافتتاحي.' }); onSaved();
    } catch (error) {
      setMessage({ tone: 'bad', text: errorText(error) });
    } finally { setBusy(false); }
  };

  return (
    <FormFields className="mt-3 rounded-2xl border border-nw-border bg-nw-surface-2 p-3">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => void submit(event)} data-testid={`go-live-manual-${kind}`}>
        <div className="sm:col-span-2 grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.search} className="mb-1 block text-[13px] font-semibold">{kind === 'customers' ? 'بحث عن عميل بالاسم أو الهاتف' : 'بحث عن مورد'}</label>
            <input id={ids.search} className={fieldClass} value={search} onChange={event => setSearch(event.target.value)} autoComplete="off" />
          </div>
          <div>
            <label htmlFor={ids.party} className="mb-1 block text-[13px] font-semibold">{kind === 'customers' ? 'العميل' : 'المورد'}</label>
            <select id={ids.party} className={fieldClass} value={partyId} onChange={event => setPartyId(event.target.value)} required>
              <option value="">{options.length ? 'اختر من القائمة' : 'لا نتائج'}</option>
              {options.map(option => <option key={option.id} value={option.id}>{option.detail ? `${option.name} — ${option.detail}` : option.name}</option>)}
            </select>
          </div>
        </div>
        {kind === 'suppliers' && (
          <div className="sm:col-span-2">
            <label htmlFor={ids.direction} className="mb-1 block text-[13px] font-semibold">الاتجاه</label>
            <select id={ids.direction} className={fieldClass} value={direction} onChange={event => setDirection(event.target.value as 'payable' | 'advance')}>
              <option value="payable">له — نحن مدينون للمورد</option>
              <option value="advance">عليه — المورد مدين لنا</option>
            </select>
          </div>
        )}
        <div>
          <label htmlFor={ids.amount} className="mb-1 block text-[13px] font-semibold">المبلغ (د.أ)</label>
          <input id={ids.amount} className={fieldClass} inputMode="decimal" dir="ltr" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.000" required />
        </div>
        <div>
          <label htmlFor={ids.date} className="mb-1 block text-[13px] font-semibold">التاريخ الأصلي</label>
          <input id={ids.date} className={fieldClass} type="date" dir="ltr" max={ammanToday()} min="2000-01-01" value={date} onChange={event => setDate(event.target.value)} required />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={ids.notes} className="mb-1 block text-[13px] font-semibold">ملاحظة (اختياري)</label>
          <input id={ids.notes} className={fieldClass} maxLength={300} value={notes} onChange={event => setNotes(event.target.value)} />
        </div>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
          <UiButton type="submit" variant="primary" disabled={disabled || busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الرصيد'}</UiButton>
          {message && <p role={message.tone === 'bad' ? 'alert' : 'status'} className={`m-0 text-sm ${message.tone === 'bad' ? 'text-nw-bad' : 'text-nw-ok'}`}>{message.text}</p>}
        </div>
      </form>
    </FormFields>
  );
};

const EntryList: React.FC<{ kind: 'customers' | 'suppliers'; entries: OpeningEntry[]; disabled: boolean; onChanged: () => void }> = ({ kind, entries, disabled, onChanged }) => {
  const reasonId = useId();
  const [target, setTarget] = useState<OpeningEntry | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!entries.length) return <p className="m-0 mt-3 text-[13px] text-nw-muted">لا توجد أرصدة مسجلة بعد.</p>;
  const reverse = async () => {
    if (!target) return;
    setBusy(true); setError('');
    try { await reverseOpening(kind, target.id, reason); setTarget(null); setReason(''); onChanged(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3">
      <h3 className="m-0 mb-2 text-[13px] font-bold text-nw-muted">آخر الأرصدة المسجلة</h3>
      <ul className="m-0 max-h-80 list-none space-y-2 overflow-y-auto p-0" data-testid={`go-live-entries-${kind}`}>
        {entries.map(entry => (
          <li key={entry.id} className="rounded-xl border border-nw-border bg-nw-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="m-0 text-sm font-semibold">{entry.partyName}</p>
                <p className="m-0 text-xs text-nw-muted"><bdi dir="ltr">{entry.entryNumber}</bdi> · <bdi dir="ltr">{entry.originalDate}</bdi>{entry.partyDetail && <> · <bdi dir="ltr">{entry.partyDetail}</bdi></>}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {entry.direction && <StatusBadge tone={entry.direction === 'payable' ? 'warn' : 'info'}>{entry.direction === 'payable' ? 'له' : 'عليه'}</StatusBadge>}
                <span className={`text-sm font-bold ${entry.isReversed ? 'text-nw-muted line-through' : ''}`}><Money minor={entry.amountInMinorUnits} /></span>
                {entry.isReversed
                  ? <StatusBadge tone="mute">معكوس</StatusBadge>
                  : <UiButton variant="danger" disabled={disabled} onClick={() => { setTarget(entry); setReason(''); setError(''); }}
                      aria-label={`عكس الرصيد ${entry.entryNumber}`}>عكس</UiButton>}
              </div>
            </div>
            {target?.id === entry.id && (
              <FormFields className="mt-3 space-y-2">
                <label htmlFor={reasonId} className="block text-[13px] font-semibold">سبب العكس (يظهر في سجل التدقيق)</label>
                <input id={reasonId} className={fieldClass} value={reason} maxLength={300} onChange={event => setReason(event.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <UiButton variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => void reverse()}>تأكيد العكس</UiButton>
                  <UiButton onClick={() => setTarget(null)} disabled={busy}>تراجع</UiButton>
                </div>
                {error && <p role="alert" className="m-0 text-sm text-nw-bad">{error}</p>}
              </FormFields>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

interface SetupCardProps {
  kind: GoLiveKind;
  icon: React.ReactNode;
  description: string;
  progress: { value: number; max: number; label: string };
  facts: React.ReactNode;
  manual: React.ReactNode;
  manualLabel: string;
  onManual?: () => void;
  locked: boolean;
  extra?: React.ReactNode;
  warehouseId?: string;
  onSaved: () => void;
}

const SetupCard: React.FC<SetupCardProps> = ({ kind, icon, description, progress, facts, manual, manualLabel, onManual, locked, extra, warehouseId, onSaved }) => {
  const [open, setOpen] = useState<'manual' | 'import' | null>(null);
  const titleId = useId();
  const done = progress.max > 0 && progress.value >= progress.max;
  return (
    <Card role="region" aria-labelledby={titleId} data-testid={`go-live-card-${kind}`} className="min-w-0">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-nw-info-bg text-nw-info" aria-hidden="true">{icon}</span>
        <div className="min-w-0 flex-1">
          <SectionHeader id={titleId} title={kindTitle[kind]} hint={description}
            action={<StatusBadge tone={done ? 'ok' : progress.value > 0 ? 'warn' : 'mute'}>{done ? 'مكتمل' : progress.value > 0 ? 'قيد الإدخال' : 'لم يبدأ'}</StatusBadge>} />
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
          <span className="text-nw-muted">{progress.label}</span>
          <span className="font-bold"><Num value={progress.value} /> من <Num value={progress.max} /></span>
        </div>
        <StockBar value={progress.value} max={Math.max(progress.max, 1)} tone={done ? 'ok' : 'info'} label={`${kindTitle[kind]}: ${progress.label}`} />
        <div className="text-[13px] text-nw-muted">{facts}</div>
      </div>
      {extra}
      <div className="mt-3 flex flex-wrap gap-2">
        <UiButton disabled={locked} aria-expanded={onManual ? undefined : open === 'manual'}
          onClick={() => (onManual ? onManual() : setOpen(open === 'manual' ? null : 'manual'))}>
          <PencilLine className="h-4 w-4" aria-hidden="true" />{manualLabel}
        </UiButton>
        <UiButton disabled={locked} aria-expanded={open === 'import'} onClick={() => setOpen(open === 'import' ? null : 'import')}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />استيراد من Excel
        </UiButton>
      </div>
      {open === 'manual' && !onManual && manual}
      {open === 'import' && <ImportPanel kind={kind} disabled={locked} warehouseId={warehouseId} onSaved={onSaved} />}
    </Card>
  );
};

export const GoLiveSetupView: React.FC = () => {
  const { roleName } = useAuthStore();
  const isOwner = roleName === 'owner';
  const warehouses = useAppStoreSelector(state => state.warehouses);
  const activeBranch = useAppStoreSelector(state => state.activeBranch);
  const { openModal, setActiveTab } = useAppStoreActions();
  const warehouseOptions = useMemo(() => {
    const scoped = warehouses.filter(w => !activeBranch?.id || w.branchId === activeBranch.id);
    return scoped.length ? scoped : warehouses;
  }, [warehouses, activeBranch?.id]);
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState<GoLiveStatus | null>(null);
  const [customerEntries, setCustomerEntries] = useState<OpeningEntry[]>([]);
  const [supplierEntries, setSupplierEntries] = useState<OpeningEntry[]>([]);
  const [loadError, setLoadError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [finishError, setFinishError] = useState('');
  const [finishing, setFinishing] = useState(false);
  const phraseId = useId(), warehouseSelectId = useId();

  useEffect(() => { if (!warehouseId && warehouseOptions[0]) setWarehouseId(warehouseOptions[0].id); }, [warehouseId, warehouseOptions]);

  const refresh = useCallback(async () => {
    if (!isOwner) return;
    try {
      const [nextStatus, customers, suppliers] = await Promise.all([fetchGoLiveStatus(), fetchCustomerOpenings(), fetchSupplierOpenings()]);
      setStatus(nextStatus); setCustomerEntries(customers); setSupplierEntries(suppliers); setLoadError('');
    } catch (error) { setLoadError(errorText(error)); }
  }, [isOwner]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!isOwner) {
    return (
      <div dir="rtl" className="mx-auto max-w-lg p-4 pb-28">
        <Card className="text-center">
          <ShieldAlert className="mx-auto mb-2 h-11 w-11 text-nw-warn" aria-hidden="true" />
          <h1 className="m-0 text-sm font-black text-nw-warn">هذه الشاشة للمالك فقط</h1>
          <p className="m-0 mt-1 text-xs leading-5 text-nw-warn">إدخال الأرصدة الافتتاحية وإنهاء بداية التشغيل صلاحية المالك وحده.</p>
        </Card>
      </div>
    );
  }

  const locked = !status || status.finished;
  const finish = async () => {
    setFinishing(true); setFinishError('');
    try { await finishGoLiveSetup(phrase.trim()); setConfirming(false); setPhrase(''); await refresh(); }
    catch (error) { setFinishError(errorText(error)); } finally { setFinishing(false); }
  };

  return (
    <div dir="rtl" className="min-h-full bg-nw-bg pb-28 lg:pb-8" data-testid="go-live-page">
      <PageHeader title="بداية التشغيل"
        description="أدخل المنتجات والبضاعة الموجودة والأرصدة القديمة مرة واحدة قبل التشغيل الفعلي."
        actions={status && (status.finished
          ? <StatusBadge tone="ok"><Lock className="me-1 h-3.5 w-3.5" aria-hidden="true" />منتهية ومقفلة</StatusBadge>
          : <StatusBadge tone="warn">مفتوحة للإدخال</StatusBadge>)} />
      <div className="space-y-4 px-4 py-4 sm:px-8 sm:py-6">
        {loadError && <p role="alert" className="m-0 rounded-xl bg-nw-bad-bg p-3 text-sm text-nw-bad">{loadError}</p>}
        {status?.finished && (
          <Card className="border-nw-ok bg-nw-ok-bg" data-testid="go-live-finished">
            <p className="m-0 flex items-center gap-2 text-sm font-bold text-nw-ok"><Lock className="h-4 w-4" aria-hidden="true" />تم إنهاء بداية التشغيل نهائياً.</p>
            <p className="m-0 mt-1 text-[13px] text-nw-text">قاعدة البيانات ترفض الآن أي إدخال افتتاحي. التصحيحات تتم بالعمليات العادية (الجرد، الدفعات، الاستلام).
              {status.finishedAt && <> التاريخ: <bdi dir="ltr">{status.finishedAt.slice(0, 16).replace('T', ' ')}</bdi></>}</p>
          </Card>
        )}
        {!status && !loadError && <p role="status" className="m-0 text-sm text-nw-muted">جارٍ تحميل حالة بداية التشغيل…</p>}
        {status && (
          <div className="grid gap-4 xl:grid-cols-2">
            <SetupCard kind="products" icon={<Package className="h-5 w-5" />} locked={locked} onSaved={() => void refresh()}
              description="عرّف الأصناف بالأسعار والطرود؛ المنتج يبدأ برصيد صفر."
              progress={{ value: status.products.importedCount, max: Math.max(status.products.activeCount, status.products.importedCount), label: 'منتجات مستوردة من المعرّفة' }}
              facts={<>المنتجات المعرّفة في النظام: <Num value={status.products.activeCount} /></>}
              manualLabel="إدخال يدوي" manual={null} onManual={() => { setActiveTab('products'); openModal('add_product'); }} />
            <SetupCard kind="stock" icon={<Boxes className="h-5 w-5" />} locked={locked} onSaved={() => void refresh()} warehouseId={warehouseId}
              description="الكميات الموجودة فعلاً بالطرود والحبات، بتكلفة الصنف ودون فاتورة مورد."
              progress={{ value: status.stock.countedProductCount, max: status.stock.stockableCount, label: 'أصناف أُدخل رصيدها' }}
              facts={<>جلسات الرصيد الافتتاحي: <Num value={status.stock.sessionCount} /></>}
              manualLabel="إدخال يدوي" manual={null} onManual={() => openModal('inventory_opening_setup')}
              extra={warehouseOptions.length > 1 && (
                <FormFields className="mt-3">
                  <label htmlFor={warehouseSelectId} className="mb-1 block text-[13px] font-semibold">المستودع للاستيراد</label>
                  <select id={warehouseSelectId} className={fieldClass} value={warehouseId} onChange={event => setWarehouseId(event.target.value)}>
                    {warehouseOptions.map(w => <option key={w.id} value={w.id}>{w.nameAr || w.name}</option>)}
                  </select>
                </FormFields>
              )} />
            <SetupCard kind="customers" icon={<Users className="h-5 w-5" />} locked={locked} onSaved={() => void refresh()}
              description="دين كل عميل قبل النظام بتاريخه الأصلي. يظهر في كشف الحساب كـ«رصيد سابق قبل النظام» ولا يدخل المبيعات أو الأرباح أو الوردية."
              progress={{ value: status.customers.withOpeningCount, max: Math.max(status.customers.customerCount, status.customers.withOpeningCount), label: 'عملاء لهم دين سابق' }}
              facts={<>مجموع الديون السابقة: <Money minor={status.customers.activeTotalInMinorUnits} /></>}
              manualLabel="إدخال يدوي" manual={<ManualOpeningForm kind="customers" disabled={locked} onSaved={() => void refresh()} />}
              extra={<EntryList kind="customers" entries={customerEntries} disabled={locked} onChanged={() => void refresh()} />} />
            <SetupCard kind="suppliers" icon={<Truck className="h-5 w-5" />} locked={locked} onSaved={() => void refresh()}
              description="رصيد كل مورد قبل النظام: «له» إن كنا مدينين له، «عليه» إن كان مديناً لنا."
              progress={{ value: status.suppliers.withOpeningCount, max: Math.max(status.suppliers.supplierCount, status.suppliers.withOpeningCount), label: 'موردون لهم رصيد سابق' }}
              facts={<>له: <Money minor={status.suppliers.payableTotalInMinorUnits} /> · عليه: <Money minor={status.suppliers.advanceTotalInMinorUnits} /></>}
              manualLabel="إدخال يدوي" manual={<ManualOpeningForm kind="suppliers" disabled={locked} onSaved={() => void refresh()} />}
              extra={<EntryList kind="suppliers" entries={supplierEntries} disabled={locked} onChanged={() => void refresh()} />} />
          </div>
        )}
        {status && !status.finished && (
          <Card data-testid="go-live-finish">
            <SectionHeader title="إنهاء بداية التشغيل" hint="خطوة نهائية لا رجعة فيها: بعدها ترفض قاعدة البيانات أي رصيد افتتاحي أو عكسه أو استيراده." />
            {!confirming
              ? <UiButton variant="danger" className="mt-3" onClick={() => setConfirming(true)}><AlertTriangle className="h-4 w-4" aria-hidden="true" />إنهاء بداية التشغيل</UiButton>
              : (
                <FormFields className="mt-3 space-y-2">
                  <label htmlFor={phraseId} className="block text-[13px] font-semibold">{`للتأكيد اكتب: ${GO_LIVE_CONFIRMATION}`}</label>
                  <input id={phraseId} className={fieldClass} value={phrase} onChange={event => setPhrase(event.target.value)} autoComplete="off" />
                  <div className="flex flex-wrap gap-2">
                    <UiButton variant="danger" disabled={finishing || phrase.trim() !== GO_LIVE_CONFIRMATION} onClick={() => void finish()}>تأكيد الإنهاء النهائي</UiButton>
                    <UiButton onClick={() => { setConfirming(false); setPhrase(''); }} disabled={finishing}>تراجع</UiButton>
                  </div>
                  {finishError && <p role="alert" className="m-0 text-sm text-nw-bad">{finishError}</p>}
                </FormFields>
              )}
          </Card>
        )}
      </div>
    </div>
  );
};

export default GoLiveSetupView;

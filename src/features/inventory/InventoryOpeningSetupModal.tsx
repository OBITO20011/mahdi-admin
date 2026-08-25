import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  PackageCheck,
  Search,
  ShieldCheck,
  Upload,
  Warehouse as WarehouseIcon,
  X,
} from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import {
  applyInventoryOpeningSetupInSupabase,
  fetchInventoryOpeningSetupFromSupabase,
  type InventoryOpeningProduct,
  type InventoryOpeningSetup,
} from '../../services/supabase/inventory-opening.service';

interface InventoryOpeningSetupModalProps {
  onClose: () => void;
}

interface OpeningEntry {
  packageCount: string;
  looseUnits: string;
}

const emptyEntry = (): OpeningEntry => ({
  packageCount: '',
  looseUnits: '',
});

const createIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() ||
  `opening-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const integerValue = (value: string): number => {
  if (value.trim() === '') return 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
};

function escapeCsv(value: string | number): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseDelimitedText(content: string): string[][] {
  const firstLine = content.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes('\t')
    ? '\t'
    : firstLine.split(';').length > firstLine.split(',').length
      ? ';'
      : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && content[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

const normalizedHeader = (value: string) =>
  value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');

const findHeaderIndex = (headers: string[], candidates: string[]) =>
  headers.findIndex((header) => candidates.includes(normalizedHeader(header)));

export const InventoryOpeningSetupModal: React.FC<
  InventoryOpeningSetupModalProps
> = ({ onClose }) => {
  const {
    warehouses,
    activeBranch,
    refreshProductsFromSupabase,
    refreshInventoryMovementsFromSupabase,
    setToast,
  } = useAppStore();
  const warehouseOptions = useMemo(
    () =>
      warehouses.filter(
        (warehouse) =>
          !activeBranch?.id || warehouse.branchId === activeBranch.id
      ),
    [activeBranch?.id, warehouses]
  );
  const [warehouseId, setWarehouseId] = useState(
    warehouseOptions[0]?.id || warehouses[0]?.id || ''
  );
  const [setup, setSetup] = useState<InventoryOpeningSetup | null>(null);
  const [entries, setEntries] = useState<Record<string, OpeningEntry>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [notes, setNotes] = useState(
    'جرد افتتاحي فعلي عند بدء استخدام النظام'
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!warehouseId && warehouseOptions[0]?.id) {
      setWarehouseId(warehouseOptions[0].id);
    }
  }, [warehouseId, warehouseOptions]);

  const loadSetup = useCallback(async () => {
    if (!warehouseId) return;
    setIsLoading(true);
    setLoadError('');
    try {
      const result = await fetchInventoryOpeningSetupFromSupabase(warehouseId);
      setSetup(result);
      setEntries({});
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'تعذر تحميل تهيئة المخزون الافتتاحي.';
      setLoadError(message);
      setSetup(null);
    } finally {
      setIsLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  const selectedRows = useMemo(() => {
    if (!setup) return [];
    return setup.products
      .filter((product) => {
        const entry = entries[product.productId];
        return Boolean(
          entry &&
            (entry.packageCount.trim() !== '' || entry.looseUnits.trim() !== '')
        );
      })
      .map((product) => {
        const entry = entries[product.productId] || emptyEntry();
        const packageCount = integerValue(entry.packageCount);
        const looseUnits = integerValue(entry.looseUnits);
        const actualQuantity =
          Number.isFinite(packageCount) && Number.isFinite(looseUnits)
            ? packageCount * product.unitsPerPackage + looseUnits
            : Number.NaN;
        const errors: string[] = [];
        if (!product.eligible) {
          errors.push(product.blockReason || 'الصنف غير مؤهل للرصيد الافتتاحي.');
        }
        if (!Number.isFinite(packageCount) || !Number.isFinite(looseUnits)) {
          errors.push('الكميات يجب أن تكون أعدادًا صحيحة موجبة أو صفرًا.');
        } else if (looseUnits >= product.unitsPerPackage) {
          errors.push(
            `الحبات المتبقية يجب أن تكون أقل من ${product.unitsPerPackage}.`
          );
        }
        if (actualQuantity > 0 && product.costPriceInMinorUnits <= 0) {
          errors.push('تكلفة الشراء غير مدخلة؛ عدّل بطاقة الصنف أولًا.');
        }
        return {
          product,
          packageCount,
          looseUnits,
          actualQuantity,
          difference: Number.isFinite(actualQuantity)
            ? actualQuantity - product.currentQuantity
            : Number.NaN,
          errors,
        };
      });
  }, [entries, setup]);

  const invalidRows = selectedRows.filter((row) => row.errors.length > 0);
  const totalActualQuantity = selectedRows.reduce(
    (sum, row) =>
      sum + (Number.isFinite(row.actualQuantity) ? row.actualQuantity : 0),
    0
  );
  const totalDifference = selectedRows.reduce(
    (sum, row) => sum + (Number.isFinite(row.difference) ? row.difference : 0),
    0
  );

  const filteredProducts = useMemo(() => {
    if (!setup) return [];
    const query = searchQuery.trim().toLowerCase();
    return setup.products.filter((product) => {
      const matchesSearch =
        !query ||
        product.productName.toLowerCase().includes(query) ||
        product.sku.toLowerCase().includes(query) ||
        product.barcode?.toLowerCase().includes(query);
      return matchesSearch && (!eligibleOnly || product.eligible);
    });
  }, [eligibleOnly, searchQuery, setup]);

  const updateEntry = (
    productId: string,
    field: keyof OpeningEntry,
    value: string
  ) => {
    if (value !== '' && !/^\d+$/.test(value)) return;
    setEntries((current) => ({
      ...current,
      [productId]: {
        ...(current[productId] || emptyEntry()),
        [field]: value,
      },
    }));
  };

  const clearEntry = (productId: string) => {
    setEntries((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
  };

  const downloadTemplate = () => {
    if (!setup) return;
    const header = [
      'SKU',
      'اسم الصنف',
      'عدد الطرود',
      'الحبات المتبقية',
      'محتوى الطرد',
      'نوع الطرد',
    ];
    const lines = setup.products.map((product) => [
      product.sku,
      product.productName,
      '',
      '',
      product.unitsPerPackage,
      product.purchasePackageName,
    ]);
    const csv = `\uFEFF${[header, ...lines]
      .map((row) => row.map(escapeCsv).join(','))
      .join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `opening-stock-${setup.warehouse.name}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importTemplate = async (file: File) => {
    if (!setup) return;
    try {
      const rows = parseDelimitedText(await file.text());
      if (rows.length < 2) {
        throw new Error('الملف فارغ أو لا يحتوي أصنافًا.');
      }
      const headers = rows[0];
      const skuIndex = findHeaderIndex(headers, ['sku', 'رمزالصنف']);
      const packagesIndex = findHeaderIndex(headers, [
        'عددالطرود',
        'packages',
        'packagecount',
      ]);
      const looseIndex = findHeaderIndex(headers, [
        'الحباتالمتبقية',
        'looseunits',
        'remainingpieces',
      ]);
      if (skuIndex < 0 || packagesIndex < 0 || looseIndex < 0) {
        throw new Error(
          'استخدم القالب المعتمد؛ الأعمدة المطلوبة: SKU، عدد الطرود، الحبات المتبقية.'
        );
      }

      const productsBySku = new Map<string, InventoryOpeningProduct>(
        setup.products.map(
          (product) =>
            [product.sku.trim().toLowerCase(), product] as [
              string,
              InventoryOpeningProduct,
            ]
        )
      );
      const importedEntries: Record<string, OpeningEntry> = {};
      let imported = 0;
      let ignored = 0;
      const problems: string[] = [];

      rows.slice(1).forEach((row, rowIndex) => {
        const sku = (row[skuIndex] || '').trim().toLowerCase();
        const packageText = (row[packagesIndex] || '').trim();
        const looseText = (row[looseIndex] || '').trim();
        if (!sku || (packageText === '' && looseText === '')) return;
        const product = productsBySku.get(sku);
        if (!product) {
          ignored += 1;
          problems.push(`السطر ${rowIndex + 2}: SKU غير موجود.`);
          return;
        }
        if (!/^\d+$/.test(packageText || '0') || !/^\d+$/.test(looseText || '0')) {
          ignored += 1;
          problems.push(`السطر ${rowIndex + 2}: كمية غير صحيحة.`);
          return;
        }
        const packageCount = Number(packageText || 0);
        const looseUnits = Number(looseText || 0);
        if (looseUnits >= product.unitsPerPackage) {
          ignored += 1;
          problems.push(`السطر ${rowIndex + 2}: الحبات تتجاوز محتوى الطرد.`);
          return;
        }
        importedEntries[product.productId] = {
          packageCount: String(packageCount),
          looseUnits: String(looseUnits),
        };
        imported += 1;
      });

      setEntries((current) => ({ ...current, ...importedEntries }));
      setToast(
        ignored > 0
          ? `تم استيراد ${imported} صنف وتجاهل ${ignored}. ${problems[0] || ''}`
          : `تم استيراد ${imported} صنف من ملف Excel بنجاح.`,
        ignored > 0 ? 'info' : 'success'
      );
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : 'تعذر قراءة ملف المخزون.',
        'error'
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleApply = async () => {
    if (
      !warehouseId ||
      selectedRows.length === 0 ||
      invalidRows.length > 0 ||
      notes.trim().length < 5 ||
      isSubmitting
    ) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await applyInventoryOpeningSetupInSupabase({
        warehouseId,
        rows: selectedRows.map((row) => ({
          productId: row.product.productId,
          packageCount: row.packageCount,
          looseUnits: row.looseUnits,
        })),
        notes,
        idempotencyKey,
      });
      await Promise.all([
        refreshProductsFromSupabase(),
        refreshInventoryMovementsFromSupabase(),
      ]);
      setToast(`${result.message} رقم الجلسة: ${result.sessionNumber}`, 'success');
      setEntries({});
      setShowReview(false);
      setIdempotencyKey(createIdempotencyKey());
      await loadSetup();
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : 'تعذر اعتماد المخزون الافتتاحي.',
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-l from-indigo-950/80 to-slate-950 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300">
            <Boxes className="h-5 w-5" />
          </div>
          <div>
            <h4 className="font-black text-indigo-100">إدخال البضاعة الموجودة قبل تشغيل النظام</h4>
            <p className="mt-1 leading-5 text-slate-400">
              أدخل العدد الفعلي مرة واحدة. لن ينشئ النظام فاتورة مورد أو مديونية،
              وستُحفظ كل الكميات كحركات افتتاحية مدققة.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <label className="space-y-1.5">
          <span className="flex items-center gap-1.5 font-bold text-slate-300">
            <WarehouseIcon className="h-3.5 w-3.5 text-indigo-400" />
            المستودع الذي تم جرده
          </span>
          <select
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-bold text-white focus:border-indigo-500 focus:outline-none"
          >
            {warehouseOptions.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={downloadTemplate}
            disabled={!setup || isLoading}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-800 bg-emerald-950/30 px-3 py-2.5 font-bold text-emerald-300 disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            تنزيل قالب Excel
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!setup || isLoading}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 font-bold text-white disabled:opacity-40"
          >
            <Upload className="h-4 w-4" />
            استيراد الملف
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importTemplate(file);
            }}
          />
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-3 text-[11px] leading-5 text-amber-200">
        <FileSpreadsheet className="ml-1 inline h-4 w-4" />
        القالب بصيغة CSV المتوافقة مع Excel. لا تغيّر SKU؛ عبّئ فقط عدد الطرود
        والحبات المتبقية ثم احفظ الملف بصيغة CSV.
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="ابحث باسم الصنف أو SKU أو الباركود..."
            className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-white focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => setEligibleOnly((current) => !current)}
          className={`rounded-xl border px-3 py-2.5 font-bold transition ${
            eligibleOnly
              ? 'border-emerald-600 bg-emerald-950/50 text-emerald-300'
              : 'border-slate-700 bg-slate-900 text-slate-300'
          }`}
        >
          المؤهل للتهيئة فقط
        </button>
      </div>

      {isLoading ? (
        <div className="flex min-h-52 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/40 text-slate-400">
          <Loader2 className="ml-2 h-5 w-5 animate-spin text-indigo-400" />
          جاري تحميل الأصناف من Supabase...
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-rose-800 bg-rose-950/30 p-5 text-center text-rose-300">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => void loadSetup()}
            className="mt-3 rounded-lg bg-rose-700 px-4 py-2 font-bold text-white"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : setup ? (
        <div className="max-h-[48vh] space-y-2 overflow-y-auto pl-1">
          {filteredProducts.map((product) => {
            const entry = entries[product.productId] || emptyEntry();
            const packages = integerValue(entry.packageCount);
            const loose = integerValue(entry.looseUnits);
            const actual =
              Number.isFinite(packages) && Number.isFinite(loose)
                ? packages * product.unitsPerPackage + loose
                : 0;
            const isSelected =
              entry.packageCount.trim() !== '' || entry.looseUnits.trim() !== '';
            const rowErrors =
              selectedRows.find((row) => row.product.productId === product.productId)
                ?.errors || [];

            return (
              <article
                key={product.productId}
                className={`rounded-2xl border p-3 transition ${
                  isSelected
                    ? rowErrors.length > 0
                      ? 'border-rose-700 bg-rose-950/20'
                      : 'border-indigo-600 bg-indigo-950/20'
                    : 'border-slate-800 bg-slate-950/50'
                } ${!product.eligible ? 'opacity-75' : ''}`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h5 className="truncate font-black text-slate-100">
                        {product.productName}
                      </h5>
                      <span className="rounded-md bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                        {product.sku}
                      </span>
                      {!product.eligible && (
                        <span className="rounded-full bg-rose-950 px-2 py-0.5 text-[9px] font-bold text-rose-300">
                          استخدم الجرد
                        </span>
                      )}
                      {product.costPriceInMinorUnits <= 0 && (
                        <span className="rounded-full bg-amber-950 px-2 py-0.5 text-[9px] font-bold text-amber-300">
                          التكلفة ناقصة
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      النظام الآن: {Math.floor(product.currentQuantity / product.unitsPerPackage)}{' '}
                      {product.purchasePackageName} +{' '}
                      {product.currentQuantity % product.unitsPerPackage}{' '}
                      {product.baseUnitName} ({product.currentQuantity} إجمالي)
                    </p>
                    {!product.eligible && (
                      <p className="mt-1 text-[10px] leading-4 text-rose-300">
                        {product.blockReason}
                      </p>
                    )}
                  </div>

                  <div className="grid shrink-0 grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <label className="space-y-1">
                      <span className="block text-[9px] font-bold text-slate-400">
                        عدد {product.purchasePackageName}
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        disabled={!product.eligible}
                        value={entry.packageCount}
                        onChange={(event) =>
                          updateEntry(
                            product.productId,
                            'packageCount',
                            event.target.value
                          )
                        }
                        placeholder="0"
                        className="w-full min-w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-center font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[9px] font-bold text-slate-400">
                        باقي {product.baseUnitName}
                      </span>
                      <input
                        type="number"
                        min="0"
                        max={product.unitsPerPackage - 1}
                        step="1"
                        disabled={!product.eligible}
                        value={entry.looseUnits}
                        onChange={(event) =>
                          updateEntry(
                            product.productId,
                            'looseUnits',
                            event.target.value
                          )
                        }
                        placeholder="0"
                        className="w-full min-w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-center font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!isSelected}
                      onClick={() => clearEntry(product.productId)}
                      className="mb-0.5 rounded-lg border border-slate-700 p-2 text-slate-500 transition hover:text-rose-400 disabled:opacity-20"
                      aria-label={`مسح إدخال ${product.productName}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {isSelected && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2 text-[10px]">
                    <span className="font-bold text-indigo-300">
                      الإجمالي المحسوب: {actual} {product.baseUnitName}
                    </span>
                    <span
                      className={
                        actual - product.currentQuantity >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }
                    >
                      الفرق عن النظام: {actual - product.currentQuantity > 0 ? '+' : ''}
                      {actual - product.currentQuantity}
                    </span>
                    {rowErrors.map((error) => (
                      <span key={error} className="w-full text-rose-300">
                        {error}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}

          {filteredProducts.length === 0 && (
            <div className="rounded-2xl border border-slate-800 p-8 text-center text-slate-500">
              لا توجد أصناف مطابقة.
            </div>
          )}
        </div>
      ) : null}

      {setup && setup.recentSessions.length > 0 && (
        <details className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-bold text-slate-300">
            <History className="h-4 w-4 text-indigo-400" />
            آخر جلسات المخزون الافتتاحي
          </summary>
          <div className="mt-3 space-y-2">
            {setup.recentSessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-2.5"
              >
                <div>
                  <b className="text-indigo-300">{session.sessionNumber}</b>
                  <span className="mt-0.5 block text-[9px] text-slate-500">
                    {session.itemCount} صنف • {session.createdByName}
                  </span>
                </div>
                <div className="text-left text-[9px] text-slate-500">
                  <span className="block">
                    {new Date(session.createdAt).toLocaleString('ar-JO')}
                  </span>
                  <span>الإجمالي: {session.totalActualQuantity}</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <label className="block space-y-1.5">
        <span className="font-bold text-slate-300">ملاحظة جلسة التهيئة *</span>
        <input
          value={notes}
          maxLength={500}
          onChange={(event) => setNotes(event.target.value)}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white focus:border-indigo-500 focus:outline-none"
        />
      </label>

      <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-slate-800 bg-slate-900/95 px-5 py-3 backdrop-blur">
        <div className="mb-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-950 p-2">
            <span className="block text-[9px] text-slate-500">الأصناف المدخلة</span>
            <b className="text-slate-200">{selectedRows.length}</b>
          </div>
          <div className="rounded-xl bg-slate-950 p-2">
            <span className="block text-[9px] text-slate-500">إجمالي الحبات</span>
            <b className="text-indigo-300">{totalActualQuantity}</b>
          </div>
          <div className="rounded-xl bg-slate-950 p-2">
            <span className="block text-[9px] text-slate-500">فرق النظام</span>
            <b className={totalDifference >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {totalDifference > 0 ? '+' : ''}{totalDifference}
            </b>
          </div>
        </div>
        {invalidRows.length > 0 && (
          <p className="mb-2 text-center text-[10px] font-bold text-rose-300">
            صحح {invalidRows.length} صف قبل المتابعة.
          </p>
        )}
        <button
          type="button"
          disabled={
            selectedRows.length === 0 ||
            invalidRows.length > 0 ||
            notes.trim().length < 5 ||
            isLoading
          }
          onClick={() => setShowReview(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 font-black text-white shadow-lg transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ClipboardCheck className="h-4 w-4" />
          مراجعة واعتماد المخزون الافتتاحي
        </button>
      </div>

      {showReview && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/90 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-lg space-y-4 rounded-t-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-black text-white">تأكيد الجرد الافتتاحي</h4>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">
                  سيتم ضبط الكمية الفعلية لـ{selectedRows.length} صنف داخل{' '}
                  {setup?.warehouse.name}. العملية ذرية ومسجلة ولا تنشئ حساب مورد.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-center">
                <span className="block text-[10px] text-slate-500">الإجمالي بعد الاعتماد</span>
                <b className="text-lg text-indigo-300">{totalActualQuantity}</b>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-center">
                <span className="block text-[10px] text-slate-500">صافي التغيير</span>
                <b className={totalDifference >= 0 ? 'text-lg text-emerald-400' : 'text-lg text-rose-400'}>
                  {totalDifference > 0 ? '+' : ''}{totalDifference}
                </b>
              </div>
            </div>

            <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 p-3 text-[11px] leading-5 text-amber-200">
              <AlertTriangle className="ml-1 inline h-4 w-4" />
              هل أنهيتم العد الفعلي؟ بعد بدء المبيعات أو الاستلام تصبح أي فروقات
              لاحقة من خلال شاشة الجرد المعتادة.
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleApply()}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-black text-white disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PackageCheck className="h-4 w-4" />
                )}
                {isSubmitting ? 'جاري الاعتماد...' : 'نعم، اعتمد الجرد'}
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setShowReview(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 py-3 font-bold text-slate-300"
              >
                عودة للمراجعة
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-2 text-[10px] text-slate-500">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        محفوظ عبر PostgreSQL RPC وسجل التدقيق
        <button type="button" onClick={onClose} className="text-slate-400 underline">
          إغلاق
        </button>
      </div>
    </div>
  );
};

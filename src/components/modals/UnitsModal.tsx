import React, { useMemo, useState } from 'react';
import {
  Archive,
  Check,
  Edit3,
  Loader2,
  LockKeyhole,
  Plus,
  RotateCcw,
  Scale,
} from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { UnitDefinition } from '../../types';

export const UnitsModal: React.FC<{ onClose: () => void }> = () => {
  const {
    units,
    addUnit,
    updateUnit,
    setUnitActive,
  } = useAppStore();
  const [mode, setMode] = useState<'idle' | 'add' | 'edit'>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameAr, setNameAr] = useState('');
  const [code, setCode] = useState('');
  const [conversionFactor, setConversionFactor] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const sortedUnits = useMemo(
    () =>
      [...units].sort((a, b) => {
        if (Boolean(a.isHidden) !== Boolean(b.isHidden)) {
          return a.isHidden ? 1 : -1;
        }
        if (Boolean(a.isSystem) !== Boolean(b.isSystem)) {
          return a.isSystem ? -1 : 1;
        }
        return a.nameAr.localeCompare(b.nameAr, 'ar');
      }),
    [units]
  );

  const resetForm = () => {
    setMode('idle');
    setEditingId(null);
    setNameAr('');
    setCode('');
    setConversionFactor(1);
    setError('');
  };

  const startEdit = (unit: UnitDefinition) => {
    setMode('edit');
    setEditingId(unit.id);
    setNameAr(unit.nameAr);
    setCode(unit.code);
    setConversionFactor(unit.conversionFactor);
    setError('');
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameAr.trim() || !code.trim()) {
      setError('اسم الوحدة وكودها مطلوبان.');
      return;
    }

    setIsSaving(true);
    setError('');
    const input = {
      nameAr: nameAr.trim(),
      code: code.trim().toUpperCase(),
      conversionFactor: Math.max(
        1,
        Math.floor(Number(conversionFactor) || 1)
      ),
    };
    const result =
      mode === 'edit' && editingId
        ? await updateUnit(editingId, input)
        : await addUnit(input);
    setIsSaving(false);

    if (!result?.success) {
      setError(result?.error || 'تعذر حفظ وحدة القياس.');
      return;
    }
    resetForm();
  };

  const changeVisibility = async (unit: UnitDefinition) => {
    const willActivate = Boolean(unit.isHidden);
    if (
      !willActivate &&
      !window.confirm(
        `هل أنت متأكد من إخفاء وحدة "${unit.nameAr}"؟ لن تظهر للعمليات الجديدة.`
      )
    ) {
      return;
    }

    setBusyId(unit.id);
    setError('');
    const result = await setUnitActive(unit.id, willActivate);
    setBusyId(null);
    if (!result?.success) {
      setError(result?.error || 'تعذر تحديث حالة وحدة القياس.');
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-black text-nw-text">وحدات القياس والتعبئة</p>
          <p className="mt-0.5 text-[9px] text-nw-muted">
            وحدات النظام محمية، ويمكن إدارة الوحدات المخصصة
          </p>
        </div>
        {mode === 'idle' && (
          <button
            type="button"
            onClick={() => {
              resetForm();
              setMode('add');
            }}
            className="flex items-center gap-1 rounded-xl bg-nw-primary px-3 py-2 font-black text-nw-on-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            إضافة وحدة
          </button>
        )}
      </div>

      {mode !== 'idle' && (
        <form
          onSubmit={handleSave}
          className="space-y-2 rounded-2xl border border-nw-info/35 bg-nw-bg p-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              value={nameAr}
              onChange={(event) => setNameAr(event.target.value)}
              placeholder="اسم الوحدة *"
              className="rounded-xl border border-nw-border bg-nw-surface px-3 py-2 text-nw-text outline-none focus:border-nw-info"
            />
            <input
              required
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="الكود مثل PAL"
              className="rounded-xl border border-nw-border bg-nw-surface px-3 py-2 text-left font-mono uppercase text-nw-text outline-none focus:border-nw-info"
            />
          </div>
          <label className="block">
            <span className="mb-1 block text-[9px] font-bold text-nw-muted">
              معامل التعبئة الافتراضي
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={conversionFactor}
              onChange={(event) =>
                setConversionFactor(
                  Math.max(1, Math.floor(Number(event.target.value) || 1))
                )
              }
              className="w-full rounded-xl border border-nw-border bg-nw-surface px-3 py-2 text-center font-black text-nw-text outline-none focus:border-nw-info"
            />
          </label>
          {error && <p className="font-bold text-nw-bad">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isSaving}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-nw-primary py-2 font-black text-nw-on-primary disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {mode === 'edit' ? 'حفظ التعديل' : 'حفظ الوحدة'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={isSaving}
              className="rounded-xl bg-nw-surface-2 px-3 py-2 font-bold text-nw-text"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {mode === 'idle' && error && (
        <div className="rounded-xl border border-nw-bad/30 bg-nw-bad-bg p-2.5 font-bold text-nw-bad">
          {error}
        </div>
      )}

      <div className="max-h-80 space-y-2 overflow-y-auto">
        {sortedUnits.map((unit) => {
          const isBusy = busyId === unit.id;
          const hasProducts = (unit.productsCount || 0) > 0;
          return (
            <div
              key={unit.id}
              className={`flex items-center justify-between rounded-2xl border border-nw-border p-3 ${
                unit.isHidden ? 'bg-nw-bg opacity-65' : 'bg-nw-bg'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-nw-ok-bg text-nw-ok">
                  <Scale className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h5 className="truncate font-black text-nw-text">
                      {unit.nameAr}{' '}
                      <span className="font-mono text-[9px] text-nw-muted">
                        ({unit.code})
                      </span>
                    </h5>
                    {unit.isSystem && (
                      <LockKeyhole
                        className="h-3 w-3 text-nw-info"
                        aria-label="وحدة نظام محمية"
                      />
                    )}
                    {unit.isHidden && (
                      <span className="rounded-full bg-nw-surface-2 px-1.5 py-0.5 text-[8px] font-bold text-nw-muted">
                        مخفية
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[9px] text-nw-muted">
                    معامل افتراضي {unit.conversionFactor} •{' '}
                    {unit.productsCount || 0} صنف مرتبط
                  </p>
                </div>
              </div>

              {!unit.isSystem && (
                <div className="flex items-center gap-1">
                  {!unit.isHidden && (
                    <button
                      type="button"
                      onClick={() => startEdit(unit)}
                      className="rounded-lg p-2 text-nw-muted hover:bg-nw-info-bg hover:text-nw-info"
                      title="تعديل الوحدة"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => changeVisibility(unit)}
                    disabled={isBusy || (!unit.isHidden && hasProducts)}
                    className={`rounded-lg p-2 disabled:cursor-not-allowed disabled:opacity-25 ${
                      unit.isHidden
                        ? 'text-nw-ok hover:bg-nw-ok-bg'
                        : 'text-nw-muted hover:bg-nw-warn-bg hover:text-nw-warn'
                    }`}
                    title={
                      unit.isHidden
                        ? 'إعادة إظهار الوحدة'
                        : hasProducts
                          ? 'عدّل الأصناف المرتبطة أولاً'
                          : 'إخفاء الوحدة'
                    }
                  >
                    {unit.isHidden ? (
                      <RotateCcw
                        className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`}
                      />
                    ) : (
                      <Archive
                        className={`h-3.5 w-3.5 ${isBusy ? 'animate-pulse' : ''}`}
                      />
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

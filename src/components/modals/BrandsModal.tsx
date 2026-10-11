import React, { useMemo, useState } from 'react';
import {
  Archive,
  Check,
  Edit3,
  Loader2,
  Plus,
  RotateCcw,
  Tag,
} from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { Brand } from '../../types';

export const BrandsModal: React.FC<{ onClose: () => void }> = () => {
  const {
    brands,
    addBrand,
    updateBrand,
    setBrandActive,
  } = useAppStore();
  const [mode, setMode] = useState<'idle' | 'add' | 'edit'>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameAr, setNameAr] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const visibleBrands = useMemo(() => {
    const activeNames = new Set(
      brands
        .filter((brand) => !brand.isHidden)
        .map((brand) => brand.nameAr.trim().toLocaleLowerCase('ar'))
    );

    return brands.filter(
      (brand) =>
        !brand.isHidden ||
        !activeNames.has(brand.nameAr.trim().toLocaleLowerCase('ar'))
    );
  }, [brands]);

  const sortedBrands = useMemo(
    () =>
      [...visibleBrands].sort((a, b) => {
        if (Boolean(a.isHidden) !== Boolean(b.isHidden)) {
          return a.isHidden ? 1 : -1;
        }
        return a.nameAr.localeCompare(b.nameAr, 'ar');
      }),
    [visibleBrands]
  );
  const activeCount = visibleBrands.filter((brand) => !brand.isHidden).length;

  const resetForm = () => {
    setMode('idle');
    setEditingId(null);
    setNameAr('');
    setLogoUrl('');
    setError('');
  };

  const startEdit = (brand: Brand) => {
    setMode('edit');
    setEditingId(brand.id);
    setNameAr(brand.nameAr);
    setLogoUrl(brand.logoUrl || '');
    setError('');
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameAr.trim()) {
      setError('اسم العلامة التجارية مطلوب.');
      return;
    }

    setIsSaving(true);
    setError('');
    const result =
      mode === 'edit' && editingId
        ? await updateBrand(editingId, {
            nameAr: nameAr.trim(),
            logoUrl: logoUrl.trim(),
          })
        : await addBrand({
            nameAr: nameAr.trim(),
            logoUrl: logoUrl.trim(),
          });
    setIsSaving(false);

    if (!result?.success) {
      setError(result?.error || 'تعذر حفظ العلامة التجارية.');
      return;
    }
    resetForm();
  };

  const changeVisibility = async (brand: Brand) => {
    const willActivate = Boolean(brand.isHidden);
    if (
      !willActivate &&
      !window.confirm(
        `هل أنت متأكد من إخفاء العلامة التجارية "${brand.nameAr}"؟ لن تظهر عند إضافة منتج جديد.`
      )
    ) {
      return;
    }

    setBusyId(brand.id);
    setError('');
    const result = await setBrandActive(brand.id, willActivate);
    setBusyId(null);
    if (!result?.success) {
      setError(result?.error || 'تعذر تحديث حالة العلامة التجارية.');
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-black text-nw-text">العلامات التجارية</p>
          <p className="mt-0.5 text-[9px] text-nw-muted">
            {activeCount} نشطة من أصل {visibleBrands.length}
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
            إضافة علامة
          </button>
        )}
      </div>

      {mode !== 'idle' && (
        <form
          onSubmit={handleSave}
          className="space-y-2 rounded-2xl border border-nw-info/35 bg-nw-bg p-3"
        >
          <input
            required
            value={nameAr}
            onChange={(event) => setNameAr(event.target.value)}
            placeholder="اسم العلامة التجارية *"
            className="w-full rounded-xl border border-nw-border bg-nw-surface px-3 py-2 text-nw-text outline-none focus:border-nw-info"
          />
          <input
            value={logoUrl}
            onChange={(event) => setLogoUrl(event.target.value)}
            placeholder="رابط الشعار — اختياري"
            className="w-full rounded-xl border border-nw-border bg-nw-surface px-3 py-2 text-nw-text outline-none focus:border-nw-info"
          />
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
              {mode === 'edit' ? 'حفظ التعديل' : 'حفظ العلامة'}
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
        {sortedBrands.map((brand) => {
          const isBusy = busyId === brand.id;
          const hasProducts = (brand.productsCount || 0) > 0;
          return (
            <div
              key={brand.id}
              className={`flex items-center justify-between rounded-2xl border border-nw-border p-3 ${
                brand.isHidden ? 'bg-nw-bg opacity-65' : 'bg-nw-bg'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-nw-warn-bg text-nw-warn">
                  {brand.logoUrl ? (
                    <img
                      src={brand.logoUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Tag className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h5 className="truncate font-black text-nw-text">
                      {brand.nameAr}
                    </h5>
                    {brand.isHidden && (
                      <span className="rounded-full bg-nw-surface-2 px-1.5 py-0.5 text-[8px] font-bold text-nw-muted">
                        مخفية
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[9px] text-nw-muted">
                    {brand.productsCount || 0} صنف مرتبط
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {!brand.isHidden && (
                  <button
                    type="button"
                    onClick={() => startEdit(brand)}
                    className="rounded-lg p-2 text-nw-muted hover:bg-nw-info-bg hover:text-nw-info"
                    title="تعديل العلامة"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => changeVisibility(brand)}
                  disabled={isBusy || (!brand.isHidden && hasProducts)}
                  className={`rounded-lg p-2 disabled:cursor-not-allowed disabled:opacity-25 ${
                    brand.isHidden
                      ? 'text-nw-ok hover:bg-nw-ok-bg'
                      : 'text-nw-muted hover:bg-nw-warn-bg hover:text-nw-warn'
                  }`}
                  title={
                    brand.isHidden
                      ? 'إعادة إظهار العلامة'
                      : hasProducts
                        ? 'عدّل الأصناف المرتبطة أولاً'
                        : 'إخفاء العلامة'
                  }
                >
                  {brand.isHidden ? (
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
            </div>
          );
        })}
      </div>
    </div>
  );
};

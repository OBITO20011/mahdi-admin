import React, { useMemo, useState } from 'react';
import {
  Archive,
  Check,
  Edit3,
  FolderTree,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';

export const CategoriesModal: React.FC<{ onClose: () => void }> = ({
  onClose,
}) => {
  const {
    categories,
    addCategory,
    updateCategory,
    setCategoryActive,
  } = useAppStore();
  const [mode, setMode] = useState<'idle' | 'add' | 'edit'>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameAr, setNameAr] = useState('');
  const [code, setCode] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const sortedCategories = useMemo(
    () =>
      [...categories].sort((a, b) => {
        if (Boolean(a.isHidden) !== Boolean(b.isHidden)) {
          return a.isHidden ? 1 : -1;
        }
        return a.nameAr.localeCompare(b.nameAr, 'ar');
      }),
    [categories]
  );
  const activeCount = categories.filter((category) => !category.isHidden)
    .length;

  const resetForm = () => {
    setMode('idle');
    setEditingId(null);
    setNameAr('');
    setCode('');
    setError('');
  };

  const startAdd = () => {
    resetForm();
    setMode('add');
  };

  const startEdit = (category: (typeof categories)[number]) => {
    setMode('edit');
    setEditingId(category.id);
    setNameAr(category.nameAr);
    setCode(category.code || '');
    setError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameAr.trim()) {
      setError('اسم القسم مطلوب.');
      return;
    }

    setIsSaving(true);
    setError('');
    const result =
      mode === 'edit' && editingId
        ? await updateCategory(editingId, {
            nameAr: nameAr.trim(),
            code: code.trim(),
          })
        : await addCategory({
            nameAr: nameAr.trim(),
            code: code.trim(),
          });
    setIsSaving(false);

    if (!result?.success) {
      setError(result?.error || 'تعذر حفظ القسم.');
      return;
    }

    resetForm();
  };

  const changeCategoryVisibility = async (
    category: (typeof categories)[number]
  ) => {
    const willActivate = Boolean(category.isHidden);
    if (
      !willActivate &&
      !window.confirm(
        `هل أنت متأكد من إخفاء قسم "${category.nameAr}"؟ لن يظهر عند إضافة منتج جديد.`
      )
    ) {
      return;
    }

    setBusyId(category.id);
    await setCategoryActive(category.id, willActivate);
    setBusyId(null);
  };

  return (
    <div dir="rtl" className="space-y-3 text-xs">
      <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-950/40 to-slate-950 p-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
              <FolderTree className="h-4 w-4" />
            </span>
            <div>
              <h4 className="font-black text-slate-100">
                أقسام مرنة للكتالوج
              </h4>
              <p className="text-[10px] text-slate-500">
                {activeCount} نشط من أصل {categories.length}
              </p>
            </div>
          </div>
          {mode === 'idle' && (
            <button
              type="button"
              onClick={startAdd}
              className="flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 font-black text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              قسم جديد
            </button>
          )}
        </div>
        <p className="mt-3 border-t border-white/5 pt-2.5 text-[10px] leading-5 text-slate-400">
          يمكنك إنشاء أي قسم يناسب بضاعتكم. القسم المرتبط بأصناف لا يُحذف
          لحماية التقارير؛ انقل أصنافه أولًا ثم أخفه.
        </p>
      </div>

      {mode !== 'idle' && (
        <form
          onSubmit={handleSubmit}
          className="space-y-2.5 rounded-2xl border border-blue-500/30 bg-slate-950 p-3.5"
        >
          <div className="flex items-center justify-between">
            <h4 className="font-black text-blue-300">
              {mode === 'edit' ? 'تعديل القسم' : 'إضافة قسم جديد'}
            </h4>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg p-1 text-slate-500 hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <input
              required
              value={nameAr}
              onChange={(event) => {
                setNameAr(event.target.value);
                setError('');
              }}
              placeholder="اسم القسم بالعربية *"
              className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 font-bold text-slate-100 outline-none focus:border-blue-500"
            />
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="رمز اختياري"
              className="rounded-xl border border-slate-800 bg-slate-900 px-2 py-2.5 text-center font-mono text-[10px] text-slate-300 outline-none focus:border-blue-500"
            />
          </div>
          {error && (
            <p className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 font-bold text-rose-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isSaving}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 font-black text-white disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {isSaving ? 'جاري الحفظ...' : 'حفظ القسم'}
          </button>
        </form>
      )}

      <div className="max-h-80 space-y-2 overflow-y-auto">
        {sortedCategories.map((category) => {
          const hasProducts = (category.productsCount || 0) > 0;
          const isBusy = busyId === category.id;

          return (
            <div
              key={category.id}
              className={`flex items-center justify-between rounded-2xl border p-3 transition ${
                category.isHidden
                  ? 'border-slate-800 bg-slate-950/50 opacity-65'
                  : 'border-slate-800 bg-slate-950'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-black ${
                    category.isHidden
                      ? 'bg-slate-800 text-slate-500'
                      : 'bg-blue-500/10 text-blue-400'
                  }`}
                >
                  {category.nameAr.trim().charAt(0)}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h5 className="truncate font-black text-slate-200">
                      {category.nameAr}
                    </h5>
                    {category.isHidden && (
                      <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[8px] font-bold text-slate-500">
                        مخفي
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[9px] text-slate-500">
                    {category.productsCount || 0} صنف
                    {category.code ? ` • ${category.code}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {!category.isHidden && (
                  <button
                    type="button"
                    onClick={() => startEdit(category)}
                    className="rounded-lg p-2 text-slate-500 transition hover:bg-blue-500/10 hover:text-blue-400"
                    title="تعديل القسم"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => changeCategoryVisibility(category)}
                  disabled={isBusy || (!category.isHidden && hasProducts)}
                  className={`rounded-lg p-2 transition disabled:cursor-not-allowed disabled:opacity-25 ${
                    category.isHidden
                      ? 'text-emerald-400 hover:bg-emerald-500/10'
                      : 'text-slate-500 hover:bg-amber-500/10 hover:text-amber-400'
                  }`}
                  title={
                    category.isHidden
                      ? 'إعادة إظهار القسم'
                      : hasProducts
                        ? 'انقل الأصناف أولًا'
                        : 'إخفاء القسم'
                  }
                >
                  {category.isHidden ? (
                    <RotateCcw
                      className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`}
                    />
                  ) : (
                    <Archive className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-xl bg-slate-800 py-2.5 font-bold text-slate-300"
      >
        تم
      </button>
    </div>
  );
};

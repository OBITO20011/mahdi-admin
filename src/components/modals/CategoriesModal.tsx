import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  Edit3,
  FolderTree,
  ImagePlus,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  removeUploadedProductImage,
  uploadCategoryImageToSupabase,
} from '../../services/supabase/product-images.service';
import { useAppStore } from '../../stores/useAppStore';
import { validateProductImage } from '../../utils/productImage';

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
  const [imageUrl, setImageUrl] = useState('');
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(
    null
  );
  const [selectedImagePreview, setSelectedImagePreview] = useState('');
  const [imageError, setImageError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!selectedImageFile) {
      setSelectedImagePreview('');
      return;
    }

    const objectUrl = URL.createObjectURL(selectedImageFile);
    setSelectedImagePreview(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedImageFile]);

  const imagePreviewSource = selectedImagePreview || imageUrl;

  const resetForm = () => {
    setMode('idle');
    setEditingId(null);
    setNameAr('');
    setCode('');
    setImageUrl('');
    setSelectedImageFile(null);
    setImageError('');
    setImageFailed(false);
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
    setImageUrl(category.imageUrl || '');
    setSelectedImageFile(null);
    setImageError('');
    setImageFailed(false);
    setError('');
  };

  const handleImageSelection = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    const validationError = validateProductImage(file);
    if (validationError) {
      setSelectedImageFile(null);
      setImageError(validationError);
      return;
    }

    setSelectedImageFile(file);
    setImageError('');
    setImageFailed(false);
  };

  const clearCategoryImage = () => {
    setImageUrl('');
    setSelectedImageFile(null);
    setImageError('');
    setImageFailed(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameAr.trim()) {
      setError('اسم القسم مطلوب.');
      return;
    }

    setIsSaving(true);
    setError('');
    let uploadedStoragePath: string | undefined;

    try {
      let nextImageUrl = imageUrl.trim();

      if (selectedImageFile) {
        const uploadResult = await uploadCategoryImageToSupabase(
          selectedImageFile
        );
        if (!uploadResult.success || !uploadResult.publicUrl) {
          setImageError(
            uploadResult.error || 'تعذر رفع صورة القسم إلى Supabase.'
          );
          return;
        }

        uploadedStoragePath = uploadResult.storagePath;
        nextImageUrl = uploadResult.publicUrl;
      }

      const result =
        mode === 'edit' && editingId
          ? await updateCategory(editingId, {
              nameAr: nameAr.trim(),
              code: code.trim(),
              imageUrl: nextImageUrl,
            })
          : await addCategory({
              nameAr: nameAr.trim(),
              code: code.trim(),
              imageUrl: nextImageUrl,
            });

      if (!result?.success) {
        if (uploadedStoragePath) {
          await removeUploadedProductImage(uploadedStoragePath);
        }
        setError(result?.error || 'تعذر حفظ القسم.');
        return;
      }

      resetForm();
    } catch (saveError: any) {
      if (uploadedStoragePath) {
        await removeUploadedProductImage(uploadedStoragePath);
      }
      setError(saveError?.message || 'حدث خطأ غير متوقع أثناء حفظ القسم.');
    } finally {
      setIsSaving(false);
    }
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
    try { await setCategoryActive(category.id, willActivate); } finally { setBusyId(null); }
  };

  return (
    <div aria-busy={isSaving || busyId !== null} dir="rtl" className="space-y-3 text-xs">
      <div className="rounded-2xl border border-nw-info/20 bg-nw-surface-2 from-nw-info-bg to-nw-border p-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-nw-info-bg text-nw-info">
              <FolderTree className="h-4 w-4" />
            </span>
            <div>
              <h4 className="font-black text-nw-text">
                أقسام مرنة للكتالوج
              </h4>
              <p className="text-[10px] text-nw-muted">
                {activeCount} نشط من أصل {categories.length}
              </p>
            </div>
          </div>
          {mode === 'idle' && (
            <button
              type="button"
              onClick={startAdd}
              className="flex items-center gap-1 rounded-xl bg-nw-primary px-3 py-2 font-black text-nw-on-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              قسم جديد
            </button>
          )}
        </div>
        <p className="mt-3 border-t border-white/5 pt-2.5 text-[10px] leading-5 text-nw-muted">
          يمكنك إنشاء أي قسم يناسب بضاعتكم. القسم المرتبط بأصناف لا يُحذف
          لحماية التقارير؛ انقل أصنافه أولًا ثم أخفه.
        </p>
      </div>

      {mode !== 'idle' && (
        <form
          onSubmit={handleSubmit}
          className="space-y-2.5 rounded-2xl border border-nw-info/30 bg-nw-bg p-3.5"
        >
          <div className="flex items-center justify-between">
            <h4 className="font-black text-nw-info">
              {mode === 'edit' ? 'تعديل القسم' : 'إضافة قسم جديد'}
            </h4>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg p-1 text-nw-muted hover:text-nw-text"
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
              className="rounded-xl border border-nw-border bg-nw-surface px-3 py-2.5 font-bold text-nw-text outline-none focus:border-nw-info"
            />
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="رمز اختياري"
              className="rounded-xl border border-nw-border bg-nw-surface px-2 py-2.5 text-center font-mono text-[10px] text-nw-text outline-none focus:border-nw-info"
            />
          </div>
          <div className="rounded-xl border border-nw-border bg-nw-surface p-2.5">
            <div className="flex items-center gap-2.5">
              <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-nw-border bg-nw-surface text-nw-muted">
                <span className="text-lg font-black">
                  {nameAr.trim().charAt(0) || 'ق'}
                </span>
                {imagePreviewSource && !imageFailed && (
                  <img
                    src={imagePreviewSource}
                    alt="معاينة صورة القسم"
                    onError={() => setImageFailed(true)}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-nw-text">صورة القسم</p>
                <p className="mt-1 text-[9px] leading-4 text-nw-muted">
                  تظهر تلقائيًا للعميل في صفحة الأقسام والرئيسية.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageSelection}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-lg bg-nw-info-bg px-2 py-1.5 text-[10px] font-black text-nw-info transition hover:bg-nw-info-bg"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    اختر صورة
                  </button>
                  {(imageUrl || selectedImageFile) && (
                    <button
                      type="button"
                      onClick={clearCategoryImage}
                      className="inline-flex items-center gap-1 rounded-lg bg-nw-bad-bg px-2 py-1.5 text-[10px] font-black text-nw-bad transition hover:bg-nw-bad-bg"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      إزالة
                    </button>
                  )}
                </div>
              </div>
            </div>
            {imageError && (
              <p className="mt-2 rounded-lg bg-nw-bad-bg px-2 py-1.5 text-[10px] font-bold text-nw-bad">
                {imageError}
              </p>
            )}
          </div>
          {error && (
            <p className="rounded-lg bg-nw-bad-bg px-2.5 py-1.5 font-bold text-nw-bad">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isSaving}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-nw-primary py-2.5 font-black text-nw-on-primary disabled:opacity-50"
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
                  ? 'border-nw-border bg-nw-bg opacity-65'
                  : 'border-nw-border bg-nw-bg'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl font-black ${
                    category.isHidden
                      ? 'bg-nw-surface-2 text-nw-muted'
                      : 'bg-nw-info-bg text-nw-info'
                  }`}
                >
                  {category.nameAr.trim().charAt(0)}
                  {category.imageUrl && (
                    <img
                      src={category.imageUrl}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h5 className="truncate font-black text-nw-text">
                      {category.nameAr}
                    </h5>
                    {category.isHidden && (
                      <span className="rounded-full bg-nw-surface-2 px-1.5 py-0.5 text-[8px] font-bold text-nw-muted">
                        مخفي
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[9px] text-nw-muted">
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
                    className="rounded-lg p-2 text-nw-muted transition hover:bg-nw-info-bg hover:text-nw-info"
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
                      ? 'text-nw-ok hover:bg-nw-ok-bg'
                      : 'text-nw-muted hover:bg-nw-warn-bg hover:text-nw-warn'
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
        className="w-full rounded-xl bg-nw-surface-2 py-2.5 font-bold text-nw-text"
      >
        تم
      </button>
    </div>
  );
};

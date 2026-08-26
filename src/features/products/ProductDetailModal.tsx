import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Boxes,
  Edit3,
  Eye,
  EyeOff,
  Image,
  Layers3,
  Palette,
  Plus,
  ReceiptText,
  Tag,
  Upload,
  X,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import {
  removeUploadedProductImage,
  uploadProductImageToSupabase,
} from '../../services/supabase/product-images.service';
import {
  createProductFlavorInSupabase,
  reorderProductFlavorsInSupabase,
  updateProductFlavorInSupabase,
} from '../../services/supabase/products.service';
import { useAppStore } from '../../stores/useAppStore';
import { Product } from '../../types';
import { formatProductInventory } from '../../utils/inventoryFormatter';
import { validateProductImage } from '../../utils/productImage';
import { calculateProductProfit } from '../../utils/productCalculations';

interface ProductDetailModalProps {
  product: Product;
  onClose: () => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  onClose,
}) => {
  const {
    categories,
    products,
    hideProduct,
    openModal,
    refreshProductsFromSupabase,
    setToast,
  } = useAppStore();
  const [imageFailed, setImageFailed] = useState(false);
  const [showVisibilityConfirm, setShowVisibilityConfirm] = useState(false);
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
  const [showFlavorForm, setShowFlavorForm] = useState(false);
  const [flavorName, setFlavorName] = useState('');
  const [openingPackages, setOpeningPackages] = useState(0);
  const [flavorImage, setFlavorImage] = useState<File | null>(null);
  const [flavorImagePreview, setFlavorImagePreview] = useState('');
  const [isSavingFlavor, setIsSavingFlavor] = useState(false);
  const [editingFlavorId, setEditingFlavorId] = useState<string | null>(null);
  const [editFlavorName, setEditFlavorName] = useState('');
  const [editFlavorBarcode, setEditFlavorBarcode] = useState('');
  const [editFlavorActive, setEditFlavorActive] = useState(true);
  const [editFlavorImage, setEditFlavorImage] = useState<File | null>(null);
  const [editFlavorImagePreview, setEditFlavorImagePreview] = useState('');
  const [isUpdatingFlavor, setIsUpdatingFlavor] = useState(false);
  const [isReorderingFlavors, setIsReorderingFlavors] = useState(false);

  const flavors = products
    .filter((item) => item.flavorMasterProductId === product.id)
    .sort(
      (first, second) =>
        (first.flavorSortOrder || 0) - (second.flavorSortOrder || 0) ||
        (first.flavorNameAr || '').localeCompare(second.flavorNameAr || '', 'ar')
    );
  const isFlavorFamily = product.isFlavorMaster || flavors.length > 0;
  const familyInventoryProduct: Product = isFlavorFamily
    ? {
        ...product,
        onHandQuantity: flavors.reduce(
          (sum, flavor) => sum + flavor.onHandQuantity,
          0
        ),
        reservedQuantity: flavors.reduce(
          (sum, flavor) => sum + flavor.reservedQuantity,
          0
        ),
        availableQuantity: flavors.reduce(
          (sum, flavor) => sum + flavor.availableQuantity,
          0
        ),
      }
    : product;

  const category = categories.find(
    (item) => item.id === product.categoryId
  );
  const unitsPerSalePackage = product.unitsPerSalePackage || 1;
  const salePackagePrice = product.salePackagePrice || 0;
  const salePackageCost =
    product.costPrice * unitsPerSalePackage;
  const needsSalePackageSetup =
    !product.saleUnitId ||
    !product.salePackage ||
    salePackagePrice <= 0;
  const salePackageProfit = calculateProductProfit(
    salePackagePrice,
    salePackageCost
  );
  const inventoryOnHand = formatProductInventory(familyInventoryProduct, false);
  const inventoryAvailable = formatProductInventory(familyInventoryProduct, true);
  const isOutOfStock = familyInventoryProduct.availableQuantity === 0;
  const isLowStock =
    familyInventoryProduct.availableQuantity > 0 &&
    familyInventoryProduct.availableQuantity <= product.reorderLevel;

  const resetFlavorForm = () => {
    if (flavorImagePreview) URL.revokeObjectURL(flavorImagePreview);
    setFlavorName('');
    setOpeningPackages(0);
    setFlavorImage(null);
    setFlavorImagePreview('');
    setShowFlavorForm(false);
  };

  const selectFlavorImage = (file?: File) => {
    if (!file) return;
    const validationError = validateProductImage(file);
    if (validationError) {
      setToast(validationError, 'error');
      return;
    }
    if (flavorImagePreview) URL.revokeObjectURL(flavorImagePreview);
    setFlavorImage(file);
    setFlavorImagePreview(URL.createObjectURL(file));
  };

  const saveFlavor = async () => {
    if (!flavorName.trim()) {
      setToast('اكتب اسم النكهة.', 'error');
      return;
    }

    setIsSavingFlavor(true);
    let uploadedStoragePath = '';
    try {
      let imageUrl = '';
      if (flavorImage) {
        const upload = await uploadProductImageToSupabase(flavorImage);
        if (!upload.success || !upload.publicUrl) {
          throw new Error(upload.error || 'تعذر رفع صورة النكهة.');
        }
        imageUrl = upload.publicUrl;
        uploadedStoragePath = upload.storagePath || '';
      }

      const result = await createProductFlavorInSupabase({
        masterProductId: product.id,
        flavorNameAr: flavorName,
        openingSalePackages: openingPackages,
        warehouseId: product.warehouseId,
        imageUrl,
      });

      if (!result.success) {
        if (uploadedStoragePath) {
          await removeUploadedProductImage(uploadedStoragePath);
        }
        setToast(result.error || 'تعذر إضافة النكهة.', 'error');
        return;
      }

      await refreshProductsFromSupabase();
      setToast(result.message || 'تمت إضافة النكهة بنجاح.', 'success');
      resetFlavorForm();
    } catch (error) {
      if (uploadedStoragePath) {
        await removeUploadedProductImage(uploadedStoragePath).catch(() => undefined);
      }
      setToast(
        error instanceof Error ? error.message : 'تعذر إضافة النكهة.',
        'error'
      );
    } finally {
      setIsSavingFlavor(false);
    }
  };

  const cancelFlavorEdit = () => {
    if (editFlavorImagePreview) {
      URL.revokeObjectURL(editFlavorImagePreview);
    }
    setEditingFlavorId(null);
    setEditFlavorName('');
    setEditFlavorBarcode('');
    setEditFlavorActive(true);
    setEditFlavorImage(null);
    setEditFlavorImagePreview('');
  };

  const startFlavorEdit = (flavor: Product) => {
    cancelFlavorEdit();
    setEditingFlavorId(flavor.id);
    setEditFlavorName(flavor.flavorNameAr || '');
    setEditFlavorBarcode(flavor.barcode || '');
    setEditFlavorActive(flavor.status !== 'hidden');
  };

  const selectEditFlavorImage = (file?: File) => {
    if (!file) return;
    const validationError = validateProductImage(file);
    if (validationError) {
      setToast(validationError, 'error');
      return;
    }
    if (editFlavorImagePreview) {
      URL.revokeObjectURL(editFlavorImagePreview);
    }
    setEditFlavorImage(file);
    setEditFlavorImagePreview(URL.createObjectURL(file));
  };

  const saveFlavorChanges = async (flavor: Product) => {
    if (!editFlavorName.trim()) {
      setToast('اكتب اسم النكهة.', 'error');
      return;
    }

    setIsUpdatingFlavor(true);
    let uploadedStoragePath = '';
    let flavorWasPersisted = false;
    try {
      let imageUrl = flavor.imageUrl || '';
      if (editFlavorImage) {
        const upload = await uploadProductImageToSupabase(editFlavorImage);
        if (!upload.success || !upload.publicUrl) {
          throw new Error(upload.error || 'تعذر رفع صورة النكهة.');
        }
        imageUrl = upload.publicUrl;
        uploadedStoragePath = upload.storagePath || '';
      }

      const result = await updateProductFlavorInSupabase({
        flavorProductId: flavor.id,
        flavorNameAr: editFlavorName,
        barcode: editFlavorBarcode,
        imageUrl,
        isActive: editFlavorActive,
      });

      if (!result.success) {
        if (uploadedStoragePath) {
          await removeUploadedProductImage(uploadedStoragePath);
        }
        setToast(result.error || 'تعذر تحديث النكهة.', 'error');
        return;
      }

      flavorWasPersisted = true;
      await refreshProductsFromSupabase();
      setToast(result.message || 'تم تحديث النكهة.', 'success');
      cancelFlavorEdit();
    } catch (error) {
      if (!flavorWasPersisted && uploadedStoragePath) {
        await removeUploadedProductImage(uploadedStoragePath).catch(
          () => undefined
        );
      }
      setToast(
        error instanceof Error ? error.message : 'تعذر تحديث النكهة.',
        'error'
      );
    } finally {
      setIsUpdatingFlavor(false);
    }
  };

  const moveFlavor = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= flavors.length) return;

    const orderedIds = flavors.map((flavor) => flavor.id);
    [orderedIds[index], orderedIds[targetIndex]] = [
      orderedIds[targetIndex],
      orderedIds[index],
    ];

    setIsReorderingFlavors(true);
    const result = await reorderProductFlavorsInSupabase(
      product.id,
      orderedIds
    );
    setIsReorderingFlavors(false);

    if (!result.success) {
      setToast(result.error || 'تعذر ترتيب النكهات.', 'error');
      return;
    }
    await refreshProductsFromSupabase();
    setToast(result.message || 'تم ترتيب النكهات.', 'success');
  };

  const changeVisibility = async () => {
    setIsUpdatingVisibility(true);
    const result = await hideProduct(product.id);
    setIsUpdatingVisibility(false);
    if (result?.success) onClose();
  };

  return (
    <div dir="rtl" className="space-y-3 text-xs">
      <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950">
        <div className="relative flex h-40 items-center justify-center bg-gradient-to-br from-slate-900 to-slate-950">
          {product.imageUrl && !imageFailed ? (
            <img
              src={product.imageUrl}
              alt={product.nameAr}
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <Image className="h-10 w-10 text-slate-700" />
          )}
          <span
            className={`absolute right-3 top-3 rounded-full border px-2.5 py-1 text-[9px] font-black ${
              product.status === 'hidden'
                ? 'border-slate-700 bg-slate-900/90 text-slate-400'
                : isOutOfStock
                  ? 'border-rose-500/30 bg-rose-950/90 text-rose-400'
                  : isLowStock
                    ? 'border-amber-500/30 bg-amber-950/90 text-amber-400'
                    : 'border-emerald-500/30 bg-emerald-950/90 text-emerald-400'
            }`}
          >
            {product.status === 'hidden'
              ? 'مخفي'
              : isOutOfStock
                ? 'نافد'
                : isLowStock
                  ? 'مخزون منخفض'
                  : 'متوفر'}
          </span>
        </div>

        <div className="space-y-2.5 p-4">
          <div>
            <p className="mb-1 text-[10px] font-bold text-blue-400">
              {category?.nameAr || 'بدون قسم'}
            </p>
            <h3 className="text-base font-black text-slate-100">
              {product.nameAr}
            </h3>
            {product.description && (
              <p className="mt-1 text-[10px] leading-5 text-slate-400">
                {product.description}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 border-t border-slate-800 pt-2.5 font-mono text-[9px] text-slate-500">
            <span className="rounded-lg bg-slate-900 px-2 py-1">
              SKU: {product.sku}
            </span>
            {product.barcode && (
              <span className="rounded-lg bg-slate-900 px-2 py-1">
                Barcode: {product.barcode}
              </span>
            )}
          </div>
        </div>
      </section>

      {!product.flavorMasterProductId && (
        <section className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-950/25 to-slate-950 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <Palette className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
              <div>
                <h4 className="font-black text-slate-100">النكهات</h4>
                <p className="mt-0.5 text-[9px] leading-4 text-slate-500">
                  السعر والطرد من المنتج الأساسي، والمخزون مستقل لكل نكهة.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowFlavorForm((value) => !value)}
              className="flex shrink-0 items-center gap-1 rounded-xl bg-violet-600 px-2.5 py-2 text-[9px] font-black text-white"
            >
              {showFlavorForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showFlavorForm ? 'إغلاق' : 'إضافة نكهة'}
            </button>
          </div>

          {showFlavorForm && (
            <div className="mt-3 space-y-2 rounded-2xl border border-violet-500/20 bg-slate-950/80 p-3">
              <label className="block">
                <span className="mb-1 block text-[9px] font-bold text-slate-400">اسم النكهة *</span>
                <input
                  value={flavorName}
                  onChange={(event) => setFlavorName(event.target.value)}
                  placeholder="مثال: جبنة"
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs font-bold text-slate-100 outline-none focus:border-violet-500"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[9px] font-bold text-slate-400">رصيد البداية ({product.salePackage || 'طرد'})</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={openingPackages}
                    onChange={(event) => setOpeningPackages(Math.max(0, Number(event.target.value) || 0))}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-center text-xs font-black text-slate-100 outline-none focus:border-violet-500"
                  />
                </label>
                <label className="flex cursor-pointer flex-col justify-end">
                  <span className="mb-1 block text-[9px] font-bold text-slate-400">صورة النكهة (اختياري)</span>
                  <span className="flex h-[38px] items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-700 bg-slate-900 text-[9px] font-bold text-slate-300">
                    <Upload className="h-3.5 w-3.5" />
                    {flavorImage ? 'تغيير الصورة' : 'اختر صورة'}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(event) => selectFlavorImage(event.target.files?.[0])}
                  />
                </label>
              </div>
              {flavorImagePreview && (
                <img src={flavorImagePreview} alt="معاينة النكهة" className="h-20 w-full rounded-xl bg-slate-900 object-contain" />
              )}
              {!isFlavorFamily && product.onHandQuantity > 0 && (
                <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2 text-[9px] font-bold leading-4 text-amber-300">
                  رصيد المنتج الأساسي حاليًا ليس صفرًا. صفّر رصيده بالجرد أولًا، ثم وزّع الرصيد على النكهات حتى لا تختلط الكميات.
                </p>
              )}
              <button
                type="button"
                onClick={() => void saveFlavor()}
                disabled={isSavingFlavor}
                className="w-full rounded-xl bg-violet-600 py-2.5 text-[10px] font-black text-white disabled:opacity-50"
              >
                {isSavingFlavor ? 'جاري الحفظ...' : 'حفظ النكهة بمخزون مستقل'}
              </button>
            </div>
          )}

          {flavors.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {flavors.map((flavor, index) => {
                const availablePackages = Math.floor(
                  flavor.availableQuantity / Math.max(1, flavor.unitsPerSalePackage || 1)
                );
                const out = availablePackages === 0;
                const isHidden = flavor.status === 'hidden';
                const isEditingFlavor = editingFlavorId === flavor.id;
                return (
                  <div
                    key={flavor.id}
                    className={`rounded-2xl border bg-slate-900/70 p-2.5 ${
                      isEditingFlavor
                        ? 'border-indigo-500/35'
                        : 'border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-950">
                        {flavor.imageUrl ? (
                          <img src={flavor.imageUrl} alt={flavor.flavorNameAr} className="h-full w-full object-cover" />
                        ) : (
                          <Palette className="m-3 h-5 w-5 text-slate-600" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <strong className="truncate text-[10px] text-slate-100">{flavor.flavorNameAr}</strong>
                          <span className={`rounded-full px-2 py-0.5 text-[8px] font-black ${
                            isHidden
                              ? 'bg-slate-700/70 text-slate-300'
                              : out
                                ? 'bg-rose-500/15 text-rose-300'
                                : 'bg-emerald-500/15 text-emerald-300'
                          }`}>
                            {isHidden ? 'متوقفة' : out ? 'نافدة' : 'متوفرة'}
                          </span>
                        </div>
                        <p className="mt-1 text-[9px] font-bold text-slate-400">
                          المتاح: {availablePackages.toLocaleString('ar-JO')} {product.salePackage || 'طرد'}
                          {flavor.barcode ? ` • ${flavor.barcode}` : ''}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-800">
                          <button
                            type="button"
                            aria-label="تحريك النكهة للأعلى"
                            disabled={index === 0 || isReorderingFlavors}
                            onClick={() => void moveFlavor(index, -1)}
                            className="p-1.5 text-slate-500 transition hover:text-indigo-300 disabled:opacity-25"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            aria-label="تحريك النكهة للأسفل"
                            disabled={
                              index === flavors.length - 1 ||
                              isReorderingFlavors
                            }
                            onClick={() => void moveFlavor(index, 1)}
                            className="border-r border-slate-800 p-1.5 text-slate-500 transition hover:text-indigo-300 disabled:opacity-25"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            isEditingFlavor
                              ? cancelFlavorEdit()
                              : startFlavorEdit(flavor)
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-indigo-300"
                          aria-label={isEditingFlavor ? 'إغلاق التعديل' : 'تعديل النكهة'}
                        >
                          {isEditingFlavor ? (
                            <X className="h-3.5 w-3.5" />
                          ) : (
                            <Edit3 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {isEditingFlavor && (
                      <div className="mt-2.5 space-y-2 border-t border-slate-800 pt-2.5">
                        <div className="grid grid-cols-2 gap-2">
                          <label>
                            <span className="mb-1 block text-[8px] font-bold text-slate-500">
                              اسم النكهة *
                            </span>
                            <input
                              value={editFlavorName}
                              onChange={(event) =>
                                setEditFlavorName(event.target.value)
                              }
                              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-2 text-[10px] font-bold text-slate-100 outline-none focus:border-indigo-500"
                            />
                          </label>
                          <label>
                            <span className="mb-1 block text-[8px] font-bold text-slate-500">
                              الباركود (اختياري)
                            </span>
                            <input
                              value={editFlavorBarcode}
                              onChange={(event) =>
                                setEditFlavorBarcode(event.target.value)
                              }
                              inputMode="numeric"
                              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-2 text-[10px] font-bold text-slate-100 outline-none focus:border-indigo-500"
                            />
                          </label>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-700 bg-slate-950 px-2 py-2 text-[9px] font-bold text-slate-300">
                            <Upload className="h-3.5 w-3.5" />
                            {editFlavorImage ? 'تم اختيار صورة جديدة' : 'تغيير الصورة'}
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={(event) =>
                                selectEditFlavorImage(event.target.files?.[0])
                              }
                            />
                          </label>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={editFlavorActive}
                            onClick={() =>
                              setEditFlavorActive((current) => !current)
                            }
                            className={`rounded-xl border px-2 py-2 text-[9px] font-black ${
                              editFlavorActive
                                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                                : 'border-slate-700 bg-slate-950 text-slate-400'
                            }`}
                          >
                            {editFlavorActive ? 'ظاهرة ومتاحة' : 'متوقفة مؤقتًا'}
                          </button>
                        </div>

                        {editFlavorImagePreview && (
                          <img
                            src={editFlavorImagePreview}
                            alt="معاينة صورة النكهة الجديدة"
                            className="h-20 w-full rounded-xl bg-slate-950 object-contain"
                          />
                        )}

                        {!editFlavorActive && flavor.onHandQuantity > 0 && (
                          <p className="rounded-xl bg-amber-500/10 p-2 text-[8px] font-bold leading-4 text-amber-300">
                            إيقاف النكهة يخفيها عن العملاء فقط؛ رصيدها وحركاتها سيبقيان محفوظين.
                          </p>
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={isUpdatingFlavor}
                            onClick={() => void saveFlavorChanges(flavor)}
                            className="rounded-xl bg-indigo-600 py-2.5 text-[9px] font-black text-white disabled:opacity-50"
                          >
                            {isUpdatingFlavor ? 'جاري الحفظ...' : 'حفظ التعديل'}
                          </button>
                          <button
                            type="button"
                            disabled={isUpdatingFlavor}
                            onClick={cancelFlavorEdit}
                            className="rounded-xl bg-slate-800 py-2.5 text-[9px] font-bold text-slate-300"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}

                    {!isEditingFlavor && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          openModal('receive_goods', { productId: flavor.id });
                        }}
                        className="mt-2 w-full rounded-xl border border-indigo-500/20 bg-indigo-500/5 py-2 text-[9px] font-black text-indigo-300"
                      >
                        استلام مخزون لهذه النكهة
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-slate-800 p-3 text-center text-[9px] font-bold text-slate-500">
              لا توجد نكهات بعد. أضف الأولى وسيبقى السعر موحدًا تلقائيًا.
            </p>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/20 to-slate-950 p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <ReceiptText className="h-4 w-4 text-emerald-400" />
          <div>
            <h4 className="font-black text-slate-100">الأسعار والربحية</h4>
            <p className="text-[9px] text-slate-500">
              البيع بالجملة للطرد كاملًا، وليس للحبة
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <PriceMetric
            label={`تكلفة ${product.salePackage || 'الطرد'}`}
            value={salePackageCost}
            color="text-amber-300"
          />
          <PriceMetric
            label="سعر بيع الطرد"
            value={salePackagePrice}
            color="text-violet-300"
          />
          <TextMetric
            label="طرد البيع الأدنى"
            value={
              needsSalePackageSetup
                ? 'بحاجة ضبط'
                : `${product.salePackage} × ${unitsPerSalePackage} ${product.unit}`
            }
            color={
              needsSalePackageSetup
                ? 'text-rose-300'
                : 'text-blue-300'
            }
          />
        </div>

        {needsSalePackageSetup ? (
          <div className="mt-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-[10px] font-bold text-amber-300">
            حدّد طرد بيع الجملة وعدد الحبات وسعر الطرد قبل إظهار
            المنتج للزبائن.
          </div>
        ) : (
          <div className="mt-2">
            <ProfitMetric
              label={`ربح ${product.salePackage}`}
              profit={salePackageProfit.profitPerUnit}
              margin={salePackageProfit.marginPercentage}
            />
          </div>
        )}

        {!needsSalePackageSetup && salePackageProfit.isLoss && (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 p-2.5 text-[10px] font-bold text-rose-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            سعر بيع الطرد أقل من تكلفته الحالية.
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-blue-500/15 bg-slate-950 p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-blue-400" />
          <div>
            <h4 className="font-black text-slate-100">طرد شراء المورد</h4>
            <p className="text-[9px] text-slate-500">
              التحويل المعتمد إلى وحدة البيع
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <TextMetric
            label="الطرد"
            value={product.purchasePackage || product.unit}
          />
          <TextMetric
            label="محتوى الطرد"
            value={`${product.unitsPerPackage || 1} ${product.unit}`}
            color="text-amber-300"
          />
          <TextMetric
            label="سعر الشراء"
            value={`${(
              product.defaultPurchasePrice ||
              product.costPrice * (product.unitsPerPackage || 1)
            ).toFixed(3)} ${CURRENCY}`}
            color="text-emerald-300"
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <Boxes className="h-4 w-4 text-indigo-400" />
          <div>
            <h4 className="font-black text-slate-100">الرصيد الحالي</h4>
            <p className="text-[9px] text-slate-500">
              يتغير من الاستلام والطلبات والجرد المعتمد
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <TextMetric
            label="الفعلي"
            value={inventoryOnHand.totalPiecesFormatted}
            color="text-amber-300"
          />
          <TextMetric
            label="المحجوز"
            value={`${familyInventoryProduct.reservedQuantity} ${product.unit}`}
            color="text-orange-300"
          />
          <TextMetric
            label="المتاح"
            value={inventoryAvailable.totalPiecesFormatted}
            color="text-emerald-300"
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <div>
            <span className="block text-[8px] font-bold text-slate-500">
              تنبيه النقص
            </span>
            <strong className="text-[10px] text-amber-300">
              {product.reorderLevel} {product.unit}
            </strong>
          </div>
          <div>
            <span className="block text-[8px] font-bold text-slate-500">
              الحد الأعلى
            </span>
            <strong className="text-[10px] text-slate-300">
              {product.maxStockLevel === undefined
                ? 'غير محدد'
                : `${product.maxStockLevel} ${product.unit}`}
            </strong>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            onClose();
            openModal('edit_product', product);
          }}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 font-black text-white"
        >
          <Edit3 className="h-4 w-4" />
          تعديل البيانات
        </button>
        <button
          type="button"
          onClick={() => setShowVisibilityConfirm(true)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 py-3 font-bold text-slate-300"
        >
          {product.status === 'hidden' ? (
            <Eye className="h-4 w-4 text-emerald-400" />
          ) : (
            <EyeOff className="h-4 w-4 text-amber-400" />
          )}
          {product.status === 'hidden' ? 'إظهار الصنف' : 'إخفاء الصنف'}
        </button>
      </div>

      {showVisibilityConfirm && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3.5">
          <div className="flex items-start gap-2">
            <Tag className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div>
              <h4 className="font-black text-amber-200">
                {product.status === 'hidden'
                  ? 'إعادة إظهار الصنف؟'
                  : 'هل تريد إخفاء الصنف؟'}
              </h4>
              <p className="mt-1 text-[10px] leading-5 text-slate-400">
                لن نحذف حركاته أو رصيده. سيتم فقط تغيير حالة ظهوره في
                الكتالوج.
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={changeVisibility}
              disabled={isUpdatingVisibility}
              className="flex-1 rounded-xl bg-amber-500 py-2.5 font-black text-slate-950 disabled:opacity-50"
            >
              {isUpdatingVisibility ? 'جاري الحفظ...' : 'نعم، تأكيد'}
            </button>
            <button
              type="button"
              onClick={() => setShowVisibilityConfirm(false)}
              className="flex-1 rounded-xl bg-slate-800 py-2.5 font-bold text-slate-300"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const PriceMetric: React.FC<{
  label: string;
  value: number;
  color: string;
}> = ({ label, value, color }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-2 text-center">
    <span className="block text-[8px] font-bold text-slate-500">{label}</span>
    <strong className={`mt-1 block text-[10px] ${color}`}>
      {value.toFixed(3)} {CURRENCY}
    </strong>
  </div>
);

const ProfitMetric: React.FC<{
  label: string;
  profit: number;
  margin: number;
}> = ({ label, profit, margin }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-2.5">
    <span className="text-[8px] font-bold text-slate-500">{label}</span>
    <div
      className={`mt-1 flex items-center justify-between ${
        profit >= 0 ? 'text-emerald-400' : 'text-rose-400'
      }`}
    >
      <strong className="text-[10px]">
        {profit.toFixed(3)} {CURRENCY}
      </strong>
      <span className="font-mono text-[9px]">%{margin.toFixed(1)}</span>
    </div>
  </div>
);

const TextMetric: React.FC<{
  label: string;
  value: string;
  color?: string;
}> = ({ label, value, color = 'text-slate-200' }) => (
  <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-2 text-center">
    <span className="block text-[8px] font-bold text-slate-500">{label}</span>
    <strong className={`mt-1 block break-words text-[9px] ${color}`}>
      {value}
    </strong>
  </div>
);

import {Card,FormFields,UiButton,formatJod} from '../../components/ui';
import React, { useCallback, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Boxes,
  Camera,
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
import { BarcodeCameraCaptureModal } from '../barcode/BarcodeCameraCaptureModal';
import type { StartBarcodeCamera } from '../barcode/barcodeCamera';
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
import {
  formatProductInventory,
  formatWholesaleInventory,
  summarizeFlavorFamilyInventory,
} from '../../utils/inventoryFormatter';
import { validateProductImage } from '../../utils/productImage';
import { calculateProductProfit } from '../../utils/productCalculations';
import { validateProductBarcode } from '../../utils/productIdentifiers';

interface ProductDetailModalProps {
  product: Product;
  onClose: () => void;
  startBarcodeScanner?: StartBarcodeCamera;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  onClose,
  startBarcodeScanner,
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
  const [flavorBarcode, setFlavorBarcode] = useState('');
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
  const [barcodeCameraTarget, setBarcodeCameraTarget] = useState<
    'new' | 'edit' | null
  >(null);

  const flavors = products
    .filter((item) => item.flavorMasterProductId === product.id)
    .sort(
      (first, second) =>
        (first.flavorSortOrder || 0) - (second.flavorSortOrder || 0) ||
        (first.flavorNameAr || '').localeCompare(second.flavorNameAr || '', 'ar')
    );
  const isFlavorFamily = product.isFlavorMaster || flavors.length > 0;
  const familyInventorySummary = summarizeFlavorFamilyInventory(flavors);
  const familyInventoryProduct: Product = isFlavorFamily
    ? {
        ...product,
        onHandQuantity: familyInventorySummary.onHandQuantity,
        reservedQuantity: familyInventorySummary.reservedQuantity,
        availableQuantity: familyInventorySummary.availableQuantity,
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
  const familyReserved = formatWholesaleInventory(
    familyInventorySummary.reservedQuantity,
    familyInventorySummary.unitsPerPackage,
    familyInventorySummary.purchasePackage,
    familyInventorySummary.unit
  );
  const isOutOfStock = familyInventoryProduct.availableQuantity === 0;
  const isLowStock =
    familyInventoryProduct.availableQuantity > 0 &&
    familyInventoryProduct.availableQuantity <= product.reorderLevel;
  const reorderSalePackages = Math.ceil(
    Math.max(0, product.reorderLevel || 0) / unitsPerSalePackage
  );
  const maxStockSalePackages =
    product.maxStockLevel === undefined
      ? undefined
      : Math.ceil(
          Math.max(0, product.maxStockLevel) / unitsPerSalePackage
        );

  const resetFlavorForm = () => {
    if (flavorImagePreview) URL.revokeObjectURL(flavorImagePreview);
    setFlavorName('');
    setFlavorBarcode('');
    setFlavorImage(null);
    setFlavorImagePreview('');
    setShowFlavorForm(false);
    setBarcodeCameraTarget(null);
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

    const barcodeValidation = validateProductBarcode(products, {
      barcode: flavorBarcode,
    });
    if (barcodeValidation.valid === false) {
      setToast(barcodeValidation.message, 'error');
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
        warehouseId: product.warehouseId,
        imageUrl,
        barcode: flavorBarcode,
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
    setBarcodeCameraTarget((target) => (target === 'edit' ? null : target));
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

    const barcodeValidation = validateProductBarcode(products, {
      barcode: editFlavorBarcode,
      currentProductId: flavor.id,
    });
    if (barcodeValidation.valid === false) {
      setToast(barcodeValidation.message, 'error');
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

  const captureFlavorBarcode = useCallback(
    (value: string) => {
      const capturedBarcode = value.trim();
      const currentProductId =
        barcodeCameraTarget === 'edit' ? editingFlavorId || undefined : undefined;
      const validation = validateProductBarcode(products, {
        barcode: capturedBarcode,
        currentProductId,
      });

      if (barcodeCameraTarget === 'edit') {
        setEditFlavorBarcode(capturedBarcode);
      } else {
        setFlavorBarcode(capturedBarcode);
      }

      if (validation.valid === false) {
        setToast(validation.message, 'error');
        return;
      }
      setToast('تمت قراءة باركود النكهة وتعبئة الحقل.', 'success');
    },
    [barcodeCameraTarget, editingFlavorId, products, setToast]
  );

  const changeVisibility = async () => {
    setIsUpdatingVisibility(true);
    const result = await hideProduct(product.id);
    setIsUpdatingVisibility(false);
    if (result?.success) onClose();
  };

  return (
    <FormFields dir="rtl" className="nw-products-fields min-w-0 space-y-4 text-nw-text text-sm">
      <Card padded={false} className="overflow-hidden rounded-3xl border border-nw-border bg-nw-surface">
        <div className="relative flex h-40 items-center justify-center   ">
          {product.imageUrl && !imageFailed ? (
            <img
              src={product.imageUrl}
              alt={product.nameAr}
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <Image className="h-11 w-11 text-nw-muted" />
          )}
          <span
            className={`absolute right-3 top-3 rounded-full border px-2.5 py-1 text-xs font-black ${
              product.status === 'hidden'
                ? 'border-nw-border bg-nw-surface-2 text-nw-muted'
                : isOutOfStock
                  ? 'border-nw-border bg-nw-bad-bg text-nw-bad'
                  : isLowStock
                    ? 'border-nw-border bg-nw-warn-bg text-nw-warn'
                    : 'border-nw-border bg-nw-ok-bg text-nw-ok'
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
            <p className="mb-1 text-xs font-bold text-nw-info">
              {category?.nameAr || 'بدون قسم'}
            </p>
            <h3 className="text-base font-black text-nw-text">
              {product.nameAr}
            </h3>
            {product.description && (
              <p className="mt-1 text-xs leading-5 text-nw-muted">
                {product.description}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 border-t border-nw-border pt-2.5 font-mono text-xs text-nw-text">
            <span className="rounded-lg bg-nw-surface-2 px-2 py-1">
              SKU: {product.sku}
            </span>
            {product.barcode && (
              <span className="rounded-lg bg-nw-surface-2 px-2 py-1">
                Barcode: {product.barcode}
              </span>
            )}
          </div>
        </div>
      </Card>

      {!product.flavorMasterProductId && (
        <Card padded={false} className="rounded-2xl border border-nw-border    p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <Palette className="mt-0.5 h-4 w-4 shrink-0 text-nw-info" />
              <div>
                <h4 className="font-black text-nw-text">النكهات</h4>
                <p className="mt-0.5 text-xs leading-4 text-nw-muted">
                  السعر والطرد من المنتج الأساسي، والمخزون مستقل لكل نكهة.
                </p>
              </div>
            </div>
            <UiButton variant="plain"
              type="button"
              onClick={() => setShowFlavorForm((value) => !value)}
              className="flex shrink-0 items-center gap-1 rounded-xl bg-nw-primary px-2.5 py-2 text-xs font-black text-nw-on-primary"
            >
              {showFlavorForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showFlavorForm ? 'إغلاق' : 'إضافة نكهة'}
            </UiButton>
          </div>

          {showFlavorForm && (
            <div className="mt-3 space-y-2 rounded-2xl border border-nw-border bg-nw-surface p-3">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-nw-muted">اسم النكهة *</span>
                <input
                  value={flavorName}
                  onChange={(event) => setFlavorName(event.target.value)}
                  placeholder="مثال: جبنة"
                  className="w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2.5 text-sm font-bold text-nw-text outline-none focus:border-nw-border"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-nw-muted">الباركود (اختياري)</span>
                <span className="flex gap-1.5">
                  <input
                    value={flavorBarcode}
                    onChange={(event) => setFlavorBarcode(event.target.value)}
                    inputMode="text"
                    aria-label="باركود النكهة الجديدة"
                    placeholder="أدخله يدويًا أو امسحه بالكاميرا"
                    className="min-w-0 flex-1 rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2.5 text-sm font-bold text-nw-text outline-none focus:border-nw-border"
                  />
                  <UiButton variant="plain"
                    type="button"
                    onClick={() => setBarcodeCameraTarget('new')}
                    aria-label="مسح باركود النكهة الجديدة بالكاميرا"
                    title="مسح الباركود بالكاميرا"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-nw-border bg-nw-info-bg text-nw-info"
                  >
                    <Camera className="h-4 w-4" />
                  </UiButton>
                </span>
              </label>
              <div className="grid gap-2">
                <label className="flex cursor-pointer flex-col justify-end">
                  <span className="mb-1 block text-xs font-bold text-nw-muted">صورة النكهة (اختياري)</span>
                  <span className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-dashed border-nw-border bg-nw-surface-2 text-xs font-bold text-nw-text">
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
                <img src={flavorImagePreview} alt="معاينة النكهة" className="h-20 w-full rounded-xl bg-nw-surface-2 object-contain" />
              )}
              <p className="rounded-xl border border-nw-border bg-nw-ok-bg p-2 text-xs font-bold leading-4 text-nw-ok">
                تُنشأ النكهة برصيد صفر. استلم كميتها الفعلية لاحقًا من شاشة الاستلام.
              </p>
              {!isFlavorFamily && product.onHandQuantity > 0 && (
                <p className="rounded-xl border border-nw-border bg-nw-warn-bg p-2 text-xs font-bold leading-4 text-nw-warn">
                  رصيد المنتج الأساسي حاليًا ليس صفرًا. صفّر رصيده بالجرد أولًا، ثم وزّع الرصيد على النكهات حتى لا تختلط الكميات.
                </p>
              )}
              <UiButton variant="plain"
                type="button"
                onClick={() => void saveFlavor()}
                disabled={isSavingFlavor}
                className="w-full rounded-xl bg-nw-primary py-2.5 text-xs font-black text-nw-on-primary disabled:opacity-50"
              >
                {isSavingFlavor ? 'جاري الحفظ...' : 'حفظ تعريف النكهة'}
              </UiButton>
            </div>
          )}

          {flavors.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {flavors.map((flavor, index) => {
                const flavorAvailable = formatProductInventory(flavor, true);
                const out = flavor.availableQuantity <= 0;
                const isHidden = flavor.status === 'hidden';
                const isEditingFlavor = editingFlavorId === flavor.id;
                return (
                  <div
                    key={flavor.id}
                    className={`rounded-2xl border bg-nw-surface-2 p-2.5 ${
                      isEditingFlavor
                        ? 'border-nw-border'
                        : 'border-nw-border'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-nw-surface">
                        {flavor.imageUrl ? (
                          <img src={flavor.imageUrl} alt={flavor.flavorNameAr} className="h-full w-full object-cover" />
                        ) : (
                          <Palette className="m-3 h-5 w-5 text-nw-muted" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <strong className="truncate text-xs text-nw-text">{flavor.flavorNameAr}</strong>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-black ${
                            isHidden
                              ? 'bg-nw-mute-bg text-nw-text'
                              : out
                                ? 'bg-nw-bad-bg text-nw-bad'
                                : 'bg-nw-ok-bg text-nw-ok'
                          }`}>
                            {isHidden ? 'متوقفة' : out ? 'نافدة' : 'متوفرة'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-bold text-nw-muted">
                          المتاح: {flavorAvailable.cartonFormatted}
                          {flavor.barcode ? ` • ${flavor.barcode}` : ''}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-nw-border">
                          <UiButton variant="plain"
                            type="button"
                            aria-label="تحريك النكهة للأعلى"
                            disabled={index === 0 || isReorderingFlavors}
                            onClick={() => void moveFlavor(index, -1)}
                            className="p-1.5 text-nw-muted transition hover:text-nw-info disabled:opacity-25"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </UiButton>
                          <UiButton variant="plain"
                            type="button"
                            aria-label="تحريك النكهة للأسفل"
                            disabled={
                              index === flavors.length - 1 ||
                              isReorderingFlavors
                            }
                            onClick={() => void moveFlavor(index, 1)}
                            className="border-r border-nw-border p-1.5 text-nw-muted transition hover:text-nw-info disabled:opacity-25"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </UiButton>
                        </div>
                        <UiButton variant="plain"
                          type="button"
                          onClick={() =>
                            isEditingFlavor
                              ? cancelFlavorEdit()
                              : startFlavorEdit(flavor)
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-nw-border bg-nw-info-bg text-nw-info"
                          aria-label={isEditingFlavor ? 'إغلاق التعديل' : 'تعديل النكهة'}
                        >
                          {isEditingFlavor ? (
                            <X className="h-3.5 w-3.5" />
                          ) : (
                            <Edit3 className="h-3.5 w-3.5" />
                          )}
                        </UiButton>
                      </div>
                    </div>

                    {isEditingFlavor && (
                      <div className="mt-2.5 space-y-2 border-t border-nw-border pt-2.5">
                        <div className="grid grid-cols-2 gap-2">
                          <label>
                            <span className="mb-1 block text-xs font-bold text-nw-muted">
                              اسم النكهة *
                            </span>
                            <input
                              value={editFlavorName}
                              onChange={(event) =>
                                setEditFlavorName(event.target.value)
                              }
                              className="w-full rounded-xl border border-nw-border bg-nw-surface px-2.5 py-2 text-xs font-bold text-nw-text outline-none focus:border-nw-border"
                            />
                          </label>
                          <label>
                            <span className="mb-1 block text-xs font-bold text-nw-muted">
                              الباركود (اختياري)
                            </span>
                            <span className="flex gap-1">
                              <input
                                value={editFlavorBarcode}
                                onChange={(event) =>
                                  setEditFlavorBarcode(event.target.value)
                                }
                                inputMode="text"
                                aria-label={`باركود نكهة ${flavor.flavorNameAr || flavor.nameAr}`}
                                className="min-w-0 flex-1 rounded-xl border border-nw-border bg-nw-surface px-2.5 py-2 text-xs font-bold text-nw-text outline-none focus:border-nw-border"
                              />
                              <UiButton variant="plain"
                                type="button"
                                onClick={() => setBarcodeCameraTarget('edit')}
                                aria-label={`مسح باركود نكهة ${flavor.flavorNameAr || flavor.nameAr} بالكاميرا`}
                                title="مسح الباركود بالكاميرا"
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-nw-border bg-nw-info-bg text-nw-info"
                              >
                                <Camera className="h-3.5 w-3.5" />
                              </UiButton>
                            </span>
                          </label>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-nw-border bg-nw-surface px-2 py-2 text-xs font-bold text-nw-text">
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
                          <UiButton variant="plain"
                            type="button"
                            role="switch"
                            aria-checked={editFlavorActive}
                            onClick={() =>
                              setEditFlavorActive((current) => !current)
                            }
                            className={`rounded-xl border px-2 py-2 text-xs font-black ${
                              editFlavorActive
                                ? 'border-nw-border bg-nw-ok-bg text-nw-ok'
                                : 'border-nw-border bg-nw-surface text-nw-muted'
                            }`}
                          >
                            {editFlavorActive ? 'ظاهرة ومتاحة' : 'متوقفة مؤقتًا'}
                          </UiButton>
                        </div>

                        {editFlavorImagePreview && (
                          <img
                            src={editFlavorImagePreview}
                            alt="معاينة صورة النكهة الجديدة"
                            className="h-20 w-full rounded-xl bg-nw-surface object-contain"
                          />
                        )}

                        {!editFlavorActive && flavor.onHandQuantity > 0 && (
                          <p className="rounded-xl bg-nw-warn-bg p-2 text-xs font-bold leading-4 text-nw-warn">
                            إيقاف النكهة يخفيها عن العملاء فقط؛ رصيدها وحركاتها سيبقيان محفوظين.
                          </p>
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          <UiButton variant="plain"
                            type="button"
                            disabled={isUpdatingFlavor}
                            onClick={() => void saveFlavorChanges(flavor)}
                            className="rounded-xl bg-nw-primary py-2.5 text-xs font-black text-nw-on-primary disabled:opacity-50"
                          >
                            {isUpdatingFlavor ? 'جاري الحفظ...' : 'حفظ التعديل'}
                          </UiButton>
                          <UiButton variant="plain"
                            type="button"
                            disabled={isUpdatingFlavor}
                            onClick={cancelFlavorEdit}
                            className="rounded-xl bg-nw-mute-bg py-2.5 text-xs font-bold text-nw-text"
                          >
                            إلغاء
                          </UiButton>
                        </div>
                      </div>
                    )}

                    {!isEditingFlavor && (
                      <UiButton variant="plain"
                        type="button"
                        onClick={() => {
                          onClose();
                          openModal('receive_goods', { productId: flavor.id });
                        }}
                        className="mt-2 w-full rounded-xl border border-nw-border bg-nw-info-bg py-2 text-xs font-black text-nw-info"
                      >
                        استلام مخزون لهذه النكهة
                      </UiButton>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-nw-border p-3 text-center text-xs font-bold text-nw-muted">
              لا توجد نكهات بعد. أضف الأولى وسيبقى السعر موحدًا تلقائيًا.
            </p>
          )}
        </Card>
      )}

      <Card padded={false} className="rounded-2xl border border-nw-border    p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <ReceiptText className="h-4 w-4 text-nw-ok" />
          <div>
            <h4 className="font-black text-nw-text">الأسعار والربحية</h4>
            <p className="text-xs text-nw-muted">
              البيع بالجملة للطرد كاملًا، وليس للحبة
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <PriceMetric
            label={`تكلفة ${product.salePackage || 'الطرد'}`}
            value={salePackageCost}
            color="text-nw-warn"
          />
          <PriceMetric
            label="سعر بيع الطرد"
            value={salePackagePrice}
            color="text-nw-info"
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
                ? 'text-nw-bad'
                : 'text-nw-info'
            }
          />
        </div>

        {needsSalePackageSetup ? (
          <div className="mt-2 rounded-xl border border-nw-border bg-nw-warn-bg p-2.5 text-xs font-bold text-nw-warn">
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
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-nw-border bg-nw-bad-bg p-2.5 text-xs font-bold text-nw-bad">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            سعر بيع الطرد أقل من تكلفته الحالية.
          </div>
        )}
      </Card>

      <Card padded={false} className="rounded-2xl border border-nw-border bg-nw-surface p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-nw-info" />
          <div>
            <h4 className="font-black text-nw-text">طرد شراء المورد</h4>
            <p className="text-xs text-nw-muted">
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
            color="text-nw-warn"
          />
          <TextMetric
            label="سعر الشراء"
            value={`${formatJod(
              product.defaultPurchasePrice ||
              product.costPrice * (product.unitsPerPackage || 1)
            )} ${CURRENCY}`}
            color="text-nw-ok"
          />
        </div>
      </Card>

      <Card padded={false}
        className="rounded-2xl border border-nw-border bg-nw-surface p-3.5"
        data-flavor-family-stock-summary={isFlavorFamily ? 'true' : undefined}
      >
        <div className="mb-3 flex items-center gap-2">
          <Boxes className="h-4 w-4 text-nw-info" />
          <div>
            <h4 className="font-black text-nw-text">
              {isFlavorFamily ? 'إجمالي مخزون النكهات' : 'الرصيد الحالي'}
            </h4>
            <p className="text-xs text-nw-muted">
              {isFlavorFamily
                ? 'محسوب للعرض فقط من أرصدة النكهات المستقلة'
                : 'يتغير من الاستلام والطلبات والجرد المعتمد'}
            </p>
          </div>
        </div>
        {isFlavorFamily && !familyInventorySummary.hasCompatiblePackaging ? (
          <p className="rounded-xl border border-nw-border bg-nw-warn-bg p-2.5 text-xs font-bold leading-4 text-nw-warn">
            أحجام طرود النكهات غير متطابقة؛ راجع رصيد كل نكهة بدل عرض مجموع مضلل.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <TextMetric
              label="الموجود"
              value={inventoryOnHand.cartonFormatted}
              color="text-nw-warn"
            />
            <TextMetric
              label="المحجوز"
              value={
                isFlavorFamily
                  ? familyReserved.cartonFormatted
                  : `${familyInventoryProduct.reservedQuantity} ${product.unit}`
              }
              color="text-orange-300"
            />
            <TextMetric
              label={isFlavorFamily ? 'إجمالي المتاح' : 'المتاح'}
              value={inventoryAvailable.cartonFormatted}
              color="text-nw-ok"
            />
          </div>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-nw-border bg-nw-surface-2 p-2.5">
          <div>
            <span className="block text-xs font-bold text-nw-muted">
              تنبيه النقص
            </span>
            <strong className="text-xs text-nw-warn">
              {reorderSalePackages} {product.salePackage || 'طرد'}
            </strong>
          </div>
          <div>
            <span className="block text-xs font-bold text-nw-muted">
              سقف المستودع
            </span>
            <strong className="text-xs text-nw-text">
              {maxStockSalePackages === undefined
                ? 'غير محدد'
                : `${maxStockSalePackages} ${product.salePackage || 'طرد'}`}
            </strong>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <UiButton variant="plain"
          type="button"
          onClick={() => {
            onClose();
            openModal('edit_product', product);
          }}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-nw-primary py-3 font-black text-nw-on-primary"
        >
          <Edit3 className="h-4 w-4" />
          تعديل البيانات
        </UiButton>
        <UiButton variant="plain"
          type="button"
          onClick={() => setShowVisibilityConfirm(true)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-nw-border bg-nw-surface py-3 font-bold text-nw-text"
        >
          {product.status === 'hidden' ? (
            <Eye className="h-4 w-4 text-nw-ok" />
          ) : (
            <EyeOff className="h-4 w-4 text-nw-warn" />
          )}
          {product.status === 'hidden' ? 'إظهار المنتج' : 'إخفاء المنتج'}
        </UiButton>
      </div>

      {showVisibilityConfirm && (
        <div className="rounded-2xl border border-nw-border bg-nw-warn-bg p-3.5">
          <div className="flex items-start gap-2">
            <Tag className="mt-0.5 h-4 w-4 shrink-0 text-nw-warn" />
            <div>
              <h4 className="font-black text-nw-warn">
                {product.status === 'hidden'
                  ? 'إعادة إظهار المنتج؟'
                  : 'هل تريد إخفاء المنتج؟'}
              </h4>
              <p className="mt-1 text-xs leading-5 text-nw-muted">
                لن نحذف حركاته أو رصيده. سيتم فقط تغيير حالة ظهوره في
                الكتالوج.
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <UiButton variant="plain"
              type="button"
              onClick={changeVisibility}
              disabled={isUpdatingVisibility}
              className="flex-1 rounded-xl bg-nw-warn-bg py-2.5 font-black text-nw-muted disabled:opacity-50"
            >
              {isUpdatingVisibility ? 'جاري الحفظ...' : 'نعم، تأكيد'}
            </UiButton>
            <UiButton variant="plain"
              type="button"
              onClick={() => setShowVisibilityConfirm(false)}
              className="flex-1 rounded-xl bg-nw-mute-bg py-2.5 font-bold text-nw-text"
            >
              إلغاء
            </UiButton>
          </div>
        </div>
      )}

      <BarcodeCameraCaptureModal
        isOpen={barcodeCameraTarget !== null}
        onClose={() => setBarcodeCameraTarget(null)}
        onCapture={captureFlavorBarcode}
        startScanner={startBarcodeScanner}
      />
    </FormFields>
  );
};

const PriceMetric: React.FC<{
  label: string;
  value: number;
  color: string;
}> = ({ label, value, color }) => (
  <div className="rounded-xl border border-nw-border bg-nw-surface-2 p-2 text-center">
    <span className="block text-xs font-bold text-nw-muted">{label}</span>
    <strong className={`mt-1 block text-xs ${color}`}>
      {formatJod(value)} {CURRENCY}
    </strong>
  </div>
);

const ProfitMetric: React.FC<{
  label: string;
  profit: number;
  margin: number;
}> = ({ label, profit, margin }) => (
  <div className="rounded-xl border border-nw-border bg-nw-surface-2 p-2.5">
    <span className="text-xs font-bold text-nw-muted">{label}</span>
    <div
      className={`mt-1 flex items-center justify-between ${
        profit >= 0 ? 'text-nw-ok' : 'text-nw-bad'
      }`}
    >
      <strong className="text-xs">
        {formatJod(profit)} {CURRENCY}
      </strong>
      <span className="font-mono text-xs">%{margin.toFixed(1)}</span>
    </div>
  </div>
);

const TextMetric: React.FC<{
  label: string;
  value: string;
  color?: string;
}> = ({ label, value, color = 'text-nw-text' }) => (
  <div className="min-w-0 rounded-xl border border-nw-border bg-nw-surface-2 p-2 text-center">
    <span className="block text-xs font-bold text-nw-muted">{label}</span>
    <strong className={`mt-1 block break-words text-xs ${color}`}>
      {value}
    </strong>
  </div>
);

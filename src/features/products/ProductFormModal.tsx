import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Barcode,
  Boxes,
  CheckCircle2,
  Image,
  Info,
  Layers3,
  Package,
  Palette,
  Plus,
  Tag,
  Trash2,
  Upload,
  Warehouse,
  X,
} from 'lucide-react';
import { CURRENCY, PURCHASE_PACKAGE_OPTIONS } from '../../constants';
import {
  removeUploadedProductImage,
  uploadProductImageToSupabase,
} from '../../services/supabase/product-images.service';
import { createProductFamilyWithFlavorsInSupabase } from '../../services/supabase/products.service';
import { useAppStore } from '../../stores/useAppStore';
import { Product } from '../../types';
import { validateProductImage } from '../../utils/productImage';
import {
  calculatePackagePrice,
  calculateProductProfit,
  calculateUnitCost,
} from '../../utils/productCalculations';

interface ProductFormModalProps {
  initialProduct?: Product | null;
  onClose: () => void;
}

interface ProductFlavorDraft {
  id: string;
  nameAr: string;
  openingSalePackages: number | '';
  imageFile: File | null;
  imagePreview: string;
}

const createFlavorDraft = (): ProductFlavorDraft => ({
  id:
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `flavor-${Date.now()}-${Math.random()}`,
  nameAr: '',
  openingSalePackages: 0,
  imageFile: null,
  imagePreview: '',
});

const inputClass =
  'w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs font-semibold text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10';

const numberInputClass =
  'w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-center text-xs font-extrabold text-slate-100 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10';

export const ProductFormModal: React.FC<ProductFormModalProps> = ({
  initialProduct,
  onClose,
}) => {
  const {
    categories,
    brands,
    warehouses,
    addCategory,
    addProduct,
    updateProduct,
    refreshProductsFromSupabase,
    setToast,
  } = useAppStore();

  const isEditing = Boolean(initialProduct?.id);
  const activeCategories = useMemo(
    () => categories.filter((category) => !category.isHidden),
    [categories]
  );
  const activeBrands = useMemo(
    () => brands.filter((brand) => !brand.isHidden),
    [brands]
  );

  const [nameAr, setNameAr] = useState(initialProduct?.nameAr || '');
  const [description, setDescription] = useState(
    initialProduct?.description || ''
  );
  const [imageUrl, setImageUrl] = useState(initialProduct?.imageUrl || '');
  const [imageFailed, setImageFailed] = useState(false);
  const [selectedImageFile, setSelectedImageFile] =
    useState<File | null>(null);
  const [selectedImagePreview, setSelectedImagePreview] = useState('');
  const [imageError, setImageError] = useState('');
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const [categoryId, setCategoryId] = useState(
    initialProduct?.categoryId || activeCategories[0]?.id || ''
  );
  const [brandId, setBrandId] = useState(initialProduct?.brandId || '');
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState('');

  const [barcode, setBarcode] = useState(initialProduct?.barcode || '');
  const [sku, setSku] = useState(initialProduct?.sku || '');
  const [purchasePackage, setPurchasePackage] = useState(
    initialProduct?.purchasePackage || 'كرتونة'
  );
  const [unitsPerPackage, setUnitsPerPackage] = useState<number | ''>(
    initialProduct?.unitsPerPackage ?? 1
  );
  const [defaultPurchasePrice, setDefaultPurchasePrice] = useState<number | ''>(
    initialProduct?.defaultPurchasePrice ??
      (initialProduct
        ? initialProduct.costPrice * (initialProduct.unitsPerPackage || 1)
        : '')
  );
  const [unitPurchasePrice, setUnitPurchasePrice] = useState<number | ''>(
    initialProduct?.defaultPurchasePrice !== undefined
      ? calculateUnitCost(
          initialProduct.defaultPurchasePrice,
          initialProduct.unitsPerPackage || 1
        )
      : initialProduct?.costPrice ?? ''
  );
  const [lastPurchasePriceEdited, setLastPurchasePriceEdited] = useState<
    'package' | 'unit'
  >('package');
  const [salePackage, setSalePackage] = useState(
    initialProduct?.saleUnitCode &&
      initialProduct.saleUnitCode !== 'PCS' &&
      initialProduct.salePackage
      ? initialProduct.salePackage
      : 'كرتونة'
  );
  const [unitsPerSalePackage, setUnitsPerSalePackage] = useState<
    number | ''
  >(
    initialProduct?.unitsPerSalePackage ??
      initialProduct?.unitsPerPackage ??
      1
  );
  const [salePackagePrice, setSalePackagePrice] = useState<number | ''>(
    initialProduct?.salePackagePrice ??
      (initialProduct
        ? (initialProduct.wholesalePrice || initialProduct.retailPrice) *
          (initialProduct.unitsPerSalePackage ||
            initialProduct.unitsPerPackage ||
            1)
        : '')
  );
  const [unit] = useState(initialProduct?.unit || 'قطعة');
  const [warehouseId, setWarehouseId] = useState(
    initialProduct?.warehouseId || warehouses[0]?.id || ''
  );
  const [onHandQuantity, setOnHandQuantity] = useState<number | ''>(
    initialProduct?.onHandQuantity ?? 0
  );
  const [reorderLevel, setReorderLevel] = useState<number | ''>(
    initialProduct?.reorderLevel ?? 5
  );
  const [maxStockLevel, setMaxStockLevel] = useState<number | ''>(
    initialProduct?.maxStockLevel ?? ''
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasFlavors, setHasFlavors] = useState(false);
  const [flavorDrafts, setFlavorDrafts] = useState<ProductFlavorDraft[]>([]);
  const [submitError, setSubmitError] = useState<{
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  } | null>(null);

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

  const validUnitsPerPackage = Math.max(
    1,
    Math.floor(Number(unitsPerPackage) || 1)
  );
  const validPackagePrice = Math.max(
    0,
    Number(defaultPurchasePrice) || 0
  );
  const costPerUnit = Math.max(
    0,
    Number(unitPurchasePrice) ||
      calculateUnitCost(validPackagePrice, validUnitsPerPackage)
  );
  const validUnitsPerSalePackage = Math.max(
    1,
    Math.floor(Number(unitsPerSalePackage) || 1)
  );
  const validSalePackagePrice = Math.max(
    0,
    Number(salePackagePrice) || 0
  );
  const salePackageCost = calculatePackagePrice(
    costPerUnit,
    validUnitsPerSalePackage
  );
  const salePackageProfit = calculateProductProfit(
    validSalePackagePrice,
    salePackageCost
  );
  const derivedSalePricePerUnit = calculateUnitCost(
    validSalePackagePrice,
    validUnitsPerSalePackage
  );

  const createCategoryInline = async () => {
    const cleanName = newCategoryName.trim();
    if (!cleanName) {
      setCategoryError('اكتب اسم القسم أولاً.');
      return;
    }

    setIsCreatingCategory(true);
    setCategoryError('');
    const result = await addCategory({ nameAr: cleanName });
    setIsCreatingCategory(false);

    if (!result?.success || !result.categoryId) {
      setCategoryError(result?.error || 'تعذر إضافة القسم.');
      return;
    }

    setCategoryId(result.categoryId);
    setNewCategoryName('');
    setShowNewCategory(false);
  };

  const generateSku = () => {
    setSku(`NWS-${Date.now().toString().slice(-7)}`);
  };

  const changeUnitsPerPackage = (rawValue: string) => {
    const nextValue =
      rawValue === '' ? '' : Number.parseInt(rawValue, 10);
    const nextUnits = Math.max(1, Number(nextValue) || 1);
    setUnitsPerPackage(nextValue);

    if (lastPurchasePriceEdited === 'unit' && unitPurchasePrice !== '') {
      setDefaultPurchasePrice(
        calculatePackagePrice(Number(unitPurchasePrice), nextUnits)
      );
    } else if (defaultPurchasePrice !== '') {
      setUnitPurchasePrice(
        calculateUnitCost(Number(defaultPurchasePrice), nextUnits)
      );
    }
  };

  const changePackagePurchasePrice = (rawValue: string) => {
    if (rawValue === '') {
      setDefaultPurchasePrice('');
      setUnitPurchasePrice('');
      setLastPurchasePriceEdited('package');
      return;
    }

    const nextPackagePrice = Math.max(0, Number.parseFloat(rawValue) || 0);
    setDefaultPurchasePrice(nextPackagePrice);
    setUnitPurchasePrice(
      calculateUnitCost(nextPackagePrice, validUnitsPerPackage)
    );
    setLastPurchasePriceEdited('package');
  };

  const changeUnitPurchasePrice = (rawValue: string) => {
    if (rawValue === '') {
      setUnitPurchasePrice('');
      setDefaultPurchasePrice('');
      setLastPurchasePriceEdited('unit');
      return;
    }

    const nextUnitPrice = Math.max(0, Number.parseFloat(rawValue) || 0);
    setUnitPurchasePrice(nextUnitPrice);
    setDefaultPurchasePrice(
      calculatePackagePrice(nextUnitPrice, validUnitsPerPackage)
    );
    setLastPurchasePriceEdited('unit');
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

  const toggleFlavorMode = () => {
    setHasFlavors((current) => {
      const next = !current;
      if (next) {
        setOnHandQuantity(0);
        setFlavorDrafts((drafts) =>
          drafts.length > 0 ? drafts : [createFlavorDraft()]
        );
      } else {
        flavorDrafts.forEach((draft) => {
          if (draft.imagePreview) URL.revokeObjectURL(draft.imagePreview);
        });
        setFlavorDrafts([]);
      }
      return next;
    });
  };

  const updateFlavorDraft = (
    id: string,
    changes: Partial<ProductFlavorDraft>
  ) => {
    setFlavorDrafts((drafts) =>
      drafts.map((draft) =>
        draft.id === id ? { ...draft, ...changes } : draft
      )
    );
  };

  const selectFlavorImage = (id: string, file?: File) => {
    if (!file) return;
    const validationError = validateProductImage(file);
    if (validationError) {
      setToast(validationError, 'error');
      return;
    }

    setFlavorDrafts((drafts) =>
      drafts.map((draft) => {
        if (draft.id !== id) return draft;
        if (draft.imagePreview) URL.revokeObjectURL(draft.imagePreview);
        return {
          ...draft,
          imageFile: file,
          imagePreview: URL.createObjectURL(file),
        };
      })
    );
  };

  const removeFlavorDraft = (id: string) => {
    setFlavorDrafts((drafts) => {
      const removed = drafts.find((draft) => draft.id === id);
      if (removed?.imagePreview) URL.revokeObjectURL(removed.imagePreview);
      return drafts.filter((draft) => draft.id !== id);
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!nameAr.trim() || !sku.trim()) {
      setToast('اسم المنتج ورمز الصنف SKU مطلوبان.', 'error');
      return;
    }
    if (!categoryId) {
      setToast('اختر قسم المنتج أو أضف قسمًا جديدًا.', 'error');
      return;
    }
    if (!warehouseId && !isEditing) {
      setToast('اختر المستودع الذي سيحمل الرصيد الافتتاحي.', 'error');
      return;
    }
    if (validPackagePrice <= 0) {
      setToast('سعر شراء الطرد يجب أن يكون أكبر من صفر.', 'error');
      return;
    }
    if (validSalePackagePrice <= 0) {
      setToast('أدخل سعر بيع طرد الجملة كاملًا.', 'error');
      return;
    }
    if (hasFlavors && !isEditing) {
      if (flavorDrafts.length < 1) {
        setToast('أضف نكهة واحدة على الأقل.', 'error');
        return;
      }
      const normalizedFlavorNames = flavorDrafts.map((draft) =>
        draft.nameAr.trim().toLocaleLowerCase('ar')
      );
      if (normalizedFlavorNames.some((name) => !name)) {
        setToast('اكتب اسمًا لكل نكهة.', 'error');
        return;
      }
      if (new Set(normalizedFlavorNames).size !== normalizedFlavorNames.length) {
        setToast('لا يمكن تكرار اسم النكهة نفسها.', 'error');
        return;
      }
    }

    const minLevel = Math.max(
      0,
      Math.floor(Number(reorderLevel) || 0)
    );
    const maxLevel =
      maxStockLevel === ''
        ? undefined
        : Math.max(0, Math.floor(Number(maxStockLevel) || 0));
    if (maxLevel !== undefined && maxLevel < minLevel) {
      setToast('الحد الأعلى للمخزون يجب أن يساوي حد التنبيه أو يزيد عنه.', 'error');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const payload: Partial<Product> = {
      nameAr: nameAr.trim(),
      description: description.trim(),
      imageUrl: imageUrl.trim(),
      categoryId,
      brandId,
      barcode: barcode.trim(),
      sku: sku.trim().toUpperCase(),
      purchasePackage,
      unitsPerPackage: validUnitsPerPackage,
      defaultPurchasePrice: validPackagePrice,
      salePackage,
      unitsPerSalePackage: validUnitsPerSalePackage,
      salePackagePrice: validSalePackagePrice,
      costPrice: costPerUnit,
      retailPrice: derivedSalePricePerUnit,
      wholesalePrice: derivedSalePricePerUnit,
      profitPerPiece:
        salePackageProfit.profitPerUnit / validUnitsPerSalePackage,
      profitPercentage: salePackageProfit.markupPercentage,
      unit,
      warehouseId,
      onHandQuantity:
        hasFlavors && !isEditing
          ? 0
          : Math.max(0, Math.floor(Number(onHandQuantity) || 0)),
      reorderLevel: minLevel,
      maxStockLevel: maxLevel,
      status: 'active',
    };

    const uploadedStoragePaths: string[] = [];
    let productWasPersisted = false;
    const cleanupUploadedImages = async () => {
      await Promise.all(
        uploadedStoragePaths.map((storagePath) =>
          removeUploadedProductImage(storagePath).catch(() => undefined)
        )
      );
    };

    try {
      if (selectedImageFile) {
        const uploadResult =
          await uploadProductImageToSupabase(selectedImageFile);

        if (!uploadResult.success || !uploadResult.publicUrl) {
          setSubmitError({
            message:
              uploadResult.error || 'تعذر رفع صورة المنتج إلى Supabase.',
            code: uploadResult.code || 'PRODUCT_IMAGE_UPLOAD_FAILED',
          });
          return;
        }

        if (uploadResult.storagePath) {
          uploadedStoragePaths.push(uploadResult.storagePath);
        }
        payload.imageUrl = uploadResult.publicUrl;
      }

      let result;
      if (hasFlavors && !isEditing) {
        const uploadedFlavors = [];
        for (const draft of flavorDrafts) {
          let flavorImageUrl = '';
          if (draft.imageFile) {
            const upload = await uploadProductImageToSupabase(draft.imageFile);
            if (!upload.success || !upload.publicUrl) {
              throw new Error(
                upload.error || `تعذر رفع صورة نكهة ${draft.nameAr}.`
              );
            }
            if (upload.storagePath) {
              uploadedStoragePaths.push(upload.storagePath);
            }
            flavorImageUrl = upload.publicUrl;
          }
          uploadedFlavors.push({
            nameAr: draft.nameAr.trim(),
            openingSalePackages: Math.max(
              0,
              Math.floor(Number(draft.openingSalePackages) || 0)
            ),
            imageUrl: flavorImageUrl,
          });
        }

        result = await createProductFamilyWithFlavorsInSupabase({
          sku: payload.sku || '',
          barcode: payload.barcode,
          nameAr: payload.nameAr || '',
          description: payload.description,
          categoryId: payload.categoryId,
          brandId: payload.brandId,
          unitName: unit,
          purchasePackage,
          unitsPerPackage: validUnitsPerPackage,
          defaultPurchasePrice: validPackagePrice,
          salePackage,
          unitsPerSalePackage: validUnitsPerSalePackage,
          salePackagePrice: validSalePackagePrice,
          costPrice: costPerUnit,
          reorderLevel: minLevel,
          maxStockLevel: maxLevel,
          warehouseId,
          openingQuantity: 0,
          imageUrl: payload.imageUrl,
          flavors: uploadedFlavors,
        });
      } else {
        result =
          isEditing && initialProduct?.id
            ? await updateProduct(initialProduct.id, payload)
            : await addProduct(payload);
      }

      if (result?.success) {
        productWasPersisted = true;
        if (hasFlavors && !isEditing) {
          await refreshProductsFromSupabase();
          setToast(
            result.message ||
              'تم إنشاء المنتج وجميع نكهاته ومخزونها بنجاح.',
            'success'
          );
        }
        onClose();
        return;
      }

      await cleanupUploadedImages();

      setSubmitError({
        message: result?.error || 'فشل حفظ المنتج في Supabase.',
        code: result?.errorDetails?.code || 'PRODUCT_SAVE_FAILED',
        details: result?.errorDetails?.details,
        hint: result?.errorDetails?.hint,
      });
    } catch (error: any) {
      if (!productWasPersisted) {
        await cleanupUploadedImages();
      }

      setSubmitError({
        message:
          error?.message || 'حدث خطأ غير متوقع أثناء حفظ المنتج.',
        code: 'CLIENT_EXCEPTION',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} dir="rtl" className="space-y-4 text-xs">
      <section className="overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-950/50 via-slate-950 to-slate-950">
        <div className="flex items-center justify-between border-b border-white/5 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
              <Package className="h-4 w-4" />
            </span>
            <div>
              <h4 className="font-black text-slate-100">هوية الصنف</h4>
              <p className="text-[10px] text-slate-500">
                الاسم والقسم والوصف الظاهر للفريق
              </p>
            </div>
          </div>
          <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[9px] font-bold text-blue-300">
            أساسي
          </span>
        </div>

        <div className="space-y-3 p-3.5">
          <div className="flex items-start gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
              {imagePreviewSource && !imageFailed ? (
                <img
                  src={imagePreviewSource}
                  alt={nameAr ? `صورة ${nameAr}` : 'معاينة صورة المنتج'}
                  onError={() => setImageFailed(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Image className="h-6 w-6 text-slate-600" />
              )}
            </div>
            <div className="flex-1 space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-300">
                اسم المنتج *
              </label>
              <input
                required
                value={nameAr}
                onChange={(event) => setNameAr(event.target.value)}
                placeholder="مثال: مياه 330 مل"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[10px] font-bold text-slate-300">
                القسم *
              </label>
              <button
                type="button"
                onClick={() => {
                  setShowNewCategory((value) => !value);
                  setCategoryError('');
                }}
                className="flex items-center gap-1 text-[10px] font-bold text-blue-400"
              >
                <Plus className="h-3 w-3" />
                قسم جديد
              </button>
            </div>
            <select
              required
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className={inputClass}
            >
              <option value="">اختر القسم</option>
              {activeCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.nameAr}
                </option>
              ))}
            </select>

            {showNewCategory && (
              <div className="mt-2 rounded-xl border border-blue-500/25 bg-blue-500/5 p-2">
                <div className="flex gap-2">
                  <input
                    value={newCategoryName}
                    onChange={(event) => {
                      setNewCategoryName(event.target.value);
                      setCategoryError('');
                    }}
                    placeholder="اسم القسم الجديد"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={createCategoryInline}
                    disabled={isCreatingCategory}
                    className="shrink-0 rounded-xl bg-blue-600 px-3 font-bold text-white disabled:opacity-50"
                  >
                    {isCreatingCategory ? '...' : 'إضافة'}
                  </button>
                </div>
                {categoryError && (
                  <p className="mt-1.5 text-[10px] font-bold text-rose-400">
                    {categoryError}
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-bold text-slate-300">
              العلامة التجارية
            </label>
            <select
              value={brandId}
              onChange={(event) => setBrandId(event.target.value)}
              className={inputClass}
            >
              <option value="">بدون علامة تجارية</option>
              {activeBrands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.nameAr}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-bold text-slate-300">
              وصف مختصر
            </label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="الحجم أو النكهة أو أي وصف يساعد الفريق على تمييز الصنف"
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="rounded-xl border border-dashed border-blue-500/30 bg-blue-500/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-black text-slate-200">صورة المنتج</p>
                <p className="mt-0.5 text-[9px] text-slate-500">
                  JPG أو PNG أو WebP — بحد أقصى 5 ميجابايت
                </p>
              </div>
              <label
                htmlFor="product-image-upload"
                className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-[10px] font-black text-white transition hover:bg-blue-500"
              >
                <Upload className="h-3.5 w-3.5" />
                {selectedImageFile || imageUrl
                  ? 'تغيير الصورة'
                  : 'اختيار من الاستديو'}
              </label>
              <input
                id="product-image-upload"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleImageSelection}
                className="sr-only"
              />
            </div>

            {selectedImageFile && (
              <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-950/60 px-2.5 py-2">
                <span
                  className="min-w-0 truncate text-[9px] font-bold text-emerald-300"
                  title={selectedImageFile.name}
                >
                  جاهزة للرفع: {selectedImageFile.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedImageFile(null);
                    setImageError('');
                    setImageFailed(false);
                  }}
                  className="mr-2 flex shrink-0 items-center gap-1 text-[9px] font-bold text-slate-400 hover:text-rose-300"
                >
                  <X className="h-3 w-3" />
                  إلغاء
                </button>
              </div>
            )}

            {imageError && (
              <p className="mt-2 text-[10px] font-bold text-rose-400">
                {imageError}
              </p>
            )}

            <button
              type="button"
              onClick={() => setShowImageUrlInput((value) => !value)}
              className="mt-2 text-[9px] font-bold text-slate-500 hover:text-blue-300"
            >
              {showImageUrlInput
                ? 'إخفاء خيار الرابط'
                : 'أو استخدام رابط صورة مباشر'}
            </button>

            {showImageUrlInput && (
              <input
                type="url"
                value={imageUrl}
                onChange={(event) => {
                  setImageUrl(event.target.value);
                  setSelectedImageFile(null);
                  setImageError('');
                  setImageFailed(false);
                }}
                placeholder="https://..."
                className={`${inputClass} mt-2`}
              />
            )}
          </div>
        </div>
      </section>

      {!isEditing && (
        <section
          className={`overflow-hidden rounded-2xl border transition-colors ${
            hasFlavors
              ? 'border-indigo-500/30 bg-slate-950'
              : 'border-slate-800 bg-slate-950'
          }`}
        >
          <div className="flex items-center justify-between gap-3 p-3.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  hasFlavors
                    ? 'bg-indigo-500/15 text-indigo-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                <Palette className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h4 className="font-black text-slate-100">
                  هل لهذا المنتج نكهات؟
                </h4>
                <p className="mt-0.5 text-[10px] leading-4 text-slate-500">
                  السعر والطرد موحّدان، والمخزون يُتابع لكل نكهة وحدها
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={hasFlavors}
              onClick={toggleFlavorMode}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1.5 font-black transition ${
                hasFlavors
                  ? 'border-indigo-400/30 bg-indigo-500/15 text-indigo-200'
                  : 'border-slate-700 bg-slate-900 text-slate-400'
              }`}
            >
              <span>{hasFlavors ? 'نعم' : 'لا'}</span>
              <span
                className={`relative h-5 w-9 rounded-full transition ${
                  hasFlavors ? 'bg-indigo-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                    hasFlavors ? 'right-0.5' : 'right-[18px]'
                  }`}
                />
              </span>
            </button>
          </div>

          {hasFlavors && (
            <div className="space-y-3 border-t border-indigo-500/15 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <strong className="text-[11px] text-indigo-200">
                    النكهات ورصيد البداية
                  </strong>
                  <p className="mt-0.5 text-[9px] text-slate-500">
                    مثال: جبنة، حار، ملح وخل
                  </p>
                </div>
                <span className="rounded-full bg-indigo-500/10 px-2 py-1 text-[9px] font-black text-indigo-300">
                  {flavorDrafts.length} نكهة
                </span>
              </div>

              <div className="space-y-2.5">
                {flavorDrafts.map((draft, index) => (
                  <div
                    key={draft.id}
                    className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3"
                  >
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="flex h-6 min-w-6 items-center justify-center rounded-lg bg-indigo-500/15 px-1.5 text-[10px] font-black text-indigo-300">
                        {index + 1}
                      </span>
                      {flavorDrafts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeFlavorDraft(draft.id)}
                          aria-label={`حذف النكهة ${index + 1}`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-[minmax(0,1fr)_110px_52px] gap-2 max-[390px]:grid-cols-[minmax(0,1fr)_92px_48px]">
                      <div>
                        <label className="mb-1.5 block text-[9px] font-bold text-slate-400">
                          اسم النكهة *
                        </label>
                        <input
                          type="text"
                          required
                          value={draft.nameAr}
                          onChange={(event) =>
                            updateFlavorDraft(draft.id, {
                              nameAr: event.target.value,
                            })
                          }
                          placeholder="مثلاً: جبنة"
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block truncate text-[9px] font-bold text-emerald-300">
                          رصيد البداية ({salePackage})
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          required
                          value={draft.openingSalePackages}
                          onChange={(event) =>
                            updateFlavorDraft(draft.id, {
                              openingSalePackages:
                                event.target.value === ''
                                  ? ''
                                  : Number.parseInt(event.target.value, 10),
                            })
                          }
                          className={numberInputClass}
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-center text-[9px] font-bold text-slate-500">
                          صورة
                        </label>
                        <label className="flex h-[38px] cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-700 bg-slate-950 text-slate-500 transition hover:border-indigo-500/50 hover:text-indigo-300">
                          {draft.imagePreview ? (
                            <img
                              src={draft.imagePreview}
                              alt={`معاينة ${draft.nameAr || `النكهة ${index + 1}`}`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Image className="h-4 w-4" />
                          )}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(event) =>
                              selectFlavorImage(
                                draft.id,
                                event.target.files?.[0] || null
                              )
                            }
                            className="sr-only"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                disabled={flavorDrafts.length >= 30}
                onClick={() =>
                  setFlavorDrafts((current) => [
                    ...current,
                    createFlavorDraft(),
                  ])
                }
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-500/30 bg-indigo-500/5 py-2.5 font-black text-indigo-300 transition hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                إضافة نكهة أخرى
              </button>

              <div className="flex items-start gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-2.5 text-[10px] leading-5 text-slate-400">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                عند الحفظ يُنشأ المنتج ونكهاته معًا، وكل نكهة تظهر برصيدها
                الخاص بينما ترث السعر والطرد من المنتج الأساسي.
              </div>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <Barcode className="h-4 w-4 text-cyan-400" />
          <div>
            <h4 className="font-black text-slate-100">التعريف والتتبع</h4>
            <p className="text-[10px] text-slate-500">
              SKU داخلي، والباركود اختياري
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[10px] font-bold text-slate-300">
                SKU *
              </label>
              {!isEditing && (
                <button
                  type="button"
                  onClick={generateSku}
                  className="text-[9px] font-bold text-cyan-400"
                >
                  توليد
                </button>
              )}
            </div>
            <input
              required
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              placeholder="NWS-1001"
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-bold text-slate-300">
              الباركود
            </label>
            <input
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="اختياري"
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-950/20 to-slate-950 p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-amber-400" />
          <div>
            <h4 className="font-black text-slate-100">شراء المورد</h4>
            <p className="text-[10px] text-slate-500">
              عرّف الطرد مرة واحدة، والتكلفة تُحسب للحبة
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1.5 block text-[9px] font-bold text-slate-400">
              نوع الطرد
            </label>
            <select
              value={purchasePackage}
              onChange={(event) => setPurchasePackage(event.target.value)}
              className={inputClass}
            >
              {PURCHASE_PACKAGE_OPTIONS.map((item) => (
                <option key={item.code} value={item.nameAr}>
                  {item.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[9px] font-bold text-slate-400">
              عدد الحبات في الطرد *
            </label>
            <input
              type="number"
              min="1"
              step="1"
              required
              value={unitsPerPackage}
              onChange={(event) =>
                changeUnitsPerPackage(event.target.value)
              }
              className={numberInputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[9px] font-bold text-slate-400">
              سعر شراء الطرد *
            </label>
            <input
              type="number"
              min="0.001"
              step="0.001"
              required
              value={defaultPurchasePrice}
              onChange={(event) =>
                changePackagePurchasePrice(event.target.value)
              }
              className={numberInputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[9px] font-bold text-amber-300">
              سعر شراء الحبة *
            </label>
            <input
              type="number"
              min="0.001"
              step="0.001"
              required
              value={unitPurchasePrice}
              onChange={(event) =>
                changeUnitPurchasePrice(event.target.value)
              }
              className={`${numberInputClass} border-amber-500/25 text-amber-200 focus:border-amber-400`}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-500/15 bg-amber-500/5 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
            <ArrowLeftRight className="h-3.5 w-3.5 text-amber-400" />
            السعران مربوطان تلقائيًا
          </span>
          <strong className="text-[10px] text-amber-300">
            {validUnitsPerPackage} حبة × {costPerUnit.toFixed(3)} ={' '}
            {validPackagePrice.toFixed(3)} {CURRENCY}
          </strong>
        </div>
      </section>

      <section className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/25 to-slate-950 p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <Tag className="h-4 w-4 text-emerald-400" />
          <div>
            <h4 className="font-black text-slate-100">
              طرد بيع الجملة والربح
            </h4>
            <p className="text-[10px] text-slate-500">
              لا يوجد بيع بالحبة؛ السعر المدخل للطرد كاملًا
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="mb-1.5 block text-[9px] font-bold text-emerald-300">
              نوع طرد البيع
            </label>
            <select
              value={salePackage}
              onChange={(event) => setSalePackage(event.target.value)}
              className={inputClass}
            >
              {PURCHASE_PACKAGE_OPTIONS.filter(
                (option) => option.code !== 'PCS'
              ).map((option) => (
                <option key={option.code} value={option.nameAr}>
                  {option.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[9px] font-bold text-slate-300">
              الحبات في طرد البيع *
            </label>
            <input
              type="number"
              min="1"
              step="1"
              required
              value={unitsPerSalePackage}
              onChange={(event) =>
                setUnitsPerSalePackage(
                  event.target.value === ''
                    ? ''
                    : Number.parseInt(event.target.value, 10)
                )
              }
              className={numberInputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[9px] font-bold text-emerald-300">
              سعر بيع الطرد *
            </label>
            <input
              type="number"
              min="0.001"
              step="0.001"
              required
              value={salePackagePrice}
              onChange={(event) =>
                setSalePackagePrice(
                  event.target.value === ''
                    ? ''
                    : Number.parseFloat(event.target.value)
                )
              }
              className={numberInputClass}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <WholesaleMetric
            label={`تكلفة ${salePackage}`}
            value={salePackageCost}
            tone="amber"
          />
          <ProfitCard
            label={`ربح ${salePackage}`}
            profit={salePackageProfit.profitPerUnit}
            margin={salePackageProfit.marginPercentage}
          />
        </div>

        <div className="mt-2 flex items-start gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-2.5 text-[10px] leading-5 text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
          الزبون يطلب عدد طرود؛ كل {salePackage} يخصم{' '}
          {validUnitsPerSalePackage} {unit} من المخزون.
        </div>

        {salePackageProfit.isLoss && (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-[10px] font-bold text-rose-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            سعر بيع الطرد أقل من تكلفته؛ سيظهر بيع هذا الطرد كخسارة.
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <Warehouse className="h-4 w-4 text-indigo-400" />
          <div>
            <h4 className="font-black text-slate-100">ضبط المخزون</h4>
            <p className="text-[10px] text-slate-500">
              الرصيد يتحرك لاحقًا من الاستلام والطلبات تلقائيًا
            </p>
          </div>
        </div>

        {!isEditing && (
          <div className="mb-3">
            <label className="mb-1.5 block text-[10px] font-bold text-slate-300">
              مستودع الرصيد الافتتاحي *
            </label>
            <select
              required
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
              className={inputClass}
            >
              <option value="">اختر المستودع</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {hasFlavors && !isEditing && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-indigo-500/15 bg-indigo-500/5 px-3 py-2 text-[10px] font-bold text-indigo-200">
            <Palette className="h-3.5 w-3.5 shrink-0" />
            الرصيد الافتتاحي موزّع على النكهات في القسم السابق.
          </div>
        )}

        <div
          className={`grid gap-2 ${
            isEditing || hasFlavors ? 'grid-cols-2' : 'grid-cols-3'
          }`}
        >
          {!isEditing && !hasFlavors && (
            <div>
              <label className="mb-1.5 block text-[9px] font-bold text-slate-400">
                رصيد افتتاحي
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={onHandQuantity}
                onChange={(event) =>
                  setOnHandQuantity(
                    event.target.value === ''
                      ? ''
                      : Number.parseInt(event.target.value, 10)
                  )
                }
                className={numberInputClass}
              />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-[9px] font-bold text-amber-300">
              تنبيه عند
            </label>
            <input
              type="number"
              min="0"
              step="1"
              required
              value={reorderLevel}
              onChange={(event) =>
                setReorderLevel(
                  event.target.value === ''
                    ? ''
                    : Number.parseInt(event.target.value, 10)
                )
              }
              className={numberInputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[9px] font-bold text-slate-400">
              حد أعلى
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={maxStockLevel}
              onChange={(event) =>
                setMaxStockLevel(
                  event.target.value === ''
                    ? ''
                    : Number.parseInt(event.target.value, 10)
                )
              }
              placeholder="اختياري"
              className={numberInputClass}
            />
          </div>
        </div>

        {isEditing && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
              <Boxes className="h-3.5 w-3.5 text-indigo-400" />
              الرصيد الحالي لا يُعدل من بطاقة الصنف
            </span>
            <strong className="text-amber-300">
              {initialProduct?.onHandQuantity || 0} {unit}
            </strong>
          </div>
        )}

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-900/70 p-2.5 text-[10px] leading-5 text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
          تاريخ الصلاحية ورقم التشغيلة يُسجلان عند استلام شحنة المورد،
          لأن كل شحنة قد تحمل صلاحية مختلفة.
        </div>
      </section>

      {submitError && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-200">
          <div className="flex items-center gap-2 font-black text-rose-400">
            <AlertTriangle className="h-4 w-4" />
            تعذر حفظ المنتج
          </div>
          <p className="mt-1.5 font-bold">{submitError.message}</p>
          {submitError.code && (
            <p className="mt-1 font-mono text-[10px] text-rose-300/80">
              {submitError.code}
            </p>
          )}
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-1 flex gap-2 border-t border-slate-800 bg-slate-900/95 px-1 pt-3 backdrop-blur">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-black text-white shadow-lg shadow-blue-600/20 transition active:scale-[0.98] disabled:opacity-50"
        >
          <CheckCircle2
            className={`h-4 w-4 ${isSubmitting ? 'animate-spin' : ''}`}
          />
          {isSubmitting
            ? 'جاري الحفظ...'
            : isEditing
              ? 'حفظ التعديلات'
              : hasFlavors
                ? `إنشاء المنتج و${flavorDrafts.length} نكهة`
                : 'إنشاء المنتج'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="rounded-xl bg-slate-800 px-5 font-bold text-slate-300"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
};

const ProfitCard: React.FC<{
  label: string;
  profit: number;
  margin: number;
}> = ({ label, profit, margin }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-2.5">
    <span className="text-[9px] font-bold text-slate-500">{label}</span>
    <div
      className={`mt-0.5 flex items-end justify-between ${
        profit >= 0 ? 'text-emerald-400' : 'text-rose-400'
      }`}
    >
      <strong className="text-xs">
        {profit.toFixed(3)} {CURRENCY}
      </strong>
      <span className="font-mono text-[10px]">%{margin.toFixed(1)}</span>
    </div>
  </div>
);

const WholesaleMetric: React.FC<{
  label: string;
  value: number;
  tone: 'amber' | 'slate';
}> = ({ label, value, tone }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-2.5">
    <span className="text-[9px] font-bold text-slate-500">{label}</span>
    <strong
      className={`mt-1 block text-[11px] ${
        tone === 'amber' ? 'text-amber-300' : 'text-slate-300'
      }`}
    >
      {value.toFixed(3)} {CURRENCY}
    </strong>
  </div>
);

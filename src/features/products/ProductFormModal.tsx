import {Card,FormFields,UiButton,formatJod} from '../../components/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Barcode,
  Boxes,
  Camera,
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
import { BarcodeCameraCaptureModal } from '../barcode/BarcodeCameraCaptureModal';
import type { StartBarcodeCamera } from '../barcode/barcodeCamera';
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
import {
  generateUniqueProductSku,
  validateProductBarcode,
  validateProductIdentifiers,
} from '../../utils/productIdentifiers';

interface ProductFormModalProps {
  initialProduct?: Product | null;
  onClose: () => void;
  startBarcodeScanner?: StartBarcodeCamera;
}

interface ProductFlavorDraft {
  id: string;
  nameAr: string;
  imageFile: File | null;
  imagePreview: string;
}

const createFlavorDraft = (): ProductFlavorDraft => ({
  id:
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `flavor-${Date.now()}-${Math.random()}`,
  nameAr: '',
  imageFile: null,
  imagePreview: '',
});

const toSalePackageCount = (
  baseQuantity: number | undefined,
  unitsPerSalePackage: number | undefined
) =>
  Math.ceil(
    Math.max(0, Number(baseQuantity) || 0) /
      Math.max(1, Number(unitsPerSalePackage) || 1)
  );

const inputClass =
  'w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2.5 text-sm font-semibold text-nw-text outline-none transition placeholder:text-nw-muted focus:border-nw-border focus:ring-2 focus:ring-nw-primary';

const numberInputClass =
  'w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2.5 text-center text-sm font-extrabold text-nw-text outline-none transition focus:border-nw-border focus:ring-2 focus:ring-nw-primary';

export const ProductFormModal: React.FC<ProductFormModalProps> = ({
  initialProduct,
  onClose,
  startBarcodeScanner,
}) => {
  const {
    categories,
    brands,
    products,
    warehouses,
    addCategory,
    addProduct,
    updateProduct,
    refreshProductsFromSupabase,
    openModal,
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
  const [isBarcodeCameraOpen, setIsBarcodeCameraOpen] = useState(false);
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
  const initialSalePackageUnits =
    initialProduct?.unitsPerSalePackage ??
    initialProduct?.unitsPerPackage ??
    1;
  const [reorderLevel, setReorderLevel] = useState<number | ''>(
    initialProduct
      ? toSalePackageCount(initialProduct.reorderLevel, initialSalePackageUnits)
      : 5
  );
  const [maxStockLevel, setMaxStockLevel] = useState<number | ''>(
    initialProduct?.maxStockLevel === undefined
      ? ''
      : toSalePackageCount(
          initialProduct.maxStockLevel,
          initialSalePackageUnits
        )
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
  const currentFlavors = useMemo(
    () =>
      initialProduct?.id
        ? products
            .filter(
              (product) =>
                product.flavorMasterProductId === initialProduct.id
            )
            .sort(
              (first, second) =>
                (first.flavorSortOrder || 0) -
                  (second.flavorSortOrder || 0) ||
                (first.flavorNameAr || '').localeCompare(
                  second.flavorNameAr || '',
                  'ar'
                )
            )
        : [],
    [initialProduct?.id, products]
  );
  const isFlavorMaster = Boolean(
    initialProduct?.isFlavorMaster || (hasFlavors && !isEditing)
  );

  const captureBarcode = useCallback(
    (value: string) => {
      const capturedBarcode = value.trim();
      setBarcode(capturedBarcode);
      setSubmitError(null);

      const validation = validateProductBarcode(products, {
        barcode: capturedBarcode,
        currentProductId: initialProduct?.id,
      });
      if (validation.valid === false) {
        setSubmitError({
          message: validation.message,
          code: validation.code,
        });
        setToast(validation.message, 'error');
        return;
      }

      setToast('تمت قراءة الباركود وتعبئة الحقل.', 'success');
    },
    [initialProduct?.id, products, setToast]
  );

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
  const currentStockSalePackages = Math.floor(
    Math.max(0, initialProduct?.onHandQuantity || 0) /
      validUnitsPerSalePackage
  );
  const currentStockLooseUnits =
    Math.max(0, initialProduct?.onHandQuantity || 0) %
    validUnitsPerSalePackage;

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
    try {
      setSku(
        generateUniqueProductSku([
          sku,
          ...products.flatMap((product) => [product.sku, product.barcode]),
        ])
      );
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : 'تعذر توليد SKU فريد. حاول مرة أخرى.',
        'error'
      );
    }
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
        setBarcode('');
        setIsBarcodeCameraOpen(false);
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
    const identifierValidation = validateProductIdentifiers(products, {
      sku,
      barcode: isFlavorMaster ? '' : barcode,
      currentProductId: initialProduct?.id,
    });
    if (identifierValidation.valid === false) {
      setSubmitError({
        message: identifierValidation.message,
        code: identifierValidation.code,
      });
      setToast(identifierValidation.message, 'error');
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

    const minSalePackages = Math.max(
      0,
      Math.floor(Number(reorderLevel) || 0)
    );
    const maxSalePackages =
      maxStockLevel === ''
        ? undefined
        : Math.max(0, Math.floor(Number(maxStockLevel) || 0));
    if (
      maxSalePackages !== undefined &&
      maxSalePackages < minSalePackages
    ) {
      setToast('سقف المستودع يجب أن يساوي حد التنبيه أو يزيد عنه.', 'error');
      return;
    }
    const minLevel = minSalePackages * validUnitsPerSalePackage;
    const maxLevel =
      maxSalePackages === undefined
        ? undefined
        : maxSalePackages * validUnitsPerSalePackage;

    setIsSubmitting(true);
    setSubmitError(null);

    const payload: Partial<Product> = {
      nameAr: nameAr.trim(),
      description: description.trim(),
      imageUrl: imageUrl.trim(),
      categoryId,
      brandId,
      barcode: isFlavorMaster ? '' : barcode.trim(),
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
      onHandQuantity: 0,
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
    <FormFields className="nw-products-fields min-w-0"><form onSubmit={handleSubmit} aria-busy={isSubmitting} data-unsaved={hasFlavors} dir="rtl" className="nw-products-fields min-w-0 space-y-4 text-nw-text text-sm">
      {(validUnitsPerSalePackage>1 || isFlavorMaster || initialProduct?.flavorMasterProductId) &&
        (initialProduct?.retailPrice ?? derivedSalePricePerUnit)===0 &&
        <p role="status" className="rounded-lg border border-nw-border p-3 text-nw-warn">
          عبّي سعر الباكيت؛ بدونه لا يُحسب خصم ضرر العميل
        </p>}
      <Card padded={false} className="overflow-hidden rounded-2xl border border-nw-border    ">
        <div className="flex items-center justify-between border-b border-nw-border px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-nw-info-bg text-nw-info">
              <Package className="h-4 w-4" />
            </span>
            <div>
              <h4 className="font-black text-nw-text">هوية المنتج</h4>
              <p className="text-xs text-nw-muted">
                الاسم والقسم والوصف الظاهر للفريق
              </p>
            </div>
          </div>
          <span className="rounded-full bg-nw-info-bg px-2 py-1 text-xs font-bold text-nw-info">
            أساسي
          </span>
        </div>

        <div className="space-y-3 p-3.5">
          <div className="flex items-start gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-nw-border bg-nw-surface-2">
              {imagePreviewSource && !imageFailed ? (
                <img
                  src={imagePreviewSource}
                  alt={nameAr ? `صورة ${nameAr}` : 'معاينة صورة المنتج'}
                  onError={() => setImageFailed(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Image className="h-6 w-6 text-nw-muted" />
              )}
            </div>
            <div className="flex-1 space-y-1.5">
              <label className="block text-xs font-bold text-nw-text">
                اسم المنتج *
              </label>
              <input aria-label="اسم المنتج"
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
              <label className="text-xs font-bold text-nw-text">
                القسم *
              </label>
              <UiButton variant="plain"
                type="button"
                onClick={() => {
                  setShowNewCategory((value) => !value);
                  setCategoryError('');
                }}
                className="flex items-center gap-1 text-xs font-bold text-nw-info"
              >
                <Plus className="h-3 w-3" />
                قسم جديد
              </UiButton>
            </div>
            <select aria-label="القسم"
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
              <div className="mt-2 rounded-xl border border-nw-border bg-nw-info-bg p-2">
                <div className="flex gap-2">
                  <input aria-label="اسم القسم الجديد"
                    value={newCategoryName}
                    onChange={(event) => {
                      setNewCategoryName(event.target.value);
                      setCategoryError('');
                    }}
                    placeholder="اسم القسم الجديد"
                    className={inputClass}
                  />
                  <UiButton variant="plain"
                    type="button"
                    onClick={createCategoryInline}
                    disabled={isCreatingCategory}
                    className="shrink-0 rounded-xl bg-nw-primary px-3 font-bold text-nw-on-primary disabled:opacity-50"
                  >
                    {isCreatingCategory ? '...' : 'إضافة'}
                  </UiButton>
                </div>
                {categoryError && (
                  <p className="mt-1.5 text-xs font-bold text-nw-bad">
                    {categoryError}
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-nw-text">
              العلامة التجارية
            </label>
            <select aria-label="العلامة التجارية"
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
            <label className="mb-1.5 block text-xs font-bold text-nw-text">
              وصف مختصر
            </label>
            <textarea aria-label="وصف المنتج"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="الحجم أو النكهة أو أي وصف يساعد الفريق على تمييز المنتج"
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="rounded-xl border border-dashed border-nw-border bg-nw-info-bg p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-black text-nw-text">صورة المنتج</p>
                <p className="mt-0.5 text-xs text-nw-muted">
                  JPG أو PNG أو WebP — بحد أقصى 5 ميجابايت
                </p>
              </div>
              <label
                htmlFor="product-image-upload"
                className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-nw-primary px-3 py-2 text-xs font-black text-nw-on-primary transition hover:opacity-95"
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
              <div className="mt-2 flex items-center justify-between rounded-lg bg-nw-surface px-2.5 py-2">
                <span
                  className="min-w-0 truncate text-xs font-bold text-nw-ok"
                  title={selectedImageFile.name}
                >
                  جاهزة للرفع: {selectedImageFile.name}
                </span>
                <UiButton variant="plain"
                  type="button"
                  onClick={() => {
                    setSelectedImageFile(null);
                    setImageError('');
                    setImageFailed(false);
                  }}
                  className="mr-2 flex shrink-0 items-center gap-1 text-xs font-bold text-nw-muted hover:text-nw-bad"
                >
                  <X className="h-3 w-3" />
                  إلغاء
                </UiButton>
              </div>
            )}

            {imageError && (
              <p className="mt-2 text-xs font-bold text-nw-bad">
                {imageError}
              </p>
            )}

            <UiButton variant="plain"
              type="button"
              onClick={() => setShowImageUrlInput((value) => !value)}
              className="mt-2 text-xs font-bold text-nw-muted hover:text-nw-info"
            >
              {showImageUrlInput
                ? 'إخفاء خيار الرابط'
                : 'أو استخدام رابط صورة مباشر'}
            </UiButton>

            {showImageUrlInput && (
              <input aria-label="رابط صورة المنتج"
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
      </Card>

      {!isEditing && (
        <Card padded={false}
          className={`overflow-hidden rounded-2xl border transition-colors ${
            hasFlavors
              ? 'border-nw-border bg-nw-surface'
              : 'border-nw-border bg-nw-surface'
          }`}
        >
          <div className="flex items-center justify-between gap-3 p-3.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  hasFlavors
                    ? 'bg-nw-info-bg text-nw-info'
                    : 'bg-nw-mute-bg text-nw-muted'
                }`}
              >
                <Palette className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h4 className="font-black text-nw-text">
                  هل لهذا المنتج نكهات؟
                </h4>
                <p className="mt-0.5 text-xs leading-4 text-nw-muted">
                  السعر والطرد موحّدان، والمخزون يُتابع لكل نكهة وحدها
                </p>
              </div>
            </div>

            <UiButton variant="plain"
              type="button"
              role="switch"
              aria-checked={hasFlavors}
              onClick={toggleFlavorMode}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1.5 font-black transition ${
                hasFlavors
                  ? 'border-nw-border bg-nw-info-bg text-nw-info'
                  : 'border-nw-border bg-nw-surface-2 text-nw-muted'
              }`}
            >
              <span>{hasFlavors ? 'نعم' : 'لا'}</span>
              <span
                className={`relative h-5 w-9 rounded-full transition ${
                  hasFlavors ? 'bg-nw-info-bg' : 'bg-nw-mute-bg'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-nw-surface shadow transition-all ${
                    hasFlavors ? 'right-0.5' : 'right-[18px]'
                  }`}
                />
              </span>
            </UiButton>
          </div>

          {hasFlavors && (
            <div className="space-y-3 border-t border-nw-border p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <strong className="text-xs text-nw-info">
                    النكهات الحالية عند الإنشاء
                  </strong>
                  <p className="mt-0.5 text-xs text-nw-muted">
                    مثال: جبنة، حار، ملح وخل
                  </p>
                </div>
                <span className="rounded-full bg-nw-info-bg px-2 py-1 text-xs font-black text-nw-info">
                  {flavorDrafts.length} نكهة
                </span>
              </div>

              <div className="space-y-2.5">
                {flavorDrafts.map((draft, index) => (
                  <div
                    key={draft.id}
                    className="rounded-2xl border border-nw-border bg-nw-surface-2 p-3"
                  >
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="flex h-6 min-w-6 items-center justify-center rounded-lg bg-nw-info-bg px-1.5 text-xs font-black text-nw-info">
                        {index + 1}
                      </span>
                      {flavorDrafts.length > 1 && (
                        <UiButton variant="plain"
                          type="button"
                          onClick={() => removeFlavorDraft(draft.id)}
                          aria-label={`حذف النكهة ${index + 1}`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-nw-muted transition hover:bg-nw-bad-bg hover:text-nw-bad"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </UiButton>
                      )}
                    </div>

                    <div className="grid grid-cols-[minmax(0,1fr)_52px] gap-2 max-[390px]:grid-cols-[minmax(0,1fr)_48px]">
                      <div>
                        <label className="mb-1.5 block text-xs font-bold text-nw-muted">
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
                        <label className="mb-1.5 block text-center text-xs font-bold text-nw-muted">
                          صورة
                        </label>
                        <label className="flex h-11 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-nw-border bg-nw-surface text-nw-muted transition hover:border-nw-border hover:text-nw-info">
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

              <UiButton variant="plain"
                type="button"
                disabled={flavorDrafts.length >= 30}
                onClick={() =>
                  setFlavorDrafts((current) => [
                    ...current,
                    createFlavorDraft(),
                  ])
                }
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-nw-border bg-nw-info-bg py-2.5 font-black text-nw-info transition hover:bg-nw-info-bg disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                إضافة نكهة أخرى
              </UiButton>

              <div className="flex items-start gap-2 rounded-xl border border-nw-border bg-nw-ok-bg p-2.5 text-xs leading-5 text-nw-muted">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-nw-ok" />
                عند الحفظ يُنشأ تعريف المنتج ونكهاته معًا برصيد صفر. تدخل
                البضاعة لاحقًا من الاستلام، ولكل نكهة مخزونها وتكلفتها.
              </div>
            </div>
          )}
        </Card>
      )}

      {isEditing &&
        (initialProduct?.isFlavorMaster || currentFlavors.length > 0) && (
          <Card padded={false} className="rounded-2xl border border-nw-border bg-nw-info-bg p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4 shrink-0 text-nw-info" />
                  <h4 className="font-black text-nw-text">
                    النكهات الحالية
                  </h4>
                </div>
                <p className="mt-1 text-xs leading-4 text-nw-muted">
                  كل نكهة SKU مستقل وله مخزون وتكلفة خاصة به.
                </p>
              </div>
              <UiButton variant="plain"
                type="button"
                onClick={() => {
                  if (!initialProduct) return;
                  openModal('view_product', initialProduct);
                }}
                className="shrink-0 rounded-xl bg-nw-primary px-3 py-2 text-xs font-black text-nw-on-primary"
              >
                إدارة النكهات
              </UiButton>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {currentFlavors.map((flavor) => (
                <div
                  key={flavor.id}
                  className="rounded-xl border border-nw-border bg-nw-surface p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="truncate text-xs text-nw-text">
                      {flavor.flavorNameAr || flavor.nameAr}
                    </strong>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-black ${
                        flavor.status === 'hidden'
                          ? 'bg-nw-mute-bg text-nw-text'
                          : 'bg-nw-ok-bg text-nw-ok'
                      }`}
                    >
                      {flavor.status === 'hidden' ? 'متوقفة' : 'نشطة'}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-nw-muted">
                    SKU: {flavor.sku}
                    {flavor.barcode ? ` • ${flavor.barcode}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        )}

      <Card padded={false} className="rounded-2xl border border-nw-border bg-nw-surface p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <Barcode className="h-4 w-4 text-nw-info" />
          <div>
            <h4 className="font-black text-nw-text">التعريف والتتبع</h4>
            <p className="text-xs text-nw-muted">
              SKU داخلي، والباركود اختياري
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-bold text-nw-text">
                SKU *
              </label>
              {!isEditing && (
                <UiButton variant="plain"
                  type="button"
                  onClick={generateSku}
                  className="text-xs font-bold text-nw-info"
                >
                  توليد
                </UiButton>
              )}
            </div>
            <input aria-label="SKU"
              required
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              placeholder="NWS-1001"
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-nw-text">
              الباركود
            </label>
            <div className="flex gap-1.5">
              <input
                value={isFlavorMaster ? '' : barcode}
                onChange={(event) => setBarcode(event.target.value)}
                inputMode="text"
                aria-label="باركود المنتج"
                placeholder={
                  isFlavorMaster ? 'لا يُستخدم للمنتج الأساسي' : 'اختياري'
                }
                disabled={isFlavorMaster}
                className={`${inputClass} min-w-0 font-mono`}
              />
              <UiButton variant="plain"
                type="button"
                onClick={() => setIsBarcodeCameraOpen(true)}
                disabled={isFlavorMaster}
                aria-label="مسح باركود المنتج بالكاميرا"
                title="مسح الباركود بالكاميرا"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-nw-border bg-nw-info-bg text-nw-info transition hover:bg-nw-info-bg disabled:cursor-not-allowed disabled:border-nw-border disabled:bg-nw-surface-2 disabled:text-nw-muted"
              >
                <Camera className="h-4 w-4" />
              </UiButton>
            </div>
            {isFlavorMaster && (
              <p className="mt-1 text-xs leading-4 text-nw-muted">
                المنتج الأساسي للتجميع فقط؛ أضف الباركود لكل نكهة قابلة للبيع.
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card padded={false} className="rounded-2xl border border-nw-border    p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-nw-warn" />
          <div>
            <h4 className="font-black text-nw-text">شراء المورد</h4>
            <p className="text-xs text-nw-muted">
              عرّف الطرد مرة واحدة، والتكلفة تُحسب للحبة
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-nw-muted">
              نوع الطرد
            </label>
            <select aria-label="نوع طرد الشراء"
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
            <label className="mb-1.5 block text-xs font-bold text-nw-muted">
              عدد الحبات في الطرد *
            </label>
            <input aria-label="عدد الباكيتات في طرد الشراء"
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
            <label className="mb-1.5 block text-xs font-bold text-nw-muted">
              سعر شراء الطرد *
            </label>
            <input aria-label="سعر شراء الطرد"
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
            <label className="mb-1.5 block text-xs font-bold text-nw-warn">
              سعر شراء الحبة *
            </label>
            <input aria-label="سعر شراء الباكيت"
              type="number"
              min="0.001"
              step="0.001"
              required
              value={unitPurchasePrice}
              onChange={(event) =>
                changeUnitPurchasePrice(event.target.value)
              }
              className={`${numberInputClass} border-nw-border text-nw-warn focus:border-nw-border`}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-xl border border-nw-border bg-nw-warn-bg px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs font-bold text-nw-muted">
            <ArrowLeftRight className="h-3.5 w-3.5 text-nw-warn" />
            السعران مربوطان تلقائيًا
          </span>
          <strong className="text-xs text-nw-warn">
            {validUnitsPerPackage} حبة × {formatJod(costPerUnit)} ={' '}
            {formatJod(validPackagePrice)} {CURRENCY}
          </strong>
        </div>
      </Card>

      <Card padded={false} className="rounded-2xl border border-nw-border    p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <Tag className="h-4 w-4 text-nw-ok" />
          <div>
            <h4 className="font-black text-nw-text">
              طرد بيع الجملة والربح
            </h4>
            <p className="text-xs text-nw-muted">
              لا يوجد بيع بالحبة؛ السعر المدخل للطرد كاملًا
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-nw-ok">
              نوع طرد البيع
            </label>
            <select aria-label="نوع طرد البيع"
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
            <label className="mb-1.5 block text-xs font-bold text-nw-text">
              الحبات في طرد البيع *
            </label>
            <input aria-label="عدد الباكيتات في طرد البيع"
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
            <label className="mb-1.5 block text-xs font-bold text-nw-ok">
              سعر بيع الطرد *
            </label>
            <input aria-label="سعر بيع الطرد"
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

        <div className="mt-2 flex items-start gap-2 rounded-xl border border-nw-border bg-nw-ok-bg p-2.5 text-xs leading-5 text-nw-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-nw-ok" />
          الزبون يطلب عدد طرود؛ كل {salePackage} يخصم{' '}
          {validUnitsPerSalePackage} {unit} من المخزون.
        </div>

        {salePackageProfit.isLoss && (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-nw-border bg-nw-bad-bg p-2.5 text-xs font-bold text-nw-bad">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            سعر بيع الطرد أقل من تكلفته؛ سيظهر بيع هذا الطرد كخسارة.
          </div>
        )}
      </Card>

      <Card padded={false} className="rounded-2xl border border-nw-border bg-nw-surface p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <Warehouse className="h-4 w-4 text-nw-info" />
          <div>
            <h4 className="font-black text-nw-text">ضبط المخزون</h4>
            <p className="text-xs text-nw-muted">
              الرصيد يتحرك لاحقًا من الاستلام والطلبات تلقائيًا
            </p>
          </div>
        </div>

        {!isEditing && (
          <div className="mb-3">
            <label className="mb-1.5 block text-xs font-bold text-nw-text">
              المستودع الافتراضي للصنف *
            </label>
            <select aria-label="المستودع"
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

        {!isEditing && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-nw-border bg-nw-ok-bg px-3 py-2 text-xs font-bold text-nw-ok">
            <Package className="h-3.5 w-3.5 shrink-0" />
            يُنشأ الصنف برصيد صفر؛ أدخل البضاعة الفعلية من شاشة الاستلام.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-nw-warn">
              تنبيه عند ({salePackage})
            </label>
            <input aria-label="حد الطلب"
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
            <label className="mb-1.5 block text-xs font-bold text-nw-muted">
              سقف المستودع ({salePackage})
            </label>
            <input aria-label="سقف المستودع"
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
            <p className="mt-1 text-xs leading-4 text-nw-muted">
              اختياري: كمية لا تريد تجاوزها عند الشراء، ولا تمنع البيع.
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl border border-nw-border bg-nw-info-bg p-2.5 text-xs leading-5 text-nw-muted">
          <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0 text-nw-info" />
          كل القيم هنا بعدد {salePackage}؛ كل {salePackage} ={' '}
          {validUnitsPerSalePackage} {unit}. النظام يحولها تلقائيًا للحبات
          عند الحفظ والحساب.
        </div>

        {isEditing && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-nw-muted">
              <Boxes className="h-3.5 w-3.5 text-nw-info" />
              الرصيد الحالي لا يُعدل من بطاقة المنتج
            </span>
            <strong className="text-nw-warn">
              {currentStockSalePackages} {salePackage}
              {currentStockLooseUnits > 0
                ? ` + ${currentStockLooseUnits} ${unit}`
                : ''}
            </strong>
          </div>
        )}

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-nw-surface-2 p-2.5 text-xs leading-5 text-nw-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-nw-info" />
          تاريخ الصلاحية ورقم التشغيلة يُسجلان عند استلام شحنة المورد،
          لأن كل شحنة قد تحمل صلاحية مختلفة.
        </div>
      </Card>

      {submitError && (
        <div className="rounded-2xl border border-nw-border bg-nw-bad-bg p-3 text-nw-bad">
          <div className="flex items-center gap-2 font-black text-nw-bad">
            <AlertTriangle className="h-4 w-4" />
            تعذر حفظ المنتج
          </div>
          <p className="mt-1.5 font-bold">{submitError.message}</p>
          {submitError.code && (
            <p className="mt-1 font-mono text-xs text-nw-bad">
              {submitError.code}
            </p>
          )}
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-1 flex gap-2 border-t border-nw-border bg-nw-surface-2 px-1 pt-3 backdrop-blur">
        <UiButton variant="plain"
          type="submit"
          disabled={isSubmitting}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-nw-primary py-3 font-black text-nw-on-primary shadow-lg shadow-none transition active:scale-[0.98] disabled:opacity-50"
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
        </UiButton>
        <UiButton variant="plain"
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="rounded-xl bg-nw-mute-bg px-5 font-bold text-nw-text"
        >
          إلغاء
        </UiButton>
      </div>

      <BarcodeCameraCaptureModal
        isOpen={isBarcodeCameraOpen && !isFlavorMaster}
        onClose={() => setIsBarcodeCameraOpen(false)}
        onCapture={captureBarcode}
        startScanner={startBarcodeScanner}
      />
    </form></FormFields>
  );
};

const ProfitCard: React.FC<{
  label: string;
  profit: number;
  margin: number;
}> = ({ label, profit, margin }) => (
  <div className="rounded-xl border border-nw-border bg-nw-surface-2 p-2.5">
    <span className="text-xs font-bold text-nw-muted">{label}</span>
    <div
      className={`mt-0.5 flex items-end justify-between ${
        profit >= 0 ? 'text-nw-ok' : 'text-nw-bad'
      }`}
    >
      <strong className="text-sm">
        {formatJod(profit)} {CURRENCY}
      </strong>
      <span className="font-mono text-xs">%{margin.toFixed(1)}</span>
    </div>
  </div>
);

const WholesaleMetric: React.FC<{
  label: string;
  value: number;
  tone: 'amber' | 'slate';
}> = ({ label, value, tone }) => (
  <div className="rounded-xl border border-nw-border bg-nw-surface-2 p-2.5">
    <span className="text-xs font-bold text-nw-muted">{label}</span>
    <strong
      className={`mt-1 block text-xs ${
        tone === 'amber' ? 'text-nw-warn' : 'text-nw-text'
      }`}
    >
      {formatJod(value)} {CURRENCY}
    </strong>
  </div>
);

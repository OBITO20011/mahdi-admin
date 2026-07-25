/**
 * ProductFormModal Component
 * Add / Edit Product with Whole Package Purchase & Live Profit Calculations
 */

import React, { useState } from 'react';
import {
  Package,
  Camera,
  Barcode,
  Building2,
  Warehouse as WarehouseIcon,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Tag,
  DollarSign,
  TrendingUp,
  Percent,
  Layers,
  Info,
} from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { Product } from '../../types';
import { CURRENCY } from '../../constants';

interface ProductFormModalProps {
  initialProduct?: Product | null;
  onClose: () => void;
}

const COMMON_PURCHASE_PACKAGES = [
  { name: 'كرتونة', code: 'CTN' },
  { name: 'باكيت', code: 'PKT' },
  { name: 'صندوق', code: 'BOX' },
  { name: 'ربطة', code: 'BND' },
  { name: 'حافظة', code: 'CASE' },
  { name: 'كيس', code: 'BAG' },
  { name: 'قنينة', code: 'BTL' },
  { name: 'علبة', code: 'CAN' },
  { name: 'قطعة', code: 'PCS' },
];

export const ProductFormModal: React.FC<ProductFormModalProps> = ({
  initialProduct,
  onClose,
}) => {
  const { categories, branches, warehouses, addProduct, updateProduct, setToast } = useAppStore();

  const isEditing = Boolean(initialProduct?.id);

  // 1. اسم المنتج والصورة
  const [nameAr, setNameAr] = useState(initialProduct?.nameAr || '');
  const [imageUrl, setImageUrl] = useState(
    initialProduct?.imageUrl ||
      'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&q=80&w=400'
  );

  // 2. القسم والبراند
  const [categoryId, setCategoryId] = useState(
    initialProduct?.categoryId || categories[0]?.id || 'cat-1'
  );

  // 3. الباركود و SKU
  const [barcode, setBarcode] = useState(
    initialProduct?.barcode || `625${Math.floor(1000000000 + Math.random() * 9000000000)}`
  );
  const [sku, setSku] = useState(
    initialProduct?.sku || `NWS-${Math.floor(1000 + Math.random() * 9000)}`
  );

  // 4. بيانات الشراء للجملة (Purchase Information)
  const [purchasePackage, setPurchasePackage] = useState(
    initialProduct?.purchasePackage || 'كرتونة'
  );
  const [unitsPerPackage, setUnitsPerPackage] = useState<number | ''>(
    initialProduct?.unitsPerPackage ?? 24
  );
  const [defaultPurchasePrice, setDefaultPurchasePrice] = useState<number | ''>(
    initialProduct?.defaultPurchasePrice ??
      (initialProduct ? initialProduct.costPrice * (initialProduct.unitsPerPackage || 24) : 7.200)
  );

  // 5. بيانات البيع (Selling Information)
  const [retailPrice, setRetailPrice] = useState<number | ''>(
    initialProduct?.retailPrice ?? 0.450
  );
  const [unit, setUnit] = useState(initialProduct?.unit || 'قطعة');

  // 6. الموقع والمخزون
  const [branchId, setBranchId] = useState(
    initialProduct?.branchId || branches[0]?.id || 'b-amman-main'
  );
  const [warehouseId, setWarehouseId] = useState(
    initialProduct?.warehouseId || warehouses[0]?.id || 'w-main'
  );
  const [warehouseLocation, setWarehouseLocation] = useState(
    initialProduct?.warehouseLocation || ''
  );
  const [onHandQuantity, setOnHandQuantity] = useState<number | ''>(
    initialProduct?.onHandQuantity ?? 10
  );
  const [reorderLevel, setReorderLevel] = useState<number | ''>(
    initialProduct?.reorderLevel ?? 5
  );
  const [expiryDate, setExpiryDate] = useState(initialProduct?.expiryDate || '');

  // UI state
  const [isScanningBarcode, setIsScanningBarcode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  } | null>(null);

  // --- Live Calculations ---
  const validUnitsPerPkg = Math.max(1, Math.floor(Number(unitsPerPackage) || 1));
  const validPkgPrice = Math.max(0, Number(defaultPurchasePrice) || 0);
  const calculatedCostPerPiece = validUnitsPerPkg > 0 ? validPkgPrice / validUnitsPerPkg : 0;

  const validRetailPrice = Math.max(0, Number(retailPrice) || 0);
  const calculatedProfitPerPiece = validRetailPrice - calculatedCostPerPiece;
  const calculatedProfitPercent =
    calculatedCostPerPiece > 0 ? (calculatedProfitPerPiece / calculatedCostPerPiece) * 100 : 0;

  const isLoss = validRetailPrice > 0 && validRetailPrice < calculatedCostPerPiece;

  // Barcode scanner simulation
  const handleSimulateBarcodeScan = () => {
    setIsScanningBarcode(true);
    setTimeout(() => {
      const scanned = `625${Math.floor(1000000000 + Math.random() * 9000000000)}`;
      setBarcode(scanned);
      setIsScanningBarcode(false);
      setToast(`تم مسح الباركود بنجاح: ${scanned}`);
    }, 800);
  };

  // Image upload simulation
  const handleSimulateImageUpload = () => {
    const sampleImages = [
      'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?auto=format&fit=crop&q=80&w=400',
      'https://images.unsplash.com/photo-1549007994-cb92caebd54b?auto=format&fit=crop&q=80&w=400',
      'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&q=80&w=400',
      'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&q=80&w=400',
    ];
    const picked = sampleImages[Math.floor(Math.random() * sampleImages.length)];
    setImageUrl(picked);
    setToast('تم تغيير صورة المنتج بنجاح');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!nameAr.trim()) {
      setToast('يرجى إدخال اسم المنتج باللغة العربية', 'error');
      return;
    }

    if (validUnitsPerPkg < 1) {
      setToast('عدد القطع داخل الطرد يجب أن يكون 1 على الأقل (عدد صحيح)', 'error');
      return;
    }

    if (validPkgPrice < 0) {
      setToast('سعر شراء الطرد لا يمكن أن يكون بالسالب', 'error');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const payload: Partial<Product> = {
        nameAr: nameAr.trim(),
        imageUrl: imageUrl.trim() || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&q=80&w=400',
        categoryId,
        barcode: barcode.trim(),
        sku: sku.trim(),
        
        // Purchase Wholesale Fields
        purchasePackage,
        unitsPerPackage: validUnitsPerPkg,
        defaultPurchasePrice: validPkgPrice,
        costPrice: Number(calculatedCostPerPiece.toFixed(4)),

        // Selling & Profit Fields
        retailPrice: validRetailPrice,
        profitPerPiece: Number(calculatedProfitPerPiece.toFixed(4)),
        profitPercentage: Number(calculatedProfitPercent.toFixed(2)),

        unit,
        branchId,
        warehouseId,
        warehouseLocation: warehouseLocation.trim(),
        onHandQuantity: Math.floor(Number(onHandQuantity) || 0),
        reorderLevel: Math.floor(Number(reorderLevel) || 5),
        expiryDate: expiryDate || undefined,
        status: 'active',
      };

      if (isEditing && initialProduct?.id) {
        updateProduct(initialProduct.id, payload);
        setToast(`تم تحديث بيانات المنتج ${nameAr} بنجاح`);
        onClose();
      } else {
        const res = await addProduct(payload);
        if (res && res.success) {
          onClose();
        } else if (res && !res.success) {
          setSubmitError(
            res.errorDetails || {
              message: res.error || 'فشلت عملية إضافة المنتج',
              code: 'ADD_PRODUCT_FAILED',
            }
          );
        }
      }
    } catch (err: any) {
      console.error('Error submitting product form:', err);
      setSubmitError({
        message: err?.message || 'حدث خطأ غير متوقع أثناء معالجة النموذج.',
        code: 'CLIENT_EXCEPTION',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} dir="rtl" className="space-y-4 text-xs">
      {/* 1. المعلومات العامة (General Information) */}
      <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 border-b border-slate-900 pb-2">
          <Tag className="w-4 h-4 text-blue-400" />
          <span className="font-extrabold text-slate-100 text-xs">المعلومات العامة للمنتج</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-16 h-16 rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center group">
            {imageUrl ? (
              <img src={imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <Package className="w-6 h-6 text-slate-600" />
            )}
            <button
              type="button"
              onClick={handleSimulateImageUpload}
              className="absolute inset-0 bg-slate-950/70 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-blue-400"
              title="تغيير الصورة"
            >
              <Camera className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 space-y-1.5">
            <label className="text-[11px] font-bold text-slate-200 block">
              اسم المنتج *
            </label>
            <input
              type="text"
              required
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              placeholder="مثال: مياه مزمز فاخرة 330مل (عبوة)"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs font-semibold focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-slate-900">
          <div>
            <label className="text-[10px] text-slate-400 block mb-0.5">القسم *</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500 font-semibold"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameAr}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-0.5">رابط الصورة (Image URL)</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-300 text-[11px] focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleSimulateImageUpload}
                className="bg-slate-900 hover:bg-slate-800 text-blue-400 border border-slate-800 px-2.5 py-1.5 rounded-xl text-[10px] font-bold shrink-0 transition"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. الباركود ورمز SKU */}
      <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-2">
        <div className="flex items-center gap-2 border-b border-slate-900 pb-1.5">
          <Barcode className="w-4 h-4 text-emerald-400" />
          <span className="font-extrabold text-slate-100 text-xs">الباركود ورمز التتبع SKU</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-300 block">الباركود الدولي *</label>
            <div className="flex gap-1">
              <input
                type="text"
                required
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="625123456789"
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 text-xs font-mono focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleSimulateBarcodeScan}
                disabled={isScanningBarcode}
                className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded-xl transition shrink-0"
                title="توليد / مسح الباركود"
              >
                <Barcode className={`w-4 h-4 ${isScanningBarcode ? 'animate-pulse' : ''}`} />
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-300 block">رمز الصنف SKU</label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="NWS-1001"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 text-xs font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* 3. بيانات الشراء للجملة (Purchase Information) */}
      <div className="bg-slate-950 p-3.5 rounded-2xl border border-blue-900/40 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-900 pb-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-400" />
            <span className="font-extrabold text-blue-300 text-xs">بيانات الشراء وطرد الجملة (Purchase Info)</span>
          </div>
          <span className="text-[10px] bg-blue-950 text-blue-300 px-2 py-0.5 rounded-full border border-blue-800">
            طرود صحيحة فقط
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {/* Default Purchase Package */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-300 block">وحدة الشراء الافتراضية</label>
            <select
              value={purchasePackage}
              onChange={(e) => setPurchasePackage(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 text-xs font-bold focus:outline-none focus:border-blue-500"
            >
              {COMMON_PURCHASE_PACKAGES.map((pkg) => (
                <option key={pkg.code} value={pkg.name}>
                  {pkg.name} ({pkg.code})
                </option>
              ))}
            </select>
          </div>

          {/* Units Per Package (Integer > 0) */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-amber-400 block">محتوى الطرد (قطع/طرد) *</label>
            <input
              type="number"
              min="1"
              step="1"
              required
              value={unitsPerPackage}
              onChange={(e) =>
                setUnitsPerPackage(e.target.value === '' ? '' : parseInt(e.target.value))
              }
              placeholder="24"
              className="w-full bg-slate-900 border border-amber-500/40 rounded-xl px-2.5 py-2 text-white font-extrabold text-xs text-center focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* Purchase Package Price (JOD) */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-emerald-400 block">سعر شراء الطرد ({CURRENCY}) *</label>
            <input
              type="number"
              min="0"
              step="0.001"
              required
              value={defaultPurchasePrice}
              onChange={(e) =>
                setDefaultPurchasePrice(e.target.value === '' ? '' : parseFloat(e.target.value))
              }
              placeholder="7.200"
              className="w-full bg-slate-900 border border-emerald-500/40 rounded-xl px-2.5 py-2 text-emerald-300 font-extrabold text-xs text-center focus:outline-none focus:border-emerald-400"
            />
          </div>
        </div>

        {/* Read-Only Cost Per Piece Banner */}
        <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
            <Info className="w-4 h-4 text-blue-400 shrink-0" />
            <span>محسوب تلقائيًا: تكلفة القطعة المباشرة</span>
          </div>
          <div className="font-extrabold text-amber-400 text-sm">
            {calculatedCostPerPiece.toFixed(3)} {CURRENCY} <span className="text-[10px] font-normal text-slate-400">/ قطعة</span>
          </div>
        </div>
      </div>

      {/* 4. بيانات البيع والأرباح (Selling Information) */}
      <div className="bg-slate-950 p-3.5 rounded-2xl border border-emerald-900/40 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-900 pb-2">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <span className="font-extrabold text-emerald-300 text-xs">بيانات البيع والأرباح (Selling & Profit)</span>
          </div>
          <span className="text-[10px] bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-800">
            احتساب تلقائي مالي
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {/* Selling Price Per Piece */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-blue-400 block">سعر بيع القطعة ({CURRENCY}) *</label>
            <input
              type="number"
              min="0"
              step="0.001"
              required
              value={retailPrice}
              onChange={(e) =>
                setRetailPrice(e.target.value === '' ? '' : parseFloat(e.target.value))
              }
              placeholder="0.450"
              className="w-full bg-slate-900 border border-blue-500/40 rounded-xl px-2.5 py-2 text-blue-200 font-extrabold text-xs text-center focus:outline-none focus:border-blue-400"
            />
          </div>

          {/* Unit of measure for selling */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-300 block">وحدة البيع الفردية</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 text-xs font-semibold focus:outline-none focus:border-blue-500"
            >
              <option value="قطعة">قطعة (حبة)</option>
              <option value="باكيت">باكيت</option>
              <option value="علبة">علبة</option>
              <option value="قنينة">قنينة</option>
              <option value="كيس">كيس</option>
            </select>
          </div>

          {/* Profit summary card */}
          <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl flex flex-col justify-center text-center">
            <span className="text-[10px] text-slate-400 font-bold">هامش الربح للقطعة</span>
            <div className={`font-extrabold text-xs mt-0.5 ${calculatedProfitPerPiece >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {calculatedProfitPerPiece.toFixed(3)} {CURRENCY}
              <span className="text-[10px] block font-mono">
                ({calculatedProfitPercent.toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>

        {/* Warning if retail price < cost price */}
        {isLoss && (
          <div className="bg-red-950/80 border border-red-800 p-2.5 rounded-xl flex items-center gap-2 text-red-200 text-[11px] animate-fadeIn">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>
              <strong>تنبيه هام:</strong> سعر بيع القطعة ({validRetailPrice.toFixed(3)} {CURRENCY}) أقل من تكلفة القطعة ({calculatedCostPerPiece.toFixed(3)} {CURRENCY})! هذا يتسبب في خسارة المبيعات.
            </span>
          </div>
        )}
      </div>

      {/* 5. المخزون والمستودع (Inventory) */}
      <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 border-b border-slate-900 pb-1.5">
          <WarehouseIcon className="w-4 h-4 text-indigo-400" />
          <span className="font-extrabold text-slate-100 text-xs">المخزون والمستودع المستلم</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-300 block">الفرع *</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 text-xs font-semibold"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-300 block">المستودع الرئيسي *</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 text-xs font-semibold"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-300 block">موقع الرف</label>
            <input
              type="text"
              value={warehouseLocation}
              onChange={(e) => setWarehouseLocation(e.target.value)}
              placeholder="مثال: رف A-12"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-300 block">
              {isEditing ? 'المخزون الحالي' : 'الكمية الافتتاحية (قطعة)'}
            </label>
            {isEditing ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-400 font-extrabold text-xs">
                {initialProduct?.onHandQuantity} {unit}
              </div>
            ) : (
              <input
                type="number"
                min="0"
                step="1"
                required
                value={onHandQuantity}
                onChange={(e) =>
                  setOnHandQuantity(e.target.value === '' ? '' : parseInt(e.target.value))
                }
                placeholder="0"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 font-extrabold text-xs"
              />
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-300 block">حد إشعار المخزون *</label>
            <input
              type="number"
              min="0"
              step="1"
              required
              value={reorderLevel}
              onChange={(e) =>
                setReorderLevel(e.target.value === '' ? '' : parseInt(e.target.value))
              }
              placeholder="5"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-amber-400 font-bold text-xs"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-300 block flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span>تاريخ الصلاحية <span className="text-slate-500 font-normal">(اختياري)</span></span>
          </label>
          <input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 text-xs"
          />
        </div>
      </div>

      {/* Error Banner */}
      {submitError && (
        <div className="bg-red-500/10 border border-red-500/30 p-3.5 rounded-2xl text-red-200 text-xs space-y-2 animate-fadeIn">
          <div className="flex items-center gap-2 text-red-400 font-bold">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
            <span>فشلت عملية حفظ المنتج</span>
          </div>
          <div className="bg-slate-950/80 p-2.5 rounded-xl font-mono text-[11px] space-y-1 text-red-300">
            <div>
              <span className="text-slate-400 font-sans">رمز الخطأ: </span>
              <strong className="text-amber-300">{submitError.code || 'N/A'}</strong>
            </div>
            <div>
              <span className="text-slate-400 font-sans">الرسالة: </span>
              <p className="text-red-200 font-bold mt-0.5">{submitError.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2 border-t border-slate-800">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl text-xs transition active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-blue-600/20 disabled:opacity-50"
        >
          <CheckCircle2 className={`w-4 h-4 ${isSubmitting ? 'animate-spin' : ''}`} />
          <span>
            {isSubmitting
              ? 'جاري حفظ بيانات المنتج...'
              : isEditing
              ? 'تحديث بيانات المنتج'
              : 'حفظ المنتج الجديد'}
          </span>
        </button>

        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 rounded-xl text-xs transition disabled:opacity-50"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
};

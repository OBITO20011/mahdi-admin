/**
 * Nawasrah Business Manager - Simplified Product Form Modal
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Product } from '../../types';
import {
  Camera,
  Barcode,
  Package,
  Calendar,
  Building2,
  Warehouse as WarehouseIcon,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Tag,
  Layers,
  Sparkles,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

interface ProductFormModalProps {
  initialProduct?: Product;
  onClose: () => void;
}

export const ProductFormModal: React.FC<ProductFormModalProps> = ({
  initialProduct,
  onClose,
}) => {
  const { categories, branches, warehouses, addProduct, updateProduct, setToast } = useAppStore();

  const isEditing = Boolean(initialProduct?.id);

  // 1. اسم المنتج
  const [nameAr, setNameAr] = useState(initialProduct?.nameAr || '');

  // 2. صورة المنتج
  const [imageUrl, setImageUrl] = useState(
    initialProduct?.imageUrl ||
      'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&q=80&w=400'
  );

  // 3. القسم
  const [categoryId, setCategoryId] = useState(
    initialProduct?.categoryId || categories[0]?.id || 'cat-1'
  );

  // 4. الباركود
  const [barcode, setBarcode] = useState(
    initialProduct?.barcode || `625${Math.floor(1000000000 + Math.random() * 9000000000)}`
  );

  // 5. سعر التكلفة
  const [costPrice, setCostPrice] = useState<number | ''>(
    initialProduct?.costPrice ?? 1.5
  );

  // 6. سعر البيع
  const [retailPrice, setRetailPrice] = useState<number | ''>(
    initialProduct?.retailPrice ?? 2.5
  );

  // 7. الوحدة
  const [unit, setUnit] = useState(initialProduct?.unit || 'قطعة');

  // 8. اختيار الفرع
  const [branchId, setBranchId] = useState(
    initialProduct?.branchId || branches[0]?.id || 'b-amman-main'
  );

  // 9. اختيار المستودع
  const [warehouseId, setWarehouseId] = useState(
    initialProduct?.warehouseId || warehouses[0]?.id || 'w-main'
  );

  // 10. موقع الرف (اختياري)
  const [warehouseLocation, setWarehouseLocation] = useState(
    initialProduct?.warehouseLocation || ''
  );

  // 11. الكمية الافتتاحية
  const [onHandQuantity, setOnHandQuantity] = useState<number | ''>(
    initialProduct?.onHandQuantity ?? 10
  );

  // 12. حد تنبيه المخزون
  const [reorderLevel, setReorderLevel] = useState<number | ''>(
    initialProduct?.reorderLevel ?? 5
  );

  // 13. تاريخ الصلاحية (اختياري)
  const [expiryDate, setExpiryDate] = useState(initialProduct?.expiryDate || '');

  const [isScanningBarcode, setIsScanningBarcode] = useState(false);

  // Camera Barcode Scanner Simulation
  const handleSimulateBarcodeScan = () => {
    setIsScanningBarcode(true);
    setTimeout(() => {
      const scanned = `625${Math.floor(1000000000 + Math.random() * 9000000000)}`;
      setBarcode(scanned);
      setIsScanningBarcode(false);
      setToast(`تم مسح الباركود بنجاح: ${scanned}`);
    }, 800);
  };

  // Image Upload Simulation
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!nameAr.trim()) {
      setToast('يرجى إدخال اسم المنتج باللغة العربية', 'error');
      return;
    }

    const payload: Partial<Product> = {
      nameAr: nameAr.trim(),
      imageUrl: imageUrl.trim() || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&q=80&w=400',
      categoryId,
      barcode: barcode.trim(),
      costPrice: Number(costPrice) || 0,
      retailPrice: Number(retailPrice) || 0,
      unit,
      branchId,
      warehouseId,
      warehouseLocation: warehouseLocation.trim(),
      onHandQuantity: Number(onHandQuantity) || 0,
      reorderLevel: Number(reorderLevel) || 5,
      expiryDate: expiryDate || undefined,
      status: 'active',
    };

    if (isEditing && initialProduct?.id) {
      updateProduct(initialProduct.id, payload);
    } else {
      addProduct(payload);
    }

    onClose();
  };

  const numCost = Number(costPrice) || 0;
  const numRetail = Number(retailPrice) || 0;
  const isLoss = numRetail > 0 && numRetail < numCost;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      {/* 1. اسم المنتج وصورة المنتج */}
      <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-3">
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
              1. اسم المنتج *
            </label>
            <input
              type="text"
              required
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              placeholder="أدخل اسم المنتج (مثال: مياه مزمز فاخرة 330مل)"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs font-semibold focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* 2. رابط أو التقاط صورة المنتج */}
        <div className="flex gap-2 items-center pt-1 border-t border-slate-900">
          <div className="flex-1">
            <label className="text-[10px] text-slate-400 block mb-0.5">2. صورة المنتج (رابط Image URL)</label>
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-300 text-[11px] focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={handleSimulateImageUpload}
            className="mt-4 bg-slate-900 hover:bg-slate-800 text-blue-400 border border-slate-800 px-3 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1 shrink-0 transition"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>كاميرا / استوديو</span>
          </button>
        </div>
      </div>

      {/* Grid: 3. القسم & 4. الباركود */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block">3. القسم *</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500 font-semibold"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameAr}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block">4. الباركود *</label>
          <div className="flex gap-1">
            <input
              type="text"
              required
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="625123456789"
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 text-xs font-mono focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={handleSimulateBarcodeScan}
              disabled={isScanningBarcode}
              className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-xl transition shrink-0"
              title="توليد / مسح الكاميرا"
            >
              <Barcode className={`w-4 h-4 ${isScanningBarcode ? 'animate-pulse' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Grid: 5. سعر التكلفة & 6. سعر البيع & 7. الوحدة */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block">
            5. سعر التكلفة ({CURRENCY}) *
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            required
            value={costPrice}
            onChange={(e) =>
              setCostPrice(e.target.value === '' ? '' : parseFloat(e.target.value))
            }
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-amber-400 font-extrabold text-xs focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block">
            6. سعر البيع ({CURRENCY}) *
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            required
            value={retailPrice}
            onChange={(e) =>
              setRetailPrice(e.target.value === '' ? '' : parseFloat(e.target.value))
            }
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-emerald-400 font-extrabold text-xs focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block">7. الوحدة *</label>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500 font-semibold"
          >
            <option value="قطعة">قطعة</option>
            <option value="باكيت">باكيت</option>
            <option value="كرتونة">كرتونة</option>
            <option value="كيلوغرام">كيلوغرام</option>
            <option value="طقم">طقم</option>
          </select>
        </div>
      </div>

      {isLoss && (
        <div className="bg-red-950/70 border border-red-800 p-2 rounded-xl flex items-center gap-2 text-red-200 text-[10px]">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span>ملاحظة: سعر البيع أقل من سعر التكلفة!</span>
        </div>
      )}

      {/* Grid: 8. الفرع & 9. المستودع */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 text-blue-400" />
            <span>8. اختيار الفرع *</span>
          </label>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500 font-semibold"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
            <WarehouseIcon className="w-3.5 h-3.5 text-indigo-400" />
            <span>9. اختيار المستودع *</span>
          </label>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500 font-semibold"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid: 10. موقع الرف (اختياري) & 11. الكمية الافتتاحية & 12. حد تنبيه المخزون */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block">
            10. موقع الرف <span className="text-slate-500 font-normal">(اختياري)</span>
          </label>
          <input
            type="text"
            value={warehouseLocation}
            onChange={(e) => setWarehouseLocation(e.target.value)}
            placeholder="مثال: رف A-12"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block">
            11. {isEditing ? 'المخزون الحالي (محمى)' : 'الكمية الافتتاحية *'}
          </label>
          {isEditing ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-slate-400 font-extrabold text-xs flex items-center justify-between">
              <span>{initialProduct?.onHandQuantity} {initialProduct?.unit}</span>
              <span className="text-[9px] text-amber-400 font-normal">تعديل عبر حركة مخزون</span>
            </div>
          ) : (
            <input
              type="number"
              min="0"
              required
              value={onHandQuantity}
              onChange={(e) =>
                setOnHandQuantity(e.target.value === '' ? '' : parseInt(e.target.value))
              }
              placeholder="0"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-extrabold text-xs focus:outline-none focus:border-blue-500"
            />
          )}
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-200 block">
            12. حد تنبيه المخزون *
          </label>
          <input
            type="number"
            min="0"
            required
            value={reorderLevel}
            onChange={(e) =>
              setReorderLevel(e.target.value === '' ? '' : parseInt(e.target.value))
            }
            placeholder="5"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-amber-400 font-bold text-xs focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* 13. تاريخ الصلاحية (اختياري) */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5 text-amber-400" />
          <span>13. تاريخ الصلاحية <span className="text-slate-500 font-normal">(اختياري)</span></span>
        </label>
        <input
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-slate-800">
        <button
          type="submit"
          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl text-xs transition active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-blue-600/20"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>{isEditing ? 'حفظ التعديلات' : 'حفظ المنتج'}</span>
        </button>

        <button
          type="button"
          onClick={onClose}
          className="px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 rounded-xl text-xs transition"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
};

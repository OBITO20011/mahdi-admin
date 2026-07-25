/**
 * Nawasrah Business Manager - Complete Product Details Modal
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Product } from '../../types';
import { formatProductInventory } from '../../utils/inventoryFormatter';
import {
  Package,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  Plus,
  Minus,
  History,
  Tag,
  AlertTriangle,
  Calendar,
  Layers,
  MapPin,
  Building,
  Scale,
  Check,
  X,
  FileText,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

interface ProductDetailModalProps {
  product: Product;
  onClose: () => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({ product, onClose }) => {
  const {
    categories,
    brands,
    suppliers,
    deleteProduct,
    hideProduct,
    duplicateProduct,
    openModal,
    setToast,
  } = useAppStore();

  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMovements, setShowMovements] = useState(false);

  const category = categories.find((c) => c.id === product.categoryId);
  const brand = brands.find((b) => b.id === product.brandId);
  const supplier = suppliers.find((s) => s.id === product.supplierId);

  const allImages = [product.imageUrl, ...(product.additionalImages || [])].filter(Boolean);

  const profitMargin = product.costPrice > 0
    ? (((product.retailPrice - product.costPrice) / product.costPrice) * 100).toFixed(1)
    : '0';

  const isLowStock = product.availableQuantity <= product.reorderLevel;
  const isOutOfStock = product.availableQuantity === 0;

  return (
    <div className="space-y-4 text-xs">
      {/* Top Image Gallery & Badges */}
      <div className="space-y-2">
        <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 h-48">
          <img
            src={allImages[activeImageIndex] || product.imageUrl}
            alt={product.nameAr}
            className="w-full h-full object-cover"
          />
          {product.status === 'hidden' && (
            <div className="absolute top-2 right-2 bg-slate-900/90 border border-slate-700 text-slate-300 font-bold px-2.5 py-1 rounded-full text-[10px] flex items-center gap-1">
              <EyeOff className="w-3 h-3 text-amber-400" />
              <span>مخفي عن الكتالوج</span>
            </div>
          )}
          {product.promoPrice && (
            <div className="absolute top-2 left-2 bg-emerald-600 text-white font-extrabold px-2.5 py-1 rounded-full text-[10px]">
              عرض خاص: {product.promoPrice.toFixed(2)} {CURRENCY}
            </div>
          )}
        </div>

        {/* Thumbnail Selector */}
        {allImages.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {allImages.map((img, idx) => (
              <button
                key={idx}
                onClick={() => setActiveImageIndex(idx)}
                className={`w-12 h-12 rounded-xl border overflow-hidden shrink-0 transition ${
                  activeImageIndex === idx ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-800 opacity-60'
                }`}
              >
                <img src={img} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Product Info Header */}
      <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-1">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-slate-100">{product.nameAr}</h3>
            {product.nameEn && <p className="text-[11px] text-slate-400 font-mono">{product.nameEn}</p>}
          </div>
          <span
            className={`px-2.5 py-1 rounded-full font-bold text-[10px] border ${
              isOutOfStock
                ? 'bg-red-500/20 text-red-400 border-red-500/30'
                : isLowStock
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
            }`}
          >
            {isOutOfStock ? 'نافد بالمخزن 🔴' : isLowStock ? 'مخزون منخفض ⚠️' : 'نشط متوفر 🟢'}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[10px] text-slate-400 pt-1">
          <span>SKU: <strong className="text-slate-200 font-mono">{product.sku}</strong></span>
          <span>•</span>
          <span>الباركود: <strong className="text-slate-200 font-mono">{product.barcode}</strong></span>
        </div>
      </div>

      {/* Key Stock & Price Metrics Bento Box */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 text-center">
          <span className="text-[10px] text-slate-400 block">سعر بيع القطعة</span>
          <span className="text-sm font-black text-blue-400">
            {product.retailPrice.toFixed(3)} {CURRENCY}
          </span>
        </div>
        <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 text-center">
          <span className="text-[10px] text-slate-400 block">تكلفة القطعة</span>
          <span className="text-sm font-bold text-amber-400">
            {product.costPrice.toFixed(3)} {CURRENCY}
          </span>
        </div>
        <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 text-center">
          <span className="text-[10px] text-slate-400 block">الربح (% والـ JOD)</span>
          <span className="text-sm font-extrabold text-emerald-400 block">
            {((product.profitPerPiece ?? (product.retailPrice - product.costPrice))).toFixed(3)} {CURRENCY}
          </span>
          <span className="text-[9px] text-emerald-300 font-mono">
            (%{(product.profitPercentage ?? profitMargin)})
          </span>
        </div>
      </div>

      {/* Wholesale Package Information Breakdown */}
      <div className="bg-slate-900/90 p-3 rounded-2xl border border-blue-900/40 space-y-2">
        <h4 className="font-bold text-blue-300 text-[11px] flex items-center justify-between">
          <span>بيانات الجملة وطرد الشراء</span>
          <span className="text-blue-400 text-[10px] bg-blue-950 px-2 py-0.5 rounded-full border border-blue-800">
            {product.purchasePackage || 'كرتونة'}
          </span>
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[10px]">
          <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
            <span className="text-slate-400 block">وحدة الشراء</span>
            <strong className="text-slate-100 text-xs font-bold">{product.purchasePackage || 'كرتونة'}</strong>
          </div>
          <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
            <span className="text-slate-400 block">قطع الطرد</span>
            <strong className="text-amber-400 text-xs font-bold">{product.unitsPerPackage || 24} قطعة</strong>
          </div>
          <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
            <span className="text-slate-400 block">سعر شراء الطرد</span>
            <strong className="text-emerald-400 text-xs font-bold">
              {(product.defaultPurchasePrice || (product.costPrice * (product.unitsPerPackage || 24))).toFixed(3)} {CURRENCY}
            </strong>
          </div>
          <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
            <span className="text-slate-400 block">تكلفة القطعة</span>
            <strong className="text-slate-200 text-xs font-bold">{product.costPrice.toFixed(3)} {CURRENCY}</strong>
          </div>
        </div>
      </div>

      {/* Quantities Status */}
      <div className="bg-slate-900/90 p-3 rounded-2xl border border-slate-800 space-y-2">
        <h4 className="font-bold text-slate-300 text-[11px] flex items-center justify-between">
          <span>حالة المخزون والمستودع</span>
          <span className="text-slate-500 text-[10px]">الوحدة: {product.unit}</span>
        </h4>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
          {(() => {
            const invOnHand = formatProductInventory(product, false);
            const invAvail = formatProductInventory(product, true);
            return (
              <>
                <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">الفعلي المخزن</span>
                  <strong className="text-amber-300 text-[11px] font-black block">{invOnHand.cartonFormatted}</strong>
                  <span className="text-slate-400 text-[10px] font-bold block">{invOnHand.totalPiecesFormatted}</span>
                </div>
                <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">المحجوز لطلبات</span>
                  <strong className="text-amber-400 text-xs font-black block">{product.reservedQuantity} قطعة</strong>
                </div>
                <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">المتاح للبيع</span>
                  <strong className="text-emerald-400 text-[11px] font-black block">{invAvail.cartonFormatted}</strong>
                  <span className="text-emerald-300/80 text-[10px] font-bold block">{invAvail.totalPiecesFormatted}</span>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Comprehensive Details Tabs/Lists */}
      <div className="bg-slate-900/90 p-3 rounded-2xl border border-slate-800 space-y-2 text-[11px]">
        <div className="grid grid-cols-2 gap-y-2 gap-x-4">
          <div>
            <span className="text-slate-500 block">القسم:</span>
            <span className="text-slate-200 font-bold">{category?.nameAr || 'غير محدد'}</span>
          </div>
          <div>
            <span className="text-slate-500 block">العلامة التجارية:</span>
            <span className="text-slate-200 font-bold">{brand?.nameAr || 'عام'}</span>
          </div>
          <div>
            <span className="text-slate-500 block">المورد الرئيسي:</span>
            <span className="text-slate-200 font-bold">{supplier?.companyName || 'مورد عام'}</span>
          </div>
          <div>
            <span className="text-slate-500 block">موقع الرف والمستودع:</span>
            <span className="text-slate-200 font-bold">{product.warehouseLocation || 'رف A-01'}</span>
          </div>
          <div>
            <span className="text-slate-500 block">تاريخ الإنتهاء / الدفعة:</span>
            <span className="text-amber-400 font-bold">
              {product.expiryDate || 'بدون صلاحية'} ({product.batchNumber || 'دفعة عامة'})
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">بلد المنشأ:</span>
            <span className="text-slate-200 font-bold">{product.countryOfOrigin || 'الأردن'}</span>
          </div>
        </div>

        {product.description && (
          <div className="pt-2 border-t border-slate-800">
            <span className="text-slate-500 block mb-0.5">الوصف:</span>
            <p className="text-slate-300 leading-relaxed bg-slate-950 p-2 rounded-xl border border-slate-800 text-[10px]">
              {product.description}
            </p>
          </div>
        )}
      </div>

      {/* Quick Interactive Operational Action Buttons */}
      <div className="space-y-2 pt-1">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              openModal('adjust_stock', { product, mode: 'add' });
            }}
            className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة كمية للمخزون</span>
          </button>

          <button
            onClick={() => {
              openModal('adjust_stock', { product, mode: 'deduct' });
            }}
            className="bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-400 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition active:scale-95"
          >
            <Minus className="w-4 h-4" />
            <span>خصم / إتلاف كمية</span>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => {
              onClose();
              openModal('edit_product', product);
            }}
            className="bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-xl font-bold flex items-center justify-center gap-1 transition active:scale-95"
          >
            <Edit className="w-3.5 h-3.5" />
            <span>تعديل</span>
          </button>

          <button
            onClick={() => duplicateProduct(product.id)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 py-2 rounded-xl font-bold flex items-center justify-center gap-1 transition active:scale-95"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>تكرار</span>
          </button>

          <button
            onClick={() => hideProduct(product.id)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 py-2 rounded-xl font-bold flex items-center justify-center gap-1 transition active:scale-95"
          >
            {product.status === 'hidden' ? <Eye className="w-3.5 h-3.5 text-emerald-400" /> : <EyeOff className="w-3.5 h-3.5 text-amber-400" />}
            <span>{product.status === 'hidden' ? 'إظهار' : 'إخفاء'}</span>
          </button>
        </div>

        {/* Delete Confirmation Handler */}
        {showDeleteConfirm ? (
          <div className="bg-red-950/80 border border-red-800 p-3 rounded-2xl space-y-2 animate-fadeIn">
            <p className="text-red-200 font-bold text-center text-[11px]">
              ⚠️ هل أنت تأكد تمامًا من حذف المنتج "{product.nameAr}" نهائياً من الكتالوج؟
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  deleteProduct(product.id);
                  onClose();
                }}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded-xl text-xs transition"
              >
                تأكيد الحذف النهائي
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-slate-800 text-slate-300 font-bold py-2 rounded-xl text-xs transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full bg-red-950/40 hover:bg-red-950/60 border border-red-800/60 text-red-400 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>حذف المنتج من الكتالوج</span>
          </button>
        )}
      </div>
    </div>
  );
};

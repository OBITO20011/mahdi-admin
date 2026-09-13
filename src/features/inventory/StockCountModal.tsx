/**
 * Nawasrah Business Manager - Stock Count / Audit Modal
 */

import React, { useEffect, useRef, useState } from 'react';
import { useAppStore, useAppStoreActions } from '../../stores/useAppStore';
import { formatProductInventory } from '../../utils/inventoryFormatter';
import {
  fetchAdminProductById,
  searchAdminProducts,
} from '../../services/supabase/products.service';
import { Product } from '../../types';
import {
  ClipboardCheck,
  Check,
  Package,
  AlertTriangle,
  ChevronLeft,
  Loader2,
  Search,
} from 'lucide-react';

interface StockCountModalProps {
  productId?: string;
  onClose: () => void;
}

export const StockCountModal: React.FC<StockCountModalProps> = ({
  productId: initialProductId,
  onClose,
}) => {
  const { warehouses, executeStockCount, setToast } = useAppStore();
  const { cacheProductPage } = useAppStoreActions();
  const [stockableProducts, setStockableProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [isProductsLoading, setIsProductsLoading] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const selectedProductRef = useRef<Product | null>(null);

  const selectedProduct = stockableProducts.find((p) => p.id === selectedProductId);

  const [actualQty, setActualQty] = useState<number>(selectedProduct?.onHandQuantity || 0);
  const [warehouseId, setWarehouseId] = useState<string>(
    selectedProduct?.warehouseId || warehouses[0]?.id || ''
  );
  const [reason, setReason] = useState<string>('جرد مخزني دوري وتسوية الفروقات');
  const [adjustmentType, setAdjustmentType] = useState<
    'stock_count' | 'damage' | 'expired' | 'manual'
  >('stock_count');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setIsProductsLoading(true);
      Promise.all([
        searchAdminProducts({
          search: productSearch,
          limit: 30,
          purpose: 'stockable',
        }),
        initialProductId
          ? fetchAdminProductById(initialProductId, 'stockable')
          : Promise.resolve(null),
      ])
        .then(([results, initialProduct]) => {
          if (!active) return;
          let merged = initialProduct && !results.some((item) => item.id === initialProduct.id)
            ? [initialProduct, ...results]
            : results;
          const retainedProduct = selectedProductRef.current;
          if (retainedProduct && !merged.some((item) => item.id === retainedProduct.id)) {
            merged = [retainedProduct, ...merged];
          }
          setStockableProducts(merged);
          cacheProductPage(merged);
          setSelectedProductId((current) => {
            if (current) return current;
            const nextProduct = initialProduct || merged[0];
            if (nextProduct) {
              selectedProductRef.current = nextProduct;
              setActualQty(nextProduct.onHandQuantity);
              if (nextProduct.warehouseId) setWarehouseId(nextProduct.warehouseId);
            }
            return nextProduct?.id || '';
          });
        })
        .catch((error) => {
          console.error('Unable to search stock count products:', error);
          if (active) setStockableProducts([]);
        })
        .finally(() => {
          if (active) setIsProductsLoading(false);
        });
    }, productSearch.trim() ? 250 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [cacheProductPage, initialProductId, productSearch]);

  // Handle product change
  const handleProductChange = (id: string) => {
    setSelectedProductId(id);
    const prod = stockableProducts.find((p) => p.id === id);
    if (prod) {
      selectedProductRef.current = prod;
      setActualQty(prod.onHandQuantity);
      if (prod.warehouseId) setWarehouseId(prod.warehouseId);
    }
  };

  const systemQty = selectedProduct?.onHandQuantity || 0;
  const difference = actualQty - systemQty;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProduct) {
      setToast('يرجى اختيار المنتج', 'error');
      return;
    }

    if (actualQty < 0) {
      setToast('يرجى إدخال كمية فعلية لا تقل عن صفر', 'error');
      return;
    }

    if (!reason.trim()) {
      setToast('سبب الجرد أو التسوية مطلوب.', 'error');
      return;
    }

    if (!warehouseId) {
      setToast('يرجى اختيار المستودع.', 'error');
      return;
    }

    setIsSubmitting(true);
    const result = await executeStockCount({
      productId: selectedProduct.id,
      actualQuantity: actualQty,
      warehouseId,
      reason: reason.trim(),
      adjustmentType,
    });
    setIsSubmitting(false);

    if (result?.success) onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      {/* Header Banner */}
      <div className="bg-purple-950/60 border border-purple-800 p-3 rounded-2xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center shrink-0">
          <ClipboardCheck className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-extrabold text-purple-200 text-xs">جرد صنف</h4>
          <p className="text-[10px] text-purple-300 opacity-80">
            أدخل ما على الرف؛ الفرق يُحفظ تلقائيًا كحركة موثقة.
          </p>
        </div>
      </div>

      {/* Product Selection */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block flex items-center gap-1">
          <Package className="w-3.5 h-3.5 text-purple-400" />
          <span>اختر المنتج المراد جرده *</span>
        </label>
        <select
          value={selectedProductId}
          onChange={(e) => handleProductChange(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-100 text-xs font-semibold focus:outline-none focus:border-purple-500"
        >
          {stockableProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nameAr} - (الرمز: {p.sku}) - بالنظام: {formatProductInventory(p).fullFormatted}
            </option>
          ))}
        </select>
      </div>

      {/* Selected Product Card */}
      {selectedProduct && (
        <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src={selectedProduct.imageUrl}
              alt=""
              className="w-10 h-10 rounded-lg object-cover border border-slate-800"
            />
            <div>
              <h5 className="font-bold text-slate-200 text-xs">{selectedProduct.nameAr}</h5>
              <p className="text-[10px] text-slate-400">
                الرمز: <span className="font-mono">{selectedProduct.sku}</span> | الباركود: {selectedProduct.barcode}
              </p>
            </div>
          </div>
          <div className="text-left">
            <span className="text-[10px] text-slate-400 block">الكمية بالنظام</span>
            <strong className="text-purple-300 text-xs font-extrabold block">
              {formatProductInventory(selectedProduct).fullFormatted}
            </strong>
          </div>
        </div>
      )}

      {/* Actual Count Input */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block">
          الجرد الفعلي الحالي على الرف ({selectedProduct?.unit || 'قطعة'}) *
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActualQty((prev) => Math.max(0, prev - 1))}
            className="w-10 h-10 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl font-bold text-slate-200 text-base"
          >
            -
          </button>
          <input
            type="number"
            min="0"
            required
            value={actualQty}
            onChange={(e) => setActualQty(Math.max(0, parseInt(e.target.value) || 0))}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-center text-sm font-extrabold text-purple-300 focus:outline-none focus:border-purple-500"
          />
          <button
            type="button"
            onClick={() => setActualQty((prev) => prev + 1)}
            className="w-10 h-10 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl font-bold text-slate-200 text-base"
          >
            +
          </button>
        </div>
      </div>

      {/* Stock Variance Summary Box */}
      <div className={`p-3 rounded-2xl border flex items-center justify-between text-xs ${
        difference === 0
          ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
          : difference > 0
          ? 'bg-blue-950/40 border-blue-800/80 text-blue-300'
          : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
      }`}>
        <div className="flex items-center gap-2">
          {difference !== 0 && <AlertTriangle className="w-4 h-4 shrink-0" />}
          <div>
            <span className="font-bold block">
              {difference === 0
                ? 'المخزون الفعلي مطابق للمخزون بالنظام تماماً'
                : difference > 0
                ? `فائض في الجرد المخزني (+${difference} ${selectedProduct?.unit})`
                : `عجز / نقص في الجرد المخزني (${difference} ${selectedProduct?.unit})`}
            </span>
            <span className="text-[10px] opacity-80">
              سيتم إنشاء حركة Stock Count لتسوية الفروقات وتسجيلها باسم المستخدم الحالي
            </span>
          </div>
        </div>
        <strong className="text-sm font-black dir-ltr">
          {difference > 0 ? `+${difference}` : difference}
        </strong>
      </div>

      <details className="group rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
        <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-bold text-slate-400 marker:hidden">
          تفاصيل التسوية (المستودع والسبب)
          <ChevronLeft className="h-3.5 w-3.5 transition group-open:-rotate-90" />
        </summary>
        <div className="mt-3 space-y-3">
      {/* Warehouse Selector */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block">المستودع الذي تم فيه الجرد:</label>
        <select
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none"
        >
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      {/* Reason / Notes */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block">
          نوع التسوية:
        </label>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="ابحث بالاسم أو SKU أو الباركود"
            className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-3 pr-9 text-xs text-slate-100 outline-none focus:border-purple-500"
          />
        </div>
        <select
          value={adjustmentType}
          onChange={(event) =>
            setAdjustmentType(
              event.target.value as
                | 'stock_count'
                | 'damage'
                | 'expired'
                | 'manual'
            )
          }
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-purple-500"
        >
          {isProductsLoading && <option value="">جارٍ تحميل المنتجات…</option>}
          <option value="stock_count">جرد فعلي</option>
          <option value="damage">بضاعة تالفة</option>
          <option value="expired">بضاعة منتهية الصلاحية</option>
          <option value="manual">تصحيح يدوي</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-200 block">سبب التعديل والتسوية:</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="مثال: جرد نهاية الشهر، تسوية عجز رفي..."
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-purple-500"
        />
      </div>
        </div>
      </details>

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-slate-800">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-xs transition active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-purple-600/20"
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>{isSubmitting ? 'جاري الحفظ...' : 'اعتماد وتسوية الجرد'}</span>
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

/**
 * Nawasrah Business Manager - Warehouse Transfer Modal
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
  ArrowLeftRight,
  Check,
  LoaderCircle,
  Package,
  Search,
  Warehouse as WarehouseIcon,
} from 'lucide-react';

interface WarehouseTransferModalProps {
  productId?: string;
  onClose: () => void;
}

export const WarehouseTransferModal: React.FC<WarehouseTransferModalProps> = ({
  productId: initialProductId,
  onClose,
}) => {
  const { warehouses, transferWarehouse, setToast } = useAppStore();
  const { cacheProductPage } = useAppStoreActions();
  const [stockableProducts, setStockableProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [isProductsLoading, setIsProductsLoading] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const selectedProductRef = useRef<Product | null>(null);
  const [transferQty, setTransferQty] = useState<number>(5);
  const [fromWarehouseId, setFromWarehouseId] = useState<string>(warehouses[0]?.id || 'w-main');
  const [toWarehouseId, setToWarehouseId] = useState<string>(
    warehouses[1]?.id || warehouses[0]?.id || 'w-main'
  );
  const [reason, setReason] = useState<string>('نقل مخزون لتلبية احتياج الفرع');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedProduct = stockableProducts.find((p) => p.id === selectedProductId);

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
            selectedProductRef.current = nextProduct || null;
            return nextProduct?.id || '';
          });
        })
        .catch((error) => {
          console.error('Unable to search transfer products:', error);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProduct) {
      setToast('يرجى اختيار المنتج', 'error');
      return;
    }

    if (fromWarehouseId === toWarehouseId) {
      setToast('يرجى اختيار مستودعين مختلفين للنقل بينهما', 'error');
      return;
    }

    if (transferQty <= 0) {
      setToast('يرجى إدخال كمية أكبر من صفر', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await transferWarehouse({
        productId: selectedProduct.id,
        quantity: transferQty,
        fromWarehouseId,
        toWarehouseId,
        reason,
      });

      if (result?.success) {
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} aria-busy={isSubmitting} className="space-y-4 text-xs">
      {/* Header Banner */}
      <div className="bg-nw-info-bg border border-nw-info p-3 rounded-2xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-nw-info-bg text-nw-info flex items-center justify-center shrink-0">
          <ArrowLeftRight className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-extrabold text-nw-info text-xs">نقل كميات بين المستودعات والفروع</h4>
          <p className="text-[10px] text-nw-info opacity-80">
            تأكيد حركة تحويل خروج من المستودع المصدر ودخول للمستودع المستهدف مع توثيق الحركة
          </p>
        </div>
      </div>

      {/* Select Product */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-nw-text block flex items-center gap-1">
          <Package className="w-3.5 h-3.5 text-nw-info" />
          <span>اختر المنتج المراد تحويله *</span>
        </label>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-nw-muted" />
          <input
            type="search"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="ابحث بالاسم أو رمز الصنف أو الباركود"
            className="w-full rounded-xl border border-nw-border bg-nw-bg py-2.5 pl-3 pr-9 text-xs text-nw-text outline-none focus:border-nw-info"
          />
        </div>
        <select
          value={selectedProductId}
          onChange={(e) => {
            setSelectedProductId(e.target.value);
            selectedProductRef.current =
              stockableProducts.find((product) => product.id === e.target.value) || null;
          }}
          className="w-full bg-nw-bg border border-nw-border rounded-xl px-3 py-2.5 text-nw-text text-xs font-semibold focus:outline-none focus:border-nw-info"
        >
          {stockableProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nameAr} - (الباركود: {p.barcode}) - المخزون المتوفر: {formatProductInventory(p).fullFormatted}
            </option>
          ))}
        </select>
      </div>

      {/* Selected Product Card */}
      {selectedProduct && (
        <div className="bg-nw-bg p-3 rounded-2xl border border-nw-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src={selectedProduct.imageUrl}
              alt=""
              className="w-10 h-10 rounded-lg object-cover border border-nw-border"
            />
            <div>
              <h5 className="font-bold text-nw-text text-xs">{selectedProduct.nameAr}</h5>
              <p className="text-[10px] text-nw-muted font-mono">رمز الصنف: {selectedProduct.sku}</p>
            </div>
          </div>
          <div className="text-left">
            <span className="text-[10px] text-nw-muted block">المخزون المتوفر</span>
            <strong className="text-nw-ok text-xs font-extrabold block">
              {formatProductInventory(selectedProduct).fullFormatted}
            </strong>
          </div>
        </div>
      )}

      {/* From & To Warehouse Selectors */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-nw-text block flex items-center gap-1">
            <WarehouseIcon className="w-3.5 h-3.5 text-nw-bad" />
            <span>من مستودع (المصدر) *</span>
          </label>
          <select
            value={fromWarehouseId}
            onChange={(e) => setFromWarehouseId(e.target.value)}
            className="w-full bg-nw-bg border border-nw-border rounded-xl px-2.5 py-2 text-nw-text text-xs focus:outline-none focus:border-nw-bad"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-nw-text block flex items-center gap-1">
            <WarehouseIcon className="w-3.5 h-3.5 text-nw-ok" />
            <span>إلى مستودع (الوجهة) *</span>
          </label>
          <select
            value={toWarehouseId}
            onChange={(e) => setToWarehouseId(e.target.value)}
            className="w-full bg-nw-bg border border-nw-border rounded-xl px-2.5 py-2 text-nw-text text-xs focus:outline-none focus:border-nw-ok"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Transfer Quantity */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-nw-text block">
          الكمية المراد نقلها ({selectedProduct?.unit || 'قطعة'}) *
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTransferQty((prev) => Math.max(1, prev - 1))}
            className="w-10 h-10 bg-nw-surface border border-nw-border hover:bg-nw-surface-2 rounded-xl font-bold text-nw-text text-base"
          >
            -
          </button>
          <input
            type="number"
            min="1"
            required
            value={transferQty}
            onChange={(e) => setTransferQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="flex-1 bg-nw-bg border border-nw-border rounded-xl px-3 py-2.5 text-center text-sm font-extrabold text-nw-info focus:outline-none focus:border-nw-info"
          />
          <button
            type="button"
            onClick={() => setTransferQty((prev) => prev + 1)}
            className="w-10 h-10 bg-nw-surface border border-nw-border hover:bg-nw-surface-2 rounded-xl font-bold text-nw-text text-base"
          >
            +
          </button>
        </div>
      </div>

      {/* Reason */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-nw-text block">سبب النقل والتوزيع:</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="مثال: تغطية نقص مخزون الفرع الثاني..."
          className="w-full bg-nw-bg border border-nw-border rounded-xl px-3 py-2 text-nw-text text-xs focus:outline-none focus:border-nw-info"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-nw-border">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 bg-nw-primary hover:bg-nw-primary text-nw-on-primary font-bold py-3 rounded-xl text-xs transition active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-nw-info/20"
        >
          {isProductsLoading && <option value="">جارٍ تحميل المنتجات…</option>}
          {isSubmitting ? (
            <LoaderCircle className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>{isSubmitting ? 'جارٍ تأكيد النقل...' : 'تأكيد نقل المخزون'}</span>
        </button>

        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="px-4 bg-nw-surface-2 hover:bg-nw-track text-nw-text font-bold py-3 rounded-xl text-xs transition"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
};

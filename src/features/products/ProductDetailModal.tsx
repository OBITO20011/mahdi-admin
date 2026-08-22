import React, { useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Edit3,
  Eye,
  EyeOff,
  Image,
  Layers3,
  ReceiptText,
  Tag,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import { useAppStore } from '../../stores/useAppStore';
import { Product } from '../../types';
import { formatProductInventory } from '../../utils/inventoryFormatter';
import { calculateProductProfit } from '../../utils/productCalculations';

interface ProductDetailModalProps {
  product: Product;
  onClose: () => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  onClose,
}) => {
  const { categories, hideProduct, openModal } = useAppStore();
  const [imageFailed, setImageFailed] = useState(false);
  const [showVisibilityConfirm, setShowVisibilityConfirm] = useState(false);
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);

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
  const inventoryOnHand = formatProductInventory(product, false);
  const inventoryAvailable = formatProductInventory(product, true);
  const isOutOfStock = product.availableQuantity === 0;
  const isLowStock =
    product.availableQuantity > 0 &&
    product.availableQuantity <= product.reorderLevel;

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
            value={`${product.reservedQuantity} ${product.unit}`}
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

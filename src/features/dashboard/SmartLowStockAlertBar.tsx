/**
 * Nawasrah Business Manager - Executive Dashboard Smart Low-Stock Alert Bar
 * Intelligent, real-time alert banner for low stock & out-of-stock products
 */

import React, { useState } from 'react';
import { DashboardLowStockAlert } from '../../types/dashboard';
import { formatWholesaleInventory } from '../../utils/inventoryFormatter';
import {
  AlertTriangle,
  PackageX,
  PackagePlus,
  ChevronDown,
  ChevronUp,
  Boxes,
  ArrowLeft,
  X,
  Sparkles,
  Zap,
} from 'lucide-react';

interface SmartLowStockAlertBarProps {
  alerts: DashboardLowStockAlert[];
  onReceiveGoods?: (productId?: string) => void;
  onNavigateToProducts?: () => void;
}

export const SmartLowStockAlertBar: React.FC<SmartLowStockAlertBarProps> = ({
  alerts,
  onReceiveGoods,
  onNavigateToProducts,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [filter, setFilter] = useState<'all' | 'out_of_stock' | 'low_stock'>('all');
  const [dismissed, setDismissed] = useState<boolean>(false);

  if (dismissed || !alerts || alerts.length === 0) {
    return null;
  }

  const outOfStockItems = alerts.filter((item) => item.isOutOfStock || item.availableQuantity <= 0);
  const lowStockItems = alerts.filter((item) => !item.isOutOfStock && item.availableQuantity > 0);

  const filteredAlerts = alerts.filter((item) => {
    if (filter === 'out_of_stock') return item.isOutOfStock || item.availableQuantity <= 0;
    if (filter === 'low_stock') return !item.isOutOfStock && item.availableQuantity > 0;
    return true;
  });

  return (
    <div
      dir="rtl"
      className="bg-nw-surface-2 from-nw-warn-bg via-nw-border to-nw-bad-bg border border-nw-warn/50 rounded-2xl p-3.5 sm:p-4 shadow-xl relative overflow-hidden transition-all duration-300"
    >
      {/* Background glow effects */}
      <div className="absolute -top-12 -right-12 w-36 h-36 bg-nw-warn-bg rounded-full blur-2xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-36 h-36 bg-nw-bad-bg rounded-full blur-2xl pointer-events-none" />

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
        <div className="flex items-start sm:items-center gap-3">
          <div className="relative shrink-0 mt-0.5 sm:mt-0">
            <div className="w-10 h-10 rounded-xl bg-nw-warn-bg border border-nw-warn/40 text-nw-warn flex items-center justify-center shadow-inner">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            </div>
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-nw-bad-bg rounded-full border-2 border-nw-border animate-ping" />
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-nw-bad-bg rounded-full border-2 border-nw-border" />
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs sm:text-sm font-extrabold text-nw-text flex items-center gap-1.5">
                <span>تنبيه ذكي: نواقص واقتراب نفاذ المخزون</span>
                <Sparkles className="w-3.5 h-3.5 text-nw-warn" />
              </h3>

              {/* Badges Count */}
              <div className="flex items-center gap-1.5">
                {outOfStockItems.length > 0 && (
                  <span className="bg-nw-bad-bg text-nw-bad border border-nw-bad/40 text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <PackageX className="w-3 h-3" />
                    <span>{outOfStockItems.length} نفذت بالكامل</span>
                  </span>
                )}
                {lowStockItems.length > 0 && (
                  <span className="bg-nw-warn-bg text-nw-warn border border-nw-warn/40 text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    <span>{lowStockItems.length} حرجة جداً</span>
                  </span>
                )}
              </div>
            </div>

            <p className="text-[11px] text-nw-warn mt-0.5">
              هناك <strong className="text-nw-warn font-bold">{alerts.length} أصناف</strong> تتطلب إعادة التوريد فوراً لتجنب توقف المبيعات.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <button
            onClick={() => onReceiveGoods?.()}
            className="bg-nw-surface-2 from-nw-warn-bg to-nw-warn-bg hover:from-nw-warn-bg hover:to-nw-warn-bg text-nw-text font-black text-xs px-3.5 py-1.5 rounded-xl shadow-lg transition active:scale-95 flex items-center gap-1.5"
          >
            <PackagePlus className="w-4 h-4" />
            <span>طلب توريد سريع</span>
          </button>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="bg-nw-surface-2 hover:bg-nw-track text-nw-text p-1.5 rounded-xl border border-nw-border transition"
            title={isExpanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setDismissed(true)}
            className="bg-nw-surface-2 hover:bg-nw-track text-nw-muted hover:text-nw-text p-1.5 rounded-xl border border-nw-border transition"
            title="تجاهل المؤقت"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded Details Section */}
      {isExpanded && (
        <div className="mt-3.5 pt-3 border-t border-nw-warn/20 space-y-3 relative z-10">
          {/* Filter Pills & Navigation */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setFilter('all')}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition ${
                  filter === 'all'
                    ? 'bg-nw-warn-bg text-nw-text border-nw-warn font-extrabold'
                    : 'bg-nw-surface text-nw-text border-nw-border hover:border-nw-border'
                }`}
              >
                الكل ({alerts.length})
              </button>
              {outOfStockItems.length > 0 && (
                <button
                  onClick={() => setFilter('out_of_stock')}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition ${
                    filter === 'out_of_stock'
                      ? 'bg-nw-bad-bg text-nw-bad border-nw-bad font-extrabold'
                      : 'bg-nw-surface text-nw-bad border-nw-bad hover:border-nw-bad'
                  }`}
                >
                  نفذت الكمية ({outOfStockItems.length})
                </button>
              )}
              {lowStockItems.length > 0 && (
                <button
                  onClick={() => setFilter('low_stock')}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition ${
                    filter === 'low_stock'
                      ? 'bg-nw-warn-bg text-nw-warn border-nw-warn font-extrabold'
                      : 'bg-nw-surface text-nw-warn border-nw-warn hover:border-nw-warn'
                  }`}
                >
                  وشكت على النفاذ ({lowStockItems.length})
                </button>
              )}
            </div>

            <button
              onClick={onNavigateToProducts}
              className="text-[11px] text-nw-warn hover:text-nw-warn font-bold flex items-center gap-1 transition"
            >
              <span>عرض إدارة المخزون الكاملة</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Cards Carousel / Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 max-h-56 overflow-y-auto pr-0.5 custom-scrollbar">
            {filteredAlerts.map((item) => {
              const isZero = item.availableQuantity <= 0 || item.isOutOfStock;
              return (
                <div
                  key={item.id}
                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-2.5 transition ${
                    isZero
                      ? 'bg-nw-bad-bg border-nw-bad/80 hover:border-nw-bad'
                      : 'bg-nw-bg border-nw-warn/50 hover:border-nw-warn/80'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                        isZero
                          ? 'bg-nw-bad-bg border-nw-bad/40 text-nw-bad'
                          : 'bg-nw-warn-bg border-nw-warn/40 text-nw-warn'
                      }`}
                    >
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.nameAr}
                          className="w-full h-full object-cover rounded-lg"
                        />
                      ) : isZero ? (
                        <PackageX className="w-4 h-4" />
                      ) : (
                        <Boxes className="w-4 h-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <h4 className="text-xs font-extrabold text-nw-text truncate">{item.nameAr}</h4>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-nw-muted mt-0.5">
                        <span>الرمز: {item.sku || 'N/A'}</span>
                        <span>•</span>
                        <span>الحد الأدنى: {item.reorderLevel}</span>
                      </div>
                    </div>
                  </div>

                  {/* Stock Quantity Badge & Quick Action */}
                  <div className="flex flex-col items-end shrink-0 gap-1">
                    <span
                      className={`text-[10px] font-black px-2 py-0.5 rounded-md border text-right ${
                        isZero
                          ? 'bg-nw-bad-bg border-nw-bad/50 text-nw-bad'
                          : 'bg-nw-warn-bg border-nw-warn/50 text-nw-warn'
                      }`}
                    >
                      {isZero ? (
                        'نفذت'
                      ) : (
                        (() => {
                          const inv = formatWholesaleInventory(
                            item.availableQuantity,
                            item.unitsPerPackage || 12,
                            'كرتونة',
                            item.unit || 'قطعة'
                          );
                          return (
                            <span>
                              <span className="block">{inv.cartonFormatted}</span>
                              <span className="block text-[9px] opacity-80">{inv.totalPiecesFormatted}</span>
                            </span>
                          );
                        })()
                      )}
                    </span>

                    <button
                      onClick={() => onReceiveGoods?.(item.id)}
                      className="text-[9px] font-bold text-nw-warn hover:text-nw-warn bg-nw-warn-bg hover:bg-nw-warn-bg border border-nw-warn/80 px-2 py-0.5 rounded-md transition"
                    >
                      + توريد
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

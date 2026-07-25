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
      className="bg-gradient-to-r from-amber-950/90 via-slate-900 to-rose-950/90 border border-amber-600/50 rounded-2xl p-3.5 sm:p-4 shadow-xl relative overflow-hidden transition-all duration-300"
    >
      {/* Background glow effects */}
      <div className="absolute -top-12 -right-12 w-36 h-36 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-36 h-36 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
        <div className="flex items-start sm:items-center gap-3">
          <div className="relative shrink-0 mt-0.5 sm:mt-0">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shadow-inner">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            </div>
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-rose-500 rounded-full border-2 border-slate-900 animate-ping" />
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-rose-500 rounded-full border-2 border-slate-900" />
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs sm:text-sm font-extrabold text-white flex items-center gap-1.5">
                <span>تنبيه ذكي: نواقص واقتراب نفاذ المخزون</span>
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              </h3>

              {/* Badges Count */}
              <div className="flex items-center gap-1.5">
                {outOfStockItems.length > 0 && (
                  <span className="bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <PackageX className="w-3 h-3" />
                    <span>{outOfStockItems.length} نفذت بالكامل</span>
                  </span>
                )}
                {lowStockItems.length > 0 && (
                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    <span>{lowStockItems.length} حرجة جداً</span>
                  </span>
                )}
              </div>
            </div>

            <p className="text-[11px] text-amber-200/80 mt-0.5">
              هناك <strong className="text-amber-300 font-bold">{alerts.length} أصناف</strong> تتطلب إعادة التوريد فوراً لتجنب توقف المبيعات.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <button
            onClick={() => onReceiveGoods?.()}
            className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs px-3.5 py-1.5 rounded-xl shadow-lg transition active:scale-95 flex items-center gap-1.5"
          >
            <PackagePlus className="w-4 h-4" />
            <span>طلب توريد سريع</span>
          </button>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="bg-slate-800/80 hover:bg-slate-700 text-slate-200 p-1.5 rounded-xl border border-slate-700 transition"
            title={isExpanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setDismissed(true)}
            className="bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 p-1.5 rounded-xl border border-slate-700 transition"
            title="تجاهل المؤقت"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded Details Section */}
      {isExpanded && (
        <div className="mt-3.5 pt-3 border-t border-amber-500/20 space-y-3 relative z-10">
          {/* Filter Pills & Navigation */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setFilter('all')}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition ${
                  filter === 'all'
                    ? 'bg-amber-500 text-slate-950 border-amber-400 font-extrabold'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:border-slate-700'
                }`}
              >
                الكل ({alerts.length})
              </button>
              {outOfStockItems.length > 0 && (
                <button
                  onClick={() => setFilter('out_of_stock')}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition ${
                    filter === 'out_of_stock'
                      ? 'bg-rose-600 text-white border-rose-500 font-extrabold'
                      : 'bg-slate-900/80 text-rose-300 border-rose-950 hover:border-rose-800'
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
                      ? 'bg-amber-600 text-white border-amber-500 font-extrabold'
                      : 'bg-slate-900/80 text-amber-300 border-amber-950 hover:border-amber-800'
                  }`}
                >
                  وشكت على النفاذ ({lowStockItems.length})
                </button>
              )}
            </div>

            <button
              onClick={onNavigateToProducts}
              className="text-[11px] text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1 transition"
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
                      ? 'bg-rose-950/40 border-rose-800/80 hover:border-rose-700'
                      : 'bg-slate-950/60 border-amber-800/50 hover:border-amber-600/80'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                        isZero
                          ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                          : 'bg-amber-500/20 border-amber-500/40 text-amber-400'
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
                        <h4 className="text-xs font-extrabold text-white truncate">{item.nameAr}</h4>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
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
                          ? 'bg-rose-600/30 border-rose-500/50 text-rose-300'
                          : 'bg-amber-600/30 border-amber-500/50 text-amber-300'
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
                      className="text-[9px] font-bold text-amber-400 hover:text-amber-300 bg-amber-950/80 hover:bg-amber-900/80 border border-amber-800/80 px-2 py-0.5 rounded-md transition"
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

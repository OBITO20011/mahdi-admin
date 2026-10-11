/**
 * Nawasrah Business Manager - Executive Dashboard Quick Actions
 * Renders 6 direct enterprise quick actions
 */

import React from 'react';
import {
  ShoppingBag,
  PlusCircle,
  Truck,
  UserPlus,
  ListOrdered,
  Package,
} from 'lucide-react';

interface QuickActionsProps {
  onNewOrder: () => void;
  onAddProduct: () => void;
  onReceiveInventory: () => void;
  onAddCustomer: () => void;
  onGoToOrders: () => void;
  onGoToProducts: () => void;
}

export const QuickActions: React.FC<QuickActionsProps> = ({
  onNewOrder,
  onAddProduct,
  onReceiveInventory,
  onAddCustomer,
  onGoToOrders,
  onGoToProducts,
}) => {
  const actions = [
    {
      id: 'new_order',
      label: 'طلب جديد (POS)',
      sub: 'نقطة البيع الكاشير',
      icon: ShoppingBag,
      color: 'from-nw-info-bg to-nw-info-bg hover:from-nw-info-bg hover:to-nw-info-bg text-nw-text',
      borderColor: 'border-nw-info/40',
      onClick: onNewOrder,
    },
    {
      id: 'add_product',
      label: 'إضافة منتج',
      sub: 'إدخال صنف للكتالوج',
      icon: PlusCircle,
      color: 'from-nw-info-bg to-nw-bad-bg hover:from-nw-info-bg hover:to-nw-bad-bg text-nw-text',
      borderColor: 'border-nw-info/40',
      onClick: onAddProduct,
    },
    {
      id: 'receive_inventory',
      label: 'استلام بضاعة',
      sub: 'إذن توريد للمخزن',
      icon: Truck,
      color: 'from-nw-ok-bg to-nw-ok-bg hover:from-nw-ok-bg hover:to-nw-ok-bg text-nw-text',
      borderColor: 'border-nw-ok/40',
      onClick: onReceiveInventory,
    },
    {
      id: 'add_customer',
      label: 'إضافة عميل',
      sub: 'تسجيل زبون جديد',
      icon: UserPlus,
      color: 'from-nw-info-bg to-nw-info-bg hover:from-nw-info-bg hover:to-nw-info-bg text-nw-text',
      borderColor: 'border-nw-info/40',
      onClick: onAddCustomer,
    },
    {
      id: 'go_orders',
      label: 'جدول الطلبات',
      sub: 'إدارة وتتبع الحالات',
      icon: ListOrdered,
      color: 'bg-nw-surface-2 hover:bg-nw-track text-nw-text',
      borderColor: 'border-nw-border',
      onClick: onGoToOrders,
    },
    {
      id: 'go_products',
      label: 'كتالوج المنتجات',
      sub: 'أسعار والكميات والمخزن',
      icon: Package,
      color: 'bg-nw-surface-2 hover:bg-nw-track text-nw-text',
      borderColor: 'border-nw-border',
      onClick: onGoToProducts,
    },
  ];

  return (
    <div className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-lg space-y-3">
      <div className="flex items-center justify-between border-b border-nw-border pb-2.5">
        <h3 className="text-xs font-extrabold text-nw-text flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-nw-primary animate-pulse" />
          <span>إجراءات سريعة (Quick Actions)</span>
        </h3>
        <span className="text-[10px] text-nw-muted">وصول بنقرة واحدة</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {actions.map((act) => {
          const Icon = act.icon;
          return (
            <button
              key={act.id}
              onClick={act.onClick}
              className={`p-3 rounded-xl border ${act.borderColor} ${
                act.color.startsWith('from-') ? `bg-nw-surface-2 ${act.color}` : act.color
              } transition active:scale-95 text-right shadow flex flex-col justify-between group`}
            >
              <div className="flex items-center justify-between mb-2">
                <Icon className="w-5 h-5 group-hover:scale-110 transition-transform" />
              </div>
              <div>
                <h4 className="text-xs font-bold leading-tight">{act.label}</h4>
                <p className="text-[9px] opacity-80 mt-0.5 font-medium">{act.sub}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

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
      color: 'from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white',
      borderColor: 'border-blue-500/40',
      onClick: onNewOrder,
    },
    {
      id: 'add_product',
      label: 'إضافة منتج',
      sub: 'إدخال صنف للكتالوج',
      icon: PlusCircle,
      color: 'from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white',
      borderColor: 'border-purple-500/40',
      onClick: onAddProduct,
    },
    {
      id: 'receive_inventory',
      label: 'استلام بضاعة',
      sub: 'إذن توريد للمخزن',
      icon: Truck,
      color: 'from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white',
      borderColor: 'border-emerald-500/40',
      onClick: onReceiveInventory,
    },
    {
      id: 'add_customer',
      label: 'إضافة عميل',
      sub: 'تسجيل زبون جديد',
      icon: UserPlus,
      color: 'from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white',
      borderColor: 'border-cyan-500/40',
      onClick: onAddCustomer,
    },
    {
      id: 'go_orders',
      label: 'جدول الطلبات',
      sub: 'إدارة وتتبع الحالات',
      icon: ListOrdered,
      color: 'bg-slate-800 hover:bg-slate-700 text-slate-200',
      borderColor: 'border-slate-700',
      onClick: onGoToOrders,
    },
    {
      id: 'go_products',
      label: 'كتالوج المنتجات',
      sub: 'أسعار والكميات والمخزن',
      icon: Package,
      color: 'bg-slate-800 hover:bg-slate-700 text-slate-200',
      borderColor: 'border-slate-700',
      onClick: onGoToProducts,
    },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-lg space-y-3">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <h3 className="text-xs font-extrabold text-slate-100 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span>إجراءات سريعة (Quick Actions)</span>
        </h3>
        <span className="text-[10px] text-slate-400">وصول بنقرة واحدة</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {actions.map((act) => {
          const Icon = act.icon;
          return (
            <button
              key={act.id}
              onClick={act.onClick}
              className={`p-3 rounded-xl border ${act.borderColor} ${
                act.color.startsWith('from-') ? `bg-gradient-to-br ${act.color}` : act.color
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

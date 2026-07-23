/**
 * Nawasrah Business Manager - Speed Quick Action Floating Button & Drawer
 */

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import {
  Plus,
  PlusCircle,
  Receipt,
  Truck,
  DollarSign,
  ArrowDownLeft,
  ArrowUpRight,
  ClipboardList,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const QuickActionButton: React.FC = () => {
  const { isQuickActionOpen, toggleQuickAction, openModal, setActiveTab } = useAppStore();

  const actions = [
    {
      id: 'add-product',
      title: 'إضافة منتج جديد',
      desc: 'إدخال منتج مع الباركود والأسعار',
      icon: PlusCircle,
      color: 'bg-blue-600/20 text-blue-400 border-blue-500/30',
      handler: () => {
        toggleQuickAction(false);
        openModal('add_product');
      },
    },
    {
      id: 'pos-sale',
      title: 'إنشاء فاتورة بيع (POS)',
      desc: 'بيع مباشر سريع مع طباعة الفاتورة',
      icon: Receipt,
      color: 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30',
      handler: () => {
        toggleQuickAction(false);
        openModal('pos_sale');
      },
    },
    {
      id: 'goods-receipt',
      title: 'استلام بضاعة لمخزن',
      desc: 'إضافة كميات مشتريات وتحديث التكلفة',
      icon: Truck,
      color: 'bg-purple-600/20 text-purple-400 border-purple-500/30',
      handler: () => {
        toggleQuickAction(false);
        openModal('receive_goods');
      },
    },
    {
      id: 'add-expense',
      title: 'تسجيل مصروف جديد',
      desc: 'تسجيل إيجار، كهرباء، رواتب وصيانة',
      icon: DollarSign,
      color: 'bg-amber-600/20 text-amber-400 border-amber-500/30',
      handler: () => {
        toggleQuickAction(false);
        openModal('add_expense');
      },
    },
    {
      id: 'customer-payment',
      title: 'تسجيل دفعة عميل (سند قبض)',
      desc: 'تحصيل ديون العميل وتحديث كشف الحساب',
      icon: ArrowDownLeft,
      color: 'bg-teal-600/20 text-teal-400 border-teal-500/30',
      handler: () => {
        toggleQuickAction(false);
        openModal('record_customer_payment');
      },
    },
    {
      id: 'supplier-payment',
      title: 'تسجيل دفعة مورد (سند صرف)',
      desc: 'دفع مستحقات الموردين وتوثيق الدفعات',
      icon: ArrowUpRight,
      color: 'bg-rose-600/20 text-rose-400 border-rose-500/30',
      handler: () => {
        toggleQuickAction(false);
        openModal('record_supplier_payment');
      },
    },
    {
      id: 'inventory-count',
      title: 'تنفيذ جرد وفروقات المخزون',
      desc: 'جرد كلي أو جزئي ومطابقة الفروقات',
      icon: ClipboardList,
      color: 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30',
      handler: () => {
        toggleQuickAction(false);
        setActiveTab('products');
        openModal('stock_count');
      },
    },
  ];

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => toggleQuickAction()}
        className={`fixed bottom-16 left-6 z-40 w-12 h-12 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-[0_10px_25px_-5px_rgba(16,85,201,0.6)] border border-blue-400/40 flex items-center justify-center transition-transform active:scale-90 ${
          isQuickActionOpen ? 'rotate-45 bg-red-600' : ''
        }`}
        aria-label="إجراءات سريعة"
      >
        <Plus className="w-6 h-6 stroke-[2.5]" />
      </button>

      {/* Speed Drawer Modal */}
      <AnimatePresence>
        {isQuickActionOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 backdrop-blur-md p-4">
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl flex flex-col gap-3 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold">
                    +
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">إجراءات عملية سريعة</h3>
                    <p className="text-[11px] text-slate-400">اختر العملية المطلوبة للتنفيذ الفوري</p>
                  </div>
                </div>
                <button
                  onClick={() => toggleQuickAction(false)}
                  className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center hover:bg-slate-700 hover:text-slate-100 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 pt-1">
                {actions.map((act) => {
                  const Icon = act.icon;
                  return (
                    <button
                      key={act.id}
                      onClick={act.handler}
                      className="flex items-center gap-3.5 p-3 rounded-2xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-right transition group active:scale-98"
                    >
                      <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0 ${act.color}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-bold text-slate-100 group-hover:text-blue-400 transition">
                          {act.title}
                        </h4>
                        <p className="text-[11px] text-slate-400 truncate">{act.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

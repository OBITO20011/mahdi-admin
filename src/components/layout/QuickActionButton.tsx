/**
 * Nawasrah Business Manager - Speed Quick Action Floating Button & Drawer
 */

import React from 'react';
import {
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import {
  PlusCircle,
  Plus,
  Receipt,
  Truck,
  DollarSign,
  ChevronLeft,
  Settings2,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const QuickActionButton: React.FC = () => {
  const isQuickActionOpen = useAppStoreSelector(
    (state) => state.isQuickActionOpen
  );
  const { toggleQuickAction, openModal, setActiveTab } = useAppStoreActions();

  const actions = [
    {
      id: 'pos-sale',
      title: 'إنشاء فاتورة بيع (POS)',
      desc: 'بيع مباشر سريع مع طباعة الفاتورة',
      icon: Receipt,
      color: 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30',
      handler: () => {
        toggleQuickAction(false);
        setActiveTab('pos');
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
      id: 'add-product',
      title: 'إضافة صنف',
      desc: 'منتج جديد مع الأسعار والطرد',
      icon: PlusCircle,
      color: 'bg-violet-600/20 text-violet-400 border-violet-500/30',
      handler: () => {
        toggleQuickAction(false);
        openModal('add_product');
      },
    },
  ];

  return (
    <>
      <button
        type="button"
        data-navigation-id="quick-action-trigger"
        onClick={() => toggleQuickAction()}
        aria-label="فتح العمليات السريعة"
        aria-expanded={isQuickActionOpen}
        aria-controls="quick-action-drawer"
        className={`pointer-events-auto absolute right-3 top-1 flex h-12 w-12 items-center justify-center rounded-2xl border text-white shadow-[0_14px_28px_-10px_rgba(37,99,235,0.95)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 active:scale-95 ${
          isQuickActionOpen
            ? 'rotate-45 border-rose-300/50 bg-rose-600'
            : 'border-blue-300/45 bg-gradient-to-br from-blue-500 to-indigo-700 hover:from-blue-400 hover:to-indigo-600'
        }`}
      >
        <Plus className="h-6 w-6 stroke-[2.5]" />
      </button>

      {/* Speed Drawer Modal */}
      <AnimatePresence>
        {isQuickActionOpen && (
          <div
            className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-3 backdrop-blur-md"
            onClick={() => toggleQuickAction(false)}
          >
            <motion.div
              id="quick-action-drawer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="quick-action-drawer-title"
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              onClick={(event) => event.stopPropagation()}
              className="flex w-full max-w-md flex-col gap-3 rounded-3xl border border-slate-800 bg-slate-900 p-4 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold">
                    +
                  </div>
                  <div>
                    <h3
                      id="quick-action-drawer-title"
                      className="text-sm font-black text-slate-100"
                    >
                      عملية جديدة
                    </h3>
                    <p className="text-[10px] text-slate-400">أكثر 4 عمليات استخداماً</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleQuickAction(false)}
                  aria-label="إغلاق العمليات السريعة"
                  className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center hover:bg-slate-700 hover:text-slate-100 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                {actions.map((act) => {
                  const Icon = act.icon;
                  return (
                    <button
                      key={act.id}
                      onClick={act.handler}
                      className="group rounded-2xl border border-slate-700/60 bg-slate-800/60 p-3 text-right transition hover:bg-slate-800 active:scale-[0.98]"
                    >
                      <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${act.color}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="mt-2 min-w-0">
                        <h4 className="text-[11px] font-black text-slate-100 transition group-hover:text-blue-400">
                          {act.title}
                        </h4>
                        <p className="mt-0.5 truncate text-[10px] text-slate-400">{act.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  toggleQuickAction(false);
                  setActiveTab('more');
                }}
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-[10px] font-bold text-slate-300 transition hover:border-slate-700 hover:text-white"
              >
                <span className="flex items-center gap-2"><Settings2 className="h-3.5 w-3.5 text-slate-400" />عمليات وإعدادات أخرى</span>
                <ChevronLeft className="h-4 w-4 text-slate-500" />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

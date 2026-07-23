/**
 * Nawasrah Business Manager - Accounts, Customers & Suppliers View
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Customer, Supplier } from '../../types';
import {
  Users,
  Building,
  Phone,
  MessageSquare,
  FileText,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  Share2,
  DollarSign,
  ChevronLeft,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

export const AccountsView: React.FC = () => {
  const {
    customers,
    suppliers,
    customerPayments,
    supplierPayments,
    invoices,
    openModal,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<'customers' | 'suppliers' | 'statements'>('customers');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-teal-400" />
            <span>إدارة العملاء والموردين والديون</span>
          </h2>
          <p className="text-[11px] text-slate-400">متابعة الذمم المدينة والدائنة وكشوفات الحسابات</p>
        </div>
      </div>

      {/* Main Mode Tabs */}
      <div className="flex items-center bg-slate-900 border border-slate-800 rounded-2xl p-1 text-xs font-bold">
        <button
          onClick={() => setActiveTab('customers')}
          className={`flex-1 py-2 rounded-xl transition ${
            activeTab === 'customers' ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          العملاء والذمم ({customers.length})
        </button>
        <button
          onClick={() => setActiveTab('suppliers')}
          className={`flex-1 py-2 rounded-xl transition ${
            activeTab === 'suppliers' ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          الموردون والمستحقات ({suppliers.length})
        </button>
      </div>

      {/* Customers List View */}
      {activeTab === 'customers' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">قائمة العملاء والديون:</span>
            <button
              onClick={() => openModal('record_customer_payment')}
              className="bg-teal-600/20 text-teal-300 border border-teal-500/30 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-teal-600/30 transition flex items-center gap-1"
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              <span>سند قبض</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {customers.map((cust) => (
              <div
                key={cust.id}
                onClick={() => setSelectedCustomer(cust)}
                className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow transition cursor-pointer hover:border-slate-700 text-xs"
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-slate-100 text-sm">{cust.name}</h4>
                  <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded-full text-slate-400 font-medium">
                    {cust.customerType === 'wholesale' ? 'جملة' : 'تجزئة'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span>هاتف: {cust.phone}</span>
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://wa.me/${cust.whatsapp || '962791234567'}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 hover:underline flex items-center gap-0.5 font-bold"
                    >
                      <MessageSquare className="w-3 h-3" />
                      <span>واتساب</span>
                    </a>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-500 block">حد الائتمان: {cust.creditLimit} د.أ</span>
                    <span className="text-[10px] text-slate-400">فترة السداد: {cust.paymentTermDays} يوم</span>
                  </div>
                  <div className="text-left">
                    <span className="text-[10px] text-slate-400 block">الرصيد القائم:</span>
                    <span className={`font-black text-sm ${cust.currentBalance > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {cust.currentBalance.toFixed(2)} {CURRENCY}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suppliers List View */}
      {activeTab === 'suppliers' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">قائمة الموردين والمستحقات:</span>
            <button
              onClick={() => openModal('record_supplier_payment')}
              className="bg-rose-600/20 text-rose-300 border border-rose-500/30 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-rose-600/30 transition flex items-center gap-1"
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>سند صرف</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {suppliers.map((sup) => (
              <div
                key={sup.id}
                className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow text-xs space-y-2"
              >
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-100 text-sm">{sup.companyName}</h4>
                  <span className="text-[10px] text-slate-400">مسؤول التواصل: {sup.contactPerson}</span>
                </div>

                <div className="text-slate-400 flex items-center justify-between">
                  <span>العنوان: {sup.address}</span>
                  <span>هاتف: {sup.phone}</span>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">الرقم الضريبي: {sup.taxNumber || 'غير مدخل'}</span>
                  <div className="text-left">
                    <span className="text-[10px] text-slate-400 block">مستحق للمورد:</span>
                    <span className="font-black text-sm text-amber-400">
                      {sup.currentBalance.toFixed(2)} {CURRENCY}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Customer Account Statement Drawer Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] font-bold text-teal-400 uppercase">كشف حساب عميل تفصيلي</span>
                <h3 className="text-sm font-bold text-slate-100">{selectedCustomer.name}</h3>
              </div>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Account Balance Summary Card */}
            <div className="bg-gradient-to-r from-teal-950 to-slate-900 p-4 rounded-2xl border border-teal-800/40 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-teal-300 font-bold block">إجمالي الدين الحالي المستحق:</span>
                <span className="text-xl font-black text-red-400">
                  {selectedCustomer.currentBalance.toFixed(2)} {CURRENCY}
                </span>
              </div>
              <button
                onClick={() => {
                  alert(`تم تصدير كشف حساب PDF للعميل ${selectedCustomer.name} بنجاح!`);
                }}
                className="bg-teal-600 hover:bg-teal-500 text-white font-bold px-3.5 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow"
              >
                <FileText className="w-4 h-4" />
                <span>تحميل PDF</span>
              </button>
            </div>

            {/* Transactions Log */}
            <div className="space-y-2 text-xs">
              <h4 className="font-bold text-slate-300">سجل الدفعات والفواتير الأخيرة:</h4>
              {customerPayments
                .filter((p) => p.customerId === selectedCustomer.id)
                .map((pay) => (
                  <div key={pay.id} className="flex items-center justify-between bg-slate-800/60 p-2.5 rounded-xl border border-slate-700/60">
                    <div>
                      <span className="font-bold text-emerald-400 block">سند قبض {pay.voucherNumber}</span>
                      <span className="text-[10px] text-slate-400">طريقة الدفع: {pay.paymentMethod}</span>
                    </div>
                    <span className="font-extrabold text-emerald-400">
                      -{pay.amount.toFixed(2)} {CURRENCY}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

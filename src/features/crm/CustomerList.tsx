import React from 'react';
import {
  ChevronLeft,
  MapPin,
  MessageCircle,
  Phone,
  ShieldAlert,
  ShoppingBag,
  Star,
  Trash2,
  WalletCards,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import { CrmCustomer } from '../../types/crm';

interface CustomerListProps {
  customers: CrmCustomer[];
  onSelectCustomer: (customer: CrmCustomer) => void;
  onBlockToggle: (customer: CrmCustomer) => void;
  onSoftDelete: (customer: CrmCustomer) => void;
}

function jordanWhatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('962')) return digits;
  if (digits.startsWith('0')) return `962${digits.slice(1)}`;
  return `962${digits}`;
}

export const CustomerList: React.FC<CustomerListProps> = ({
  customers,
  onSelectCustomer,
  onBlockToggle,
  onSoftDelete,
}) => (
  <div className="grid grid-cols-1 gap-3">
    {customers.map((customer) => (
      <article
        key={customer.id}
        className={`rounded-2xl border bg-slate-900 p-4 shadow ${
          customer.isBlocked
            ? 'border-rose-800/70'
            : customer.isVip
            ? 'border-amber-500/40'
            : 'border-slate-800'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-1">
              {customer.isBlocked ? (
                <span className="flex items-center gap-1 rounded-full border border-rose-800 bg-rose-950/50 px-2 py-0.5 text-[9px] font-bold text-rose-300">
                  <ShieldAlert className="h-3 w-3" />
                  محظور
                </span>
              ) : customer.isVip ? (
                <span className="flex items-center gap-1 rounded-full border border-amber-700 bg-amber-950/50 px-2 py-0.5 text-[9px] font-bold text-amber-300">
                  <Star className="h-3 w-3" />
                  VIP
                </span>
              ) : (
                <span className="rounded-full border border-emerald-800 bg-emerald-950/40 px-2 py-0.5 text-[9px] font-bold text-emerald-300">
                  نشط
                </span>
              )}
              <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[9px] text-slate-400">
                {customer.customerType === 'wholesale' ? 'جملة' : 'تجزئة'}
              </span>
            </div>
            <h4 className="text-sm font-black text-white">
              {customer.fullName}
            </h4>
            <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
              <MapPin className="h-3 w-3 text-amber-400" />
              {customer.governorate || 'غير محدد'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelectCustomer(customer)}
            className="flex items-center gap-1 rounded-xl bg-indigo-500/10 px-2.5 py-2 font-bold text-indigo-300"
          >
            الملف
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="my-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-950 p-2">
            <ShoppingBag className="mx-auto mb-1 h-3.5 w-3.5 text-blue-400" />
            <b className="block text-slate-200">{customer.totalOrdersCount}</b>
            <span className="text-[8px] text-slate-500">طلبات</span>
          </div>
          <div className="rounded-xl bg-slate-950 p-2">
            <span className="block text-[8px] text-slate-500">مبيعات مكتملة</span>
            <b className="text-emerald-400">
              {customer.totalSpending.toFixed(3)}
            </b>
          </div>
          <div className="rounded-xl bg-slate-950 p-2">
            <WalletCards className="mx-auto mb-1 h-3.5 w-3.5 text-rose-400" />
            <b className={customer.currentBalance > 0 ? 'text-rose-400' : 'text-emerald-400'}>
              {customer.currentBalance.toFixed(3)}
            </b>
            <span className="block text-[8px] text-slate-500">الذمة</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {customer.phone ? (
            <>
              <a
                href={`tel:${customer.phone}`}
                className="flex items-center justify-center gap-1 rounded-xl border border-emerald-800 bg-emerald-950/40 py-2 font-bold text-emerald-300"
              >
                <Phone className="h-3.5 w-3.5" />
                اتصال
              </a>
              <a
                href={`https://wa.me/${jordanWhatsappNumber(
                  customer.whatsapp || customer.phone
                )}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1 rounded-xl border border-green-800 bg-green-950/40 py-2 font-bold text-green-300"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                واتساب
              </a>
            </>
          ) : (
            <div className="col-span-2 rounded-xl bg-slate-950 p-2 text-center text-slate-500">
              لا يوجد رقم هاتف
            </div>
          )}
        </div>

        <div className="mt-2 flex justify-end gap-2 border-t border-slate-800 pt-2">
          <button
            type="button"
            onClick={() => onBlockToggle(customer)}
            className="text-[10px] font-bold text-amber-400"
          >
            {customer.isBlocked ? 'إلغاء الحظر' : 'حظر'}
          </button>
          <button
            type="button"
            onClick={() => onSoftDelete(customer)}
            className="flex items-center gap-1 text-[10px] font-bold text-rose-400"
          >
            <Trash2 className="h-3 w-3" />
            حذف
          </button>
        </div>
      </article>
    ))}
  </div>
);

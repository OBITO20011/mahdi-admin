/**
 * Nawasrah Business Manager - Customer Cards List Component
 * Renders customer cards with status badges, tags, statistics summary, and quick actions.
 */

import React from 'react';
import { CrmCustomer } from '../../types/crm';
import { CURRENCY } from '../../constants';
import {
  Phone,
  MessageSquare,
  MapPin,
  ChevronLeft,
  ShoppingBag,
  Star,
  ShieldAlert,
  UserCheck,
  Building,
  Mail,
  MoreHorizontal,
} from 'lucide-react';

interface CustomerListProps {
  customers: CrmCustomer[];
  onSelectCustomer: (customer: CrmCustomer) => void;
  onBlockToggle: (customer: CrmCustomer) => void;
  onSoftDelete: (customer: CrmCustomer) => void;
}

export const CustomerList: React.FC<CustomerListProps> = ({
  customers,
  onSelectCustomer,
  onBlockToggle,
  onSoftDelete,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {customers.map((cust) => {
        const primaryAddress = cust.addresses && cust.addresses.length > 0 ? cust.addresses[0] : null;
        const mapsUrl =
          primaryAddress?.googleMapsUrl ||
          `https://maps.google.com/?q=${encodeURIComponent(cust.governorate + ' ' + cust.fullName)}`;

        const phoneClean = cust.phone.replace(/[^0-9+]/g, '');
        const whatsappClean = (cust.whatsapp || cust.phone).replace(/[^0-9]/g, '');

        return (
          <div
            key={cust.id}
            className={`bg-slate-900 border p-4 rounded-2xl shadow-lg transition-all flex flex-col justify-between space-y-3 relative group ${
              cust.isBlocked
                ? 'border-rose-900/60 bg-rose-950/20'
                : cust.isVip
                ? 'border-amber-500/40 bg-slate-900'
                : 'border-slate-800 hover:border-slate-700'
            }`}
          >
            {/* Top Card Header */}
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    {/* Status Badge */}
                    {cust.isBlocked ? (
                      <span className="text-[10px] font-black bg-rose-950 text-rose-300 border border-rose-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <ShieldAlert className="w-2.5 h-2.5" />
                        <span>محظور Blocked</span>
                      </span>
                    ) : cust.isVip ? (
                      <span className="text-[10px] font-black bg-amber-950 text-amber-300 border border-amber-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Star className="w-2.5 h-2.5 fill-amber-300" />
                        <span>عميل VIP</span>
                      </span>
                    ) : cust.isActive ? (
                      <span className="text-[10px] font-black bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <UserCheck className="w-2.5 h-2.5" />
                        <span>نشط Active</span>
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full">
                        غير نشط
                      </span>
                    )}

                    {/* Customer Type Tag */}
                    <span className="text-[10px] font-bold bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">
                      {cust.customerType === 'wholesale' ? 'عميل جملة' : 'عميل تجزئة'}
                    </span>

                    {/* Extra Tags */}
                    {cust.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="text-[9px] font-extrabold bg-blue-950 text-blue-300 border border-blue-800 px-2 py-0.5 rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <h3
                    onClick={() => onSelectCustomer(cust)}
                    className="text-sm font-extrabold text-slate-100 hover:text-blue-400 cursor-pointer transition flex items-center gap-1.5"
                  >
                    <span>{cust.fullName}</span>
                  </h3>
                </div>

                {/* View Details Chevron Button */}
                <button
                  onClick={() => onSelectCustomer(cust)}
                  className="p-1.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-blue-600 hover:text-white transition"
                  title="عرض كافة التفاصيل"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>

              {/* Contact Info Row */}
              <div className="space-y-1 text-xs text-slate-400">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-500" />
                    <span className="font-mono">{cust.phone}</span>
                  </span>

                  {cust.email && (
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Mail className="w-3 h-3 text-slate-500" />
                      <span className="font-mono">{cust.email}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <MapPin className="w-3 h-3 text-rose-400 shrink-0" />
                  <span>
                    المحافظة: <strong className="text-slate-200">{cust.governorate}</strong>
                    {primaryAddress?.area ? ` • ${primaryAddress.area}` : ''}
                    {primaryAddress?.street ? ` (${primaryAddress.street})` : ''}
                  </span>
                </div>
              </div>
            </div>

            {/* Metrics & Spending Bar */}
            <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-xl grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 block">عدد الطلبات:</span>
                <span className="font-black text-slate-200 flex items-center gap-1">
                  <ShoppingBag className="w-3 h-3 text-blue-400" />
                  <span>{cust.totalOrdersCount} طلب</span>
                </span>
              </div>

              <div className="text-left">
                <span className="text-[10px] text-slate-500 block">إجمالي الإنفاق:</span>
                <span className="font-black text-emerald-400">
                  {cust.totalSpending.toFixed(2)} {CURRENCY}
                </span>
              </div>
            </div>

            {/* Quick Action Icon Buttons Bar */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-1 text-xs">
              <div className="flex items-center gap-1">
                {/* Call */}
                <a
                  href={`tel:${phoneClean}`}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-emerald-600 text-emerald-400 hover:text-white transition flex items-center gap-1 text-[11px] font-bold"
                  title="اتصال هاتفي"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">اتصال</span>
                </a>

                {/* WhatsApp */}
                <a
                  href={`https://wa.me/${whatsappClean || phoneClean}`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 rounded-xl bg-slate-800 hover:bg-emerald-600 text-emerald-400 hover:text-white transition flex items-center gap-1 text-[11px] font-bold"
                  title="مراسلة عبر واتساب"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">واتساب</span>
                </a>

                {/* Open Maps */}
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 rounded-xl bg-slate-800 hover:bg-rose-600 text-rose-400 hover:text-white transition flex items-center gap-1 text-[11px] font-bold"
                  title="فتح الموقع في خرائط جوجل"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">الخرائط</span>
                </a>
              </div>

              <button
                onClick={() => onSelectCustomer(cust)}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded-xl text-[11px] transition flex items-center gap-1 shadow"
              >
                <span>ملف العميل الكامل</span>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

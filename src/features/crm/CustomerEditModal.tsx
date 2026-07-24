/**
 * Nawasrah Business Manager - Customer Edit Profile Modal
 * Allows updating Full Name, Phone, Email, Governorate, Customer Type, Notes & Status
 */

import React, { useState } from 'react';
import { CrmCustomer } from '../../types/crm';
import { updateCustomerCrmInSupabase } from '../../services/supabase/crm.service';
import { UserCheck, X, Save } from 'lucide-react';

interface CustomerEditModalProps {
  customer: CrmCustomer;
  isOpen: boolean;
  onClose: () => void;
  onCustomerUpdated: () => void;
}

export const CustomerEditModal: React.FC<CustomerEditModalProps> = ({
  customer,
  isOpen,
  onClose,
  onCustomerUpdated,
}) => {
  const [fullName, setFullName] = useState<string>(customer.fullName);
  const [phone, setPhone] = useState<string>(customer.phone);
  const [email, setEmail] = useState<string>(customer.email);
  const [governorate, setGovernorate] = useState<string>(customer.governorate);
  const [customerType, setCustomerType] = useState<'retail' | 'wholesale'>(customer.customerType);
  const [notes, setNotes] = useState<string>(customer.notes);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !phone.trim()) {
      setError('يرجى تعبئة اسم العميل ورقم الهاتف.');
      return;
    }

    setLoading(true);
    setError(null);

    const res = await updateCustomerCrmInSupabase(customer.id, {
      fullName: fullName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      governorate,
      customerType,
      notes: notes.trim(),
    });

    setLoading(false);

    if (res.success) {
      onCustomerUpdated();
      onClose();
    } else {
      setError(res.error || 'تعذر حفظ تعديلات العميل.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-3xl p-5 space-y-4 shadow-2xl relative my-auto text-xs">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
              <UserCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-100 text-sm">تعديل ملف العميل</h3>
              <p className="text-[10px] text-slate-400">{customer.fullName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="bg-rose-950/80 border border-rose-800 p-2.5 rounded-xl text-rose-300 text-[11px]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-slate-300 font-bold block mb-1">الاسم الكامل *</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100 focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-slate-300 font-bold block mb-1">رقم الهاتف *</label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100 font-mono"
              />
            </div>

            <div>
              <label className="text-slate-300 font-bold block mb-1">البريد الإلكتروني</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-slate-300 font-bold block mb-1">المحافظة الرئيسي</label>
              <select
                value={governorate}
                onChange={(e) => setGovernorate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100"
              >
                <option value="عمان">عمان</option>
                <option value="الزرقاء">الزرقاء</option>
                <option value="إربد">إربد</option>
                <option value="العقبة">العقبة</option>
                <option value="السلط">السلط</option>
                <option value="مأدبا">مأدبا</option>
                <option value="الكرك">الكرك</option>
                <option value="جرش">جرش</option>
              </select>
            </div>

            <div>
              <label className="text-slate-300 font-bold block mb-1">تصنيف العميل</label>
              <select
                value={customerType}
                onChange={(e) => setCustomerType(e.target.value as 'retail' | 'wholesale')}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100 font-bold"
              >
                <option value="retail">عميل تجزئة (Retail)</option>
                <option value="wholesale">عميل جملة (Wholesale)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-slate-300 font-bold block mb-1">الملاحظات الداخلية للشركة</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="اكتب أي تفاصيل بخصوص تفضيلات العميل أو شروط التعامل..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100 resize-none"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-slate-800 text-slate-300 px-4 py-2.5 rounded-xl font-bold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-5 py-2.5 rounded-xl transition shadow flex items-center gap-1.5"
            >
              <Save className="w-4 h-4" />
              <span>{loading ? 'جاري الحفظ...' : 'تحديث البيانات'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

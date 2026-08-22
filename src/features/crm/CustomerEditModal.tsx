import React, { useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';
import { updateCustomerCrmInSupabase } from '../../services/supabase/crm.service';
import { CrmCustomer } from '../../types/crm';

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
  const [fullName, setFullName] = useState(customer.fullName);
  const [phone, setPhone] = useState(customer.phone);
  const [whatsapp, setWhatsapp] = useState(customer.whatsapp || '');
  const [email, setEmail] = useState(customer.email);
  const [governorate, setGovernorate] = useState(customer.governorate);
  const [customerType, setCustomerType] = useState<
    'retail' | 'wholesale'
  >(customer.customerType);
  const [notes, setNotes] = useState(customer.notes);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!fullName.trim() || !phone.trim()) {
      setError('اسم العميل ورقم الهاتف مطلوبان.');
      return;
    }
    setLoading(true);
    setError(null);
    const result = await updateCustomerCrmInSupabase(customer.id, {
      fullName: fullName.trim(),
      phone: phone.trim(),
      whatsapp: whatsapp.trim(),
      email: email.trim(),
      governorate: governorate.trim(),
      customerType,
      notes: notes.trim(),
    });
    setLoading(false);
    if (!result.success) {
      setError(result.error || 'تعذر حفظ البيانات.');
      return;
    }
    onCustomerUpdated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/85 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 p-5 sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-black text-white">تعديل ملف العميل</h3>
            <p className="text-[10px] text-slate-500">
              الحفظ يتم عبر إجراء قاعدة البيانات المعتمد
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-800 p-2 text-slate-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3 text-xs">
          {error && (
            <div className="rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-rose-300">
              {error}
            </div>
          )}
          <div>
            <label className="mb-1 block font-bold text-slate-300">
              الاسم الكامل *
            </label>
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
              className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block font-bold text-slate-300">
                الهاتف *
              </label>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-slate-300">
                واتساب
              </label>
              <input
                value={whatsapp}
                onChange={(event) => setWhatsapp(event.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block font-bold text-slate-300">
                البريد الإلكتروني
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-slate-300">
                المحافظة
              </label>
              <input
                value={governorate}
                onChange={(event) => setGovernorate(event.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block font-bold text-slate-300">
              نوع العميل
            </label>
            <select
              value={customerType}
              onChange={(event) =>
                setCustomerType(event.target.value as 'retail' | 'wholesale')
              }
              className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
            >
              <option value="retail">تجزئة</option>
              <option value="wholesale">جملة</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block font-bold text-slate-300">
              ملاحظات داخلية
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full resize-none rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3 font-bold text-white disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {loading ? 'جاري الحفظ...' : 'حفظ التعديلات'}
          </button>
        </form>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import {Modal} from '../../components/common/Modal';
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
    try {
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

      if (!result.success) {
        setError(result.error || 'تعذر حفظ البيانات.');
        return;
      }
      onCustomerUpdated();
      onClose();

    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="تعديل ملف العميل"
      subtitle="الحفظ يتم عبر إجراء قاعدة البيانات المعتمد" maxWidth="max-w-md"
      maxHeight="max-h-[94vh]" closeDisabled={loading} confirmUnsavedClose>
        <form onSubmit={submit} aria-busy={loading} className="space-y-3 text-xs">
          {error && (
            <div className="rounded-xl border border-nw-bad bg-nw-bad-bg p-3 text-nw-bad">
              {error}
            </div>
          )}
          <div>
            <label className="mb-1 block font-bold text-nw-text">
              الاسم الكامل *
            </label>
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
              className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block font-bold text-nw-text">
                الهاتف *
              </label>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
                className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-nw-text">
                واتساب
              </label>
              <input
                value={whatsapp}
                onChange={(event) => setWhatsapp(event.target.value)}
                className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block font-bold text-nw-text">
                البريد الإلكتروني
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-nw-text">
                المحافظة
              </label>
              <input
                value={governorate}
                onChange={(event) => setGovernorate(event.target.value)}
                className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block font-bold text-nw-text">
              نوع العميل
            </label>
            <select
              value={customerType}
              onChange={(event) =>
                setCustomerType(event.target.value as 'retail' | 'wholesale')
              }
              className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
            >
              <option value="retail">تجزئة</option>
              <option value="wholesale">جملة</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block font-bold text-nw-text">
              ملاحظات داخلية
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full resize-none rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-nw-primary py-3 font-bold text-nw-on-primary disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {loading ? 'جاري الحفظ...' : 'حفظ التعديلات'}
          </button>
        </form>
    </Modal>
  );
};

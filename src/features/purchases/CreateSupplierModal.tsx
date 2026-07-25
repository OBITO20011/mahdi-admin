/**
 * Nawasrah Business Manager - Create Supplier Modal Component (إضافة مورد جديد)
 */

import React, { useState, useEffect } from 'react';
import { Supplier } from '../../types';
import { createSupplierInSupabase, updateSupplierInSupabase } from '../../services/supabase/purchases.service';
import { storeEngine } from '../../stores/useAppStore';
import {
  X,
  Building,
  User,
  Phone,
  Mail,
  MapPin,
  FileText,
  CheckCircle2,
  AlertTriangle,
  CreditCard,
  MessageSquare,
} from 'lucide-react';

interface CreateSupplierModalProps {
  isOpen: boolean;
  initialCompanyName?: string;
  supplierToEdit?: Supplier | null;
  onClose: () => void;
  onSuccess: (supplier: Supplier) => void;
}

export const CreateSupplierModal: React.FC<CreateSupplierModalProps> = ({
  isOpen,
  initialCompanyName = '',
  supplierToEdit = null,
  onClose,
  onSuccess,
}) => {
  const [companyName, setCompanyName] = useState<string>('');
  const [contactPerson, setContactPerson] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [whatsapp, setWhatsapp] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [taxNumber, setTaxNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isActive, setIsActive] = useState<boolean>(true);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (supplierToEdit) {
        setCompanyName(supplierToEdit.companyName || '');
        setContactPerson(supplierToEdit.contactPerson || '');
        setPhone(supplierToEdit.phone || '');
        setWhatsapp(supplierToEdit.whatsapp || '');
        setEmail(supplierToEdit.email || '');
        setAddress(supplierToEdit.address || '');
        setTaxNumber(supplierToEdit.taxNumber || '');
        setNotes(supplierToEdit.notes || '');
        setIsActive(supplierToEdit.isActive ?? true);
      } else {
        setCompanyName(initialCompanyName);
        setContactPerson('');
        setPhone('');
        setWhatsapp('');
        setEmail('');
        setAddress('');
        setTaxNumber('');
        setNotes('');
        setIsActive(true);
      }
      setErrorMsg(null);
      setIsSubmitting(false);
    }
  }, [isOpen, initialCompanyName, supplierToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedCompanyName = companyName.trim();
    if (!trimmedCompanyName) {
      setErrorMsg('اسم الشركة/المورد مطلوب.');
      return;
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        setErrorMsg('صيغة البريد الإلكتروني غير صحيحة.');
        return;
      }
    }

    setIsSubmitting(true);

    const inputData = {
      companyName: trimmedCompanyName,
      contactPerson: contactPerson.trim() || undefined,
      phone: phone.trim() || undefined,
      whatsapp: whatsapp.trim() || undefined,
      email: trimmedEmail || undefined,
      address: address.trim() || undefined,
      taxNumber: taxNumber.trim() || undefined,
      notes: notes.trim() || undefined,
      isActive,
    };

    let res;
    if (supplierToEdit) {
      res = await updateSupplierInSupabase(supplierToEdit.id, inputData);
    } else {
      res = await createSupplierInSupabase(inputData);
    }

    setIsSubmitting(false);

    if (res.success && res.data) {
      storeEngine.setToast(
        supplierToEdit ? 'تم تحديث بيانات المورد بنجاح' : 'تمت إضافة المورد بنجاح',
        'success'
      );
      onSuccess(res.data);
      onClose();
    } else {
      setErrorMsg(res.error || 'حدث خطأ أثناء حفظ بيانات المورد');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden my-auto flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="bg-slate-800/80 px-5 py-4 border-b border-slate-700/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-teal-600/20 border border-teal-500/30 flex items-center justify-center text-teal-400 font-bold">
              <Building className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                {supplierToEdit ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
              </h2>
              <p className="text-xs text-slate-400">
                {supplierToEdit
                  ? 'تحديث بيانات وسجل معلومات المورد'
                  : 'إدخال بيانات المورد لإتاحته في أوامر الشراء'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-700/60 text-slate-300 hover:text-white flex items-center justify-center transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {errorMsg && (
            <div className="bg-rose-950/50 border border-rose-500/30 p-3 rounded-2xl text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Company Name (Required) */}
          <div className="space-y-1">
            <label className="font-bold text-slate-300 flex items-center gap-1">
              <Building className="w-3.5 h-3.5 text-teal-400" />
              اسم الشركة / المورد: <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              placeholder="مثال: شركة النوارس التجارية"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-bold focus:outline-none focus:border-teal-500"
            />
          </div>

          {/* Contact Person & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-slate-300 flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-blue-400" />
                الشخص المسؤول:
              </label>
              <input
                type="text"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                placeholder="مثال: أحمد النواصرة"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-teal-500"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-300 flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-emerald-400" />
                رقم الهاتف:
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0791234567"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-teal-500 font-mono"
              />
            </div>
          </div>

          {/* WhatsApp & Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-slate-300 flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                رقم الواتساب:
              </label>
              <input
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="0791234567"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-teal-500 font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-300 flex items-center gap-1">
                <Mail className="w-3.5 h-3.5 text-indigo-400" />
                البريد الإلكتروني:
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="supplier@example.com"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-teal-500 font-mono"
              />
            </div>
          </div>

          {/* Address & Tax Number */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-slate-300 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
                العنوان:
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="عمان - المقابلين"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-teal-500"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-300 flex items-center gap-1">
                <CreditCard className="w-3.5 h-3.5 text-purple-400" />
                الرقم الضريبي:
              </label>
              <input
                type="text"
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.target.value)}
                placeholder="123456789"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-teal-500 font-mono"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="font-bold text-slate-300 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              ملاحظات المورد:
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="شروط التوريد، مواعيد التسليم، خصومات إضافية..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-teal-500 resize-none"
            />
          </div>

          {/* Status Active Toggle */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="supplierIsActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 bg-slate-800 border-slate-700 cursor-pointer"
            />
            <label htmlFor="supplierIsActive" className="text-slate-300 font-bold cursor-pointer">
              مورد نشط (متاح للاختيار في طلبات الشراء)
            </label>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold transition disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !companyName.trim()}
              className="px-6 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold transition shadow-lg disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? (
                <span>جاري حفظ المورد...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>حفظ المورد واختياره</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

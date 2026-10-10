import {FormFields, Card, UiButton} from '../../components/ui';
/**
 * Nawasrah Business Manager - Create Supplier Modal Component (إضافة مورد جديد)
 */

import React, { useState, useEffect } from 'react';
import {useDialogFocus} from '../../hooks/useDialogFocus';
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
  const panel = useDialogFocus(isOpen, () => { if (!isSubmitting) onClose(); }, true);

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
    try {

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

    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormFields ref={panel as React.RefObject<HTMLDivElement>} tabIndex={-1} role="dialog" aria-modal="true" aria-label="بيانات المورد" aria-busy={isSubmitting} className="nw-purchasing-fields fixed inset-0 z-[60] flex items-center justify-center bg-nw-overlay backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <Card padded={false} className="bg-nw-surface border border-nw-border rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden my-auto flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="bg-nw-surface-2 px-5 py-4 border-b border-nw-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-nw-ok-bg border border-nw-border flex items-center justify-center text-nw-ok font-bold">
              <Building className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-nw-text">
                {supplierToEdit ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
              </h2>
              <p className="text-xs text-nw-muted">
                {supplierToEdit
                  ? 'تحديث بيانات وسجل معلومات المورد'
                  : 'إدخال بيانات المورد لإتاحته في أوامر الشراء'}
              </p>
            </div>
          </div>
          <UiButton aria-label="إغلاق بيانات المورد" variant="plain"
            type="button"
            onClick={onClose}
            className="w-11 h-11 rounded-xl bg-nw-surface-2 text-nw-text hover:text-nw-text flex items-center justify-center transition h-auto min-h-11 min-w-0 whitespace-normal"
          >
            <X className="w-5 h-5" />
          </UiButton>
        </div>

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {errorMsg && (
            <div className="bg-nw-bad-bg border border-nw-border p-3 rounded-2xl text-nw-bad flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-nw-bad" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Company Name (Required) */}
          <div className="space-y-1">
            <label className="font-bold text-nw-text flex items-center gap-1">
              <Building className="w-3.5 h-3.5 text-nw-ok" />
              اسم الشركة / المورد: <span className="text-nw-bad">*</span>
            </label>
            <input aria-label="مثال: شركة النوارس التجارية"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              placeholder="مثال: شركة النوارس التجارية"
              className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text font-bold focus:outline-none focus:border-nw-border"
            />
          </div>

          {/* Contact Person & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-nw-text flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-nw-info" />
                الشخص المسؤول:
              </label>
              <input aria-label="مثال: أحمد النواصرة"
                type="text"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                placeholder="مثال: أحمد النواصرة"
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-nw-text flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-nw-ok" />
                رقم الهاتف:
              </label>
              <input aria-label="0791234567"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0791234567"
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border font-mono"
              />
            </div>
          </div>

          {/* WhatsApp & Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-nw-text flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5 text-nw-ok" />
                رقم الواتساب:
              </label>
              <input aria-label="0791234567"
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="0791234567"
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-nw-text flex items-center gap-1">
                <Mail className="w-3.5 h-3.5 text-nw-info" />
                البريد الإلكتروني:
              </label>
              <input aria-label="البريد الإلكتروني"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="supplier@example.com"
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border font-mono"
              />
            </div>
          </div>

          {/* Address & Tax Number */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-nw-text flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-nw-warn" />
                العنوان:
              </label>
              <input aria-label="عمان - المقابلين"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="عمان - المقابلين"
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-nw-text flex items-center gap-1">
                <CreditCard className="w-3.5 h-3.5 text-nw-info" />
                الرقم الضريبي:
              </label>
              <input aria-label="123456789"
                type="text"
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.target.value)}
                placeholder="123456789"
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border font-mono"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="font-bold text-nw-text flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-nw-muted" />
              ملاحظات المورد:
            </label>
            <textarea aria-label="شروط التوريد، مواعيد التسليم، خصومات إضافية..."
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="شروط التوريد، مواعيد التسليم، خصومات إضافية..."
              className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border resize-none"
            />
          </div>

          {/* Status Active Toggle */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="supplierIsActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 rounded text-nw-ok focus:ring-nw-primary bg-nw-surface-2 border-nw-border cursor-pointer"
            />
            <label htmlFor="supplierIsActive" className="text-nw-text font-bold cursor-pointer">
              مورد نشط (متاح للاختيار في طلبات الشراء)
            </label>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-nw-border flex items-center justify-end gap-3 shrink-0">
            <UiButton variant="plain"
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-nw-surface-2 text-nw-text hover:bg-nw-surface-2 font-bold transition disabled:opacity-50 h-auto min-h-11 min-w-0 whitespace-normal"
            >
              إلغاء
            </UiButton>
            <UiButton variant="plain"
              type="submit"
              disabled={isSubmitting || !companyName.trim()}
              className="px-6 py-2 rounded-xl bg-nw-ok-bg hover:bg-nw-ok-bg text-nw-text font-bold transition shadow-lg disabled:opacity-50 flex items-center gap-2 h-auto min-h-11 min-w-0 whitespace-normal"
            >
              {isSubmitting ? (
                <span>جاري حفظ المورد...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>حفظ المورد واختياره</span>
                </>
              )}
            </UiButton>
          </div>
        </form>
      </Card>
    </FormFields>
  );
};

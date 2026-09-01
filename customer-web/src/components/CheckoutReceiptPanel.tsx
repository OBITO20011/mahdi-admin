import {
  CheckCircle2,
  ExternalLink,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react';
import type { GuestOrderReceipt } from '../types/checkout';
import { formatJod } from '../utils/money';

interface CheckoutReceiptPanelProps {
  receipt: GuestOrderReceipt;
  whatsappUrl: string;
  storeWhatsAppNumber: string;
  onClose: () => void;
  onTrackOrder: (receipt: GuestOrderReceipt) => void;
}

export function CheckoutReceiptPanel({
  receipt,
  whatsappUrl,
  storeWhatsAppNumber,
  onClose,
  onTrackOrder,
}: CheckoutReceiptPanelProps) {
  return (
    <div className="overflow-y-auto p-6 text-center sm:p-10">
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-[2rem] bg-emerald-100 text-emerald-600">
        <CheckCircle2 className="h-10 w-10" />
      </div>
      <h3 className="mt-5 text-xl font-black text-slate-950">
        وصل طلبك إلى تطبيق الإدارة
      </h3>
      <p className="mt-2 text-xs leading-6 text-slate-500">
        تم ربطه بملف العميل وحجز الكمية المطلوبة دون خصمها كمبيع نهائي حتى
        تؤكد الإدارة التسليم.
      </p>

      <div className="mx-auto mt-6 grid max-w-lg gap-3 sm:grid-cols-2">
        <div className="rounded-3xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-[10px] font-bold text-blue-500">رقم الطلب</p>
          <p className="mt-1 font-mono text-lg font-black text-blue-800">
            {receipt.orderNumber}
          </p>
        </div>
        <div className="rounded-3xl border border-orange-100 bg-orange-50 p-4">
          <p className="text-[10px] font-bold text-orange-500">
            إجمالي المنتجات
          </p>
          <p className="mt-1 text-lg font-black text-orange-700">
            {formatJod(receipt.totalInMinorUnits)}
          </p>
        </div>
      </div>

      {receipt.discountInMinorUnits > 0 && (
        <div className="mx-auto mt-3 max-w-lg rounded-2xl border border-violet-200 bg-violet-50 p-3 text-xs font-black text-violet-800">
          تم تطبيق خصم
          {receipt.promotionCode ? ` بالرمز ${receipt.promotionCode}` : ''}{' '}
          بقيمة {formatJod(receipt.discountInMinorUnits)}
        </div>
      )}

      <div className="mx-auto mt-4 flex max-w-lg items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-right text-[10px] font-bold leading-5 text-emerald-800">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        {receipt.idempotentReplay
          ? 'كان الطلب محفوظًا مسبقًا؛ أعاد النظام نفس الطلب ولم يكرر الحجز.'
          : receipt.customerReused
            ? 'تم ربط الطلب بملف العميل الموجود حسب رقم الهاتف.'
            : 'تم إنشاء ملف عميل جديد وربطه بهذا الطلب تلقائيًا.'}
      </div>

      <div className="mx-auto mt-6 flex max-w-lg flex-col gap-3 sm:flex-row">
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-xs font-black text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-700"
        >
          <MessageCircle className="h-4 w-4" />
          {storeWhatsAppNumber
            ? 'إرسال الملخص لمتجرنا'
            : 'مشاركة الملخص عبر واتساب'}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-xs font-black text-slate-700"
        >
          العودة للمتجر
        </button>
        {receipt.trackingToken && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onTrackOrder(receipt);
            }}
            className="flex-1 rounded-2xl bg-blue-700 px-5 py-3.5 text-xs font-black text-white shadow-lg shadow-blue-900/15 transition hover:bg-blue-800"
          >
            متابعة الطلب
          </button>
        )}
      </div>
    </div>
  );
}

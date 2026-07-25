/**
 * Nawasrah Business Manager - Supplier Receipt Detail View
 * Detailed view and printable receipt for direct goods receiving
 */

import React, { useState } from 'react';
import { SupplierReceipt } from '../../types/directReceiving';
import { CURRENCY } from '../../constants';
import { formatWholesaleInventory } from '../../utils/inventoryFormatter';
import { archiveSupplierReceiptInSupabase } from '../../services/supabase/directReceiving.service';
import { useAppStore } from '../../stores/useAppStore';
import {
  FileText,
  Printer,
  DollarSign,
  Archive,
  Building2,
  Calendar,
  Warehouse,
  User,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  Package,
  Layers,
  ChevronLeft,
} from 'lucide-react';

interface SupplierReceiptDetailViewProps {
  receipt: SupplierReceipt;
  onBack: () => void;
  onRecordPayment: (receipt: SupplierReceipt) => void;
  onRefresh: () => void;
}

export const SupplierReceiptDetailView: React.FC<SupplierReceiptDetailViewProps> = ({
  receipt,
  onBack,
  onRecordPayment,
  onRefresh,
}) => {
  const { setToast } = useAppStore();
  const [activeSubTab, setActiveSubTab] = useState<'items' | 'payments' | 'history'>('items');
  const [isArchiving, setIsArchiving] = useState<boolean>(false);

  const minorToJod = (fils: number) => (fils / 1000).toFixed(3);

  const handlePrint = () => {
    window.print();
  };

  const handleToggleArchive = async () => {
    setIsArchiving(true);
    const newArchivedState = !receipt.isArchived;
    const res = await archiveSupplierReceiptInSupabase(receipt.id, newArchivedState);

    if (res.success) {
      setToast(
        newArchivedState ? 'تم أرشفة سند الاستلام بنجاح.' : 'تم إلغاء أرشفة سند الاستلام.',
        'success'
      );
      onRefresh();
    } else {
      setToast(res.error || 'فشلت عملية تغيير حالة الأرشفة.', 'error');
    }
    setIsArchiving(false);
  };

  const paymentStatusBadge = {
    paid: { label: 'مدفوع بالكامل', bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    partially_paid: { label: 'مدفوع جزئيًا', bg: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
    unpaid: { label: 'غير مدفوع (ذمة)', bg: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  }[receipt.paymentStatus] || { label: 'غير مدفوع', bg: 'bg-slate-800 text-slate-300 border-slate-700' };

  return (
    <div dir="rtl" className="space-y-4 text-xs text-slate-200">
      {/* Top Header Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden bg-slate-900 p-3 rounded-2xl border border-slate-800">
        <button
          onClick={onBack}
          className="bg-slate-800 text-slate-300 px-3 py-1.5 rounded-xl font-bold hover:bg-slate-700 transition flex items-center gap-1.5"
        >
          <ArrowRight className="w-4 h-4" />
          <span>العودة لسندات الاستلام</span>
        </button>

        <div className="flex items-center gap-2">
          {receipt.amountDueInMinorUnits > 0 && (
            <button
              onClick={() => onRecordPayment(receipt)}
              className="bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-xl font-bold hover:bg-emerald-600/30 transition flex items-center gap-1.5"
            >
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span>تسجيل دفعة للمورد</span>
            </button>
          )}

          <button
            onClick={handleToggleArchive}
            disabled={isArchiving}
            className="bg-slate-800 text-slate-300 border border-slate-700 px-3 py-1.5 rounded-xl font-bold hover:bg-slate-700 transition flex items-center gap-1.5"
          >
            <Archive className="w-4 h-4 text-amber-400" />
            <span>{receipt.isArchived ? 'إلغاء الأرشفة' : 'أرشفة السند'}</span>
          </button>

          <button
            onClick={handlePrint}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-xl font-bold hover:bg-blue-500 transition flex items-center gap-1.5 shadow"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة السند</span>
          </button>
        </div>
      </div>

      {/* Printable Receipt Layout Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 md:p-6 space-y-6 print:bg-white print:text-black print:border-none print:shadow-none print:p-0">
        {/* Printable Receipt Header */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-800 print:border-black pb-4 gap-4">
          <div>
            <h2 className="text-base font-black text-slate-100 print:text-black flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-400 print:hidden" />
              <span>إذن استلام بضائع من مورد (Direct Goods Receipt)</span>
            </h2>
            <p className="text-[11px] text-slate-400 print:text-gray-600 font-mono mt-0.5">
              رقم السند: <strong className="text-blue-400 print:text-black">{receipt.receiptNumber}</strong>
            </p>
          </div>

          <div className="text-left flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full border font-extrabold text-xs print:border-black print:text-black ${paymentStatusBadge.bg}`}
            >
              {paymentStatusBadge.label}
            </span>
          </div>
        </div>

        {/* Metadata Details Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 bg-slate-950 print:bg-gray-50 border border-slate-800 print:border-gray-300 p-3.5 rounded-xl text-xs">
          <div>
            <span className="text-slate-400 print:text-gray-500 block text-[10px] font-bold">المورد</span>
            <strong className="text-slate-100 print:text-black text-xs">{receipt.supplierName}</strong>
            {receipt.supplierPhone && (
              <span className="block text-[10px] text-slate-500 print:text-gray-600 font-mono">
                {receipt.supplierPhone}
              </span>
            )}
          </div>

          <div>
            <span className="text-slate-400 print:text-gray-500 block text-[10px] font-bold">المستودع المستلم</span>
            <strong className="text-slate-100 print:text-black text-xs">{receipt.warehouseName}</strong>
          </div>

          <div>
            <span className="text-slate-400 print:text-gray-500 block text-[10px] font-bold">رقم فاتورة المورد</span>
            <strong className="text-slate-100 print:text-black text-xs">
              {receipt.supplierInvoiceNumber || 'غير مدخل'}
            </strong>
          </div>

          <div>
            <span className="text-slate-400 print:text-gray-500 block text-[10px] font-bold">تاريخ الاستلام</span>
            <strong className="text-slate-100 print:text-black text-xs">
              {new Date(receipt.receivedAt).toLocaleString('ar-JO')}
            </strong>
          </div>

          <div>
            <span className="text-slate-400 print:text-gray-500 block text-[10px] font-bold">مُستلم البضاعة</span>
            <strong className="text-slate-100 print:text-black text-xs">{receipt.receivedByName}</strong>
          </div>

          <div>
            <span className="text-slate-400 print:text-gray-500 block text-[10px] font-bold">طريقة الدفع</span>
            <strong className="text-slate-100 print:text-black text-xs">
              {receipt.paymentMethod === 'cash'
                ? 'نقدي'
                : receipt.paymentMethod === 'cliq'
                ? 'CliQ / تحويل'
                : receipt.paymentMethod === 'deferred'
                ? 'آجل'
                : receipt.paymentMethod}
            </strong>
          </div>
        </div>

        {/* Sub Tabs for Web View */}
        <div className="flex items-center gap-2 border-b border-slate-800 print:hidden pb-2">
          <button
            onClick={() => setActiveSubTab('items')}
            className={`px-3 py-1.5 rounded-xl font-bold transition ${
              activeSubTab === 'items'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200'
            }`}
          >
            الأصناف المستلمة ({receipt.items?.length || 0})
          </button>
          <button
            onClick={() => setActiveSubTab('payments')}
            className={`px-3 py-1.5 rounded-xl font-bold transition ${
              activeSubTab === 'payments'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200'
            }`}
          >
            سجل الدفعات ({receipt.payments?.length || 0})
          </button>
        </div>

        {/* Items Table */}
        {(activeSubTab === 'items' || true) && (
          <div className="space-y-3">
            <h3 className="font-bold text-slate-200 print:text-black text-xs hidden print:block">
              بيانات البضائع والأصناف المستلمة:
            </h3>
            <div className="overflow-x-auto border border-slate-800 print:border-black rounded-xl">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-950 print:bg-gray-100 text-slate-400 print:text-black font-bold border-b border-slate-800 print:border-black">
                  <tr>
                    <th className="p-2.5">#</th>
                    <th className="p-2.5">اسم الصنف / SKU</th>
                    <th className="p-2.5 text-center">وحدة الشراء</th>
                    <th className="p-2.5 text-center">الكمية الواردة</th>
                    <th className="p-2.5 text-center">محتوى الطرد</th>
                    <th className="p-2.5 text-center">إجمالي الوحدات</th>
                    <th className="p-2.5 text-center">سعر الطرد</th>
                    <th className="p-2.5 text-center">تكلفة الوحدة</th>
                    <th className="p-2.5 text-center">الإجمالي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 print:divide-gray-300 text-slate-200 print:text-black">
                  {receipt.items?.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-slate-800/30">
                      <td className="p-2.5 font-bold">{idx + 1}</td>
                      <td className="p-2.5 font-bold">
                        <div>{item.productName}</div>
                        <span className="text-[10px] text-slate-500 font-mono">{item.productSku}</span>
                      </td>
                      <td className="p-2.5 text-center font-bold">{item.purchaseUnitName}</td>
                      <td className="p-2.5 text-center font-bold text-blue-400 print:text-black">
                        {Math.floor(item.packageQuantity)}
                      </td>
                      <td className="p-2.5 text-center">{Math.floor(item.unitsPerPackage)} {item.baseUnitName}</td>
                      <td className="p-2.5 text-center font-extrabold text-emerald-400 print:text-black">
                        {formatWholesaleInventory(item.totalBaseUnits, item.unitsPerPackage, item.purchaseUnitName, item.baseUnitName).fullFormatted}
                      </td>
                      <td className="p-2.5 text-center font-mono">
                        {minorToJod(item.packagePriceInMinorUnits)} {CURRENCY}
                      </td>
                      <td className="p-2.5 text-center font-mono text-amber-400 print:text-black">
                        {minorToJod(item.baseUnitCostInMinorUnits)} {CURRENCY}
                      </td>
                      <td className="p-2.5 text-center font-mono font-bold text-emerald-400 print:text-black">
                        {minorToJod(item.lineTotalInMinorUnits)} {CURRENCY}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Payments History List SubTab */}
        {activeSubTab === 'payments' && (
          <div className="space-y-2 print:hidden">
            {receipt.payments?.length === 0 ? (
              <div className="p-4 text-center text-slate-500">لا توجد دفعات مسجلة على هذا السند بعد.</div>
            ) : (
              receipt.payments?.map((p) => (
                <div key={p.id} className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-emerald-400 block text-xs">
                      {minorToJod(p.amountInMinorUnits)} {CURRENCY} ({p.paymentMethod})
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(p.paymentDate).toLocaleString('ar-JO')} {p.notes ? `| ${p.notes}` : ''}
                    </span>
                  </div>
                  {p.referenceNumber && (
                    <span className="text-[10px] text-slate-500 font-mono bg-slate-900 px-2 py-0.5 rounded">
                      مرجع: {p.referenceNumber}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Financial Summary Calculation Card */}
        <div className="bg-slate-950 print:bg-gray-100 border border-slate-800 print:border-black p-4 rounded-xl space-y-2 max-w-sm mr-auto text-xs">
          <div className="flex items-center justify-between text-slate-400 print:text-black">
            <span>مجموع الأصناف:</span>
            <span className="font-mono font-bold">{minorToJod(receipt.subtotalInMinorUnits)} {CURRENCY}</span>
          </div>

          {receipt.discountInMinorUnits > 0 && (
            <div className="flex items-center justify-between text-rose-400">
              <span>خصم إضافي:</span>
              <span className="font-mono font-bold">-{minorToJod(receipt.discountInMinorUnits)} {CURRENCY}</span>
            </div>
          )}

          {receipt.deliveryFeeInMinorUnits > 0 && (
            <div className="flex items-center justify-between text-slate-300 print:text-black">
              <span>أجور النقل/التوصيل:</span>
              <span className="font-mono font-bold">+{minorToJod(receipt.deliveryFeeInMinorUnits)} {CURRENCY}</span>
            </div>
          )}

          <div className="flex items-center justify-between font-black text-slate-100 print:text-black border-t border-slate-800 print:border-black pt-2 text-sm">
            <span>المجموع النهائي:</span>
            <span className="text-emerald-400 print:text-black">{minorToJod(receipt.totalInMinorUnits)} {CURRENCY}</span>
          </div>

          <div className="flex items-center justify-between text-slate-300 print:text-black pt-1">
            <span>المبلغ المدفوع:</span>
            <span className="font-mono font-bold text-emerald-400 print:text-black">
              {minorToJod(receipt.amountPaidInMinorUnits)} {CURRENCY}
            </span>
          </div>

          <div className="flex items-center justify-between font-bold pt-1 border-t border-slate-800/80">
            <span>المتبقي كذمة للمورد:</span>
            <span className={`font-mono font-black ${receipt.amountDueInMinorUnits > 0 ? 'text-rose-400 print:text-black' : 'text-emerald-400'}`}>
              {minorToJod(receipt.amountDueInMinorUnits)} {CURRENCY}
            </span>
          </div>
        </div>

        {/* Notes & Signatures for Print */}
        <div className="border-t border-slate-800 print:border-black pt-4 grid grid-cols-2 gap-4 text-center print:text-black">
          <div>
            <span className="text-[10px] text-slate-400 print:text-black block font-bold">توقيع المستلم والتدقيق</span>
            <div className="h-10 border-b border-dashed border-slate-700 print:border-black mt-2"></div>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 print:text-black block font-bold">توقيع المورد أو السائق</span>
            <div className="h-10 border-b border-dashed border-slate-700 print:border-black mt-2"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

import {FormFields, formatJod, Card, UiButton, formatUiDate, DataTable, Tr, Th, Td} from '../../components/ui';
/**
 * Nawasrah Business Manager - Supplier Receipt Detail View
 * Detailed view and printable receipt for direct goods receiving
 */

import React, { useState } from 'react';
import { SupplierReceipt } from '../../types/directReceiving';
import { CURRENCY } from '../../constants';
import { formatWholesaleInventory } from '../../utils/inventoryFormatter';
import { archiveSupplierReceiptInSupabase } from '../../services/supabase/directReceiving.service';
import { useAppStoreActions } from '../../stores/useAppStore';
import { CancelSupplierReceiptDialog } from './CancelSupplierReceiptDialog';
import {
  Printer,
  DollarSign,
  Archive,
  Building2,
  ArrowRight,
  RotateCcw,
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
  const { setToast } = useAppStoreActions();
  const [activeSubTab, setActiveSubTab] = useState<'items' | 'payments' | 'history'>('items');
  const [isArchiving, setIsArchiving] = useState<boolean>(false);
  const [showCancellationDialog, setShowCancellationDialog] =
    useState<boolean>(false);

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

  const paymentStatusBadge =
    receipt.status === 'cancelled'
      ? {
          label: 'ملغى ومعكوس',
          bg: 'bg-nw-bad-bg text-nw-bad border-nw-border',
        }
      : {
          paid: {
            label: 'مدفوع بالكامل',
            bg: 'bg-nw-ok-bg text-nw-ok border-nw-border',
          },
          partially_paid: {
            label: 'مدفوع جزئيًا',
            bg: 'bg-nw-warn-bg text-nw-warn border-nw-border',
          },
          unpaid: {
            label: 'غير مدفوع (ذمة)',
            bg: 'bg-nw-bad-bg text-nw-bad border-nw-border',
          },
        }[receipt.paymentStatus] || {
          label: 'غير مدفوع',
          bg: 'bg-nw-surface-2 text-nw-text border-nw-border',
        };

  return (
    <FormFields dir="rtl" className="nw-purchasing-fields space-y-4 text-xs text-nw-text">
      {/* Top Header Actions */}
      <Card padded={false} className="flex flex-wrap items-center justify-between gap-2 print:hidden bg-nw-surface p-3 rounded-2xl border border-nw-border">
        <UiButton variant="plain" type="button"
          onClick={onBack}
          className="bg-nw-surface-2 text-nw-text px-3 py-1.5 rounded-xl font-bold hover:bg-nw-surface-2 transition flex items-center gap-1.5 h-auto min-h-11 min-w-0 whitespace-normal"
        >
          <ArrowRight className="w-4 h-4" />
          <span>العودة لسندات الاستلام</span>
        </UiButton>

        <div className="flex flex-wrap items-center gap-2">
          {receipt.status === 'completed' && (
            <UiButton variant="plain" type="button"
              onClick={() => setShowCancellationDialog(true)}
              className="bg-nw-bad-bg text-nw-bad border border-nw-border px-3 py-1.5 rounded-xl font-bold hover:bg-nw-bad-bg transition flex items-center gap-1.5 h-auto min-h-11 min-w-0 whitespace-normal"
            >
              <RotateCcw className="w-4 h-4" />
              <span>إلغاء وعكس السند</span>
            </UiButton>
          )}

          {receipt.status === 'completed' && receipt.amountDueInMinorUnits > 0 && (
            <UiButton variant="plain" type="button"
              onClick={() => onRecordPayment(receipt)}
              className="bg-nw-ok-bg text-nw-ok border border-nw-border px-3 py-1.5 rounded-xl font-bold hover:bg-nw-ok-bg transition flex items-center gap-1.5 h-auto min-h-11 min-w-0 whitespace-normal"
            >
              <DollarSign className="w-4 h-4 text-nw-ok" />
              <span>تسجيل دفعة للمورد</span>
            </UiButton>
          )}

          {receipt.status === 'completed' && (
            <UiButton variant="plain" type="button"
              onClick={handleToggleArchive}
              disabled={isArchiving}
              className="bg-nw-surface-2 text-nw-text border border-nw-border px-3 py-1.5 rounded-xl font-bold hover:bg-nw-surface-2 transition flex items-center gap-1.5 h-auto min-h-11 min-w-0 whitespace-normal"
            >
              <Archive className="w-4 h-4 text-nw-warn" />
              <span>{receipt.isArchived ? 'إلغاء الأرشفة' : 'أرشفة السند'}</span>
            </UiButton>
          )}

          <UiButton variant="plain" type="button"
            onClick={handlePrint}
            className="bg-nw-info-bg text-nw-text px-4 py-1.5 rounded-xl font-bold hover:bg-nw-info-bg transition flex items-center gap-1.5 shadow h-auto min-h-11 min-w-0 whitespace-normal"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة السند</span>
          </UiButton>
        </div>
      </Card>

      {/* Printable Receipt Layout Container */}
      <Card padded={false} className="bg-nw-surface border border-nw-border rounded-2xl p-4 md:p-6 space-y-6 print:bg-nw-surface print:text-nw-text print:border-none print:shadow-none print:p-0">
        {/* Printable Receipt Header */}
        <div className="flex flex-wrap items-center justify-between border-b border-nw-border print:border-nw-border pb-4 gap-4">
          <div>
            <h2 className="text-base font-black text-nw-text print:text-nw-text flex items-center gap-2">
              <Building2 className="w-5 h-5 text-nw-info print:hidden" />
              <span>إذن استلام بضائع من مورد (Direct Goods Receipt)</span>
            </h2>
            <p className="text-[11px] text-nw-muted print:text-nw-muted font-mono mt-0.5">
              رقم السند: <strong className="text-nw-info print:text-nw-text">{receipt.receiptNumber}</strong>
            </p>
          </div>

          <div className="text-left flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full border font-extrabold text-xs print:border-nw-border print:text-nw-text ${paymentStatusBadge.bg}`}
            >
              {paymentStatusBadge.label}
            </span>
          </div>
        </div>

        {/* Metadata Details Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 bg-nw-bg print:bg-nw-mute-bg border border-nw-border print:border-nw-border p-3.5 rounded-xl text-xs">
          <div>
            <span className="text-nw-muted print:text-nw-muted block text-[10px] font-bold">المورد</span>
            <strong className="text-nw-text print:text-nw-text text-xs">{receipt.supplierName}</strong>
            {receipt.supplierPhone && (
              <span className="block text-[10px] text-nw-muted print:text-nw-muted font-mono">
                {receipt.supplierPhone}
              </span>
            )}
          </div>

          <div>
            <span className="text-nw-muted print:text-nw-muted block text-[10px] font-bold">المستودع المستلم</span>
            <strong className="text-nw-text print:text-nw-text text-xs">{receipt.warehouseName}</strong>
          </div>

          <div>
            <span className="text-nw-muted print:text-nw-muted block text-[10px] font-bold">رقم فاتورة المورد</span>
            <strong className="text-nw-text print:text-nw-text text-xs">
              {receipt.supplierInvoiceNumber || 'غير مدخل'}
            </strong>
          </div>

          <div>
            <span className="text-nw-muted print:text-nw-muted block text-[10px] font-bold">تاريخ الاستلام</span>
            <strong className="text-nw-text print:text-nw-text text-xs">
              {formatUiDate(receipt.receivedAt, {year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
            </strong>
          </div>

          <div>
            <span className="text-nw-muted print:text-nw-muted block text-[10px] font-bold">مُستلم البضاعة</span>
            <strong className="text-nw-text print:text-nw-text text-xs">{receipt.receivedByName}</strong>
          </div>

          <div>
            <span className="text-nw-muted print:text-nw-muted block text-[10px] font-bold">طريقة الدفع</span>
            <strong className="text-nw-text print:text-nw-text text-xs">
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
        <div className="flex items-center gap-2 border-b border-nw-border print:hidden pb-2">
          <UiButton variant="plain" type="button"
            onClick={() => setActiveSubTab('items')}
            className={`px-3 py-1.5 rounded-xl font-bold transition ${
              activeSubTab === 'items'
                ? 'bg-nw-info-bg text-nw-text shadow'
                : 'bg-nw-bg text-nw-muted hover:text-nw-text'
            }`}
          >
            الأصناف المستلمة ({receipt.items?.length || 0})
          </UiButton>
          <UiButton variant="plain" type="button"
            onClick={() => setActiveSubTab('payments')}
            className={`px-3 py-1.5 rounded-xl font-bold transition ${
              activeSubTab === 'payments'
                ? 'bg-nw-info-bg text-nw-text shadow'
                : 'bg-nw-bg text-nw-muted hover:text-nw-text'
            }`}
          >
            سجل الدفعات ({receipt.payments?.length || 0})
          </UiButton>
        </div>

        {/* Items Table */}
        {activeSubTab === 'items' && (
          <div className="space-y-3">
            <h3 className="font-bold text-nw-text print:text-nw-text text-xs hidden print:block">
              بيانات البضائع والأصناف المستلمة:
            </h3>
            <div className="overflow-x-auto border border-nw-border print:border-nw-border rounded-xl">
              <DataTable caption="أصناف السند" className="w-full text-right text-xs">
                <thead className="bg-nw-bg print:bg-nw-mute-bg text-nw-muted print:text-nw-text font-bold border-b border-nw-border print:border-nw-border">
                  <Tr>
                    <Th className="p-2.5">#</Th>
                    <Th className="p-2.5">اسم الصنف / SKU</Th>
                    <Th className="p-2.5 text-center">وحدة الشراء</Th>
                    <Th className="p-2.5 text-center">الكمية الواردة</Th>
                    <Th className="p-2.5 text-center">محتوى الطرد</Th>
                    <Th className="p-2.5 text-center">إجمالي الوحدات</Th>
                    <Th className="p-2.5 text-center">سعر الطرد</Th>
                    <Th className="p-2.5 text-center">تكلفة الوحدة</Th>
                    <Th className="p-2.5 text-center">سعر البيع</Th>
                    <Th className="p-2.5 text-center">ربح الوحدة</Th>
                    <Th className="p-2.5 text-center">الإجمالي</Th>
                  </Tr>
                </thead>
                <tbody className="divide-y divide-nw-border print:divide-nw-border text-nw-text print:text-nw-text">
                  {receipt.items?.map((item, idx) => (
                    <Tr key={item.id} className="hover:bg-nw-surface-2">
                      <Td className="p-2.5 font-bold">{idx + 1}</Td>
                      <Td className="p-2.5 font-bold">
                        <div>{item.productName}</div>
                        <span className="text-[10px] text-nw-muted font-mono">{item.productSku}</span>
                      </Td>
                      <Td className="p-2.5 text-center font-bold">{item.purchaseUnitName}</Td>
                      <Td className="p-2.5 text-center font-bold text-nw-info print:text-nw-text">
                        {Math.floor(item.packageQuantity)}
                      </Td>
                      <Td className="p-2.5 text-center">{Math.floor(item.unitsPerPackage)} {item.baseUnitName}</Td>
                      <Td className="p-2.5 text-center font-extrabold text-nw-ok print:text-nw-text">
                        {formatWholesaleInventory(item.totalBaseUnits, item.unitsPerPackage, item.purchaseUnitName, item.baseUnitName).fullFormatted}
                      </Td>
                      <Td className="p-2.5 text-center font-mono">
                        {formatJod(Number(minorToJod(item.packagePriceInMinorUnits)))} {CURRENCY}
                      </Td>
                      <Td className="p-2.5 text-center font-mono text-nw-warn print:text-nw-text">
                        {formatJod(Number(minorToJod(item.baseUnitCostInMinorUnits)))} {CURRENCY}
                      </Td>
                      <Td className="p-2.5 text-center font-mono text-nw-info print:text-nw-text">
                        {formatJod(Number(minorToJod(item.sellingPriceInMinorUnits || 0)))} {CURRENCY}
                      </Td>
                      <Td
                        className={`p-2.5 text-center font-mono font-bold print:text-nw-text ${
                          (item.sellingPriceInMinorUnits || 0) >= item.baseUnitCostInMinorUnits
                            ? 'text-nw-ok'
                            : 'text-nw-bad'
                        }`}
                      >
                        {formatJod(Number(minorToJod(
                          (item.sellingPriceInMinorUnits || 0) -
                            item.baseUnitCostInMinorUnits
                        )))}{' '}
                        {CURRENCY}
                      </Td>
                      <Td className="p-2.5 text-center font-mono font-bold text-nw-ok print:text-nw-text">
                        {formatJod(Number(minorToJod(item.lineTotalInMinorUnits)))} {CURRENCY}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          </div>
        )}

        {/* Payments History List SubTab */}
        {activeSubTab === 'payments' && (
          <div className="space-y-2 print:hidden">
            {receipt.payments?.length === 0 ? (
              <div className="p-4 text-center text-nw-muted">لا توجد دفعات مسجلة على هذا السند بعد.</div>
            ) : (
              receipt.payments?.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl border p-3 ${
                    p.isReversed
                      ? 'border-nw-border bg-nw-bad-bg'
                      : 'border-nw-border bg-nw-bg'
                  }`}
                >
                  <div>
                    <span
                      className={`block text-xs font-bold ${
                        p.isReversed
                          ? 'text-nw-bad line-through'
                          : 'text-nw-ok'
                      }`}
                    >
                      {formatJod(Number(minorToJod(p.amountInMinorUnits)))} {CURRENCY} ({p.paymentMethod})
                    </span>
                    <span className="text-[10px] text-nw-muted">
                      {formatUiDate(p.paymentDate, {year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} {p.notes ? `| ${p.notes}` : ''}
                    </span>
                    {p.isReversed && (
                      <span className="mt-1 block text-[10px] font-bold text-nw-bad">
                        دفعة معكوسة
                        {p.reversalReason ? ` — ${p.reversalReason}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {p.isReversed && (
                      <span className="rounded-full border border-nw-border bg-nw-bad-bg px-2 py-0.5 text-[10px] font-extrabold text-nw-bad">
                        معكوسة
                      </span>
                    )}
                    {p.referenceNumber && (
                      <span className="text-[10px] text-nw-muted font-mono bg-nw-surface px-2 py-0.5 rounded">
                        مرجع: {p.referenceNumber}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Financial Summary Calculation Card */}
        <div className="bg-nw-bg print:bg-nw-mute-bg border border-nw-border print:border-nw-border p-4 rounded-xl space-y-2 max-w-sm mr-auto text-xs">
          <div className="flex items-center justify-between text-nw-muted print:text-nw-text">
            <span>مجموع الأصناف:</span>
            <span className="font-mono font-bold">{formatJod(Number(minorToJod(receipt.subtotalInMinorUnits)))} {CURRENCY}</span>
          </div>

          {receipt.discountInMinorUnits > 0 && (
            <div className="flex items-center justify-between text-nw-bad">
              <span>خصم إضافي:</span>
              <span className="font-mono font-bold">-{formatJod(Number(minorToJod(receipt.discountInMinorUnits)))} {CURRENCY}</span>
            </div>
          )}

          {receipt.deliveryFeeInMinorUnits > 0 && (
            <div className="flex items-center justify-between text-nw-text print:text-nw-text">
              <span>أجور النقل/التوصيل:</span>
              <span className="font-mono font-bold">+{formatJod(Number(minorToJod(receipt.deliveryFeeInMinorUnits)))} {CURRENCY}</span>
            </div>
          )}

          <div className="flex items-center justify-between font-black text-nw-text print:text-nw-text border-t border-nw-border print:border-nw-border pt-2 text-sm">
            <span>المجموع النهائي:</span>
            <span className="text-nw-ok print:text-nw-text">{formatJod(Number(minorToJod(receipt.totalInMinorUnits)))} {CURRENCY}</span>
          </div>

          <div className="flex items-center justify-between text-nw-text print:text-nw-text pt-1">
            <span>المبلغ المدفوع:</span>
            <span className="font-mono font-bold text-nw-ok print:text-nw-text">
              {formatJod(Number(minorToJod(receipt.amountPaidInMinorUnits)))} {CURRENCY}
            </span>
          </div>

          <div className="flex items-center justify-between font-bold pt-1 border-t border-nw-border">
            <span>المتبقي كذمة للمورد:</span>
            <span className={`font-mono font-black ${receipt.amountDueInMinorUnits > 0 ? 'text-nw-bad print:text-nw-text' : 'text-nw-ok'}`}>
              {formatJod(Number(minorToJod(receipt.amountDueInMinorUnits)))} {CURRENCY}
            </span>
          </div>
        </div>

        {/* Notes & Signatures for Print */}
        <div className="border-t border-nw-border print:border-nw-border pt-4 grid grid-cols-2 gap-4 text-center print:text-nw-text">
          <div>
            <span className="text-[10px] text-nw-muted print:text-nw-text block font-bold">توقيع المستلم والتدقيق</span>
            <div className="h-10 border-b border-dashed border-nw-border print:border-nw-border mt-2"></div>
          </div>
          <div>
            <span className="text-[10px] text-nw-muted print:text-nw-text block font-bold">توقيع المورد أو السائق</span>
            <div className="h-10 border-b border-dashed border-nw-border print:border-nw-border mt-2"></div>
          </div>
        </div>
      </Card>

      <CancelSupplierReceiptDialog
        receipt={showCancellationDialog ? receipt : null}
        onClose={() => setShowCancellationDialog(false)}
        onSuccess={onRefresh}
      />
    </FormFields>
  );
};

import React from 'react';
import {UiButton} from '../../components/ui';

/** Order input is a delivery snapshot,never authority to edit an existing card. */
export function GuestDeliveryProposal({recipientName, customerName, address, onReview}: {
  recipientName: string;
  customerName: string;
  address: string;
  onReview: () => void;
}) {
  return <section aria-label="بيانات مستلم طلب المتجر" className="rounded-xl border border-nw-info bg-nw-info-bg p-3">
    <h4 className="font-bold">بيانات المستلم من طلب المتجر</h4>
    <p>اسم المستلم: {recipientName}</p>
    <p>عنوان هذا الطلب: {address}</p>
    <p>الاسم في بطاقة الزبون: {customerName}</p>
    <p className="mt-2 text-xs">تغيير مقترح للبطاقة؛ لا يُعتمد تلقائياً عند تأكيد الطلب. بعد الاتصال بالزبون، راجع ملفه وعدّل الاسم أو أضف عنواناً افتراضياً يدوياً إن وافقت.</p>
    <UiButton onClick={onReview}>مراجعة بطاقة الزبون لاعتماد التغيير يدوياً</UiButton>
  </section>;
}

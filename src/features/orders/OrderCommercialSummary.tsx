import { MoneyText } from '../../components/ui';
import { Order } from '../../types';
import { PAYMENT_METHOD_LABELS } from './orderStatus';
import {savedReceiptLine} from '../receipts/saleReceipt';
import {receiptLineDescription} from '../../../customer-web/src/receipts/commercialReceipt';
import {parseExchangeFunding,exchangeFundingLines,type ExchangeReceiptFunding} from '../../../customer-web/src/receipts/exchangeFunding';
import {formatExactMinorJod} from '../../utils/aftercare215Money';

/** Presentation of immutable order snapshots only; never reads the current catalogue. */
export function OrderCommercialSummary({ order }: { order: Order }) {
  let funding:ExchangeReceiptFunding|undefined;
  if(order.paymentMethod==='exchange_credit'){
    try{funding=parseExchangeFunding(order.exchangeFunding);if(order.items.length!==1||order.discount!==0||order.deliveryFee!==0)throw Error('shape');}
    catch{return <section role="alert">تفصيل مقابل التبديل غير مكتمل؛ حدّث الفاتورة قبل قراءة المبلغ.</section>;}
  }
  return <section data-testid="order-commercial-summary" className="space-y-3 text-sm">
    <h4 className="font-semibold">أصناف الطلب</h4>
    <ul className="divide-y divide-nw-border">
      {(order.items || []).map((item) => <li key={item.id} className="py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">{item.productName}</p>
            <p className="text-xs text-nw-muted">{receiptLineDescription(savedReceiptLine(item))}{!funding&&<> · <bdi dir="ltr">{item.quantity} × {item.unitPrice.toFixed(3)}</bdi></>}</p>
          </div>
          {funding?<bdi dir="ltr" className="shrink-0">{formatExactMinorJod(funding.newTotalInMinorUnits)}</bdi>:<MoneyText amount={item.totalPrice} className="shrink-0" />}
        </div>
        {!!item.parcelInstances?.length && <details data-commercial-components className="text-xs">
          <summary className="min-h-11 cursor-pointer py-3 text-nw-primary">عرض مكونات الطرود ({item.parcelInstances.length})</summary>
          {item.parcelInstances.map((instance) => <div key={instance.id} className="space-y-1 pb-3">
            <h5 className="font-semibold">مكونات {instance.unitName} #{instance.sequence}</h5>
            <ul aria-label={`مكونات ${instance.unitName} رقم ${instance.sequence}`} className="space-y-1">
              {instance.components.map((component) => <li key={component.id}>{component.name} ({component.sku}) — {component.quantity} {component.unitName}</li>)}
            </ul>
          </div>)}
        </details>}
      </li>)}
    </ul>
    <dl className="space-y-2 border-t border-nw-border pt-3">
      <div className="flex justify-between gap-3 text-nw-muted"><dt>المجموع الفرعي</dt><dd>{funding?<bdi dir="ltr">{formatExactMinorJod(funding.newTotalInMinorUnits)}</bdi>:<MoneyText amount={order.subtotal} />}</dd></div>
      {order.discount > 0 && <div className="flex justify-between gap-3 text-nw-ok"><dt>الخصم{order.promotionCode ? ` (${order.promotionCode})` : ''}</dt><dd><MoneyText amount={-order.discount} /></dd></div>}
      <div className="flex justify-between gap-3 text-nw-muted"><dt>التوصيل</dt><dd><MoneyText amount={order.deliveryFee} /></dd></div>
      <div className="flex justify-between gap-3 font-bold"><dt>الإجمالي</dt><dd>{funding?<bdi dir="ltr">{formatExactMinorJod(funding.newTotalInMinorUnits)}</bdi>:<MoneyText amount={order.totalAmount} />}</dd></div>
      <div className="flex justify-between gap-3 text-xs text-nw-muted"><dt>طريقة الدفع</dt><dd>{PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod}</dd></div>
    </dl>
    {funding&&<div className="space-y-2 rounded-lg border border-nw-border p-3">{exchangeFundingLines(funding).map(line=><p key={line} className="break-words">{line}</p>)}</div>}
  </section>;
}

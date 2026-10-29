import type {Branch,Invoice,Order,OrderItem} from '../../types';
import {jodToMinorUnits} from '../../utils/receivingCalculations';
import {paymentMethodLabel} from '../../utils/receipt';
import type {CommercialReceiptLine,ReceiptDocumentData} from '../../../customer-web/src/receipts/commercialReceipt';
import {parseExchangeFunding} from '../../../customer-web/src/receipts/exchangeFunding';

export function savedReceiptLine(item:OrderItem):CommercialReceiptLine {
  return {key:item.id,name:item.productName,kind:item.commercialLineKind,quantity:item.quantity,
    baseQuantity:item.baseQuantity,baseUnitName:item.baseUnitName,savedUnitName:item.unit||item.salePackage,
    parcels:item.parcelInstances?.map(p=>({components:p.components.map(c=>({name:c.name,quantity:c.quantity,unitName:c.unitName}))})),
    totalInMinorUnits:jodToMinorUnits(item.totalPrice)};
}
type ReceiptInvoice=Invoice&{changeDue?:number;deliveryFee?:number};
export function invoiceReceipt(invoice:ReceiptInvoice,branch?:Pick<Branch,'name'|'address'|'phone'>):ReceiptDocumentData {
  const funding=invoice.exchangeFunding?parseExchangeFunding(invoice.exchangeFunding):undefined;
  if((invoice.paymentMethod==='exchange_credit')!==Boolean(funding)||funding&&(invoice.items.length!==1||invoice.discount!==0||(invoice.deliveryFee??0)!==0||invoice.remainingAmount!==0))throw new Error('تفصيل مقابل التبديل غير مكتمل؛ حدّث الفاتورة قبل طباعة الوصل.');
  return {businessName:'النواصرة لتجارة الجملة والمواد الغذائية',number:invoice.invoiceNumber,createdAt:invoice.createdAt,
    customerName:invoice.customerName||'زبون نقدي',branch:{name:branch?.name||'',address:branch?.address,phone:branch?.phone},
    lines:invoice.items.map(item=>({...savedReceiptLine(item),...(funding?{totalInMinorUnitsExact:funding.newTotalInMinorUnits}:{})})),subtotalInMinorUnits:jodToMinorUnits(invoice.subtotal),
    discountInMinorUnits:jodToMinorUnits(invoice.discount),deliveryInMinorUnits:jodToMinorUnits(invoice.deliveryFee??0),
    totalInMinorUnits:jodToMinorUnits(invoice.totalAmount),paymentLabel:paymentMethodLabel(invoice.paymentMethod,invoice.initialPaymentMethod),
    ...(!funding?{paidInMinorUnits:jodToMinorUnits(invoice.paidAmount)}:{}),
    ...(invoice.initialPaymentMethod?{balanceLabel:'الباقي على الحساب'}:{}),
    remainingInMinorUnits:jodToMinorUnits(invoice.remainingAmount),changeInMinorUnits:jodToMinorUnits(invoice.changeDue??0),...(funding?{exchangeFunding:funding}:{})};
}
/** Reprint uses the loaded saved order. It never invokes sale/payment/token creation. */
export function orderReceipt(order:Order,branch?:Pick<Branch,'name'|'address'|'phone'>):ReceiptDocumentData {
  const result=invoiceReceipt({id:order.id,invoiceNumber:order.orderNumber,customerName:order.customerName,
    items:order.items,subtotal:order.subtotal,discount:order.discount,taxAmount:0,deliveryFee:order.deliveryFee,
    totalAmount:order.totalAmount,paidAmount:order.amountPaid??0,remainingAmount:order.amountDue??0,
    paymentMethod:order.paymentMethod,exchangeFunding:order.exchangeFunding,status:'posted',branchId:order.branchId,createdById:'',createdByName:'',createdAt:order.createdAt},branch);
  return result;
}

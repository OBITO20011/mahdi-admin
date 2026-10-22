import type {Branch,Invoice,Order,OrderItem} from '../../types';
import {jodToMinorUnits} from '../../utils/receivingCalculations';
import {paymentMethodLabel} from '../../utils/receipt';
import type {CommercialReceiptLine,ReceiptDocumentData} from '../../../customer-web/src/receipts/commercialReceipt';

export function savedReceiptLine(item:OrderItem):CommercialReceiptLine {
  return {key:item.id,name:item.productName,kind:item.commercialLineKind,quantity:item.quantity,
    baseQuantity:item.baseQuantity,baseUnitName:item.baseUnitName,savedUnitName:item.unit||item.salePackage,
    parcels:item.parcelInstances?.map(p=>({components:p.components.map(c=>({name:c.name,quantity:c.quantity,unitName:c.unitName}))})),
    totalInMinorUnits:jodToMinorUnits(item.totalPrice)};
}
type ReceiptInvoice=Invoice&{changeDue?:number;deliveryFee?:number};
export function invoiceReceipt(invoice:ReceiptInvoice,branch?:Pick<Branch,'name'|'address'|'phone'>):ReceiptDocumentData {
  return {businessName:'محلات النواصرة',number:invoice.invoiceNumber,createdAt:invoice.createdAt,
    customerName:invoice.customerName||'زبون نقدي',branch:{name:branch?.name||'',address:branch?.address,phone:branch?.phone},
    lines:invoice.items.map(savedReceiptLine),subtotalInMinorUnits:jodToMinorUnits(invoice.subtotal),
    discountInMinorUnits:jodToMinorUnits(invoice.discount),deliveryInMinorUnits:jodToMinorUnits(invoice.deliveryFee??0),
    totalInMinorUnits:jodToMinorUnits(invoice.totalAmount),paymentLabel:paymentMethodLabel(invoice.paymentMethod),
    remainingInMinorUnits:jodToMinorUnits(invoice.remainingAmount),changeInMinorUnits:jodToMinorUnits(invoice.changeDue??0)};
}
/** Reprint uses the loaded saved order. It never invokes sale/payment/token creation. */
export function orderReceipt(order:Order,branch?:Pick<Branch,'name'|'address'|'phone'>):ReceiptDocumentData {
  const result=invoiceReceipt({id:order.id,invoiceNumber:order.orderNumber,customerName:order.customerName,
    items:order.items,subtotal:order.subtotal,discount:order.discount,taxAmount:0,deliveryFee:order.deliveryFee,
    totalAmount:order.totalAmount,paidAmount:order.amountPaid??0,remainingAmount:order.amountDue??0,
    paymentMethod:order.paymentMethod,status:'posted',branchId:order.branchId,createdById:'',createdByName:'',createdAt:order.createdAt},branch);
  return result;
}

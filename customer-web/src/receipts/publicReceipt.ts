import type { PublicPosReceipt } from '../types/receipt';
import type { ReceiptDocumentData } from './commercialReceipt';

const paymentLabel = (method: string) => ({cash:'كاش',cliq:'CliQ',card:'بطاقة',bank_transfer:'تحويل بنكي',debt:'آجل على الحساب',mixed:'دفع مختلط'})[method] || method || 'غير محدد';

/** Same saved receipt template as POS and history. No catalogue lookup or write. */
export function publicReceiptDocument(receipt:PublicPosReceipt):ReceiptDocumentData {
  return {businessName:'النواصرة لتجارة الجملة والمواد الغذائية',number:receipt.orderNumber,createdAt:receipt.createdAt,branch:receipt.branch,
    lines:receipt.items.map((item,index)=>({key:String(index),name:item.productName,kind:item.commercialLineKind,
      quantity:item.packageQuantity,baseQuantity:item.baseQuantity,baseUnitName:item.baseUnitName,
      savedUnitName:item.packageName,parcels:item.parcelInstances,totalInMinorUnits:item.lineTotalInMinorUnits})),
    subtotalInMinorUnits:receipt.subtotalInMinorUnits,discountInMinorUnits:receipt.discountInMinorUnits,
    deliveryInMinorUnits:0,totalInMinorUnits:receipt.totalInMinorUnits,paymentLabel:paymentLabel(receipt.paymentMethod)};
}

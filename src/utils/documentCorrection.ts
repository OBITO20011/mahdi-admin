export const correctionActions=['pos_sale','customer_payment','supplier_payment','purchase_receipt'] as const;
export type CorrectionAction=typeof correctionActions[number];
export const correctionTitles:Record<CorrectionAction,string>={pos_sale:'عكس بيع خاطئ',customer_payment:'عكس دفعة عميل',supplier_payment:'عكس دفعة مورد',purchase_receipt:'إلغاء سند الاستلام'};
export const correctionRoles:Record<CorrectionAction,readonly string[]>={pos_sale:['owner'],supplier_payment:['owner'],customer_payment:['owner','admin','manager','accountant'],purchase_receipt:['owner','admin','manager','warehouse_keeper']};
export interface CorrectionPreview {
  contractVersion:207;action:CorrectionAction;recordId:string;reference:string;eligible:boolean;
  blockedReason:string|null;cashShiftId:string|null;fingerprint:string;
  effect:{cashInMinorUnits:number;cliqInMinorUnits:number;customerDebtInMinorUnits:number;
    supplierBalanceInMinorUnits:number;inventoryBaseUnits:number;paymentMethod:string|null;
    paymentInMinorUnits:number;stock:unknown[]};
}
export const correctionRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function readCorrectionPreview(value:unknown,action:CorrectionAction,recordId:string):CorrectionPreview {
  if(!correctionRecord(value)||value.contractVersion!==207||value.action!==action||value.recordId!==recordId
    ||typeof value.reference!=='string'||typeof value.eligible!=='boolean'
    ||(value.blockedReason!==null&&typeof value.blockedReason!=='string')
    ||(value.cashShiftId!==null&&typeof value.cashShiftId!=='string')
    ||typeof value.fingerprint!=='string'||!/^[0-9a-f]{64}$/u.test(value.fingerprint)
    ||!correctionRecord(value.effect)||!Array.isArray(value.effect.stock))throw new Error('دليل معاينة التصحيح غير متاح أو غير متطابق.');
  for(const field of ['cashInMinorUnits','cliqInMinorUnits','customerDebtInMinorUnits','supplierBalanceInMinorUnits','inventoryBaseUnits','paymentInMinorUnits']) {
    if(typeof value.effect[field]!=='number'||!Number.isSafeInteger(value.effect[field]))throw new Error('أرقام معاينة التصحيح غير متاحة.');
  }
  if(value.effect.paymentMethod!==null&&typeof value.effect.paymentMethod!=='string')throw new Error('طريقة الدفع غير متاحة في المعاينة.');
  for(const row of value.effect.stock){
    if(!correctionRecord(row))throw new Error('تفصيل مخزون المعاينة غير متاح.');
    if(action==='purchase_receipt'&&(typeof row.productName!=='string'||!row.productName
      ||typeof row.baseUnits!=='number'||!Number.isSafeInteger(row.baseUnits)
      ||![row.wacBefore,row.wacAfter].every(n=>n===null||(typeof n==='number'&&Number.isFinite(n)&&n>=0))))throw new Error('دليل تكلفة الاستلام غير متاح.');
  }
  if(value.eligible?value.blockedReason!==null:!value.blockedReason)throw new Error('أهلية التصحيح غير متطابقة.');
  return value as unknown as CorrectionPreview;
}

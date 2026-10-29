import type {SupplierReplacementCase} from '../../utils/supplierReplacement';

/** Saved commercial factor only; never infer a historical parcel from today's product. */
export function supplierPacketQuantity(quantity:number|bigint,unitsPerCommercialUnit=1):string {
  if(typeof quantity==='number'&&(!Number.isSafeInteger(quantity)||quantity<0)
    ||typeof quantity==='bigint'&&quantity<0n||!Number.isSafeInteger(unitsPerCommercialUnit)||unitsPerCommercialUnit<1) {
    throw new Error('الكمية المحفوظة غير مكتملة؛ حدّث السجل.');
  }
  const value=BigInt(quantity),size=BigInt(unitsPerCommercialUnit);
  if(size===1n)return `${value} باكيت`;
  const parcels=value/size,packets=value%size;
  return [parcels?`${parcels} طرد`:'',packets?`${packets} باكيت`:''].filter(Boolean).join(' + ')||'0 باكيت';
}
export const supplierCaseQuantity=(item:Pick<SupplierReplacementCase,'unitsPerCommercialUnit'>,quantity:number)=>supplierPacketQuantity(quantity,item.unitsPerCommercialUnit);

export const supplierDecisionHelp={
  receive:'المورد أعطاك بضاعة سليمة بدلها: تدخل المخزون، بلا مال.',
  partial:'المورد أعطاك جزءاً من البديل؛ والباقي يبقى معلّقاً.',
  credit:'بدل البضاعة، ينقص دينك للمورد بقيمتها؛ لا مخزون ولا كاش، وبحد ما عليك له.',
  refusal:'إذا رفض المورد: سجّلها خسارة من السجل.',
} as const;

import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { PublicPosReceipt } from '../types/receipt';
import {parseExchangeFunding} from '../receipts/exchangeFunding';

type RpcRecord = Record<string, unknown>;

const recordValue = (value: unknown): RpcRecord =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RpcRecord)
    : {};
const stringValue = (value: unknown) =>
  typeof value === 'string' ? value : '';
const integerValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

interface ReceiptRpcResponse {data:unknown;error:{code?:string;message?:string}|null;status?:number}
export async function readReceiptWithRpc(receiptToken:string,execute:(name:'lite1_public_pos_receipt2'|'get_public_pos_receipt',args:{p_receipt_token:string})=>PromiseLike<ReceiptRpcResponse>){
  const args={p_receipt_token:receiptToken};
  let result=await execute('lite1_public_pos_receipt2',args);
  if(result.status===404&&result.data==null&&result.error?.code==='PGRST202'&&result.error.message?.includes('lite1_public_pos_receipt2'))result=await execute('get_public_pos_receipt',args);
  return result;
}

export async function fetchPublicPosReceipt(
  receiptToken: string
): Promise<PublicPosReceipt> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptToken)) {
    throw new Error('رابط الإيصال غير صحيح.');
  }

  const { data, error } = await readReceiptWithRpc(receiptToken,(name,args)=>supabase!.rpc(name,args));
  if (error) throw new Error(error.message || 'تعذر تحميل الإيصال.');

  const payload = recordValue(data);
  if (payload.success !== true) {
    throw new Error(stringValue(payload.message) || 'الإيصال غير موجود.');
  }

  // Read only the global display mode; never consult the current product catalogue for a saved receipt.
  const displayMode=await supabase.rpc('lite1_operating_mode',{});
  const modeValue=recordValue(displayMode.data);
  const legacy=displayMode.status===404&&displayMode.data==null&&displayMode.error?.code==='PGRST202'&&displayMode.error.message?.includes('lite1_operating_mode');
  if(!legacy&&(displayMode.error||modeValue.contractVersion!=='sales-only-phase2-v1'||typeof modeValue.fullAccounting!=='boolean'))throw Error('تعذر التحقق من وحدة عرض الوصل. أعد المحاولة.');
  const actualUnitNames=!legacy&&modeValue.fullAccounting===false;
  const branch = recordValue(payload.branch);
  const hasInitial=payload.initialPaymentMethod!==undefined;
  const hasPayment=hasInitial||payload.amountPaidInMinorUnits!==undefined||payload.remainingInMinorUnits!==undefined;
  if(hasInitial&&(!['cash','cliq'].includes(String(payload.initialPaymentMethod))
    ||!Number.isSafeInteger(payload.amountPaidInMinorUnits)||Number(payload.amountPaidInMinorUnits)<0
    ||!Number.isSafeInteger(payload.remainingInMinorUnits)||Number(payload.remainingInMinorUnits)<0))throw new Error('تفصيل الدفعة غير مكتمل. أعد تحميل الوصل.');
  if(hasPayment&&(!Number.isSafeInteger(payload.amountPaidInMinorUnits)||Number(payload.amountPaidInMinorUnits)<0
    ||!Number.isSafeInteger(payload.remainingInMinorUnits)||Number(payload.remainingInMinorUnits)<0))throw new Error('تفصيل الدفعة غير مكتمل. أعد تحميل الوصل.');
  if(payload.paymentMethod==='exchange_credit'&&payload.exchange==null)throw new Error('تفصيل وصل التبديل غير متاح. أعد تحميل الرابط.');
  return {
    ...(actualUnitNames?{actualUnitNames:true}:{}),
    ...(payload.exchange!=null?{exchangeFunding:parseExchangeFunding(payload.exchange)}:{}),
    orderNumber: stringValue(payload.orderNumber),
    createdAt: stringValue(payload.createdAt),
    status: stringValue(payload.status),
    paymentMethod: stringValue(payload.paymentMethod),
    paymentStatus: stringValue(payload.paymentStatus),
    ...(hasInitial?{initialPaymentMethod:payload.initialPaymentMethod as 'cash'|'cliq'}:{}),
    ...(hasPayment?{amountPaidInMinorUnits:Number(payload.amountPaidInMinorUnits),remainingInMinorUnits:Number(payload.remainingInMinorUnits)}:{}),
    subtotalInMinorUnits: integerValue(payload.subtotalInMinorUnits),
    discountInMinorUnits: integerValue(payload.discountInMinorUnits),
    totalInMinorUnits: integerValue(payload.totalInMinorUnits),
    branch: {
      name: stringValue(branch.name) || 'النواصرة لتجارة الجملة والمواد الغذائية',
      address: stringValue(branch.address),
      phone: stringValue(branch.phone),
    },
    items: Array.isArray(payload.items)
      ? payload.items.map((item) => {
          const row = recordValue(item);
          return {
            productName: stringValue(row.productName) || 'منتج',
            sku: stringValue(row.sku),
            packageQuantity: integerValue(row.packageQuantity),
            packageName: stringValue(row.packageName) || 'طرد',
            unitsPerPackage: integerValue(row.unitsPerPackage) || 1,
            packagePriceInMinorUnits: integerValue(
              row.packagePriceInMinorUnits
            ),
            lineTotalInMinorUnits: integerValue(row.lineTotalInMinorUnits),
            commercialLineKind: stringValue(row.commercialLineKind) || undefined,
            baseQuantity: row.baseQuantity == null ? undefined : integerValue(row.baseQuantity),
            baseUnitName: stringValue(row.baseUnitName) || undefined,
            parcelInstances: Array.isArray(row.parcelInstances) ? row.parcelInstances.map((parcel) => {
              const saved = recordValue(parcel);
              return { components: Array.isArray(saved.components) ? saved.components.map((component) => {
                const value = recordValue(component);
                return { name: stringValue(value.name), quantity: integerValue(value.quantity), unitName: stringValue(value.unitName) };
              }) : [] };
            }) : [],
          };
        })
      : [],
  };
}

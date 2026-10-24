import {supabase,isSupabaseConfigured} from '../../lib/supabase';
export interface CashDocumentDisplay {id:string;reference:string;party:string;location?:string;lines:{id:string;name:string;quantity:number;unit:string}[]}
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('تفاصيل المستند غير مكتملة.');return v as Record<string,unknown>;};
const text=(v:unknown)=>{if(typeof v!=='string'||!v.trim())throw new Error('هوية المستند غير مكتملة.');return v;};
export function parseCashDocumentDisplay(value:unknown,id:string,kind:'supplier_receipt'|'purchase_order'):CashDocumentDisplay {
 const r=object(value);if(r.id!==id)throw new Error('المستند المقروء لا يطابق الحركة.');
 const receipt=kind==='supplier_receipt',lines=r[receipt?'supplier_receipt_items':'purchase_order_items'];if(!Array.isArray(lines))throw new Error('أصناف المستند غير مكتملة.');
 const party=r.suppliers?text(object(r.suppliers).company_name):'المورد',location=r.warehouses?text(object(r.warehouses).name_ar):undefined;
 return {id,reference:text(r[receipt?'receipt_number':'purchase_order_number']),party,location,lines:lines.map(value=>{const line=object(value),product=object(line.products),quantity=line[receipt?'total_base_units':'ordered_quantity'];if(typeof quantity!=='number'||!Number.isSafeInteger(quantity)||quantity<=0)throw new Error('كمية المستند غير صالحة.');return {id:text(line.id),name:text(product.name_ar),quantity,unit:receipt?text(line.base_unit_name):text(object(product.base_unit).name_ar)};})};
}
/** Existing table ACL/RLS; only document identity and quantities are selected. */
export async function fetchCashReceiptDocument(receiptId:string) {
 if(!supabase||!isSupabaseConfigured)throw new Error('قراءة المستند غير متاحة.');
 const {data,error}=await supabase.from('supplier_receipts').select('id,receipt_number,suppliers(company_name),warehouses(name_ar),supplier_receipt_items(id,total_base_units,base_unit_name,products(name_ar))').eq('id',receiptId).single();
 if(error)throw new Error('تعذر فتح سند الاستلام. أعد المحاولة.');return parseCashDocumentDisplay(data,receiptId,'supplier_receipt');
}
export async function fetchCashPurchaseDocument(poId:string) {
 if(!supabase||!isSupabaseConfigured)throw new Error('قراءة المستند غير متاحة.');
 const {data,error}=await supabase.from('purchase_orders').select('id,purchase_order_number,suppliers(company_name),warehouses(name_ar),purchase_order_items(id,ordered_quantity,products!purchase_order_items_product_id_fkey(name_ar,base_unit:units!products_unit_id_fkey(name_ar)))').eq('id',poId).single();
 if(error)throw new Error('تعذر فتح طلب الشراء. أعد المحاولة.');return parseCashDocumentDisplay(data,poId,'purchase_order');
}

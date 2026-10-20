export const SALES_HISTORY_ROLES = ['owner','admin','manager','accountant','cashier','sales','orders','delivery_driver'] as const;
export const SALES_HISTORY_PERIODS = ['day','week','month','range','all'] as const;
export type SalesHistoryPeriod = typeof SALES_HISTORY_PERIODS[number];
export type SalesHistoryMethod = 'all'|'cash'|'cliq'|'bank_transfer'|'cheque'|'card'|'debt'|'mixed'|'unknown';
export type SalesHistorySource = 'all'|'pos'|'website'|'unknown';
export interface SalesHistoryInput {
  page:number;pageSize:number;period:SalesHistoryPeriod;fromDate?:string;toDate?:string;
  paymentMethod?:SalesHistoryMethod;source?:SalesHistorySource;customerSearch?:string;numberSearch?:string;salesOnly?:boolean;
}
export interface SalesHistoryItem {
  id:string;orderNumber:string;listedAt:string;firstCompletedAt:string|null;dateBasis:'creation'|'completion';
  customerName:string;customerPhone:string;totalInMinorUnits:number;paymentMethod:string|null;
  paymentStatus:string|null;source:string|null;status:string;countsAsSale:boolean;
}
export interface SalesHistoryPage {
  generatedAt:string;timeZone:'Asia/Amman';page:number;pageSize:number;totalCount:number;totalPages:number;
  period:{kind:SalesHistoryPeriod;fromDate:string|null;toDate:string|null};rows:SalesHistoryItem[];
  summary:{invoiceCount:number;salesCount:number;salesInMinorUnits:number;undatedInvoiceCount:number};
}
/** Actual roles win over a potentially stale primary role. Fallback supports older callers. */
export function canReadSalesHistory(roles:readonly string[]|undefined,primaryRole?:string|null):boolean {
  return (roles?.length?roles:primaryRole?[primaryRole]:[]).some(role=>(SALES_HISTORY_ROLES as readonly string[]).includes(role));
}
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const timestamp=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const nullableString=(v:unknown):v is string|null=>v===null||typeof v==='string';
export function isSalesHistoryDate(value:unknown):value is string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(value))return false;
  const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
/** Fail closed on missing/rounded money or incomplete pages;never fabricate zero. */
export function parseSalesHistoryPage(value:unknown):SalesHistoryPage {
  const fail=():never=>{throw new Error('بيانات سجل المبيعات غير مكتملة. أعد التحميل.');};
  if(!record(value)||value.success!==true||!timestamp(value.generatedAt)||value.timeZone!=='Asia/Amman'
    ||!integer(value.page)||value.page<1||value.page>100000||!integer(value.pageSize)||value.pageSize<1||value.pageSize>100
    ||!integer(value.totalCount)||!integer(value.totalPages)||!record(value.summary)||!record(value.period)||!Array.isArray(value.rows))return fail();
  const s=value.summary,p=value.period;
  if(!integer(s.invoiceCount)||!integer(s.salesCount)||!integer(s.salesInMinorUnits)||!integer(s.undatedInvoiceCount)
    ||s.invoiceCount!==value.totalCount||s.salesCount>s.invoiceCount||s.undatedInvoiceCount>s.invoiceCount-s.salesCount
    ||value.totalPages!==Math.max(1,Math.ceil(value.totalCount/value.pageSize))
    ||!(SALES_HISTORY_PERIODS as readonly unknown[]).includes(p.kind)
    ||!(p.fromDate===null||isSalesHistoryDate(p.fromDate))||!(p.toDate===null||isSalesHistoryDate(p.toDate))
    ||(p.kind==='all'?(p.fromDate!==null||p.toDate!==null):(!p.fromDate||!p.toDate||p.fromDate>p.toDate))
    ||value.rows.length!==Math.min(value.pageSize,Math.max(0,value.totalCount-(value.page-1)*value.pageSize)))return fail();
  const ids=new Set<string>();
  const rows=value.rows.map((r):SalesHistoryItem=>{
    if(!record(r)||typeof r.id!=='string'||!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(r.id)||ids.has(r.id)
      ||typeof r.orderNumber!=='string'||!timestamp(r.listedAt)||!(r.firstCompletedAt===null||timestamp(r.firstCompletedAt))
      ||!['creation','completion'].includes(String(r.dateBasis))||typeof r.customerName!=='string'||typeof r.customerPhone!=='string'
      ||!integer(r.totalInMinorUnits)||!nullableString(r.paymentMethod)||!nullableString(r.paymentStatus)||!nullableString(r.source)
      ||typeof r.status!=='string'||typeof r.countsAsSale!=='boolean')return fail();
    if((r.dateBasis==='completion')!==(r.firstCompletedAt!==null)
      ||(r.firstCompletedAt!==null&&r.listedAt!==r.firstCompletedAt)
      ||r.countsAsSale!==(r.firstCompletedAt!==null&&['completed','returned'].includes(r.status)))return fail();
    ids.add(r.id);return {id:r.id,orderNumber:r.orderNumber,listedAt:r.listedAt,firstCompletedAt:r.firstCompletedAt,
      dateBasis:r.dateBasis as 'creation'|'completion',customerName:r.customerName,customerPhone:r.customerPhone,
      totalInMinorUnits:r.totalInMinorUnits,paymentMethod:r.paymentMethod,paymentStatus:r.paymentStatus,source:r.source,status:r.status,countsAsSale:r.countsAsSale};
  });
  return {generatedAt:value.generatedAt,timeZone:'Asia/Amman',page:value.page,pageSize:value.pageSize,totalCount:value.totalCount,totalPages:value.totalPages,
    period:{kind:p.kind as SalesHistoryPeriod,fromDate:p.fromDate as string|null,toDate:p.toDate as string|null},rows,
    summary:{invoiceCount:s.invoiceCount,salesCount:s.salesCount,salesInMinorUnits:s.salesInMinorUnits,undatedInvoiceCount:s.undatedInvoiceCount}};
}

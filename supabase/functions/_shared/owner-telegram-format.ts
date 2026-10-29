// Exact display contract from PR37/current reviewed n8n goldens. No transport or calculation.
export type OwnerEvent = {eventType:string;entityId?:string;payload:OwnerPayload};
export type OwnerPayload = Record<string,any>;
export type OwnerKeyboard = {rows:Array<{row:{buttons:Array<{text:string;additionalFields:{url:string}}>}}>};
export const ownerTestMessage = "<b>✅ تم ربط تنبيهات النواصرة لتجارة الجملة والمواد الغذائية بهاتفك</b>";

export function formatOwnerMessage($json:OwnerEvent):string {
 return (() => {
 const p=$json.payload||{},t=$json.eventType,missing='غير متاح';
 const plain=(v:unknown,limit=80)=>{
  if(v===null||v===undefined||!['string','number','bigint'].includes(typeof v))return missing;
  // Reviewed PR37 sanitizer deliberately removes ASCII/bidi control characters.
  // eslint-disable-next-line no-control-regex
  const s=String(v).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').trim();
  return s?Array.from(s).slice(0,limit).join(''):missing;
 };
 const h=(v:unknown,limit=80)=>plain(v,limit).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 const integer=(v:unknown)=>{
  if(typeof v==='number'&&!Number.isSafeInteger(v))return null;
  if(!['string','number','bigint'].includes(typeof v))return null;
  const s=String(v).trim();return /^-?\d{1,80}$/.test(s)?BigInt(s):null;
 };
 const grouped=(s:string)=>s.replace(/\B(?=(\d{3})+(?!\d))/g,',');
 const money=(v:unknown)=>{
  const n=integer(v);if(n===null)return missing;
  const a=n<BigInt(0)?-n:n;
  return (n<BigInt(0)?'−':'')+grouped(String(a/BigInt(1000)))+'.'+String(a%BigInt(1000)).padStart(3,'0')+' د.أ';
 };
 const quantity=(v:unknown,unit?:unknown)=>{
  if(typeof v==='number'&&(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER))return missing;
  if(!['string','number','bigint'].includes(typeof v))return missing;
  const raw=String(v).trim();if(!/^-?\d{1,80}(?:\.\d{1,6})?$/.test(raw))return missing;
  const negative=raw.startsWith('-'),parts=(negative?raw.slice(1):raw).split('.');
  return (negative?'−':'')+grouped(parts[0])+(parts[1]?'.'+parts[1]:'')+(unit?' '+plain(unit):'');
 };
 const m=(v:unknown)=>h(money(v),160);
 const q=(v:unknown,unit?:unknown)=>h(quantity(v,unit),240);
 const available=()=>{
  if(p.parcelQuantity!==undefined&&p.unitQuantity!==undefined){
   const parcels=quantity(p.parcelQuantity,'طرد'),units=quantity(p.unitQuantity,p.unitName||p.baseUnitName||'حبة');
   if(parcels!==missing&&units!==missing)return parcels+' + '+units;
  }
  return quantity(p.availableQuantity,p.unitName||p.baseUnitName);
 };
 const weekdays:Record<string,string>={Sun:'الأحد',Mon:'الإثنين',Tue:'الثلاثاء',Wed:'الأربعاء',Thu:'الخميس',Fri:'الجمعة',Sat:'السبت'};
 const months=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
 const dateParts=(value:unknown)=>{
  if(typeof value!=='string')return null;
  let date;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value)){
   date=new Date(value+'T12:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)return null;
  }else if(/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value))date=new Date(value);
  else return null;
  if(!Number.isFinite(date.getTime()))return null;
  return Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Amman',weekday:'short',day:'numeric',month:'numeric',year:'numeric'}).formatToParts(date).map(x=>[x.type,x.value]));
 };
 const dateText=(parts:Record<string,string>|null,year=false)=>parts?weekdays[parts.weekday]+' '+parts.day+' '+months[parseInt(parts.month,10)-1]+(year?' '+parts.year:''):missing;
 const range=(from:unknown,to:unknown)=>{
  const a=dateParts(from),b=dateParts(to),same=a&&b&&a.year===b.year&&a.month===b.month&&a.day===b.day;
  const years=Boolean(a&&b&&a.year!==b.year);
  return same||!to?dateText(a,years):dateText(a,years)+' — '+dateText(b,years);
 };
 const titles:Record<string,string>={business_daily_summary:'📊 ملخص اليوم',business_weekly_summary:'📊 ملخص الأسبوع',new_order:'🛍️ طلب جديد',order_unprocessed:'⏰ طلب متأخر',order_near_expiry:'⏰ طلب قريب الانتهاء',order_expired:'⏰ طلب منتهي',low_stock:'⚠️ مخزون منخفض',out_of_stock:'⛔ نفد المخزون',shift_closed:'🔒 أُغلقت الوردية',shift_close_reminder:'🕐 تذكير وردية',shift_close_overdue:'🕐 وردية متأخرة',expense_daily_threshold:'💸 حد المصروف',cheque_due:'🧾 شيك مستحق',cheque_returned:'↩️ شيك راجع',purchase_order_overdue:'📦 أمر شراء متأخر'};
 if(!(typeof t==='string'&&Object.hasOwn(titles,t))&&!(t==='business_alert_recovery'&&typeof p.resolvedAlertType==='string'&&Object.hasOwn(titles,p.resolvedAlertType)))throw new Error('OWNER_BUSINESS_EVENT_NOT_ALLOWED');
 const title='<b>'+(t==='business_alert_recovery'?'✅ تمت المعالجة':titles[t])+'</b>';
 let sections:string[];
 if(t==='business_daily_summary'||t==='business_weekly_summary'){
  const s=p.sales||{},f=p.cashFlow||{},e=p.expenses||{},i=p.inventory||{},b=p.balances||{};
  sections=[title+'\n<i>'+h(range(p.period?.dateFrom,p.period?.dateTo))+'</i>',
   '<b>المبيعات</b>\nالصافي: '+m(s.netSalesInMinorUnits)+'\n(مبيعات '+m(s.grossSalesInMinorUnits)+' − مرتجعات '+m(s.returnEntitlementInMinorUnits??s.refundsInMinorUnits)+')',
   '<b>المقبوض</b>\nكاش: '+m(f.cashCollectedInMinorUnits)+'\nCliQ: '+m(f.cliqCollectedInMinorUnits),
   '<b>المصاريف</b>\n'+m(e.totalInMinorUnits),
   '<b>صافي الربح</b>\n'+m(s.netProfitInMinorUnits),
   '<b>المخزون</b>\nمنخفض: '+q(i.lowStockCount)+' | نافد: '+q(i.outOfStockCount),
   '<b>الذمم</b>\nعلى الزبائن: '+m(b.customerDueInMinorUnits)+'\nللموردين: '+m(b.supplierDueInMinorUnits)];
  const supplied=Array.isArray(i.lowStockItems)?i.lowStockItems:Array.isArray(i.lowStockProducts)?i.lowStockProducts:[];
  const names=supplied.slice(0,3).map((x:any)=>typeof x==='string'?h(x):h(x?.productName??x?.name)).filter((x:string)=>x!==missing);
  if(names.length)sections[5]+='\n'+names.map((x:string)=>'• '+x).join('\n');
 }else if(['new_order','order_unprocessed','order_near_expiry','order_expired'].includes(t)){
  const lines=[title,'رقم الطلب: '+h(p.orderNumber)];
  if(t==='new_order')lines.push('الإجمالي: '+m(p.totalInMinorUnits),'الدفع: '+(p.paymentMethod==='cliq'?'CliQ':p.paymentMethod==='cash_on_delivery'?'كاش عند الاستلام':missing));
  sections=[lines.join('\n')];
 }else if(t==='low_stock'||t==='out_of_stock')sections=[[title,'الصنف: '+h(p.productName),'المتاح: '+h(available(),480),'حد التنبيه: '+q(p.thresholdQuantity,p.unitName||p.baseUnitName),'المستودع: '+h(p.warehouseName)].join('\n')];
 else if(t==='shift_closed'){
  const absolute=integer(p.cashDiscrepancyAbsoluteInMinorUnits??p.cashDiscrepancyInMinorUnits);
  let discrepancy=missing;
  if(absolute!==null){const a=absolute<BigInt(0)?-absolute:absolute;if(a===BigInt(0))discrepancy='مطابق';else if(p.cashDiscrepancyDirection==='surplus')discrepancy='زيادة '+money(a);else if(p.cashDiscrepancyDirection==='shortage')discrepancy='نقص '+money(a);}
  sections=[[title,'رقم الوردية: '+h(p.shiftNumber),'المتوقع: '+m(p.expectedCashInMinorUnits),'الفعلي: '+m(p.actualCashInMinorUnits),'فرق الدرج: '+h(discrepancy,180)].join('\n')];
 }else if(t==='shift_close_reminder'||t==='shift_close_overdue')sections=[title+'\nرقم الوردية: '+h(p.shiftNumber)];
 else if(t==='purchase_order_overdue')sections=[[title,'الرقم: '+h(p.purchaseOrderNumber),'المورد: '+h(p.supplierName)].join('\n')];
 else if(t==='expense_daily_threshold')sections=[[title,'الفرع: '+h(p.branchName),'مصروف اليوم: '+m(p.dailyTotalInMinorUnits),'الحد: '+m(p.thresholdInMinorUnits)].join('\n')];
 else if(t==='cheque_due'||t==='cheque_returned')sections=[[title,'المرجع: '+h(p.trackingNumber),'المبلغ: '+m(p.amountInMinorUnits),'الاستحقاق: '+h(dateText(dateParts(p.dueDate)))].join('\n')];
 else sections=[title+'\n'+h(titles[p.resolvedAlertType])];
 const result=sections.join('\n\n');if(result.length>=4096)throw new Error('OWNER_MESSAGE_TOO_LONG');return result;
})();
}

export function formatOwnerKeyboard($json:OwnerEvent):OwnerKeyboard {
 return (() => {
 const p=$json.payload||{},t=$json.eventType;
 const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
 const base='https://admin.alnawasreh.com/';let text='',path='';
 if(['low_stock','out_of_stock'].includes(t)&&uuid(p.productId)){text='افتح المخزون';path='?screen=inventory';}
 else if(uuid($json.entityId)){
  if(['new_order','order_unprocessed','order_near_expiry','order_expired'].includes(t)){text='افتح الطلب';path='?screen=orders&order='+encodeURIComponent($json.entityId);}
  else if(['cheque_due','cheque_returned'].includes(t)){text='افتح الشيكات';path='?screen=cheques';}
  else if(['shift_closed','shift_close_reminder','shift_close_overdue'].includes(t)){text='افتح الورديات';path='?screen=shifts';}
  else if(['business_daily_summary','business_weekly_summary','expense_daily_threshold','business_alert_recovery'].includes(t)){text='افتح التقارير';path='?screen=reports';}
 }
 return {rows:text?[{row:{buttons:[{text,additionalFields:{url:base+path} }]} }]:[]};
})();
}

export function ownerInlineKeyboard(event:OwnerEvent):{inline_keyboard:Array<Array<{text:string;url:string}>>} {
 return {inline_keyboard:formatOwnerKeyboard(event).rows.map(row=>row.row.buttons.map(button=>({text:button.text,url:button.additionalFields.url})))};
}

/** Offline preparation only. No database client, environment loader or network. */
import {readXlsxFirstSheet, readZip, columnIndex, XLSX_MAX_BYTES} from '../../../src/lib/xlsx';
import {GO_LIVE_COLUMNS, mapSheet, prepareProducts, prepareStock, prepareCustomers, prepareSuppliers, parseJodToMinor, ammanToday, type GoLiveKind, type SheetRow, type RowError} from '../../../src/features/goLive/goLiveImport';
import {prepareOpeningChequeSheet} from '../../../src/features/goLive/openingChequesImport';
import {normalizeImageSku, imageFileSku} from '../../../src/features/products/bulkImages/model';

export const INPUT_FILES={products:'المنتجات.xlsx',stock:'البضاعة-الموجودة.xlsx',suppliers:'أرصدة-الموردين.xlsx',customers:'ديون-العملاء.xlsx',cheques:'شيكات-البداية.xlsx',drawer:'الدرج-الافتتاحي.xlsx'} as const;
export type Kind=keyof typeof INPUT_FILES;
export interface Party {id:string;name:string;phone:string;active:boolean}
export interface LocalProduct {sku:string;barcode:string;name:string;unitsPerPackage:number;costInMinor:string;eligible:boolean;imageUrl?:string}
export interface LocalReference {format:1;asOf:string;categories:{name:string;active:boolean}[];units:{code:string;name:string}[];products:LocalProduct[];customers:Party[];suppliers:Party[];chequeKeys:{kind:'customer'|'supplier';partyId:string;bank:string;number:string}[]}
export interface Issue {file:string;row:number;column:string;severity:'error'|'warning'|'incomplete';reason:string;fix:string}
export interface ImageInput {name:string;size:number}
export interface FileInput {name:string;bytes:Uint8Array}
const money=(value:bigint)=>{const sign=value<0n?'-':'';const n=value<0n?-value:value;return sign+(n/1000n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu,',')+'.'+(n%1000n).toString().padStart(3,'0')+' د.أ';};
export const normalizePhone=(s:string)=>{let n=s.trim().replace(/[^0-9]/gu,'');if(n.startsWith('00962'))n=n.slice(2);return /^962[0-9]{9}$/u.test(n)?'0'+n.slice(3):/^7[0-9]{8}$/u.test(n)?'0'+n:n;};
export const normalizeName=(s:string)=>{const from='أإآٱةىؤئ \u0640\u064b\u064c\u064d\u064e\u064f\u0650\u0651\u0652',to='ااااهيوي';return [...s.trim().toLowerCase()].map(c=>{const at=from.indexOf(c);return at<0?c:to[at]??'';}).join('');};
const text=(v:unknown):v is string=>typeof v==='string';
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
export function validReference(v:unknown):v is LocalReference {
 if(!object(v)||v.format!==1||!text(v.asOf)||!/^\d{4}-\d{2}-\d{2}$/u.test(v.asOf))return false;
 const list=(key:string,predicate:(r:unknown)=>boolean)=>Array.isArray(v[key])&&(v[key] as unknown[]).every(predicate);
 return list('categories',r=>object(r)&&text(r.name)&&typeof r.active==='boolean')&&list('units',r=>object(r)&&text(r.code)&&text(r.name))
 &&list('products',r=>object(r)&&['sku','barcode','name','costInMinor'].every(k=>text(r[k]))&&typeof r.unitsPerPackage==='number'&&Number.isSafeInteger(r.unitsPerPackage)&&r.unitsPerPackage>=1&&r.unitsPerPackage<=999999&&/^[0-9]{1,12}$/u.test(String(r.costInMinor))&&typeof r.eligible==='boolean'&&(r.imageUrl===undefined||text(r.imageUrl)))
 &&['customers','suppliers'].every(k=>list(k,r=>object(r)&&['id','name','phone'].every(k=>text(r[k]))&&typeof r.active==='boolean'))
 &&list('chequeKeys',r=>object(r)&&['customer','supplier'].includes(String(r.kind))&&['partyId','bank','number'].every(k=>text(r[k])));
}
function columnFor(kind:Kind,error:RowError):string {
 const m=error.message;if(error.row===1)return 'رؤوس الأعمدة';const quoted=/"([^"]+)"/u.exec(m)?.[1];if(quoted)return quoted;
 if(kind==='cheques')return m.includes('تاريخ')?m.split(': ').at(-1)!:'المبلغ (د.أ)';
 if(m.includes('SKU'))return 'رمز الصنف SKU';if(m.includes('الباركود'))return 'الباركود';
 if(m.includes('سعر بيع'))return 'سعر بيع الطرد (د.أ)';if(m.includes('التكلفة')||m.includes('سعر الشراء'))return 'سعر شراء الطرد / تكلفة الباكيت (د.أ)';
 if(m.includes('الطرد')&&kind==='products')return 'عدد الباكيتات في طرد الشراء / البيع';if(m.includes('الحد الأدنى'))return 'الحد الأدنى للمخزون (باكيت)';
 if(m.includes('الاتجاه'))return 'الاتجاه (له/عليه)';if(m.includes('تاريخ'))return kind==='customers'?'تاريخ الدين الأصلي':'تاريخ الرصيد الأصلي';
 if(m.includes('الملاحظة'))return 'ملاحظة';if(kind==='stock')return m.includes('الإضافية')?'الباكيتات الإضافية':'الباركود أو SKU / عدد الطرود';
 if(m.includes('مبلغ')||m.includes('المبلغ'))return kind==='customers'?'مبلغ الدين (د.أ)':'المبلغ (د.أ)';return 'السطر';
}
const fixFor=(reason:string)=>reason.includes('العمود')||reason.includes('القالب')?'أعد عناوين القالب المعتمد؛ لا تضع ورقة التعليمات أولاً.':reason.includes('مكرر')?'راجع السطر المشار إليه وأزل التكرار أو صحح الرمز/الطرف؛ لا تجمع ديون تواريخ مختلفة.':reason.includes('تاريخ')?'اكتب تاريخاً صالحاً كما في القالب، وراجع تاريخ الأصل لا تاريخ الإدخال.':reason.includes('ثلاث')?'اكتب المبلغ بالدينار بثلاث منازل كحد أقصى، بلا تقريب لإخفاء خطأ.':reason.includes('الصنف')||reason.includes('رمز')?'طابق رمز الصنف أو النكهة مع ملف المنتجات/المرجع المحلي، ولا تطابق بالاسم.':'صحح الخانة وفق السبب وقالبها، ثم أعد الفحص ومعاينة النظام يوم الإدخال.';
export async function checkFiles(inputs:Partial<Record<Kind,FileInput>>,reference:unknown,images?:ImageInput[],today=ammanToday(),options:{noOpeningCheques?:boolean}={}) {
 const issues:Issue[]=[];const add=(kind:Kind|'reference'|'images',row:number,column:string,reason:string,severity:Issue['severity']='error',fix=fixFor(reason))=>issues.push({file:kind in INPUT_FILES?INPUT_FILES[kind as Kind]:kind==='reference'?'المرجع المحلي':'مجلد الصور',row,column,severity,reason,fix});
 const ref=validReference(reference)?reference:null;
 if(!ref)add('reference',0,'المرجع','المرجع المحلي غائب أو غير مكتمل؛ لم تُثبت الأقسام والوحدات والأطراف الحالية.','incomplete','جهّز reference.json وفق الدليل من القوائم المعتمدة المحفوظة محلياً؛ لا تستخدم مثالاً كمرجع حي.');
 if(ref&&ref.asOf!==today)add('reference',0,'asOf','المرجع بتاريخ مختلف عن يوم الفحص؛ راجع أنه ما زال يمثل القوائم المحفوظة.','warning','حدّث المرجع يدوياً من قوائم معتمدة؛ لا تغيّر التاريخ وحده لإسكات التحذير.');
 const sheets:Partial<Record<Kind,string[][]>>={},rows:Partial<Record<GoLiveKind,SheetRow[]>>={},counts:Partial<Record<Kind,number>>={};
 for(const kind of Object.keys(INPUT_FILES) as Kind[]){const input=inputs[kind];if(!input){if(kind!=='cheques'||!options.noOpeningCheques)add(kind,0,'الملف','ملف القالب غير موجود.');continue;}
  if(input.bytes.length>XLSX_MAX_BYTES){add(kind,0,'الملف','حجم الملف أكبر من 5 ميغابايت.');continue;}
  try{sheets[kind]=await readXlsxFirstSheet(input.bytes);}catch{add(kind,0,'الملف','تعذر قراءة XLSX صالح ضمن حدود قارئ النظام.');continue;}
  if(['products','stock','customers','suppliers'].includes(kind)){const mapped=mapSheet(kind as GoLiveKind,sheets[kind]!);rows[kind as GoLiveKind]=mapped.rows;counts[kind]=mapped.rows.length;for(const m of mapped.fileErrors)add(kind,1,'رؤوس الأعمدة',m);}
  // Detect unsafe identifier cell types without changing the authoritative reader.
  const files=await readZip(input.bytes,n=>n==='xl/workbook.xml'||n==='xl/_rels/workbook.xml.rels'||/^xl\/worksheets\/[^/]+\.xml$/u.test(n));
  const xmlText=(name:string)=>new TextDecoder().decode(files.get(name)??new Uint8Array());
  const firstTag=/<(?:\w+:)?sheet\s[^>]*>/u.exec(xmlText('xl/workbook.xml'))?.[0]??'';
  const firstId=/\br:id="([^"]+)"/u.exec(firstTag)?.[1];
  let firstPath='xl/worksheets/sheet1.xml';
  for(const match of xmlText('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/gu))if(match[0].includes(`Id="${firstId}"`)){
   const target=/Target="([^"]+)"/u.exec(match[0])?.[1]??'';firstPath=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//u,'');
  }
  const headers=sheets[kind]![0]??[];const identifierHeaders=new Set(['رمز الصنف SKU','الباركود','الباركود أو SKU','هاتف العميل','هاتف المورد','رقم الشيك']);
  // Values from only the actual first-sheet reader; a numeric warning is not a new rejection rule.
  for(const match of xmlText(firstPath).matchAll(/<c\b([^>]*?)>([\s\S]*?)<\/c>/gu)){
   const coord=/\br="([A-Z]+)(\d+)"/u.exec(match[1]);if(!coord||Number(coord[2])<2)continue;const h=headers[columnIndex(coord[1])];
   if(identifierHeaders.has(h)&&! /\bt="(?:s|inlineStr|str)"/u.test(match[1])&&/<v>[^<]+<\/v>/u.test(match[2]))add(kind,Number(coord[2]),h,'الخانة محفوظة كرقم؛ الأصفار البادئة أو الأرقام بعد الخانة15 قد تكون فُقدت قبل الفحص.','warning','قارن بالأصل وأعد كتابة المعرف كنص؛ تغيير تنسيق رقم فقد أصفاره لا يعيدها.');
  }
 }
 const prepared={products:prepareProducts(rows.products??[]),customers:prepareCustomers(rows.customers??[],today),suppliers:prepareSuppliers(rows.suppliers??[],today)};
 for(const kind of ['products','customers','suppliers'] as const)for(const e of prepared[kind].errors)add(kind,e.row,columnFor(kind,e),e.message);
 const products:LocalProduct[]=[...(ref?.products??[])],productCosts=new Map<string,string>();
 const productRows=prepared.products.payload;
 for(const r of productRows){const test=(column:string,reason:string)=>add('products',r.sourceRow,column,reason);
  if(r.sku.length>64)test('رمز الصنف SKU','رمز الصنف SKU مطلوب وبحد أقصى 64 حرفاً.');if(r.name_ar.length>200)test('اسم المنتج','اسم المنتج أطول من 200 حرف.');if(r.barcode.length>64)test('الباركود','الباركود أطول من64 حرفاً.');
  if(ref){const categories=ref.categories.filter(c=>c.active&&c.name===r.category_name);if(categories.length!==1)test('القسم',categories.length?'اسم القسم مكرر في المرجع؛ صحح الأقسام أولاً.':'القسم غير موجود؛ أضفه أولاً أو صحّح اسمه.');
   for(const key of ['base_unit_name','purchase_unit_name','sale_unit_name'] as const){const value=r[key];const byCode=ref.units.filter(u=>u.code.toUpperCase()===value.toUpperCase());const matches=byCode.length?byCode:ref.units.filter(u=>u.name===value);if(matches.length!==1)test(GO_LIVE_COLUMNS.products.find(c=>c.key===key)!.header,'الوحدة غير موجودة أو اسمها مكرر؛ اكتب رمز الوحدة الصحيح مثل PKT/CTN.');}
   if(ref.products.some(p=>p.sku.toLowerCase()===r.sku.toLowerCase()))test('رمز الصنف SKU','رمز SKU مستخدم لمنتج موجود في المرجع.');if(r.barcode&&ref.products.some(p=>p.barcode===r.barcode))test('الباركود','الباركود مستخدم لمنتج موجود في المرجع.');
  }
  products.push({sku:r.sku,barcode:r.barcode,name:r.name_ar,unitsPerPackage:Number(r.units_per_purchase_unit),costInMinor:r.cost_per_base_unit_in_minor_units,eligible:true});
 }
 const seenBarcode=new Map<string,number>();for(const r of productRows){if(r.barcode){if(seenBarcode.has(r.barcode))add('products',r.sourceRow,'الباركود',`الباركود مكرر داخل الملف (السطر ${seenBarcode.get(r.barcode)}).`);else seenBarcode.set(r.barcode,r.sourceRow);}}
 const refs=products.map((p,i)=>{const id='local-product-'+i;productCosts.set(id,p.costInMinor);return{productId:id,sku:p.sku,barcode:p.barcode,productName:p.name,unitsPerPackage:p.unitsPerPackage,costPriceInMinorUnits:Number(p.costInMinor),eligible:p.eligible};});
 const stock=prepareStock(rows.stock??[],refs);for(const e of stock.errors)add('stock',e.row,columnFor('stock',e),e.message);
 const parties={customers:[...(ref?.customers??[])],suppliers:[...(ref?.suppliers??[])]};
 for(const kind of ['customers','suppliers'] as const){const seen=new Map<string,number>(),newNames=new Map<string,string>();
  for(const row of prepared[kind].payload){const r=row as unknown as Record<string,string|number>,name=String(r[kind==='customers'?'customer_name':'supplier_name']??''),phone=normalizePhone(String(r[kind==='customers'?'customer_phone':'supplier_phone']??''));const existing=(ref?.[kind]??[]).filter(p=>p.active);let key='';
   if(name.length>150)add(kind,row.sourceRow,'الاسم','اسم الطرف أطول من150 حرفاً.');if(String(r.notes??'').length>300)add(kind,row.sourceRow,'ملاحظة','الملاحظة أطول من300 حرف.');
   const candidates=phone?existing.filter(p=>normalizePhone(p.phone)===phone):existing.filter(p=>p.name.trim()===name);
   if(candidates.length>1)add(kind,row.sourceRow,'الاسم / الهاتف','الطرف غير فريد؛ اختره يدوياً أو صحح الهاتف.');
   else if(candidates.length===1)key=candidates[0].id;
   else{const similar=existing.some(p=>normalizeName(p.name)===normalizeName(name));if(similar)add(kind,row.sourceRow,'الاسم / الهاتف','اسم مطابق أو مشابه بهاتف مختلف؛ لن يُنشأ طرف مكرر.');else if(kind==='customers'&&(!name||!phone||!/^\d{9,15}$/u.test(phone)))add(kind,row.sourceRow,'هاتف العميل / اسم العميل','العميل غير موجود؛ الاسم وهاتف صحيح مطلوبان لإضافته.');else if(!name)add(kind,row.sourceRow,'اسم المورد','اسم المورد مطلوب لإضافته.');else{const newKey=kind==='customers'?phone:normalizeName(name);key='new:'+kind+':'+newKey;if(newNames.has(key)&&newNames.get(key)!==normalizeName(name))add(kind,row.sourceRow,'الاسم / الهاتف','نفس الهاتف الجديد ورد باسم آخر؛ وحّد الاسم أو الهاتف.');newNames.set(key,normalizeName(name));if(!parties[kind].some(p=>p.id===key))parties[kind].push({id:key,name,phone,active:true});}}
   if(key){const unique=kind==='customers'?key+':'+r.original_debt_date+':'+r.amount_in_minor_units:key;if(seen.has(unique))add(kind,row.sourceRow,'الاسم / الهاتف',`سطر مكرر لنفس الطرف${kind==='customers'?' والتاريخ والمبلغ':''} (السطر ${seen.get(unique)}).`);else seen.set(unique,row.sourceRow);}
  }
 }
 let chequeTotal=0n;const noChequeRows=!(sheets.cheques??[]).slice(1).some(row=>row.some(c=>c.trim()));const chequeRows=options.noOpeningCheques&&noChequeRows?{rows:[],errors:[]}:prepareOpeningChequeSheet(sheets.cheques??[]);if(options.noOpeningCheques&&!noChequeRows)add('cheques',1,'الملف','تأكيد عدم وجود شيكات يتعارض مع ملف يحوي أسطراً؛ أزل التأكيد أو راجع الملف.');counts.cheques=chequeRows.rows.length;for(const e of chequeRows.errors)add('cheques',e.row,columnFor('cheques',e),e.message);
 if(chequeRows.rows.length>500)add('cheques',1,'الملف','شيكات البداية تقبل500 سطر كحد أقصى.');
 const chequeSeen=new Set((ref?.chequeKeys??[]).map(k=>[k.kind,k.partyId,k.bank.toLowerCase(),k.number].join('|')));
 for(const r of chequeRows.rows){const n=r.sourceRow as number,bank=String(r.bank_name??''),number=String(r.cheque_number??''),status=String(r.initial_status||'pending');
  if(!['incoming','outgoing'].includes(String(r.direction))||!['pending','endorsed'].includes(status)||(r.direction==='outgoing'&&status==='endorsed'))add('cheques',n,'الاتجاه / الحالة','اختر وارد أو صادر، وقيد الانتظار أو وارد مجيّر فقط.');
  if(!bank||bank.length>120||!number||number.length>80)add('cheques',n,'البنك / رقم الشيك','اسم البنك ورقم الشيك مطلوبان ضمن120/80 حرفاً.');if(String(r.notes??'').length>500)add('cheques',n,'ملاحظة','الملاحظة لا تتجاوز500 حرف.');
  const resolve=(kind:'customers'|'suppliers',name:string,phone='')=>{const matches=parties[kind].filter(p=>(kind==='suppliers'||p.active)&&(!phone||p.phone===phone)&&(!name||normalizeName(p.name)===normalizeName(name)));if((!name&&!phone)||matches.length!==1){add('cheques',n,kind==='customers'?'اسم العميل / هاتف العميل':'اسم المورد','الطرف غير موجود أو غير فريد؛ صحح الاسم والهاتف أو اختره من القائمة.');return;}
   const k=[kind==='customers'?'customer':'supplier',matches[0].id,bank.toLowerCase(),number].join('|');if(chequeSeen.has(k))add('cheques',n,'رقم الشيك','الشيك مكرر للطرف والبنك والرقم.');chequeSeen.add(k);};
  if(r.direction==='incoming'){if(r.supplier_name)add('cheques',n,'اسم المورد للصادر','الوارد يرتبط بالزبون؛ استخدم حقل المورد المجيّر له.');resolve('customers',String(r.customer_name??''),String(r.customer_phone??''));if(status==='endorsed')resolve('suppliers',String(r.endorsed_supplier_name??''));else if(r.endorsed_supplier_name)add('cheques',n,'المورد المجيّر له','اختر حالة مجيّر عند تحديد مورد التجيير.');}
  if(r.direction==='outgoing'){if(r.customer_name||r.customer_phone||r.endorsed_supplier_name)add('cheques',n,'الطرف','الصادر يرتبط بمورد واحد فقط.');resolve('suppliers',String(r.supplier_name??''));}
  if(r.amount_in_minor_units&&/^\d+$/u.test(String(r.amount_in_minor_units)))chequeTotal+=BigInt(String(r.amount_in_minor_units));
 }
 let drawer:string|null=null;const drawerSheet=sheets.drawer??[],drawerRows=drawerSheet.slice(1).filter(r=>r.some(c=>c.trim()));counts.drawer=drawerRows.length;
 if(drawerSheet[0]?.length!==1||drawerSheet[0]?.[0]!=='العهدة الافتتاحية (د.أ)'||drawerRows.length!==1)add('drawer',1,'العهدة الافتتاحية (د.أ)','ملف العد اليدوي يحتاج عنوان القالب ومبلغ درج واحد فقط.');else{drawer=parseJodToMinor(drawerRows[0][0]??'');if(drawer===null)add('drawer',2,'العهدة الافتتاحية (د.أ)','اكتب مبلغاً غير سالب بثلاث منازل كحد أقصى للتحضير اليدوي.');}
 if(images){if(images.length>500)add('images',0,'المجلد','رفع الصور يقبل500 ملف للدفعة؛ قسّم المجلد.');const seen=new Map<string,number>();const normalized=new Map<string,LocalProduct[]>();for(const p of products){const sku=normalizeImageSku(p.sku);normalized.set(sku,[...(normalized.get(sku)??[]),p]);}for(const [i,f]of images.entries()){const firstIssue=issues.length;const sku=imageFileSku(f.name),m=normalized.get(sku)??[];if(!/\.(jpe?g|png|webp)$/iu.test(f.name)||!sku)add('images',i+1,'اسم الملف','صيغة الصورة ليست JPG/PNG/WebP باسم رمز الصنف.');if(f.size>5*1024**2||f.size<=0)add('images',i+1,'الحجم','حجم الصورة يجب أن يكون موجباً وحتى5MB.');if(seen.has(sku))add('images',i+1,'اسم الملف',`ملفان لنفس الرمز بعد التطبيع (الملف ${seen.get(sku)}).`);else seen.set(sku,i+1);if(m.length!==1)add('images',i+1,'اسم الملف',m.length?'رمز الصورة يطابق أكثر من منتج.':'لا يوجد منتج أو نكهة برمز اسم الملف.');for(let k=firstIssue;k<issues.length;k++)issues[k].file=f.name;}for(const _product of products.filter(p=>p.eligible&&!p.imageUrl&&!seen.has(normalizeImageSku(p.sku))))add('images',0,'صور ناقصة','يوجد منتج نشط بلا صورة في المجلد أو المرجع.','warning','راجع جدول المنتجات والصور؛ الصورة اختيارية ولا نطابق باسم المنتج.');}
 const sum=(kind:'customers'|'suppliers',direction?:string)=>prepared[kind].payload.reduce((s,r)=>!issues.some(i=>i.file===INPUT_FILES[kind]&&i.row===r.sourceRow&&i.severity==='error')&&(!direction||('direction'in r&&r.direction===direction))?s+BigInt(r.amount_in_minor_units):s,0n);
 const stockValue=stock.payload.reduce((s,r)=>s+BigInt(r.baseQuantity)*BigInt(productCosts.get(r.productId)??'0'),0n);
 const totals={stockValueInMinor:stockValue.toString(),customerDebtInMinor:sum('customers').toString(),supplierPayableInMinor:sum('suppliers','payable').toString(),supplierAdvanceInMinor:sum('suppliers','advance').toString(),chequesInMinor:chequeTotal.toString(),drawerInMinor:drawer};
 return {format:1,noOpeningCheques:options.noOpeningCheques===true,ok:!issues.some(i=>i.severity!=='warning'),offline:true,databaseWrites:0,referenceDate:ref?.asOf??null,checkedDate:today,counts,productCount:productRows.length,totals,issues,limits:['فحص تحضيري محلي؛ لا يثبت أن المرجع يطابق الحالة الحية. تبقى معاينة النظام المحمية يوم الإدخال إلزامية.','المجاميع تخص الأسطر المحضّرة؛ إذا وُجد خطأ فهي مؤقتة وليست توقيع قبول.','الأصفار المفقودة داخل Excel لا يمكن استعادتها، والصور تُفحص بالاسم والحجم فقط؛ فك الصورة وضغطها في واجهة الرفع.','النكهات لا يستوردها قالب المنتجات؛ أضف تعريفاتها يدوياً للمرجع بعد تحضيرها من النموذج.']};
}
export function arabicReport(report:Awaited<ReturnType<typeof checkFiles>>):string {
 const heading=report.ok?'اجتاز الفحص التحضيري المحلي':'لم يجتز الفحص التحضيري المحلي';
 return ['# فحص ملفات بداية التشغيل',heading,'بلا اتصال وبلا كتابة على قاعدة بيانات.','تاريخ الفحص: '+report.checkedDate,'','## الملخص',`عدد المنتجات المحضّرة: ${report.productCount}`,`قيمة المخزون المحضّر: ${money(BigInt(report.totals.stockValueInMinor))}`,`ديون العملاء الصالحة محلياً: ${money(BigInt(report.totals.customerDebtInMinor))}`,`للموردين علينا: ${money(BigInt(report.totals.supplierPayableInMinor))}`,`على الموردين لنا: ${money(BigInt(report.totals.supplierAdvanceInMinor))}`,`مجموع الشيكات للمتابعة فقط: ${money(BigInt(report.totals.chequesInMinor))}`,`الدرج للتحضير اليدوي فقط: ${report.totals.drawerInMinor===null?'غير متاح':money(BigInt(report.totals.drawerInMinor))}`,'','## النتائج',...report.issues.map(i=>`- ${i.severity==='error'?'خطأ':i.severity==='warning'?'تنبيه':'غير مكتمل'} | ${i.file} | صف ${i.row||'—'} | ${i.column}: ${i.reason} الحل: ${i.fix}`),'','## حدود الفحص',...report.limits.map(l=>'- '+l),''].join('\n');
}

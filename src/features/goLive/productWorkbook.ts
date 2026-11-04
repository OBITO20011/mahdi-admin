/** Workbook presentation/validation only. Existing RPCs remain authoritative. */
import {GO_LIVE_COLUMNS,mapSheet,prepareProducts,parseJodToMinor,parseWholeNumber,normalizeDigits,type GoLiveColumn,type RowError,type ProductPayload} from './goLiveImport';
import {readXlsxFirstSheet,readXlsxSheet} from '../../lib/xlsx';
const renamed:Record<string,string>={sale_package_price:'سعر بيع الطرد للزبون (د.أ)',purchase_package_price:'سعر شراء الطرد من المورد (د.أ)',cost_per_base_unit:'سعر شراء الباكيت (التكلفة) (د.أ)',units_per_sale_unit:'كم باكيت في طرد البيع',units_per_purchase_unit:'كم باكيت في طرد الشراء'};
export const PRODUCT_WORKBOOK_COLUMNS:readonly GoLiveColumn[]=[...GO_LIVE_COLUMNS.products.map(c=>({...c,header:renamed[c.key]??c.header})),
 {key:'sale_method',header:'طريقة البيع (طرد/باكيت مفرد/الاثنين)',required:false,example:'الاثنين',width:30},
 {key:'packet_price',header:'سعر بيع الباكيت المفرد (د.أ)',required:false,example:'0.250',width:28},
 {key:'brand_name',header:'العلامة التجارية',required:false,example:'',width:24},
 {key:'description',header:'وصف المنتج',required:false,example:'منتج وهمي؛ احذف المثال',width:38},
 {key:'warehouse_code',header:'رمز المستودع للجرد الافتتاحي',required:false,example:'WH-MAIN',width:28},
 {key:'max_stock_level',header:'سقف المستودع (باكيت)',required:false,example:'',width:24},
 {key:'opening_stock',header:'المخزون (باكيت) اختياري بعد الجرد',required:false,example:'',width:30}];
export const FLAVOR_WORKBOOK_COLUMNS:readonly GoLiveColumn[]=[
 {key:'master_sku',header:'رمز المنتج الأساسي',required:true,example:'CHO-001',width:24},
 {key:'name',header:'اسم النكهة',required:true,example:'ليمون',width:24},
 {key:'barcode',header:'باركود النكهة',required:false,example:'',width:24},
 {key:'sku',header:'رمز النكهة (اختياري)',required:false,example:'',width:30},
 {key:'opening_stock',header:'المخزون (باكيت) اختياري بعد الجرد',required:false,example:'',width:32}];
export const PRODUCT_WORKBOOK_NOTES=[
 'احذف المثال الوهمي. المعلومات الثابتة تُعبأ مبكراً، والمخزون بعد جرد فعلي قرب يوم التشغيل.',
 'سعر الباكيت مرتبط بسعر الطرد وعدده كما في شاشة إنشاء منتج، وليس سعراً مستقلاً. عند تعبئة السعرين يجب أن يتطابقا بعد التقريب الحالي للفلس.',
 'النكهات ترث أسعار وتكلفة الأساسي. الأساسي للتجميع بلا مخزون أو باركود؛ ضع الباركود والمخزون في ورقة النكهات.',
 'المخزون اختياري وبالباكيت. بعد تعريف الأصناف يُنزّل ملف البضاعة الموجودة (طرود الشراء وباكيتاتها) ويُستورد من مسار الجرد المحروس؛ لا تستخدم استلام شراء.',
 'المستودع وجهة الجرد الافتتاحي وليس حقلاً ثابتاً مستقلاً للمنتج. الأقسام والوحدات والعلامات والمستودعات يجب أن تكون معرّفة مسبقاً.',
 'صورة كل صنف أو نكهة من مجلد الصور: اسم الملف هو رمز الصنف النهائي، وخلفية فاتحة.',
 'الإنشاء ثم تثبيت بيانات النكهات عمليتان؛ لا تُعد الدفعة مكتملة قبل القراءة والمطابقة، وعند الانقطاع استخدم استئناف المحاولة نفسها.'
] as const;
export const skuKey=(s:string)=>normalizeDigits(s.normalize('NFKC')).trim().toUpperCase();
export function deterministicFlavorSku(master:string,name:string){
 const slug=skuKey(name).replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-+|-+$/gu,'');
 const raw=skuKey(master)+'-'+slug;if(!slug)return '';
 if([...raw].length<=64)return raw;
 let code=2166136261;for(const c of raw)code=Math.imul(code^c.codePointAt(0)!,16777619)>>>0;
 return [...raw].slice(0,55).join('')+'-'+code.toString(16).padStart(8,'0');
}
export interface WorkbookFlavor {row:number;name:string;sku:string;barcode:string;openingStock:number|null;generatedSku:boolean}
export interface WorkbookProduct {row:number;data:ProductPayload;brand:string;description:string;warehouse:string;maxStock:number|null;openingStock:number|null;flavors:WorkbookFlavor[]}
export interface ProductWorkbookPlan {products:WorkbookProduct[];errors:RowError[];warnings:RowError[];missingStock:number}
const valueRow=(columns:readonly GoLiveColumn[],header:readonly string[],cells:readonly string[])=>Object.fromEntries(columns.map(c=>[c.key,(cells[header.indexOf(c.header)]??'').trim()]));
export async function readProductWorkbook(bytes:Uint8Array){return{products:await readXlsxFirstSheet(bytes),flavors:await readXlsxSheet(bytes,'النكهات')};}
export function prepareProductWorkbook(productSheet:readonly(readonly string[])[],flavorSheet:readonly(readonly string[])[]=[]):ProductWorkbookPlan{
 const errors:RowError[]=[],warnings:RowError[]=[];const header=(productSheet[0]??[]).map(c=>c.trim());
 // Bind the renamed headings to the exact legacy pure validator; accept old headings too.
 const legacyHeader=header.map(h=>GO_LIVE_COLUMNS.products.find(c=>renamed[c.key]===h)?.header??h);
 const mapped=mapSheet('products',[legacyHeader,...productSheet.slice(1)]);
 for(const message of mapped.fileErrors)errors.push({row:1,message});
 const extra=new Map<number,Record<string,string>>();
 for(const row of mapped.rows){
  const v=valueRow(PRODUCT_WORKBOOK_COLUMNS,header,productSheet[row.row-1]);extra.set(row.row,v);
  const method=v.sale_method;const size=parseWholeNumber(row.values.units_per_sale_unit,{min:1});
  if(method&&!['طرد','باكيت مفرد','الاثنين'].includes(method))errors.push({row:row.row,message:'طريقة البيع: اختر طرد أو باكيت مفرد أو الاثنين.'});
  if(method){
   if(row.values.parcel_only&&['نعم','true','1'].includes(row.values.parcel_only)!==(method==='طرد'))errors.push({row:row.row,message:'طريقة البيع تتعارض مع يُباع بالطرد فقط.'});
   row.values.parcel_only=method==='طرد'?'نعم':'لا';
   if(method==='باكيت مفرد'&&size!==1)errors.push({row:row.row,message:'للباكيت المفرد فقط اجعل عدد باكيتات طرد البيع 1، وطرد الشراء يبقى كما هو.'});
  }
  if(method&&method!=='طرد'&&!v.packet_price)errors.push({row:row.row,message:'سعر بيع الباكيت المفرد مطلوب لطريقة البيع المختارة.'});
  if(v.packet_price){
   const packet=parseJodToMinor(v.packet_price),parcel=parseJodToMinor(row.values.sale_package_price);
   if(packet===null||packet==='0')errors.push({row:row.row,message:'سعر بيع الباكيت المفرد يجب أن يكون موجباً وبثلاث خانات كحد أقصى.'});
   else if(parcel!==null&&size!==null&&BigInt(packet)!==(BigInt(parcel)+BigInt(Math.floor(size/2)))/BigInt(size))errors.push({row:row.row,message:'سعر الباكيت لا يطابق سعر الطرد مقسوماً على عدد الباكيتات بعد التقريب إلى الفلس؛ صحّح السعرين.'});
  }
 }
 const prepared=prepareProducts(mapped.rows);errors.push(...prepared.errors);
 const stock=(s:string,row:number)=>{if(!s)return null;const n=parseWholeNumber(s,{max:9_999_999});if(n===null)errors.push({row,message:'المخزون: أدخل عدد باكيتات صحيحاً غير سالب أو اتركه فارغاً حتى الجرد.'});return n;};
 const products=prepared.payload.map(p=>{const v=extra.get(p.sourceRow)!;const max=v.max_stock_level?parseWholeNumber(v.max_stock_level,{max:999_999}):null;
  if(v.max_stock_level&&(max===null||max<Number(p.min_stock_level)))errors.push({row:p.sourceRow,message:'سقف المستودع يجب أن يكون عدداً صحيحاً لا يقل عن حد التنبيه (بالباكيت).'});
  return{row:p.sourceRow,data:p,brand:v.brand_name,description:v.description,warehouse:v.warehouse_code,maxStock:max,openingStock:stock(v.opening_stock,p.sourceRow),flavors:[] as WorkbookFlavor[]};});
 const byMaster=new Map(products.map(p=>[skuKey(p.data.sku),p]));
 if(flavorSheet.length){const fh=(flavorSheet[0]??[]).map(c=>c.trim());
  for(const c of FLAVOR_WORKBOOK_COLUMNS.filter(c=>c.required))if(!fh.includes(c.header))errors.push({row:1,message:`النكهات: العمود "${c.header}" مطلوب.`});
  flavorSheet.slice(1).forEach((cells,i)=>{if(!cells.some(c=>c.trim()))return;const row=i+2,v=valueRow(FLAVOR_WORKBOOK_COLUMNS,fh,cells),parent=byMaster.get(skuKey(v.master_sku));
   if(!parent){errors.push({row,message:'النكهات: رمز المنتج الأساسي غير موجود في ورقة المنتجات.'});return;}
   if(!v.name||v.name.length>80){errors.push({row,message:'النكهات: الاسم مطلوب وبحد أقصى 80 حرفاً.'});return;}
   if(parent.flavors.some(f=>f.name.trim().toLocaleLowerCase('ar')===v.name.toLocaleLowerCase('ar')))errors.push({row,message:'النكهات: اسم نكهة مكرر لنفس المنتج.'});
   const sku=v.sku||deterministicFlavorSku(parent.data.sku,v.name);
   if(!sku||[...sku].length>64)errors.push({row,message:'النكهات: رمز النكهة مطلوب وبحد أقصى 64 حرفاً.'});
   parent.flavors.push({row,name:v.name,sku,barcode:v.barcode,openingStock:stock(v.opening_stock,row),generatedSku:!v.sku});
  });
 }
 const identifiers=new Map<string,{sku:string;row:number}>();
 for(const p of products){
  if(p.flavors.length>30)errors.push({row:p.row,message:'الحد الأعلى 30 نكهة لكل منتج.'});
  if(p.flavors.length&&(p.data.barcode||p.openingStock))errors.push({row:p.row,message:'المنتج الأساسي للنكهات بلا باركود أو مخزون؛ ضعها لكل نكهة.'});
  const items=[{sku:p.data.sku,barcode:p.data.barcode,row:p.row},...p.flavors];
  for(const item of items)for(const code of new Set([item.sku,item.barcode].filter(Boolean).map(skuKey))){const prior=identifiers.get(code);if(prior)errors.push({row:item.row,message:`رمز أو باركود مكرر عبر ورقتي المنتجات والنكهات؛ راجع السطر ${prior.row}.`});else identifiers.set(code,{sku:item.sku,row:item.row});}
 }
 const missingStock=products.reduce((n,p)=>n+(p.flavors.length?p.flavors.filter(f=>f.openingStock===null).length:Number(p.openingStock===null)),0);
 if(missingStock)warnings.push({row:0,warning:true,message:`${missingStock} صنف بلا مخزون — يُعبأ بعد الجرد يوم D−1/يوم التشغيل.`});
 return{products,errors,warnings,missingStock};
}
export function productWorkbookStockRows(plan:ProductWorkbookPlan){
 return plan.products.flatMap(p=>(p.flavors.length?p.flavors:[{sku:p.data.sku,openingStock:p.openingStock}]).filter(f=>f.openingStock!==null).map(f=>({sku:f.sku,packageCount:Math.floor(f.openingStock!/Number(p.data.units_per_purchase_unit)),looseUnits:f.openingStock!%Number(p.data.units_per_purchase_unit)})));
}

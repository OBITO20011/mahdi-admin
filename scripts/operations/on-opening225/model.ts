/** Offline preparation only. The existing product and opening-stock readers remain authoritative. */
import {PRODUCT_WORKBOOK_COLUMNS,FLAVOR_WORKBOOK_COLUMNS,prepareProductWorkbook,skuKey,type WorkbookProduct} from '../../../src/features/goLive/productWorkbook';
import {GO_LIVE_COLUMNS,mapSheet,prepareStock,parseJodToMinor,parseWholeNumber,normalizeDigits} from '../../../src/features/goLive/goLiveImport';
import {validateProductWorkbookReference,type ProductWorkbookReference} from '../../../src/features/goLive/productWorkbookReference';

export const OWNER_CATALOG225_SHA256='3310da575b28e763fed079bf775f4010ac0a32ad23118b7216d18ca8de608e6c';
export const PRICE_COLUMNS225=[
 ['sku','SKU'],['master','SKU العائلة'],['name','اسم المنتج'],['flavor','النكهة'],['unit','رمز الوحدة'],['unitName','وحدة الأساس'],
 ['purchaseUnit','وحدة طرد الشراء'],['purchaseCount','عدد الوحدات في طرد الشراء'],
 ['single','سعر بيع المفرد للمراجعة'],['parcel','سعر بيع الطرد للمراجعة'],
 ['invoicePrice','السعر من الفاتورة (د.أ)'],['basis','هل السعر لطرد أم وحدة؟'],
 ['invoiceRef','مرجع الفاتورة'],['invoiceDate','تاريخ الفاتورة'],['minimum','الحد الأدنى الاختياري'],
 ['unitCost','تكلفة الوحدة المحسوبة (د.أ)'],
] as const;
export const STOCK_COLUMNS225=[
 ['sku','SKU'],['name','اسم المنتج / النكهة'],['unit','وحدة الأساس'],['warehouse','رمز المستودع'],
 ['packages','عدد طرود الشراء'],['loose','الوحدات المفردة الإضافية'],
 ['quantity','إجمالي الوحدات'],['value','قيمة الافتتاح المقرّبة (د.أ)'],
 ['difference','فرق التقييم عن الفاتورة (د.أ)'],['warning','تنبيه'],
] as const;
type Sheet=readonly(readonly string[])[];
type Input=Record<string,string>;
export interface OpeningIssue225 {sheet:string;row:number;code:string;message:string}
export interface Sellable225 {sku:string;master:string;name:string;flavor:string;unit:string;unitName:string;purchaseUnit:string;purchaseCount:string;single:string;parcel:string;product:WorkbookProduct}
export interface OpeningCatalog225 {products:WorkbookProduct[];sellable:Sellable225[];productSheet:Sheet;flavorSheet:Sheet}
export interface OpeningSettings225 {defaultWarehouse:string;valuationThreshold:string}
const jod=(n:bigint)=>`${n/1000n}.${String(n%1000n).padStart(3,'0')}`;
export const roundedUnitCost225=(invoiceMinor:bigint,divisor:number)=>{
 if(invoiceMinor<0n||!Number.isSafeInteger(divisor)||divisor<1)throw Error('ON225_COST_INPUT_INVALID');
 return (invoiceMinor+BigInt(Math.floor(divisor/2)))/BigInt(divisor);
};
export function openingCatalog225(productSheet:Sheet,flavorSheet:Sheet,units:readonly{code:string;name:string}[]=[]):OpeningCatalog225{
 const plan=prepareProductWorkbook(productSheet,flavorSheet,'sales-only');
 if(plan.errors.length)throw Error('ON225_SOURCE_CATALOG_INVALID');
 const sellable=plan.products.flatMap(product=>{
  const single=jod(BigInt(product.singlePriceInMinorUnits??product.data.sale_package_price_in_minor_units));
  const common={master:product.flavors.length?product.data.sku:'',name:product.data.name_ar,
   unit:product.data.base_unit_name,unitName:units.find(u=>skuKey(u.code)===skuKey(product.data.base_unit_name))?.name??product.data.base_unit_name,purchaseUnit:product.data.purchase_unit_name,
   purchaseCount:product.data.units_per_purchase_unit,single,parcel:jod(BigInt(product.data.sale_package_price_in_minor_units)),product};
  return product.flavors.length?product.flavors.map(flavor=>({...common,sku:flavor.sku,flavor:flavor.name})):
   [{...common,sku:product.data.sku,flavor:''}];
 });
 return {products:plan.products,sellable,productSheet,flavorSheet};
}
export function ownerPriceRows225(catalog:OpeningCatalog225){
 return [PRICE_COLUMNS225.map(c=>c[1]),...catalog.sellable.map(item=>PRICE_COLUMNS225.map(([key])=>
  key==='unitCost'?'':key in item?String(item[key as keyof Sellable225]):''))];
}
export function ownerStockRows225(catalog:OpeningCatalog225){
 return [STOCK_COLUMNS225.map(c=>c[1]),...catalog.sellable.map(item=>
  [item.sku,item.name+(item.flavor?' · '+item.flavor:''),item.unitName,'','','','','','',''])];
}
function sheetInputs(sheet:Sheet,columns:readonly(readonly[string,string])[],name:string,issues:OpeningIssue225[]):Input[]{
 const header=sheet[0]??[];
 if(columns.some(([,title])=>header.filter(h=>h===title).length!==1)){
  issues.push({sheet:name,row:1,code:'HEADERS',message:'عناوين الأعمدة ناقصة أو مكررة؛ استخدم ورقة التعبئة الأصلية.'});return [];
 }
 return sheet.slice(1).map((row,i)=>({row:String(i+2),...Object.fromEntries(columns.map(([key,title])=>[key,String(row[header.indexOf(title)]??'').trim()]))})).filter(r=>Object.entries(r).some(([key,value])=>key!=='row'&&value));
}
function invoiceDate(value:string):string|null{
 let text=normalizeDigits(value);
 if(/^\d+(?:\.0+)?$/u.test(text)){
  const serial=Number(text);if(!Number.isSafeInteger(serial)||serial<1||serial>2958465)return null;
  text=new Date(Date.UTC(1899,11,30)+serial*86400000).toISOString().slice(0,10);
 }
 if(!/^\d{4}-\d{2}-\d{2}$/u.test(text))return null;
 const date=new Date(text+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===text?text:null;
}
export function convertOpening225(catalog:OpeningCatalog225,priceSheet:Sheet,stockSheet:Sheet,settings:OpeningSettings225,reference?:ProductWorkbookReference){
 const errors:OpeningIssue225[]=[],warnings:OpeningIssue225[]=[];
 const add=(sheet:string,row:number,code:string,message:string)=>errors.push({sheet,row,code,message});
 const prices=sheetInputs(priceSheet,PRICE_COLUMNS225,'التكلفة',errors),stocks=sheetInputs(stockSheet,STOCK_COLUMNS225,'الجرد',errors);
 const items=new Map(catalog.sellable.map(item=>[item.sku,item]));
 const seenStock=new Set<string>(),seenPrices=new Set<string>();
 const preparedStock:{row:number;sku:string;warehouse:string;packages:number;loose:number;quantity:bigint}[]=[];
 for(const row of stocks){
  const at=Number(row.row),item=items.get(row.sku),warehouse=row.warehouse||settings.defaultWarehouse;
  if(!item){add('الجرد',at,'SKU','رمز غير موجود في الملف الأصلي أو أساسي عائلة غير قابل للجرد.');continue;}
  if(row.unit!==item.unitName||row.name!==item.name+(item.flavor?' · '+item.flavor:''))add('الجرد',at,'IDENTITY','لا تغيّر اسم الصنف أو وحدته في ورقة التعبئة.');
  if(!warehouse||reference&&!reference.warehouses?.some(w=>w.active&&skuKey(w.code)===skuKey(warehouse)))add('الجرد',at,'WAREHOUSE','اختر رمز مستودع نشط من المرجع المحلي المعتمد.');
  const key=item.sku+'\0'+skuKey(warehouse);
  if(seenStock.has(key))add('الجرد',at,'DUPLICATE_STOCK','الصنف مكرر في المستودع نفسه.');seenStock.add(key);
  const packages=parseWholeNumber(row.packages,{max:9_999_999}),loose=row.loose?parseWholeNumber(row.loose,{max:9_999_999}):0;
  if(packages===null||loose===null){add('الجرد',at,'COUNT','أدخل العدد الفعلي الصحيح، وصفر صراحةً عند عدم وجود رصيد.');continue;}
  // Purchase counts are validated below; quantities are computed after that validation.
  preparedStock.push({row:at,sku:item.sku,warehouse,packages,loose,quantity:0n});
 }
 const costs=new Map<string,{item:Sellable225;purchaseUnit:string;count:number;cost:bigint;invoice:bigint;divisor:number;minimum:number;invoiceRef:string;invoiceDate:string;basis:string}>();
 for(const row of prices){
  const at=Number(row.row),item=items.get(row.sku);
  if(!item){add('التكلفة',at,'SKU','رمز غير موجود في الملف الأصلي.');continue;}
  if(seenPrices.has(item.sku)){add('التكلفة',at,'DUPLICATE_PRICE','كرّر الصنف في الجرد لمستودع آخر فقط، وليس في التكلفة.');continue;}seenPrices.add(item.sku);
  for(const key of ['master','name','flavor','unit','unitName','single','parcel']as const){
   const matches=key==='single'||key==='parcel'?parseJodToMinor(row[key])===parseJodToMinor(item[key]):row[key]===item[key];
   if(!matches)add('التكلفة',at,'SOURCE_CHANGED','بيانات المصدر وأسعار البيع للمراجعة فقط؛ لا تعدّلها هنا.');
  }
  const count=parseWholeNumber(row.purchaseCount,{min:1,max:999999}),minimum=row.minimum?parseWholeNumber(row.minimum):0;
  const invoice=row.invoicePrice?parseJodToMinor(row.invoicePrice):'0';
  if(count===null||minimum===null||invoice===null){add('التكلفة',at,'COST_INPUT','راجع محتوى طرد الشراء والحد والمبلغ ذي الثلاث منازل.');continue;}
  if(!row.purchaseUnit||reference&&reference.units.filter(u=>skuKey(u.code)===skuKey(row.purchaseUnit)||u.name===row.purchaseUnit).length!==1)add('التكلفة',at,'PURCHASE_UNIT','وحدة طرد الشراء يجب أن تكون معرّفة وفريدة في المرجع.');
  const amount=BigInt(invoice),basis=row.basis;
  if(amount>0n&&!['طرد','وحدة'].includes(basis))add('التكلفة',at,'BASIS','اختر طرد أو وحدة للسعر من الفاتورة.');
  const divisor=basis==='طرد'?count:1,cost=roundedUnitCost225(amount,divisor);
  const date=row.invoiceDate?invoiceDate(row.invoiceDate):'';
  if(amount>0n&&(!row.invoiceRef||!date))add('التكلفة',at,'INVOICE_REFERENCE','أدخل مرجع الفاتورة وتاريخها الصحيح؛ لا تغيّر إجمالي الفاتورة بسبب التقريب.');
  costs.set(item.sku,{item,purchaseUnit:row.purchaseUnit,count,cost,invoice:amount,divisor,minimum,invoiceRef:row.invoiceRef,invoiceDate:date??'',basis});
 }
 for(const item of catalog.sellable){
  if(!seenPrices.has(item.sku))add('التكلفة',0,'MISSING_SKU','كل صنف قابل للبيع يحتاج سطراً في ورقة التكلفة: '+item.sku);
  if(!preparedStock.some(row=>row.sku===item.sku))add('الجرد',0,'MISSING_SKU','كل صنف يحتاج عداً صريحاً ولو صفراً: '+item.sku);
 }
 const threshold=parseJodToMinor(settings.valuationThreshold);
 if(threshold===null)add('الإعدادات',0,'THRESHOLD','حد تنبيه فرق التقييم يجب أن يكون مبلغاً صحيحاً غير سالب.');
 const audit=[];
 for(const row of preparedStock){
  const cost=costs.get(row.sku);if(!cost)continue;
  if(row.loose>=cost.count)add('الجرد',row.row,'LOOSE_COUNT','الوحدات الإضافية يجب أن تكون أقل من محتوى طرد الشراء.');
  const quantity=BigInt(row.packages)*BigInt(cost.count)+BigInt(row.loose);row.quantity=quantity;
  if(quantity>2147483647n)add('الجرد',row.row,'COUNT_LIMIT','الكمية تتجاوز حد المسار الرسمي.');
  if(quantity>0n&&cost.cost===0n)add('الجرد',row.row,'ZERO_COST','رصيد موجب بتكلفة صفر؛ راجع السعر ومحتوى الطرد والتقريب.');
  const differenceNumerator=(cost.cost*BigInt(cost.divisor)-cost.invoice)*quantity;
  if(threshold!==null&&(differenceNumerator<0n?-differenceNumerator:differenceNumerator)>BigInt(threshold)*BigInt(cost.divisor))warnings.push({sheet:'الجرد',row:row.row,code:'VALUATION_DIFFERENCE',message:'فرق تقييم يتجاوز الحد المختار؛ راجع إجمالي الفاتورة والتكلفة المقرّبة قبل اعتماد الجرد.'});
  audit.push({sku:row.sku,warehouse:row.warehouse,quantity:String(quantity),unitCostMinor:String(cost.cost),invoicePriceMinor:String(cost.invoice),invoiceBasis:cost.basis,invoiceRef:cost.invoiceRef,invoiceDate:cost.invoiceDate,exactCostNumerator:String(cost.invoice),exactCostDivisor:cost.divisor,openingValueMinor:String(cost.cost*quantity),valuationDifferenceNumeratorMinor:String(differenceNumerator),valuationDifferenceDivisor:cost.divisor});
 }
 const roots=new Map<string,typeof costs extends Map<string,infer V>?V:never>();
 for(const item of catalog.sellable){
  const row=costs.get(item.sku);if(!row)continue;
  const key=item.product.data.sku,prior=roots.get(key);
  if(prior&&[prior.purchaseUnit,prior.count,String(prior.cost),prior.minimum].join('\0')!==[row.purchaseUnit,row.count,String(row.cost),row.minimum].join('\0'))add('التكلفة',0,'FAMILY_COST','النكهات ترث تكلفة ومحتوى طرد وحد عائلتها؛ لا تُوحّد قيماً مختلفة بصمت: '+key);
  else if(!prior)roots.set(key,row);
 }
 const originalHeader=catalog.productSheet[0]??[];
 const originalBySku=new Map(catalog.products.map(product=>[product.data.sku,catalog.productSheet[product.row-1]]));
 const productRows=[PRODUCT_WORKBOOK_COLUMNS.map(c=>c.header),...catalog.products.map(product=>{
  const cost=roots.get(product.data.sku),original=originalBySku.get(product.data.sku)!;
  const values:Record<string,string>={purchase_unit_name:cost?.purchaseUnit??'',units_per_purchase_unit:String(cost?.count??''),cost_per_base_unit:cost?jod(cost.cost):'',purchase_package_price:cost?jod(cost.basis==='طرد'?cost.invoice:cost.invoice*BigInt(cost.count)):'',min_stock_level:String(cost?.minimum??0),opening_stock:'',warehouse_code:''};
  return PRODUCT_WORKBOOK_COLUMNS.map(c=>Object.hasOwn(values,c.key)?values[c.key]:original[originalHeader.indexOf(c.header)]??'');
 })];
 const flavorHeader=catalog.flavorSheet[0]??[];
 const flavorRows=[FLAVOR_WORKBOOK_COLUMNS.map(c=>c.header),...catalog.flavorSheet.slice(1).filter(r=>r.some(Boolean)).map(row=>FLAVOR_WORKBOOK_COLUMNS.map(c=>c.key==='opening_stock'?'':row[flavorHeader.indexOf(c.header)]??''))];
 const plan=prepareProductWorkbook(productRows,flavorRows,'full',{independentFullPrices:true});
 for(const issue of plan.errors)add(issue.sheet??'المنتجات',issue.row,'OFFICIAL_PRODUCTS',issue.message);
 if(reference)for(const issue of validateProductWorkbookReference(plan,reference))add(issue.sheet??'المنتجات',issue.row,'REFERENCE',issue.message);
 const warehouses=[...new Set(preparedStock.map(r=>r.warehouse))].sort();
 const stockFiles=warehouses.map(warehouse=>({warehouse,rows:[GO_LIVE_COLUMNS.stock.map(c=>c.header),...preparedStock.filter(r=>r.warehouse===warehouse).map(r=>[r.sku,items.get(r.sku)!.name,String(r.packages),String(r.loose)])]}));
 const refs=catalog.sellable.flatMap(item=>{const c=costs.get(item.sku);return c?[{productId:item.sku,sku:item.sku,barcode:item.flavor?item.product.flavors.find(f=>f.sku===item.sku)!.barcode:item.product.data.barcode,productName:item.name,unitsPerPackage:c.count,costPriceInMinorUnits:Number(c.cost),eligible:true}]:[];});
 for(const file of stockFiles){const mapped=mapSheet('stock',file.rows);for(const error of prepareStock(mapped.rows,refs).errors)add('الجرد '+file.warehouse,error.row,'OFFICIAL_STOCK',error.message);}
 return {ok:errors.length===0,errors,warnings,productRows,flavorRows,stockFiles,audit,
  counts:{products:catalog.products.length,families:catalog.products.filter(p=>p.flavors.length).length,flavors:catalog.products.reduce((n,p)=>n+p.flavors.length,0),sellable:catalog.sellable.length,stockRows:preparedStock.length,warehouses:warehouses.length},
  totalOpeningValueMinor:audit.reduce((n,r)=>n+BigInt(r.openingValueMinor),0n).toString()};
}

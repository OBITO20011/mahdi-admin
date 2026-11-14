import {fetchOperatingMode} from './operatingMode.service';
/** Versioned public product writers only. No service key,SQL endpoint or alternate privileges. */
import {isSupabaseConfigured,supabase,sanitizedSupabaseUrl}from'../../lib/supabase';
import {skuKey,type WorkbookProduct,type ProductWorkbookPlan}from'../../features/goLive/productWorkbook';
import {type ProductWorkbookReference,validateProductWorkbookReference}from'../../features/goLive/productWorkbookReference';
import {createProductImportAttempt,resumeProductImport,type ProductImportAttempt,type ProductImportEntry,type ProductImportSnapshot}from'../../features/goLive/productImportAttempt';
import {fetchGoLiveStatus}from'./goLive.service';
import {normalizeImportDisplayText as display}from'../../features/goLive/importDisplayText';
type Row=Record<string,unknown>;
const metadataColumns='id,sku,barcode,name_ar,description,category_id,brand_id,unit_id,purchase_unit_id,units_per_purchase_unit,default_purchase_price_in_minor_units,sale_unit_id,units_per_sale_unit,default_sale_price_in_minor_units,sale_price_in_minor_units,cost_price_in_minor_units,min_stock_level,max_stock_level,is_active,parcel_only,updated_at,flavor_master_product_id,is_flavor_master,flavor_name_ar';
function db(){if(!isSupabaseConfigured||!supabase)throw Error('PRODUCT_IMPORT_NO_CLIENT');return supabase;}
async function result(request:PromiseLike<{data:unknown;error:unknown}>){const r=await request;if(r.error)throw Error('PRODUCT_IMPORT_REQUEST_FAILED');return r.data;}
function record(v:unknown):Row{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('PRODUCT_IMPORT_INVALID_RESPONSE');return v as Row;}
const str=(v:unknown)=>v===null||v===undefined?'':String(v);
function assert(ok:unknown,code='PRODUCT_IMPORT_READBACK_DIFFER'):asserts ok{if(!ok)throw Error(code);}
async function all(table:'categories'|'units'|'brands'|'warehouses'|'products'){
 const rows:Row[]=[];for(let from=0;from<50_000;from+=500){
  const request=table==='categories'?db().from('categories').select('id,name_ar,is_active').order('id').range(from,from+499)
   :table==='units'?db().from('units').select('id,code,name_ar').order('id').range(from,from+499)
   :table==='brands'?db().from('brands').select('id,name_ar,is_active').order('id').range(from,from+499)
   :table==='warehouses'?db().from('warehouses').select('id,code,name_ar,is_active').order('id').range(from,from+499)
   :db().from('products').select('id,sku,barcode').order('id').range(from,from+499);
  const data=await result(request);assert(Array.isArray(data));rows.push(...data.map(record));if(data.length<500)return rows;
 }throw Error('PRODUCT_IMPORT_REFERENCE_LIMIT');
}
export async function fetchProductWorkbookReference():Promise<ProductWorkbookReference>{
 // This existing owner/active/AAL contract is checked before any import write.
 const status=await fetchGoLiveStatus();assert(!status.finished,'PRODUCT_IMPORT_SETUP_FINISHED');
 const[categories,units,brands,warehouses,products]=await Promise.all([all('categories'),all('units'),all('brands'),all('warehouses'),all('products')]);
 return{categories:categories.map(r=>({id:str(r.id),name:str(r.name_ar),active:r.is_active===true})),units:units.map(r=>({id:str(r.id),name:str(r.name_ar),code:str(r.code)})),brands:brands.map(r=>({id:str(r.id),name:str(r.name_ar),active:r.is_active===true})),warehouses:warehouses.map(r=>({id:str(r.id),name:str(r.name_ar),code:str(r.code),active:r.is_active===true})),products:products.map(r=>({id:str(r.id),sku:str(r.sku),barcode:str(r.barcode)}))};
}
const unique=<T,>(rows:T[])=>{assert(rows.length===1,'PRODUCT_IMPORT_REFERENCE_AMBIGUOUS');return rows[0];};
function wanted(row:WorkbookProduct,ref:ProductWorkbookReference):Row{const p=row.data;
 const unit=(value:string)=>{const code=ref.units.filter(u=>skuKey(u.code)===skuKey(value));return unique(code.length?code:ref.units.filter(u=>display(u.name)===value)).id!;};
 return{...(row.singlePriceInMinorUnits===undefined?{}:{sale_price_in_minor_units:row.singlePriceInMinorUnits}),sku:p.sku,barcode:p.barcode||null,name_ar:p.name_ar,description:row.description||null,category_id:unique(ref.categories.filter(c=>c.active&&display(c.name)===p.category_name)).id!,brand_id:row.brand?unique(ref.brands!.filter(b=>b.active&&display(b.name)===row.brand)).id!:null,unit_id:unit(p.base_unit_name),purchase_unit_id:unit(p.purchase_unit_name),units_per_purchase_unit:p.units_per_purchase_unit,default_purchase_price_in_minor_units:p.purchase_package_price_in_minor_units,sale_unit_id:unit(p.sale_unit_name),units_per_sale_unit:p.units_per_sale_unit,default_sale_price_in_minor_units:p.sale_package_price_in_minor_units,cost_price_in_minor_units:p.cost_per_base_unit_in_minor_units,min_stock_level:p.min_stock_level,max_stock_level:row.maxStock,parcel_only:p.parcel_only??false,is_active:true};
}
function compare(actual:Row,expected:Row,keys=Object.keys(expected)){for(const key of keys)assert(str(actual[key])===str(expected[key]),'PRODUCT_IMPORT_READBACK_DIFFER');}
export async function readProductImportSnapshot(id:string):Promise<ProductImportSnapshot>{
 const row=record(await result(db().from('products').select(metadataColumns).eq('id',id).single()));
 const children=await result(db().from('products').select(metadataColumns).eq('flavor_master_product_id',id).order('id'));assert(Array.isArray(children));
 return{id:str(row.id),sku:str(row.sku),barcode:str(row.barcode),metadata:row,flavors:children.map(r=>{const c=record(r);return{id:str(c.id),name:str(c.flavor_name_ar),sku:str(c.sku),barcode:str(c.barcode),metadata:c};})};
}
async function findTemporary(sku:string){const rows=await result(db().from('products').select('id').eq('sku',sku).limit(2));assert(Array.isArray(rows));assert(rows.length<=1);return rows.length?readProductImportSnapshot(str(record(rows[0]).id)):null;}
async function write(row:Row,change:Row,method:boolean|null,independent=false){
 const value={...row,...change};const args={p_product_id:row.id,p_expected_updated_at:row.updated_at,p_sku:value.sku,p_barcode:value.barcode,p_name_ar:value.name_ar,p_description:value.description,p_category_id:value.category_id,p_brand_id:value.brand_id,p_unit_id:value.unit_id,p_purchase_unit_id:value.purchase_unit_id,p_units_per_purchase_unit:value.units_per_purchase_unit,p_default_purchase_price_in_minor_units:value.default_purchase_price_in_minor_units,p_sale_unit_id:value.sale_unit_id,p_units_per_sale_unit:value.units_per_sale_unit,p_default_sale_price_in_minor_units:value.default_sale_price_in_minor_units,p_cost_price_in_minor_units:value.cost_price_in_minor_units,p_min_stock_level:value.min_stock_level,p_max_stock_level:value.max_stock_level,p_is_active:value.is_active,p_image_url:null,p_parcel_only:method};
 assert(record(await result(db().rpc(independent?'update_product_master_v6':'update_product_master_v5',{...args,...(independent?{p_sale_price_in_minor_units:value.sale_price_in_minor_units}:{})}))).success===true);
}
export async function productImportContext(actor:string){const{data,error}=await db().auth.getUser();assert(!error&&data.user?.id===actor,'PRODUCT_IMPORT_ACTOR_CHANGED');return{actor,project:sanitizedSupabaseUrl};}
export const productImportStorageKey=(actor:string,project:string)=>'nawasrah:product-workbook:v1:'+actor+':'+project;
export function loadProductImportAttempt(storage:Storage,key:string):ProductImportAttempt|null{
 const raw=storage.getItem(key);if(raw===null)return null;
 let a:ProductImportAttempt;try{a=JSON.parse(raw);}catch{throw Error('PRODUCT_IMPORT_JOURNAL_INVALID');}
 assert(a&&a.version===1&&typeof a.actor==='string'&&typeof a.project==='string'&&/^[a-f0-9]{64}$/u.test(a.planHash)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(a.nonce)&&Array.isArray(a.entries),'PRODUCT_IMPORT_JOURNAL_INVALID');
 for(const e of a.entries)assert(e&&typeof e.temporarySku==='string'&&typeof e.complete==='boolean'&&(!e.masterId||/^[a-f0-9-]{36}$/u.test(e.masterId)),'PRODUCT_IMPORT_JOURNAL_INVALID');return a;
}
const hash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
async function inspectContext(plan:ProductWorkbookPlan,actor:string,storage:Storage){
 assert(!plan.errors.length&&plan.products.length>0,'PRODUCT_IMPORT_PLAN_INVALID');const context=await productImportContext(actor),key=productImportStorageKey(actor,context.project),planHash=await hash(JSON.stringify(plan.operatingMode==='sales-only'?{operatingMode:'sales-only',products:plan.products}:plan.products));
 if(plan.operatingMode==='sales-only'){const mode=await fetchOperatingMode();assert(mode.mode==='sales-only'&&mode.installed,'PRODUCT_IMPORT_MODE_CHANGED');}
 const attempt=loadProductImportAttempt(storage,key);if(attempt&&(attempt.planHash!==planHash||attempt.actor!==actor||attempt.project!==context.project))throw Error('PRODUCT_IMPORT_ATTEMPT_MISMATCH');
 const reference=await fetchProductWorkbookReference();
 // Only exact IDs belonging to this already-bound attempt may be excluded from
 // the existing-identifier check; a new file cannot adopt an existing product.
 const owned=new Set<string>();if(attempt)for(const e of attempt.entries){if(e.masterId){owned.add(e.masterId);Object.values(e.flavorIds??{}).forEach(id=>owned.add(id));}else{const prior=await findTemporary(e.temporarySku);if(prior){owned.add(prior.id);prior.flavors.forEach(f=>owned.add(f.id));}}}
 const errors=validateProductWorkbookReference(plan,{...reference,products:reference.products.filter(p=>!owned.has(p.id!))});
 return{context,key,planHash,attempt,reference,errors};
}
export async function inspectProductWorkbook(plan:ProductWorkbookPlan,actor:string,storage:Storage){const value=await inspectContext(plan,actor,storage);return{errors:value.errors,pending:Boolean(value.attempt&&!value.attempt.entries.every(e=>e.complete))};}
async function saveProductWorkbookUnlocked(plan:ProductWorkbookPlan,actor:string,storage:Storage,progress?:(done:number,total:number)=>void){
 const{context,key,planHash,reference,errors}=await inspectContext(plan,actor,storage);let attempt=loadProductImportAttempt(storage,key);assert(!errors.length,'PRODUCT_IMPORT_REFERENCE_INVALID');
 if(!attempt){attempt=createProductImportAttempt(actor,context.project,planHash,plan.products.length);storage.setItem(key,JSON.stringify(attempt));}
 const core=[...(plan.operatingMode==='sales-only'?['sale_price_in_minor_units']:[]),'name_ar','category_id','unit_id','purchase_unit_id','units_per_purchase_unit','default_purchase_price_in_minor_units','sale_unit_id','units_per_sale_unit','default_sale_price_in_minor_units','cost_price_in_minor_units','min_stock_level','parcel_only','is_active'];
 const assertFamily=(row:WorkbookProduct,current:ProductImportSnapshot)=>{compare(current.metadata!,wanted(row,reference),core);assert(current.barcode===row.data.barcode,'PRODUCT_IMPORT_CONCURRENT_CHANGE');assert(current.flavors.length===row.flavors.length);for(const f of row.flavors)assert(current.flavors.filter(c=>c.name===f.name).length===1);};
 const assertFinal=(row:WorkbookProduct,current:ProductImportSnapshot)=>{const target=wanted(row,reference);compare(current.metadata!,target);assertFamily(row,current);assert(Boolean(current.metadata!.is_flavor_master)===Boolean(row.flavors.length));for(const f of row.flavors){const c=unique(current.flavors.filter(c=>c.name===f.name));compare(c.metadata!,{...target,sku:f.sku,barcode:f.barcode||null,name_ar:row.data.name_ar+' - '+f.name},Object.keys(target));assert(str(c.metadata!.flavor_master_product_id)===current.id);}};
 return resumeProductImport(plan.products,{...context,planHash},{load:()=>loadProductImportAttempt(storage,key),persist:a=>storage.setItem(key,JSON.stringify(a)),findTemporary,read:readProductImportSnapshot,progress,assertCreated:assertFamily,
  create:async(row,temp,operationKey)=>{
   if(plan.operatingMode==='sales-only'){const mode=await fetchOperatingMode();assert(mode.mode==='sales-only'&&mode.installed,'PRODUCT_IMPORT_MODE_CHANGED');}const p=row.data,w=wanted(row,reference);let data:unknown;
   if(row.flavors.length){const warehouse=row.warehouse?unique(reference.warehouses!.filter(x=>x.active&&skuKey(x.code)===skuKey(row.warehouse))).id:reference.warehouses?.find(w=>w.active)?.id;assert(warehouse,'PRODUCT_IMPORT_WAREHOUSE_REQUIRED');
    data=await result(db().rpc(plan.operatingMode==='sales-only'?'create_product_family_with_flavors_v3':'create_product_family_with_flavors_v2',{...(plan.operatingMode==='sales-only'?{p_sale_price_in_minor_units:w.sale_price_in_minor_units}:{}),p_sku:temp,p_barcode:null,p_name_ar:w.name_ar,p_description:w.description,p_category_id:w.category_id,p_brand_id:w.brand_id,p_unit_id:w.unit_id,p_purchase_unit_id:w.purchase_unit_id,p_units_per_purchase_unit:w.units_per_purchase_unit,p_default_purchase_price_in_minor_units:w.default_purchase_price_in_minor_units,p_sale_unit_id:w.sale_unit_id,p_units_per_sale_unit:w.units_per_sale_unit,p_default_sale_price_in_minor_units:w.default_sale_price_in_minor_units,p_cost_price_in_minor_units:w.cost_price_in_minor_units,p_min_stock_level:w.min_stock_level,p_max_stock_level:w.max_stock_level,p_warehouse_id:warehouse,p_image_url:null,p_flavors:row.flavors.map(f=>({nameAr:f.name,openingSalePackages:0,imageUrl:null})),p_parcel_only:w.parcel_only}));
   }else if(plan.operatingMode==='sales-only'){
    const warehouse=row.warehouse?unique(reference.warehouses!.filter(x=>x.active&&skuKey(x.code)===skuKey(row.warehouse))).id:reference.warehouses?.find(x=>x.active)?.id;assert(warehouse,'PRODUCT_IMPORT_WAREHOUSE_REQUIRED');
    data=await result(db().rpc('create_product_with_opening_stock_v6',{p_sku:temp,p_barcode:w.barcode,p_name_ar:w.name_ar,p_description:w.description,p_category_id:w.category_id,p_brand_id:w.brand_id,p_unit_id:w.unit_id,p_purchase_unit_id:w.purchase_unit_id,p_units_per_purchase_unit:w.units_per_purchase_unit,p_default_purchase_price_in_minor_units:w.default_purchase_price_in_minor_units,p_sale_unit_id:w.sale_unit_id,p_units_per_sale_unit:w.units_per_sale_unit,p_default_sale_price_in_minor_units:w.default_sale_price_in_minor_units,p_sale_price_in_minor_units:w.sale_price_in_minor_units,p_cost_price_in_minor_units:w.cost_price_in_minor_units,p_min_stock_level:w.min_stock_level,p_max_stock_level:w.max_stock_level,p_warehouse_id:warehouse,p_opening_quantity:0,p_image_url:null,p_parcel_only:w.parcel_only}));
   }else{
    // The legacy RPC resolves exact database names/codes. Keep its existing
    // identity after matching the workbook's normalized descriptive labels.
    const category=unique(reference.categories.filter(c=>c.id===w.category_id));
    const unitCode=(id:unknown)=>unique(reference.units.filter(u=>u.id===id)).code;
    data=await result(db().rpc('import_go_live_products_v1',{p_idempotency_key:operationKey,p_rows:[{...p,sku:temp,category_name:category.name,base_unit_name:unitCode(w.unit_id),purchase_unit_name:unitCode(w.purchase_unit_id),sale_unit_name:unitCode(w.sale_unit_id)}],p_dry_run:false}));
   }assert(record(data).success===true);},
  finalize:async(row,entry:ProductImportEntry)=>{if(plan.operatingMode==='sales-only'){const mode=await fetchOperatingMode();assert(mode.mode==='sales-only'&&mode.installed,'PRODUCT_IMPORT_MODE_CHANGED');}let current=await readProductImportSnapshot(entry.masterId!);assertFamily(row,current);assert(current.sku===entry.temporarySku||current.sku===row.data.sku);
   const target=wanted(row,reference);let final=false;try{compare(current.metadata!,target);final=true;}catch{/* Exact initial metadata may still need the reviewed enrichment phase. */}
   if(!final){const m=current.metadata!;for(const k of ['brand_id','description','max_stock_level'])assert(str(m[k])===''||str(m[k])===str(target[k]),'PRODUCT_IMPORT_CONCURRENT_CHANGE');await write(m,target,target.parcel_only as boolean,plan.operatingMode==='sales-only');}
   current=await readProductImportSnapshot(entry.masterId!);assertFamily(row,current);
   for(const f of row.flavors){const c=unique(current.flavors.filter(c=>c.name===f.name));assert(entry.flavorIds?.[f.name]===c.id,'PRODUCT_IMPORT_FLAVOR_ID_CHANGED');if(c.sku===f.sku&&c.barcode===f.barcode)continue;assert(c.sku===entry.flavorSkus?.[f.name]&&c.barcode==='','PRODUCT_IMPORT_CONCURRENT_CHANGE');compare(c.metadata!,target,core.filter(k=>k!=='name_ar'));await write(c.metadata!,{sku:f.sku,barcode:f.barcode||null},null,plan.operatingMode==='sales-only');}
  },assertFinal});
}
export const productImportErrorText=(error:unknown)=>{
 const code=error instanceof Error?error.message:'';
 if(code==='PRODUCT_IMPORT_MODE_CHANGED')return 'تغيّر وضع التشغيل أو تعذر التحقق منه. لا تبدأ محاولة جديدة؛ أعد قراءة الوضع ثم استأنف الملف نفسه (MODE-02).';
 if(code==='PRODUCT_IMPORT_BUSY')return 'هناك استيراد جارٍ في نافذة أخرى. انتظر اكتماله ثم استأنف الملف نفسه (IMP-05).';
 if(code==='PRODUCT_IMPORT_LOCK_REQUIRED')return 'افتح آخر إصدار من Chrome أو Safari للاستيراد الآمن، ومن جهاز ومتصفح واحد فقط (IMP-05).';
 if(code==='PRODUCT_IMPORT_ATTEMPT_MISMATCH')return 'توجد محاولة محفوظة لملف آخر. اختر الملف نفسه لاستئنافها؛ لا تبدأ استيراداً جديداً.';
 if(code==='PRODUCT_IMPORT_SETUP_FINISHED')return 'بداية التشغيل منتهية؛ لا يمكن بدء استيراد افتتاحي جديد.';
 if(code.includes('JOURNAL')||code==='QuotaExceededError')return 'تعذر حفظ سجل المحاولة على الجهاز. لا تغلقه؛ أصلح مساحة التخزين ثم استأنف الملف نفسه.';
 if(code.includes('READBACK')||code.includes('CONCURRENT')||code.includes('FLAVOR_ID'))return 'لم تتطابق بيانات الصنف مع المحاولة. توقف وراجع المطوّر قبل المتابعة (IMP-02).';
 return 'لم نتأكد من اكتمال الاستيراد. اختر استئناف المحاولة بنفس الملف؛ لا تنشئ محاولة جديدة (IMP-01).';
};

// The durable journal has one writer across tabs of the same browser profile.
export const productWorkbookLockName=(actor:string)=>'nawasrah-product-workbook:'+sanitizedSupabaseUrl+':'+actor;
export async function saveProductWorkbook(plan:ProductWorkbookPlan,actor:string,storage:Storage,progress?:(done:number,total:number)=>void){
 if(typeof navigator==='undefined'||!navigator.locks)throw Error('PRODUCT_IMPORT_LOCK_REQUIRED');
 return navigator.locks.request(productWorkbookLockName(actor),{ifAvailable:true},async lock=>{
  if(!lock)throw Error('PRODUCT_IMPORT_BUSY');return saveProductWorkbookUnlocked(plan,actor,storage,progress);
 });
}

import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{build}from'esbuild';import{webcrypto}from'node:crypto';
import{PRODUCT_WORKBOOK_COLUMNS as C,FLAVOR_WORKBOOK_COLUMNS as F,prepareProductWorkbook}from'../src/features/goLive/productWorkbook';
const actor='92600000-0000-4000-8000-000000000001';
const bytes=(v:Record<string,string>)=>C.map(c=>({sku:'TPL',barcode:'',name_ar:'منتج وهمي',category_name:'سكر',base_unit_name:'PKT',purchase_unit_name:'CTN',units_per_purchase_unit:'12',sale_unit_name:'CTN',units_per_sale_unit:'12',sale_package_price:'9.000',purchase_package_price:'6.000',cost_per_base_unit:'0.500',parcel_only:'لا',sale_method:'الاثنين',packet_price:'0.750',...v}[c.key]??''));
const plan=(family=false)=>prepareProductWorkbook([C.map(c=>c.header),bytes({})],family?[F.map(c=>c.header),F.map(c=>({master_sku:'TPL',name:'ليمون',barcode:'000123'}[c.key]??''))]:[]);
const discountedPlan=(family=false)=>prepareProductWorkbook([C.map(c=>c.header),bytes({units_per_sale_unit:'20',sale_package_price:'17.000',packet_price:'0.900'})],family?[F.map(c=>c.header),F.map(c=>({master_sku:'TPL',name:'ليمون',barcode:'000123'}[c.key]??''))]:[],'sales-only');
const compile=(entry:string)=>build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'isolated-client-only',setup(b){b.onResolve({filter:/lib\/supabase$/},()=>({path:'client',namespace:'local-only'}));b.onResolve({filter:/^\.\/goLive\.service$/},()=>({path:'status',namespace:'local-only'}));b.onLoad({filter:/.*/,namespace:'local-only'},args=>({contents:args.path==='client'?"export const isSupabaseConfigured=true,sanitizedSupabaseUrl='http://127.0.0.1:25431',supabase=globalThis.__DB;":"export async function fetchGoLiveStatus(){if(!globalThis.__OWNER)throw Error('DENIED');return {finished:false}}",loader:'js'}));}}]});
const bundle=compile('src/services/supabase/productWorkbook.service.ts'),barcodeBundle=compile('src/services/supabase/productFamilyBarcodes.service.ts');
async function fixture(options:{accounting225?:boolean;lossWarning?:boolean}={}){
 let next=10,version=0,loseCreate=false,loseWrite=false,owner=true,lockBusy=false,lockMissing=false,fullMode=false;const uid=()=>`92600000-0000-4000-8000-${String(++next).padStart(12,'0')}`;
 const tables:Record<string,any[]>={categories:[{id:'cat',name_ar:'سكر',is_active:true}],units:[{id:'pkt',code:'PKT',name_ar:'باكيت'},{id:'ctn',code:'CTN',name_ar:'طرد'}],brands:[],warehouses:[{id:'wh',code:'WH-MAIN',name_ar:'الرئيسي',is_active:true}],products:[]};
 const calls:{name:string;args:any}[]=[];
 const create=(a:any,sku:string,name:string,barcode:string|null=null,parent:string|null=null,flavor:string|null=null)=>{const row={id:uid(),sku:sku.toUpperCase(),barcode,name_ar:name,description:a.p_description??null,category_id:a.p_category_id??'cat',brand_id:a.p_brand_id??null,unit_id:a.p_unit_id??'pkt',purchase_unit_id:a.p_purchase_unit_id??'ctn',units_per_purchase_unit:String(a.p_units_per_purchase_unit??12),default_purchase_price_in_minor_units:String(a.p_default_purchase_price_in_minor_units??6000),sale_unit_id:a.p_sale_unit_id??'ctn',units_per_sale_unit:String(a.p_units_per_sale_unit??12),default_sale_price_in_minor_units:String(a.p_default_sale_price_in_minor_units??9000),sale_price_in_minor_units:String(a.p_sale_price_in_minor_units??Math.round(Number(a.p_default_sale_price_in_minor_units??9000)/Number(a.p_units_per_sale_unit??12))),cost_price_in_minor_units:String(a.p_cost_price_in_minor_units??500),min_stock_level:String(a.p_min_stock_level??0),max_stock_level:a.p_max_stock_level??null,is_active:true,parcel_only:a.p_parcel_only??false,updated_at:String(++version),flavor_master_product_id:parent,is_flavor_master:false,flavor_name_ar:flavor};tables.products.push(row);return row;};
 const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},from:(table:string)=>{const filters:((r:any)=>boolean)[]=[];let single=false,lo=0,hi=Infinity;
 const run=()=>{const rows=tables[table].filter(r=>filters.every(f=>f(r))).slice(lo,hi+1);return{data:single?rows[0]:rows,error:null};};
 const query:any={select:()=>query,order:()=>query,range:(a:number,b:number)=>{lo=a;hi=b;return query;},eq:(key:string,value:any)=>{filters.push(r=>r[key]===value);return query;},limit:(n:number)=>{hi=n-1;return query;},single:()=>{single=true;return query;},then:(resolve:any)=>Promise.resolve(run()).then(resolve)};return query;},rpc:async(name:string,a:any)=>{calls.push({name,args:structuredClone(a)});
 if(name==='get_product_pricing_context225'){assert.equal(a.p_product_id,null);return options.accounting225?
  {data:{contractVersion:'on-independent-prices225-v1',mode:'full'},error:null}:
  {data:null,error:{code:'PGRST202',message:'public.get_product_pricing_context225'},status:404};}
 if(name==='create_product_with_opening_stock_v7'&&options.lossWarning&&!a.p_below_cost_confirmation){
  const detail={acknowledged:true,contractVersion:'on-prices225-create-confirmation-v1',productSku:a.p_sku,
   unitPrice:Number(a.p_sale_price_in_minor_units),parcelPrice:Number(a.p_default_sale_price_in_minor_units),unitsPerParcel:Number(a.p_units_per_sale_unit),
   parcelEnabled:true,parcelOnly:false,risks:[{name:a.p_name_ar,wacInMinorUnitsExact:'950.000000',unitBelowCost:true,parcelBelowCost:true,productSku:a.p_sku}]};
  return {data:null,error:{message:'PRICES225_BELOW_WAC_CONFIRMATION_REQUIRED: test',details:JSON.stringify(detail)}};
 }
 if(name==='lite1_operating_mode')return{data:{contractVersion:'sales-only-phase2-v1',fullAccounting:fullMode},error:null};
 if((name==='create_product_family_with_flavors_v2'||name==='create_product_family_with_flavors_v3'||name==='create_product_family_with_flavors_v4')){const parent=create(a,a.p_sku,a.p_name_ar);parent.is_flavor_master=true;for(const f of a.p_flavors)create(a,a.p_sku+'-F-'+next,a.p_name_ar+' - '+f.nameAr,null,parent.id,f.nameAr);if(loseCreate){loseCreate=false;return{data:null,error:{message:'raw sensitive technical data'}};}return{data:{success:true},error:null};}
 if(name==='create_product_with_opening_stock_v6'||name==='create_product_with_opening_stock_v7'){const row=create(a,a.p_sku,a.p_name_ar,a.p_barcode||null);if(loseCreate){loseCreate=false;return{data:null,error:{message:'LOCAL_LOST_RESPONSE'}};}return{data:{success:true,product_id:row.id},error:null};}
 if(name==='import_go_live_products_v1'){for(const p of a.p_rows)create({},p.sku,p.name_ar,p.barcode||null);return{data:{success:true},error:null};}
 if(name==='update_product_flavor_v2'){const row=tables.products.find(p=>p.id===a.p_flavor_product_id);assert.equal(row.updated_at,a.p_expected_updated_at);row.barcode=a.p_barcode;row.updated_at=String(++version);if(loseWrite){loseWrite=false;return{data:null,error:{message:'RAW TOKEN'}};}return{data:{success:true},error:null};}
 if((name==='update_product_master_v5'||name==='update_product_master_v6'||name==='update_product_master_v7')){const row=tables.products.find(p=>p.id===a.p_product_id);assert.equal(row.updated_at,a.p_expected_updated_at);if(row.flavor_master_product_id)assert.equal(a.p_parcel_only,null,'inherited method must not be rewritten');for(const[key,value]of Object.entries(a))if(!['p_product_id','p_expected_updated_at','p_image_url'].includes(key)&&!(key==='p_parcel_only'&&value===null))row[key.slice(2)]=value;row.updated_at=String(++version);if(loseWrite&&(row.flavor_master_product_id||name==='update_product_master_v6')){loseWrite=false;return{data:null,error:{message:'RAW'}};}return{data:{success:true},error:null};}throw Error('UNEXPECTED_RPC');}};
 const module={exports:{}};const context=vm.createContext({__DB:client,get navigator(){return{locks:lockMissing?undefined:{request:async(_name:string,_options:unknown,callback:(lock:unknown)=>unknown)=>callback(lockBusy?null:{mode:'exclusive'})}};},get __OWNER(){return owner;},module,exports:module.exports,crypto:webcrypto,TextEncoder,TextDecoder,structuredClone});vm.runInContext((await bundle).outputFiles[0].text,context);
 const api=module.exports as any;const store=new Map<string,string>();const storage:Storage={get length(){return store.size;},key:i=>[...store.keys()][i]??null,getItem:k=>store.get(k)??null,setItem:(k,v)=>{store.set(k,v);},removeItem:k=>{store.delete(k);},clear:()=>store.clear()};
 const barcodeModule={exports:{}};vm.runInContext((await barcodeBundle).outputFiles[0].text,vm.createContext({__DB:client,module:barcodeModule,exports:barcodeModule.exports,crypto:webcrypto,TextEncoder,TextDecoder,structuredClone}));
 return{setFullMode:()=>{fullMode=true;},api,barcodeApi:barcodeModule.exports as any,seedFamily:()=>client.rpc('create_product_family_with_flavors_v2',{p_sku:'FORM',p_name_ar:'عائلة شاشة',p_flavors:[{nameAr:'ليمون'}]}),storage,tables,calls,lockBusy:()=>{lockBusy=true;},lockMissing:()=>{lockMissing=true;},loseCreate:()=>{loseCreate=true;},loseWrite:()=>{loseWrite=true;},deny:()=>{owner=false;}};
}
test('adapter actual source completes ordinary row and a family with exact barcode/SKU and preserved inherited method',async()=>{const ordinary=await fixture();await ordinary.api.saveProductWorkbook(plan(),actor,ordinary.storage);assert.equal(ordinary.tables.products.length,1);assert.equal(ordinary.tables.products[0].sku,'TPL');
 const f=await fixture();await f.api.saveProductWorkbook(plan(true),actor,f.storage);const rows=f.tables.products;assert.equal(rows.length,2);assert.equal(rows[0].sku,'TPL');assert.equal(rows[1].sku,'TPL-ليمون');assert.equal(rows[1].barcode,'000123');assert.equal(rows[1].cost_price_in_minor_units,'500');assert.equal(rows[1].default_sale_price_in_minor_units,'9000');assert.ok(f.calls.every(c=>!c.name.includes('inventory')));});
test('real adapter lost create/finalize responses resume same IDs and create once;completed recheck writes zero',async()=>{
 for(const phase of ['create','finalize']){const f=await fixture();if(phase==='create')f.loseCreate();else f.loseWrite();await assert.rejects(f.api.saveProductWorkbook(plan(true),actor,f.storage));const ids=f.tables.products.map(p=>p.id);await f.api.saveProductWorkbook(plan(true),actor,f.storage);assert.deepEqual(f.tables.products.map(p=>p.id),ids);assert.equal(f.calls.filter(c=>c.name==='create_product_family_with_flavors_v2').length,1);const count=f.calls.length;await f.api.saveProductWorkbook(plan(true),actor,f.storage);assert.equal(f.calls.length,count);}
});
test('wrong actor/owner gate and untrusted errors cannot write or expose raw messages',async()=>{const f=await fixture();await assert.rejects(f.api.saveProductWorkbook(plan(), 'OTHER',f.storage));f.deny();await assert.rejects(f.api.saveProductWorkbook(plan(),actor,f.storage));assert.equal(f.calls.length,0);assert.doesNotMatch(f.api.productImportErrorText(Error('secret token customer 50.000')),/secret|token|50\.000/u);});


test('form barcode second phase persists IDs,does not recreate family or change prices,and resumes a lost response once',async()=>{
 const f=await fixture();await f.seedFamily();const familyId=f.tables.products[0].id,commercial=f.tables.products.map(r=>[r.cost_price_in_minor_units,r.default_sale_price_in_minor_units,r.units_per_purchase_unit]);
 f.loseWrite();await assert.rejects(f.barcodeApi.completeFamilyBarcodes(actor,familyId,f.storage,[{name:'ليمون',barcode:'000998'}]),/FLV-02/u);assert.deepEqual(Array.from(f.barcodeApi.pendingFamilyBarcodes(actor,f.storage)),[familyId]);
 await f.barcodeApi.completeFamilyBarcodes(actor,familyId,f.storage);assert.equal(f.tables.products[1].barcode,'000998');assert.equal(f.calls.filter(c=>c.name==='update_product_flavor_v2').length,1);assert.equal(f.calls.filter(c=>c.name==='create_product_family_with_flavors_v2').length,1);assert.deepEqual(f.tables.products.map(r=>[r.cost_price_in_minor_units,r.default_sale_price_in_minor_units,r.units_per_purchase_unit]),commercial);assert.equal(f.barcodeApi.pendingFamilyBarcodes(actor,f.storage).length,0);
 assert.doesNotMatch(f.barcodeApi.familyBarcodeErrorText(Error('RAW TOKEN (FLV-02).')),/RAW|TOKEN/u);
});


test('another tab or unavailable WebLocks refuse before journal or RPC writes',async()=>{for(const kind of ['lockBusy','lockMissing']as const){const f=await fixture();f[kind]();await assert.rejects(f.api.saveProductWorkbook(plan(true),actor,f.storage),/PRODUCT_IMPORT_(?:BUSY|LOCK_REQUIRED)/u);assert.equal(f.calls.length,0);assert.equal(f.storage.length,0);}});

test('lite import binds mode to journal;zero-cost family lost response resumes through existing writers without duplication',async()=>{
 const f=await fixture(),p=prepareProductWorkbook([C.map(c=>c.header),bytes({purchase_package_price:'',cost_per_base_unit:''})],[F.map(c=>c.header),F.map(c=>({master_sku:'TPL',name:'ليمون',barcode:'000123'}[c.key]??''))],'sales-only');
 assert.deepEqual(p.errors,[]);f.loseCreate();await assert.rejects(f.api.saveProductWorkbook(p,actor,f.storage));const ids=f.tables.products.map(p=>p.id);
 await f.api.saveProductWorkbook(p,actor,f.storage);assert.deepEqual(f.tables.products.map(p=>p.id),ids);assert.equal(f.calls.filter(c=>c.name==='create_product_family_with_flavors_v3').length,1);
 assert.ok(f.tables.products.every(p=>p.cost_price_in_minor_units==='0'));assert.equal(f.tables.products[1].barcode,'000123');
 await assert.rejects(f.api.saveProductWorkbook({...p,operatingMode:undefined},actor,f.storage),/PRODUCT_IMPORT_ATTEMPT_MISMATCH/);
 f.setFullMode();const before=f.calls.filter(c=>c.name!=='lite1_operating_mode').length;await assert.rejects(f.api.saveProductWorkbook(p,actor,f.storage),/PRODUCT_IMPORT_MODE_CHANGED/);assert.equal(f.calls.filter(c=>c.name!=='lite1_operating_mode').length,before);
});


test('OFF real import adapter sends both explicit prices and resumes lost create/finalize responses without changing either',async()=>{
 for(const family of [false,true])for(const phase of ['none','create','finalize']){
  const f=await fixture();if(phase==='create')f.loseCreate();if(phase==='finalize')f.loseWrite();
  const value=discountedPlan(family);assert.deepEqual(value.errors,[]);
  if(phase==='none')await f.api.saveProductWorkbook(value,actor,f.storage);else await assert.rejects(f.api.saveProductWorkbook(value,actor,f.storage));
  const ids=f.tables.products.map(p=>p.id);await f.api.saveProductWorkbook(value,actor,f.storage);
  assert.deepEqual(f.tables.products.map(p=>p.id),ids);assert.equal(f.tables.products.length,family?2:1);
  for(const row of f.tables.products){assert.equal(String(row.sale_price_in_minor_units),'900');assert.equal(String(row.default_sale_price_in_minor_units),'17000');assert.equal(String(row.units_per_sale_unit),'20');}
  assert.equal(f.calls.filter(c=>c.name===(family?'create_product_family_with_flavors_v3':'create_product_with_opening_stock_v6')).length,1);
  const writes=f.calls.filter(c=>['update_product_master_v6','create_product_family_with_flavors_v3','create_product_with_opening_stock_v6'].includes(c.name));
  assert.ok(writes.length>0);for(const call of writes){assert.equal(String(call.args.p_sale_price_in_minor_units),'900');assert.equal(String(call.args.p_default_sale_price_in_minor_units),'17000');}
  assert.equal(f.calls.filter(c=>['update_product_master_v5','create_product_family_with_flavors_v2','import_go_live_products_v1'].includes(c.name)).length,0);
 }
});

const on225plan=(family=false)=>prepareProductWorkbook([C.map(c=>c.header),bytes({
 units_per_sale_unit:'20',sale_package_price:'17.000',packet_price:'0.900',cost_per_base_unit:'0.950',
})],family?[F.map(c=>c.header),F.map(c=>({master_sku:'TPL',name:'ليمون',barcode:'000123'}[c.key]??''))]:[],'full',{independentFullPrices:true});

test('ON225 resume keeps independent single and parcel prices on ordinary products and every flavor',async()=>{
 for(const family of [false,true]){
  const f=await fixture({accounting225:true});
  f.loseCreate();
  const prepared=on225plan(family);assert.deepEqual(prepared.errors,[]);
  await assert.rejects(f.api.saveProductWorkbook(prepared,actor,f.storage));
  const ids=f.tables.products.map(p=>p.id);
  await f.api.saveProductWorkbook(prepared,actor,f.storage);
  assert.deepEqual(f.tables.products.map(p=>p.id),ids);
  assert.ok(f.tables.products.every(p=>p.sale_price_in_minor_units==='900'&&p.default_sale_price_in_minor_units==='17000'));
  assert.equal(f.calls.filter(c=>c.name===(family?'create_product_family_with_flavors_v4':'create_product_with_opening_stock_v7')).length,1);
  assert.equal(f.calls.filter(c=>c.name==='update_product_master_v7').length,1);
  assert.equal(f.calls.filter(c=>c.name==='import_go_live_products_v1').length,0);
  if(family)assert.equal(f.tables.products[1].barcode,'000123');
 }
});

test('a loss needs explicit consent before resending exact server confirmation, and an unsupported server never writes',async()=>{
 const older=await fixture();
 await assert.rejects(older.api.saveProductWorkbook(on225plan(),actor,older.storage),/PRODUCT_IMPORT_MODE_CHANGED/);
 assert.deepEqual(older.calls.map(c=>c.name),['get_product_pricing_context225']);
 assert.equal(older.storage.length,0);
 const f=await fixture({accounting225:true,lossWarning:true});
 let seen=0;
 await assert.rejects(f.api.saveProductWorkbook(on225plan(),actor,f.storage,undefined,async(proof:unknown)=>{
  assert.deepEqual(JSON.parse(JSON.stringify(proof)).risks.map((r:{wacInMinorUnitsExact:string})=>r.wacInMinorUnitsExact),['950.000000']);
  seen++;return false;
 }),/PRODUCT_IMPORT_PRICE_CONFIRMATION_DECLINED/);
 assert.equal(seen,1);assert.equal(f.tables.products.length,0);
 await f.api.saveProductWorkbook(on225plan(),actor,f.storage,undefined,async()=>true);
 const calls=f.calls.filter(c=>c.name==='create_product_with_opening_stock_v7');
 assert.equal(calls.length,3);
 assert.equal(calls[0].args.p_below_cost_confirmation,null);
 assert.equal(calls[1].args.p_below_cost_confirmation,null);
 assert.equal(calls[2].args.p_below_cost_confirmation.unitPrice,900);
 assert.equal(calls[2].args.p_below_cost_confirmation.productSku,calls[2].args.p_sku);
 assert.equal(new Set(calls.map(c=>c.args.p_sku)).size,1);
 assert.equal(f.tables.products.length,1);
});

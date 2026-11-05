// Current application service, fixed local RPC transport. Never a hosted client.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';
import {productWorkbookDbTransport} from './product-workbook-db-transport.mjs';
import {productWorkbookScaleData} from './product-workbook-scale-data.ts';
import {prepareProductWorkbook,readProductWorkbook,productWorkbookStockRows,PRODUCT_WORKBOOK_COLUMNS as C} from '../../src/features/goLive/productWorkbook.ts';
import {GO_LIVE_COLUMNS,GO_LIVE_BATCH_SIZE,mapSheet,prepareStock,chunk} from '../../src/features/goLive/goLiveImport.ts';
import {writeXlsx,readXlsxFirstSheet} from '../../src/lib/xlsx.ts';

const root=path.resolve(import.meta.dirname,'../..');
export const scaleFixtureRoot=path.join(root,'scripts/testing/fixtures/product-workbook-scale');
const q=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function runProductWorkbookScaleCase({json,sql,auth,actor,container,out,full=false}){
 assert.equal(container,'supabase_db_nawasrah-product-template-test');assert.equal(actor,id(1));
 const started=performance.now(),model=productWorkbookScaleData();
 let plan;
 if(full){const decoded=await readProductWorkbook(await readFile(path.join(scaleFixtureRoot,'المنتجات-وهمي-1000.xlsx')));plan=prepareProductWorkbook(decoded.products,decoded.flavors);}
 else{
  // All modes, max30 family, Arabic/long/numeric identifiers, filled/empty stock.
  const indices=[0,1,2,29,32,33,34,100,101,700],products=[model.positive[0].rows[0],...indices.map(i=>model.positive[0].rows[i+1])];
  const key=C.findIndex(c=>c.key==='sku'),masters=new Set(products.slice(1).map(r=>String(r[key])));
  const flavors=[model.positive[1].rows[0],...model.positive[1].rows.slice(1).filter(r=>masters.has(String(r[0])))];
  plan=prepareProductWorkbook(products.map(r=>r.map(String)),flavors.map(r=>r.map(String)));
 }
 assert.deepEqual(plan.errors,[]);const flavorCount=plan.products.reduce((n,p)=>n+p.flavors.length,0),families=plan.products.filter(p=>p.flavors.length).length,ordinary=plan.products.length-families;
 await sql(`INSERT INTO categories(code,name_ar) SELECT 'SCALE-DRINKS','ﻣﺸﺮﻭﺑﺎﺕ   وهمية' WHERE NOT EXISTS(SELECT 1 FROM categories WHERE name_ar='ﻣﺸﺮﻭﺑﺎﺕ   وهمية' AND is_active);INSERT INTO categories(code,name_ar) SELECT 'TPL-CHOC','شوكولاتة' WHERE NOT EXISTS(SELECT 1 FROM categories WHERE name_ar='شوكولاتة' AND is_active);INSERT INTO units(code,name_ar) VALUES('PKT','باكيت'),('CTN','طرد') ON CONFLICT(code) DO NOTHING;INSERT INTO brands(name_ar,is_active) SELECT 'علامة اختبار حجم وهمية',true WHERE NOT EXISTS(SELECT 1 FROM brands WHERE name_ar='علامة اختبار حجم وهمية');INSERT INTO warehouses(id,branch_id,code,name_ar,is_active) SELECT ${q(id(202))},${q(id(200))},'WH-MAIN','مستودع اختبار الحجم',true WHERE NOT EXISTS(SELECT 1 FROM warehouses WHERE code='WH-MAIN' AND is_active);`);
 // Explicit role-local timeout on EVERY application request, not SET ROLE alone.
 assert.equal(await json(auth("SELECT to_jsonb(current_setting('statement_timeout'));")),'8s');
 const entries=new Map(),storage={get length(){return entries.size;},key:i=>[...entries.keys()][i]??null,getItem:k=>entries.get(k)??null,setItem:(k,v)=>{entries.set(k,v);},removeItem:k=>{entries.delete(k);},clear:()=>entries.clear()};
 let familyCreates=0,ordinaryCreates=0,flavorWrites=0,phase=0;
 const timings=[],interruptions=[],committed=new Map();
 const measured=async text=>{
  const name=/SELECT public\.([a-z0-9_]+)\(/u.exec(text)?.[1];
  if(phase===0&&name==='create_product_family_with_flavors_v2'&&familyCreates===Math.floor(families/2)){phase=1;throw Error('SCALE_BEFORE_FAMILY');}
  const isFlavor=name==='update_product_master_v5'&&text.includes('p_parcel_only:=NULL::boolean');
  if(phase===1&&isFlavor&&flavorWrites===Math.floor(flavorCount/2)){phase=2;throw Error('SCALE_BEFORE_FLAVOR');}
  const t=performance.now(),value=await json(text),ms=performance.now()-t;
  if(name){timings.push({rpc:name,ms,rows:name==='import_go_live_products_v1'?1:undefined});committed.set(name,(committed.get(name)??0)+1);}
  if(name==='create_product_family_with_flavors_v2')familyCreates++;
  if(isFlavor)flavorWrites++;
  if(name==='import_go_live_products_v1'){
   ordinaryCreates++;
   if(phase===2&&ordinaryCreates===Math.ceil(ordinary/2)){phase=3;throw Error('SCALE_LOST_COMMITTED_REPLY');}
  }
  return value;
 };
 let previousIds=new Map();
 for(let restart=0;restart<4;restart++){
  // Fresh service instance after each simulated process loss, same exact journal.
  const bridge=await productWorkbookDbTransport({json:measured,auth,actor,container});
  if(restart<3){await assert.rejects(bridge.service.saveProductWorkbook(plan,actor,storage));assert.equal(phase,restart+1);}
  else{const result=await bridge.service.saveProductWorkbook(plan,actor,storage);assert.equal(result.complete,true);}
  const attempt=JSON.parse([...entries.values()][0]);
  for(const [i,entry]of attempt.entries.entries())if(entry.masterId){if(previousIds.has(i))assert.equal(entry.masterId,previousIds.get(i),'RESUME_CHANGED_MASTER');previousIds.set(i,entry.masterId);}
  await writeFile(path.join(out,`scale-${full?'full':'small'}-journal-${restart}.json`),JSON.stringify(attempt,null,2)+'\n');
  const journal=path.join(out,`scale-${full?'full':'small'}-storage-${restart}.json`);
  await writeFile(journal,JSON.stringify([...entries]));entries.clear();for(const[k,v]of JSON.parse(await readFile(journal,'utf8')))entries.set(k,v);
  interruptions.push({phase:restart,completed:attempt.entries.filter(e=>e.complete).length,knownMasterIds:previousIds.size,elapsedMs:performance.now()-started});
  console.log(JSON.stringify({scale:full?'full':'small',restart,completed:interruptions.at(-1).completed}));
 }
 assert.equal(familyCreates,families);assert.equal(ordinaryCreates,ordinary);assert.equal(flavorWrites,flavorCount);
 const expected=plan.products.flatMap(p=>[{p,sku:p.data.sku,barcode:p.data.barcode,name:p.data.name_ar,flavor:null,stock:p.flavors.length?0:p.openingStock??0},...p.flavors.map(f=>({p,sku:f.sku,barcode:f.barcode,name:p.data.name_ar+' - '+f.name,flavor:f.name,stock:f.openingStock??0}))]);
 const actual=await json("SELECT jsonb_agg(to_jsonb(p)) FROM products p WHERE sku LIKE 'SCALE-%' OR sku LIKE 'FLAVOR-%';");
 assert.equal(actual.length,expected.length);assert.equal(new Set(actual.map(r=>r.sku)).size,actual.length);
 const bySku=new Map(actual.map(r=>[r.sku,r]));
 for(const e of expected){const a=bySku.get(e.sku),p=e.p.data;assert.ok(a,e.sku);assert.equal(a.barcode??'',e.barcode);assert.equal(a.name_ar,e.name);assert.equal(a.description,e.p.description||null);assert.equal(a.flavor_name_ar,e.flavor);assert.equal(a.units_per_purchase_unit,Number(p.units_per_purchase_unit));assert.equal(a.units_per_sale_unit,Number(p.units_per_sale_unit));assert.equal(a.cost_price_in_minor_units,Number(p.cost_per_base_unit_in_minor_units));assert.equal(a.default_sale_price_in_minor_units,Number(p.sale_package_price_in_minor_units));assert.equal(a.default_purchase_price_in_minor_units,Number(p.purchase_package_price_in_minor_units));assert.equal(a.parcel_only,p.parcel_only??false);assert.equal(a.max_stock_level,e.p.maxStock);if(e.flavor)assert.equal(a.flavor_master_product_id,bySku.get(p.sku).id);}
 // Service itself additionally compares every commercial/reference metadata field.
 assert.ok(JSON.parse([...entries.values()][0]).entries.every(e=>e.complete));
 const writeCount=[...committed.entries()].filter(([n])=>n!=='get_go_live_setup_status_v1').reduce((n,[,c])=>n+c,0);
 const replay=await productWorkbookDbTransport({json:measured,auth,actor,container});
 await replay.service.saveProductWorkbook(plan,actor,storage);
 assert.equal([...committed.entries()].filter(([n])=>n!=='get_go_live_setup_status_v1').reduce((n,[,c])=>n+c,0),writeCount);
 assert.equal(await json(`SELECT to_jsonb(COALESCE(sum(on_hand_quantity),0)) FROM inventory_balances WHERE product_id IN(${actual.map(r=>q(r.id)).join(',')});`),0);
 const importedAt=performance.now();
 // Exact current UI download => current parser => current protected stock service.
 const exported=productWorkbookStockRows(plan),bytes=writeXlsx([{name:'البيانات',rows:[GO_LIVE_COLUMNS.stock.map(c=>c.header),...exported.map(r=>GO_LIVE_COLUMNS.stock.map(c=>({code:r.sku,name:'',package_count:String(r.packageCount),loose_units:String(r.looseUnits)}[c.key]??'')))]}]);
 await writeFile(path.join(out,'البضاعة-الموجودة-'+(full?'1000':'small')+'.xlsx'),bytes);
 const signatures=await json("SELECT jsonb_object_agg(p.proname,(SELECT jsonb_object_agg(p.proargnames[g],format_type(p.proargtypes[g-1],NULL)) FROM generate_series(1,p.pronargs)g)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('get_inventory_opening_setup','apply_inventory_opening_setup');");
 const db={rpc:async(name,args)=>{assert.ok(['get_inventory_opening_setup','apply_inventory_opening_setup'].includes(name));const signature=signatures[name];const parameters=Object.entries(args).map(([k,v])=>{assert.ok(Object.hasOwn(signature,k));const type=signature[k];assert.match(type,/^(text|jsonb|uuid)$/u);return k+':='+q(type==='jsonb'?JSON.stringify(v):v)+'::'+type;}).join(',');return{data:await measured(auth('SELECT public.'+name+'('+parameters+');')),error:null};}};
 const compiled=await build({absWorkingDir:root,entryPoints:['src/services/supabase/inventory-opening.service.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'fixed-local-stock',setup(b){b.onResolve({filter:/lib\/supabase$/},()=>({path:'client',namespace:'local-stock'}));b.onLoad({filter:/.*/,namespace:'local-stock'},()=>({contents:'export const supabase=globalThis.__DB,isSupabaseConfigured=true;',loader:'js'}));}}]});
 const module={exports:{}};vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,__DB:db});const stockService=module.exports;
 const warehouse=await json("SELECT to_jsonb(id) FROM warehouses WHERE code='WH-MAIN' AND is_active;");
 const setup=await stockService.fetchInventoryOpeningSetupFromSupabase(warehouse);
 const mapped=mapSheet('stock',await readXlsxFirstSheet(bytes));assert.deepEqual(mapped.fileErrors,[]);
 const stock=prepareStock(mapped.rows,setup.products);assert.deepEqual(stock.errors,[]);assert.equal(stock.payload.length,exported.length);
 const stockTimings=[];
 for(const [i,batch]of chunk(stock.payload,GO_LIVE_BATCH_SIZE.stock).entries()){
  const input={warehouseId:warehouse,rows:batch,notes:'جرد وهمي لاختبار الحجم فقط',idempotencyKey:'scale-'+(full?'full':'small')+'-stock-'+i};
  const t=performance.now();const result=await stockService.applyInventoryOpeningSetupInSupabase(input);assert.equal(result.itemCount,batch.length);stockTimings.push({batch:i,rows:batch.length,ms:performance.now()-t});
  const repeated=await stockService.applyInventoryOpeningSetupInSupabase(input);assert.equal(repeated.idempotentReplay,true);
 }
 const balances=await json(`SELECT COALESCE(jsonb_object_agg(p.id::text,COALESCE(b.on_hand_quantity,0)),'{}') FROM products p LEFT JOIN inventory_balances b ON b.product_id=p.id AND b.warehouse_id=${q(warehouse)} WHERE p.id IN(${actual.map(r=>q(r.id)).join(',')});`);
 let value=0n,quantity=0;for(const e of expected){assert.equal(balances[bySku.get(e.sku).id],e.stock,e.sku);quantity+=e.stock;value+=BigInt(e.stock)*BigInt(e.p.data.cost_per_base_unit_in_minor_units);}
 const wac=await json(`SELECT jsonb_object_agg(id::text,wac_cost_in_minor_units_exact) FROM products WHERE id IN(${actual.map(r=>q(r.id)).join(',')});`);for(const e of expected)if(e.stock)assert.equal(String(wac[bySku.get(e.sku).id]),e.p.data.cost_per_base_unit_in_minor_units);
 const report={ok:true,mode:full?'full':'small',seed:model.seed,parents:plan.products.length,families,flavors:flavorCount,actualProducts:actual.length,matchedEveryRow:true,interruptions,committed:Object.fromEntries(committed),replayAdditionalProductWrites:0,authenticatedTimeout:'8s',anonTimeout:'3s',productBatch:'one parent;up to30flavors atomically',stockBatch:GO_LIVE_BATCH_SIZE.stock,stockRows:stock.payload.length,stockQuantity:quantity,stockValueMinor:String(value),blankStock:plan.missingStock,timings,stockTimings,importAndResumeMs:importedAt-started,totalMs:performance.now()-started};
 assert.ok(timings.every(t=>t.ms<8000),'REQUEST_EXCEEDED_AUTH_TIMEOUT');assert.ok(stockTimings.every(t=>t.ms<6000),'STOCK_BATCH_HAS_NO_2S_MARGIN');
 await writeFile(path.join(out,'scale-'+report.mode+'.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,timings:undefined,stockTimings}));return report;
}

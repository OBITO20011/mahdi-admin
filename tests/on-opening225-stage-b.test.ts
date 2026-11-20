import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeXlsx,readXlsxSheet} from '../src/lib/xlsx';
import {PRODUCT_WORKBOOK_COLUMNS,FLAVOR_WORKBOOK_COLUMNS} from '../src/features/goLive/productWorkbook';
import {openingCatalog225,ownerPriceRows225,ownerStockRows225,convertOpening225,convertStageBStock225,PRICE_COLUMNS225 as P,STOCK_COLUMNS225 as S,type StageBProduct225} from '../scripts/operations/on-opening225/model';
import {runOpening225} from '../scripts/operations/on-opening225/cli';
import {stageABaseline225} from '../scripts/operations/two-stage225.mjs';
import {backupSourceEvidenceSha256} from '../scripts/backup/complete-backup.mjs';
const hash=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
const fields:Record<string,string>={sku:'NW-0001',name_ar:'صنف وهمي',barcode:'000123',category_name:'قسم',base_unit_name:'PKT',purchase_unit_name:'PKT',units_per_purchase_unit:'1',sale_unit_name:'PKT',units_per_sale_unit:'1',sale_package_price:'1.000',packet_price:'1.000',sale_method:'باكيت مفرد'};
const ref={categories:[{name:'قسم',active:true}],units:[{code:'PKT',name:'باكيت'},{code:'CTN',name:'كرتونة'}],warehouses:[{code:'WH-A',active:true}],products:[]};
const settings={defaultWarehouse:'WH-A',valuationThreshold:'0.100'};
function fixture(){
 const productSheet=[PRODUCT_WORKBOOK_COLUMNS.map(c=>c.header),PRODUCT_WORKBOOK_COLUMNS.map(c=>fields[c.key]??'')],flavors=[FLAVOR_WORKBOOK_COLUMNS.map(c=>c.header)];
 const catalog=openingCatalog225(productSheet,flavors,ref.units),prices=ownerPriceRows225(catalog),stock=ownerStockRows225(catalog);
 const price=(changes:Record<string,string>)=>{for(const[k,v]of Object.entries(changes))prices[1][P.findIndex(c=>c[0]===k)]=v;};
 const count=(changes:Record<string,string>)=>{for(const[k,v]of Object.entries(changes))stock[1][S.findIndex(c=>c[0]===k)]=v;};
 price({purchaseUnit:'CTN',purchaseCount:'24',invoicePrice:'12.000',basis:'طرد',invoiceRef:'INV-A',invoiceDate:'2026-11-19'});count({packages:'3',loose:'5'});
 const live:StageBProduct225[]=[{id:'00000000-0000-4000-8000-000000000001',sku:'NW-0001',name:'اسم عدله المالك',active:true,master:false,unitCode:'PKT',unitName:'باكيت',purchaseUnitCode:'CTN',unitsPerPackage:24,costPriceInMinorUnits:500,wacExact:null,updatedAt:'2026-11-24T10:00:00Z'}];
 return {catalog,productSheet,flavors,prices,stock,price,count,live,run:()=>convertStageBStock225(catalog,prices,stock,settings,ref,live)};
}
test('stage B keeps77base units and live name; emits no product/flavor output or price write',()=>{
 const f=fixture(),r=f.run();assert.equal(r.ok,true,JSON.stringify(r.errors));assert.equal(r.audit[0].quantity,'77');assert.equal(r.audit[0].unitCostMinor,'500');assert.equal(r.totalOpeningValueMinor,'38500');
 assert.equal(r.stockFiles[0].rows[1][1],'اسم عدله المالك');assert.equal(r.productWrites,0);assert.ok(!('productRows'in r));assert.ok(!('flavorRows'in r));
});
test('a changed live cost is refused until the worksheet agrees; changing the sheet never updates the product',()=>{
 const f=fixture();f.live[0].costPriceInMinorUnits=600;f.live[0].wacExact='600.000000';
 const failed=f.run();assert.equal(failed.ok,false);assert.match(failed.errors.find(e=>e.code==='LIVE_COST_MISMATCH')!.message,/NW-0001.*0.500.*0.600/u);
 assert.equal(f.live[0].costPriceInMinorUnits,600);
 f.price({invoicePrice:'14.400'});const r=f.run();assert.equal(r.ok,true,JSON.stringify(r.errors));assert.equal(r.audit[0].unitCostMinor,'600');assert.equal(r.totalOpeningValueMinor,'46200');
});
test('purchase content, base unit, fractional WAC, inactive row and missing SKU all refuse B',()=>{
 for(const change of [{unitsPerPackage:12},{unitCode:'BOX'},{wacExact:'500.5'},{active:false}]){
  const f=fixture();Object.assign(f.live[0],change);assert.equal(f.run().ok,false,JSON.stringify(change));
 }
 const f=fixture();f.live.length=0;assert.equal(f.run().ok,false);
});
test('official per-flavor cost corrections are matched individually in B; initial family creation keeps its equal-cost rule',()=>{
 const catalog=openingCatalog225([PRODUCT_WORKBOOK_COLUMNS.map(c=>c.header),PRODUCT_WORKBOOK_COLUMNS.map(c=>c.key==='barcode'?'':fields[c.key]??'')],
  [FLAVOR_WORKBOOK_COLUMNS.map(c=>c.header),['NW-0001','ليمون','000234','FL-1',''],['NW-0001','نعنع','000235','FL-2','']],ref.units);
 const prices=ownerPriceRows225(catalog),stock=ownerStockRows225(catalog);
 for(let i=1;i<=2;i++){
  for(const [key,value]of Object.entries({purchaseUnit:'CTN',purchaseCount:'24',invoicePrice:i===1?'12.000':'14.400',basis:'طرد',invoiceRef:'INV-A',invoiceDate:'2026-11-19'}))prices[i][P.findIndex(c=>c[0]===key)]=value;
  stock[i][S.findIndex(c=>c[0]==='loose')]='1';
 }
 const base=fixture().live[0],live=[{...base,sku:'FL-1',costPriceInMinorUnits:500},{...base,id:'00000000-0000-4000-8000-000000000002',sku:'FL-2',costPriceInMinorUnits:600,wacExact:'600.000000'}];
 const b=convertStageBStock225(catalog,prices,stock,settings,ref,live);assert.equal(b.ok,true,JSON.stringify(b.errors));assert.deepEqual(b.audit.map(r=>r.unitCostMinor),['500','600']);
 const a=convertOpening225(catalog,prices,stock,settings,ref);assert.equal(a.ok,false);assert.ok(a.errors.some(e=>e.code==='FAMILY_COST'));
});
test('real stage B XLSX CLI produces quantity files only, binds the fresh read, and rejects a stale worksheet cost',async()=>{
 const f=fixture(),dir=await mkdtemp(path.join(tmpdir(),'nawasrah-on225-stage-b-')),source=writeXlsx([{name:'المنتجات',rows:f.productSheet},{name:'النكهات',rows:f.flavors}]);
 const sourcePath=path.join(dir,'source.xlsx'),filled=path.join(dir,'filled.xlsx'),reference=path.join(dir,'reference.json');
 await writeFile(sourcePath,source);
 // Official dictionary reference shape; the stock converter still compares live product data separately.
 await writeFile(reference,JSON.stringify({format:1,...ref,asOf:'2026-11-24',customers:[],suppliers:[],chequeKeys:[]}));
 // A full catalog snapshot can exceed the workbook's5MiB cap. Its separate
 // 32MiB JSON cap does not increase any Excel input limit or weaken SHA binding.
 const actual=JSON.parse(await readFile(new URL('./fixtures/two-stage225-reference-tables.json',import.meta.url),'utf8')) as {history:string[];catalog:{tables:{schema:string;name:string;kind:string}[]}};
 const evidence={history:actual.history,catalog:{...actual.catalog,definition:'x'.repeat(6*1024**2)},tables:Object.fromEntries(actual.catalog.tables.filter(t=>['r','p'].includes(t.kind)).map(t=>t.schema+'.'+t.name).sort().map(n=>[n,{rows:0,hash:'d41d8cd98f00b204e9800998ecf8427e'}]))};
 const backup={ok:true,projectRef:'kzevmysfydaslxcerogt',historyCeiling:225,historyFiles:185,sha256:'a'.repeat(64),sourceEvidenceSha256:backupSourceEvidenceSha256(evidence),finishedAt:'2026-11-19T10:00:00Z'};
 const stockAlerts={full:evidence.tables['public.stock_alerts'],withoutLastUpdated:evidence.tables['public.stock_alerts'],rowHashes:{}};
 const base=stageABaseline225(evidence,backup,backup.sha256,stockAlerts),basePath=path.join(dir,'baseline.json'),baseText=JSON.stringify(base);await writeFile(basePath,baseText);
 const snapshot={format:1,ceiling:225,capturedAt:'2026-11-24T10:00:00Z',catalog:evidence.catalog,history:evidence.history,modeOn:true,setupOpen:true,ordersClosed:true,positiveBalances:0,tables:evidence.tables,stockAlerts,products:f.live};
 const livePath=path.join(dir,'live.json'),liveText=JSON.stringify(snapshot);assert.ok(Buffer.byteLength(liveText)>5*1024**2);await writeFile(livePath,liveText);
 const saveFilled=()=>writeFile(filled,writeXlsx([{name:'التكلفة',rows:f.prices},{name:'الجرد',rows:f.stock},{name:'الإعدادات',rows:[['الإعداد','القيمة'],['رمز المستودع الأساسي','WH-A'],['حد تنبيه فرق التقييم (د.أ)','0.100']]}]));await saveFilled();
 const args=(output:string)=>['--mode','stock','--source',sourcePath,'--filled',filled,'--reference',reference,'--live-snapshot',livePath,'--live-snapshot-sha256',hash(liveText),'--baseline',basePath,'--baseline-sha256',hash(baseText),'--output',output];
 const output=path.join(dir,'accepted');assert.equal(await runOpening225(args(output),{expectedSourceSha:hash(source)}),0);
 assert.ok(!(await readdir(output)).includes('المنتجات.xlsx'));
 const rows=await readXlsxSheet(await readFile(path.join(output,'المستودع-01/البضاعة-الموجودة.xlsx')),'البيانات');assert.equal(rows[1][2],'3');assert.equal(rows[1][3],'5');
 f.price({invoicePrice:'14.400'});await saveFilled();const bad=path.join(dir,'mismatch');assert.equal(await runOpening225(args(bad),{expectedSourceSha:hash(source)}),1);assert.deepEqual(await readdir(bad),['report.json']);
 const report=JSON.parse(await readFile(path.join(bad,'report.json'),'utf8'));assert.ok(report.errors.some((e:{code:string})=>e.code==='LIVE_COST_MISMATCH'));assert.equal(snapshot.products[0].costPriceInMinorUnits,500);
});

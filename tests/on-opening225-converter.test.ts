import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeXlsx,readXlsxSheet} from '../src/lib/xlsx';
import {mapSheet,prepareStock} from '../src/features/goLive/goLiveImport';
import {runOpening225} from '../scripts/operations/on-opening225/cli';
import {PRODUCT_WORKBOOK_COLUMNS,FLAVOR_WORKBOOK_COLUMNS,prepareProductWorkbook} from '../src/features/goLive/productWorkbook';
import {openingCatalog225,ownerPriceRows225,ownerStockRows225,convertOpening225,PRICE_COLUMNS225 as P,STOCK_COLUMNS225 as S,roundedUnitCost225} from '../scripts/operations/on-opening225/model';

const fields:Record<string,string>={sku:'NW-0001',name_ar:'صنف وهمي',barcode:'000123456789',category_name:'قسم وهمي',base_unit_name:'PKT',purchase_unit_name:'PKT',units_per_purchase_unit:'1',sale_unit_name:'PKT',units_per_sale_unit:'1',sale_package_price:'1.000',packet_price:'1.000',sale_method:'باكيت مفرد',description:'24 وحدة'};
const make=(family=false)=>openingCatalog225([PRODUCT_WORKBOOK_COLUMNS.map(c=>c.header),PRODUCT_WORKBOOK_COLUMNS.map(c=>({...fields,barcode:family?'':fields.barcode})[c.key]??'')],family?[FLAVOR_WORKBOOK_COLUMNS.map(c=>c.header),['NW-0001','ليمون','000234','FL-1',''],['NW-0001','نعنع','000235','FL-2','']]:[],ref.units);
const ref={categories:[{name:'قسم وهمي',active:true}],units:[{code:'PKT',name:'باكيت'},{code:'CTN',name:'كرتونة'}],warehouses:[{code:'WH-A',active:true},{code:'WH-B',active:true}],products:[]};
const settings={defaultWarehouse:'WH-A',valuationThreshold:'0.100'};
function inputs(family=false){
 const catalog=make(family),prices=ownerPriceRows225(catalog),stocks=ownerStockRows225(catalog);
 const price=(i:number,changes:Record<string,string>)=>{for(const [key,value]of Object.entries(changes))prices[i][P.findIndex(c=>c[0]===key)]=value;};
 const stock=(i:number,changes:Record<string,string>)=>{for(const [key,value]of Object.entries(changes))stocks[i][S.findIndex(c=>c[0]===key)]=value;};
 for(let i=1;i<prices.length;i++){price(i,{purchaseUnit:'CTN',purchaseCount:'12',invoicePrice:'10.000',basis:'طرد',invoiceRef:'INV-001',invoiceDate:'2026-11-01'});stock(i,{packages:'100',loose:'0'});}
 return {catalog,prices,stocks,price,stock,run:()=>convertOpening225(catalog,prices,stocks,settings,ref)};
}

test('invoice package cost rounds independently to833fils and exposes the400fils valuation difference on1200units',()=>{
 const i=inputs(),before=structuredClone({catalog:i.catalog,prices:i.prices,stocks:i.stocks}),r=i.run();
 assert.equal(r.ok,true,JSON.stringify(r.errors));assert.equal(r.audit[0].unitCostMinor,'833');
 assert.equal(r.audit[0].quantity,'1200');assert.equal(r.audit[0].openingValueMinor,'999600');
 assert.equal(r.audit[0].valuationDifferenceNumeratorMinor,'-4800');assert.equal(r.audit[0].valuationDifferenceDivisor,12);
 assert.equal(r.audit[0].invoicePriceMinor,'10000');assert.equal(r.audit[0].invoiceRef,'INV-001');
 assert.equal(r.warnings.filter(w=>w.code==='VALUATION_DIFFERENCE').length,1);
 assert.deepEqual({catalog:i.catalog,prices:i.prices,stocks:i.stocks},before,'Preparation must never mutate its source');
 const plan=prepareProductWorkbook(r.productRows,r.flavorRows,'full',{independentFullPrices:true});assert.deepEqual(plan.errors,[]);
 assert.deepEqual([plan.products[0].data.sku,plan.products[0].data.barcode,plan.products[0].singlePriceInMinorUnits],['NW-0001','000123456789','1000']);
 assert.equal(plan.products[0].data.cost_per_base_unit_in_minor_units,'833');assert.equal(plan.products[0].openingStock,null);
});
test('unit-priced invoice and multiple warehouses preserve one cost and separate physical counts',()=>{
 const i=inputs();i.price(1,{invoicePrice:'0.850',basis:'وحدة'});i.stock(1,{packages:'2',loose:'3'});
 i.stocks.push([...i.stocks[1]]);i.stock(2,{warehouse:'WH-B',packages:'1',loose:'1'});
 const r=i.run();assert.equal(r.ok,true,JSON.stringify(r.errors));assert.equal(r.audit[0].unitCostMinor,'850');
 assert.deepEqual(r.audit.map(x=>[x.warehouse,x.quantity]),[['WH-A','27'],['WH-B','13']]);
 assert.equal(r.totalOpeningValueMinor,'34000');assert.equal(r.stockFiles.length,2);assert.deepEqual(r.warnings,[]);
});
test('zero quantities are explicit;missing counts or positive balance with zero/rounded-to-zero cost is rejected',()=>{
 const noStock=inputs();noStock.stock(1,{packages:'0'});noStock.price(1,{invoicePrice:'',invoiceRef:'',invoiceDate:'',basis:''});assert.equal(noStock.run().ok,true);
 const zeroCosts:Record<string,string>[]=[{invoicePrice:'0.000'},{invoicePrice:'0.001',purchaseCount:'999999'}];
 for(const changes of zeroCosts){
  const i=inputs();i.price(1,changes);assert.ok(i.run().errors.some(e=>e.code==='ZERO_COST'));
 }
 const blank=inputs();blank.stock(1,{packages:'',loose:''});assert.ok(blank.run().errors.some(e=>e.code==='COUNT'));
});
test('package invoice needs known content and unit; 12.000 per 24 and 0.500 per unit both value 77 units at 38.500',()=>{
 const i=inputs();
 for(const n of ['','1','2.5']){
  i.price(1,{purchaseCount:n});
  assert.match(i.run().errors.find(e=>e.code==='PURCHASE_COUNT')?.message??'',/NW-0001 — صنف وهمي: أدخل عدد الوحدات في طرد الشراء/u);
 }
 i.price(1,{purchaseCount:'24',invoicePrice:'12.000',purchaseUnit:''});
 assert.ok(i.run().errors.some(e=>e.code==='PURCHASE_UNIT'));
 i.price(1,{purchaseUnit:'كرتونة'});i.stock(1,{packages:'3',loose:'5'});
 for(const [basis,invoicePrice] of [['طرد','12.000'],['وحدة','0.500']]){
  i.price(1,{basis,invoicePrice});
  const r=i.run();assert.ok(r.ok,JSON.stringify(r.errors));
  assert.deepEqual([r.audit[0].unitCostMinor,r.audit[0].quantity,r.totalOpeningValueMinor],['500','77','38500']);
  assert.deepEqual(r.stockFiles[0].rows[1],['NW-0001','صنف وهمي','3','5']);
 }
});
test('single-unit defaults leave packaging inputs blank and preserve loose counts through the official stock parser',()=>{
 const i=inputs();
 assert.deepEqual(ownerPriceRows225(i.catalog)[1].slice(6,9),['','','1.000']);
 i.price(1,{purchaseCount:'',purchaseUnit:'',basis:'وحدة',invoicePrice:'0.500'});
 for(const packages of ['1','0']){
  i.stock(1,{packages,loose:'77'});
  assert.ok(i.run().errors.some(e=>e.code==='STOCK_PACKAGE_CONTENT'&&e.message.includes('NW-0001')));
 }
 i.stock(1,{packages:''});
 const r=i.run();assert.ok(r.ok,JSON.stringify(r.errors));assert.equal(r.audit[0].quantity,'77');
 assert.deepEqual(r.stockFiles[0].rows[1],['NW-0001','صنف وهمي','77','0']);
 const parsed=prepareStock(mapSheet('stock',r.stockFiles[0].rows).rows,[{
  productId:'stock-test',sku:'NW-0001',barcode:'000123456789',productName:'صنف وهمي',eligible:true,unitsPerPackage:1,costPriceInMinorUnits:500,
 }]);
 assert.deepEqual(parsed.errors,[]);assert.equal(parsed.payload[0].baseQuantity,77);
 const p=prepareProductWorkbook(r.productRows,r.flavorRows,'full',{independentFullPrices:true}).products[0];
 assert.equal(p.data.units_per_sale_unit,'1');assert.equal(p.data.parcel_only,false);
 assert.deepEqual([p.singlePriceInMinorUnits,p.data.sale_package_price_in_minor_units],['1000','1000']);
});
test('optional independent sale parcel exports both active prices and methods and rejects incomplete or invalid entries',()=>{
 const i=inputs(),valid={saleUnit:'CTN',saleCount:'12',salePrice:'11.000',saleMethod:'الاثنين'};
 for(const [changes,code] of [
  [{salePrice:'13.000'},'SALE_PRICE'],[{salePrice:'1.000'},'SALE_PRICE'],[{saleCount:'1'},'SALE_COUNT'],
  [{saleUnit:'باكيت'},'SALE_UNIT'],[{saleUnit:'UNKNOWN'},'SALE_UNIT'],[{salePrice:'0.000'},'SALE_PRICE'],
  [{salePrice:'11.0001'},'SALE_PRICE'],[{saleMethod:''},'SALE_METHOD'],
 ] as const){
  i.price(1,{...valid,...changes});assert.ok(i.run().errors.some(e=>e.code===code&&e.message.includes('NW-0001')),code);
 }
 for(const saleMethod of ['الاثنين','طرد']){
  i.price(1,{...valid,saleMethod});
  const r=i.run();assert.ok(r.ok,JSON.stringify(r.errors));
  const plan=prepareProductWorkbook(r.productRows,r.flavorRows,'full',{independentFullPrices:true});
  assert.deepEqual(plan.errors,[]);
  const p=plan.products[0];assert.deepEqual([p.singlePriceInMinorUnits,p.data.sale_package_price_in_minor_units],['1000','11000']);
  assert.equal(p.data.units_per_sale_unit,'12');assert.equal(p.data.parcel_only,saleMethod==='طرد');
 }
});
test('below-cost active prices warn and inherited flavor sales settings must match',()=>{
 const i=inputs(true),sale={saleUnit:'CTN',saleCount:'12',salePrice:'9.000',saleMethod:'الاثنين'};
 i.price(1,sale);assert.ok(i.run().errors.some(e=>e.code==='FAMILY_SALE'));
 i.price(2,sale);const r=i.run();assert.ok(r.ok,JSON.stringify(r.errors));
 assert.equal(r.warnings.filter(w=>w.code==='BELOW_COST'&&w.message.includes('سعر الطرد')).length,2);
 const single=inputs();single.price(1,{purchaseUnit:'',purchaseCount:'',basis:'وحدة',invoicePrice:'1.100'});
 single.stock(1,{packages:'',loose:'5'});
 const result=single.run();assert.ok(result.ok);assert.match(result.warnings[0].message,/سعر المفرد أقل من التكلفة/u);
});
test('catalog identity,sales prices,all sellable SKUs and unique warehouse rows are immutable contracts',()=>{
 for(const [key,value]of [['single','0.900'],['name','غيره'],['unit','CTN'],['sku','UNKNOWN']]){
  const i=inputs();i.price(1,{[key]:value});assert.equal(i.run().ok,false,key);
 }
 const missing=inputs(true);missing.prices.pop();assert.ok(missing.run().errors.some(e=>e.code==='MISSING_SKU'));
 const duplicate=inputs();duplicate.stocks.push([...duplicate.stocks[1]]);assert.ok(duplicate.run().errors.some(e=>e.code==='DUPLICATE_STOCK'));
 const repeated=inputs();repeated.prices.push([...repeated.prices[1]]);assert.ok(repeated.run().errors.some(e=>e.code==='DUPLICATE_PRICE'));
 const unknown=inputs();unknown.stock(1,{warehouse:'WH-X'});assert.ok(unknown.run().errors.some(e=>e.code==='WAREHOUSE'));
});
test('flavors keep their own SKU and barcode and reject inconsistent inherited costs rather than averaging',()=>{
 const i=inputs(true);let r=i.run();assert.equal(r.ok,true,JSON.stringify(r.errors));
 assert.deepEqual(r.flavorRows.slice(1).map(row=>[row[2],row[3]]),[['000234','FL-1'],['000235','FL-2']]);
 i.price(2,{invoicePrice:'11.000'});r=i.run();assert.ok(r.errors.some(e=>e.code==='FAMILY_COST'));
 i.price(2,{invoicePrice:'10.000',purchaseCount:'13'});assert.ok(i.run().errors.some(e=>e.code==='FAMILY_COST'));
});
test('three-decimal money,integer packages,invoice provenance and legal dates remain strict even with forged formula caches',()=>{
 const invalidInputs:Record<string,string>[]=[{invoicePrice:'0.1234'},{purchaseCount:'1.2'},{invoicePrice:'-1.000'},{invoiceDate:'2026-02-30'},{invoiceRef:''},{basis:'تخمين'}];
 for(const changes of invalidInputs){
  const i=inputs();i.price(1,changes);assert.equal(i.run().ok,false,JSON.stringify(changes));
 }
 const i=inputs();i.price(1,{unitCost:'9999',invoicePrice:'١٠٫٠٠٠',invoiceDate:'46327'});
 assert.equal(i.run().audit[0].unitCostMinor,'833','Cached formula cell is not an input');
 const loose=inputs();loose.stock(1,{loose:'12'});assert.ok(loose.run().errors.some(e=>e.code==='LOOSE_COUNT'));
 assert.equal(roundedUnitCost225(1000n,16),63n);assert.equal(roundedUnitCost225(9650n,12),804n);
 assert.throws(()=>roundedUnitCost225(-1n,12));
});

async function cliFixture(){
 const directory=await mkdtemp(path.join(tmpdir(),'nawasrah-on225-converter-')),i=inputs();
 const source=writeXlsx([{name:'المنتجات',rows:i.catalog.productSheet},{name:'النكهات',rows:i.catalog.flavorSheet}]);
 const sourceFile=path.join(directory,'source.xlsx'),refFile=path.join(directory,'reference.json'),filled=path.join(directory,'filled.xlsx');
 await writeFile(sourceFile,source);await writeFile(refFile,JSON.stringify({format:1,asOf:'2026-11-18',...ref,customers:[],suppliers:[],chequeKeys:[]}));
 const writeFilled=()=>writeFile(filled,writeXlsx([{name:'التكلفة',rows:i.prices},{name:'الجرد',rows:i.stocks},{name:'الإعدادات',rows:[['الإعداد','القيمة'],['رمز المستودع الأساسي','WH-A'],['حد تنبيه فرق التقييم (د.أ)','0.100']]}]));
 await writeFilled();
 const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
 const common=['--source',sourceFile,'--reference',refFile],dependency={expectedSourceSha:digest(source)};
 return {directory,i,source,sourceFile,filled,writeFilled,common,dependency,digest};
}
test('real XLSX conversion is offline,keeps source bytes and produces official product/warehouse files with invoice evidence',async()=>{
 const f=await cliFixture(),output=path.join(f.directory,'output'),originalFetch=globalThis.fetch;
 f.i.price(1,{saleUnit:'CTN',saleCount:'12',salePrice:'11.000',saleMethod:'الاثنين'});await f.writeFilled();
 globalThis.fetch=()=>{throw Error('OFFLINE_CONVERTER_NETWORK_FORBIDDEN');};
 try{
  assert.equal(await runOpening225(['--mode','convert',...f.common,'--filled',f.filled,'--output',output],f.dependency),0);
  assert.deepEqual(await readFile(f.sourceFile),Buffer.from(f.source));
  const report=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));
  assert.equal(report.ok,true);assert.equal(report.offline,true);assert.equal(report.databaseWrites,0);
  assert.equal(report.audit[0].invoicePriceMinor,'10000');assert.equal(report.audit[0].invoiceRef,'INV-001');assert.equal(report.warnings.length,1);
  const products=await readXlsxSheet(await readFile(path.join(output,'المنتجات.xlsx')),'المنتجات');
  assert.equal(products[1][products[0].indexOf('الباركود')],'000123456789');
  assert.equal(products[1][products[0].indexOf('سعر شراء الباكيت (التكلفة) (د.أ)')],'0.833');
  const imported=prepareProductWorkbook(products,[],'full',{independentFullPrices:true});
  assert.deepEqual(imported.errors,[]);
  assert.deepEqual([imported.products[0].singlePriceInMinorUnits,imported.products[0].data.sale_package_price_in_minor_units],['1000','11000']);
  const manifest=JSON.parse(await readFile(path.join(output,'import-manifest.json'),'utf8'));
  assert.equal(manifest.migrationCeiling,225);assert.equal(manifest.stock[0].warehouse,'WH-A');
  const stock=await readXlsxSheet(await readFile(path.join(output,manifest.stock[0].file)));
  assert.deepEqual(stock[1],['NW-0001','صنف وهمي','100','0']);
  const before=f.digest(await readFile(path.join(output,'report.json')));
  await assert.rejects(()=>runOpening225(['--mode','convert',...f.common,'--filled',f.filled,'--output',output],f.dependency));
  assert.equal(f.digest(await readFile(path.join(output,'report.json'))),before,'Existing owner output cannot be overwritten');
 }finally{globalThis.fetch=originalFetch;}
});
test('CLI refuses unapproved source bytes and writes no import files for invalid filled data',async()=>{
 const f=await cliFixture(),mismatch=path.join(f.directory,'wrong-source-output');
 await assert.rejects(()=>runOpening225(['--mode','template',...f.common,'--output',mismatch]),/ON225_IMMUTABLE_SOURCE_SHA_MISMATCH/);
 await assert.rejects(()=>access(mismatch),{code:'ENOENT'});
 f.i.price(1,{single:'0.001'});await f.writeFilled();
 const output=path.join(f.directory,'invalid');assert.equal(await runOpening225(['--mode','convert',...f.common,'--filled',f.filled,'--output',output],f.dependency),1);
 const report=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));assert.ok(report.errors.some((e:{code:string})=>e.code==='SOURCE_CHANGED'));
 await assert.rejects(()=>access(path.join(output,'المنتجات.xlsx')),{code:'ENOENT'});
});

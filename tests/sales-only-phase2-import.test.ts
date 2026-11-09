import test from 'node:test';
import assert from 'node:assert/strict';
import {productWorkbookColumns,flavorWorkbookColumns,PRODUCT_WORKBOOK_COLUMNS,prepareProductWorkbook,productWorkbookStockRows} from '../src/features/goLive/productWorkbook';
import {GO_LIVE_COLUMNS,mapSheet,prepareProducts} from '../src/features/goLive/goLiveImport';
import {OPENING_CHEQUE_COLUMNS,prepareOpeningChequeSheet} from '../src/features/goLive/openingChequesImport';
import {writeXlsx} from '../src/lib/xlsx';
import {checkFiles,INPUT_FILES,arabicReport,type LocalReference} from '../scripts/operations/go-live-files/check';
const values:Record<string,string>={sku:'LITE-01',name_ar:'ﺑﺮﺍﻭﻧﻲ',category_name:'شوكولاتة',base_unit_name:'PKT',purchase_unit_name:'CTN',units_per_purchase_unit:'12',sale_unit_name:'CTN',units_per_sale_unit:'12',sale_package_price:'9.000',sale_method:'الاثنين',packet_price:'0.750'};
const sheet=(extra:Record<string,string>={},columns=productWorkbookColumns('sales-only'))=>[columns.map(c=>c.header),columns.map(c=>({...values,...extra}[c.key]??''))];
test('lite template omits stock/cost yet same commercial rules and presentation normalization;full still requires cost',()=>{
 for(const c of productWorkbookColumns('sales-only'))assert.ok(!['cost_per_base_unit','purchase_package_price','opening_stock','max_stock_level'].includes(c.key));
 assert.ok(!flavorWorkbookColumns('sales-only').some(c=>c.key==='opening_stock'));
 const plan=prepareProductWorkbook(sheet(),[],'sales-only');assert.deepEqual(plan.errors,[]);assert.equal(plan.products[0].data.cost_per_base_unit_in_minor_units,'0');
 assert.equal(plan.products[0].data.name_ar,'براوني');assert.equal(plan.products[0].data.sale_package_price_in_minor_units,'9000');assert.equal(plan.operatingMode,'sales-only');
 assert.ok(plan.warnings.some(w=>w.message.includes('التكلفة الفارغة')));assert.ok(!plan.warnings.some(w=>w.message.includes('يُعبأ بعد الجرد')));assert.deepEqual(productWorkbookStockRows(plan),[]);
 assert.ok(prepareProductWorkbook(sheet()).errors.some(e=>e.message.includes('التكلفة')||e.message.includes('تكلفة')));
 assert.ok(prepareProductWorkbook(sheet({packet_price:'0.751'}),[],'sales-only').errors.some(e=>e.message.includes('لا يطابق')));
 const legacy=GO_LIVE_COLUMNS.products.filter(c=>c.key!=='cost_per_base_unit');const mapped=mapSheet('products',[legacy.map(c=>c.header),legacy.map(c=>values[c.key]??'')],'sales-only');assert.deepEqual(mapped.fileErrors,[]);assert.equal(prepareProducts(mapped.rows,'sales-only').payload[0].cost_per_base_unit_in_minor_units,'0');
});
test('lite never silently imports filled stock;normalization/flavor IDs and leading barcode zeros retained',()=>{
 const full=PRODUCT_WORKBOOK_COLUMNS,flavors=[flavorWorkbookColumns('sales-only').map(c=>c.header),['LITE-01','ﺑﺮﺗﻘﺎﻝ','000123','']];
 const plan=prepareProductWorkbook(sheet({},full),flavors,'sales-only');assert.deepEqual(plan.errors,[]);assert.equal(plan.products[0].flavors[0].barcode,'000123');assert.equal(plan.products[0].flavors[0].name,'برتقال');
 assert.ok(prepareProductWorkbook(sheet({opening_stock:'0'},full),[],'sales-only').errors.some(e=>e.message.includes('المخزون مطفأ')));
 const f=[...flavors.map(r=>[...r])];f[0].push('المخزون (باكيت) اختياري بعد الجرد');f[1].push('1');assert.ok(prepareProductWorkbook(sheet({},full),f,'sales-only').errors.some(e=>e.sheet==='النكهات'&&e.message.includes('المخزون مطفأ')));
});
test('opening customer cheque retained;outgoing/endorsed refused in lite while full parser stays unchanged',()=>{
 const headers=OPENING_CHEQUE_COLUMNS.map(c=>c[1]),row=['وارد','قيد الانتظار','بنك وهمي','00001','2026-12-01','1.000','عميل وهمي','0790000000','','','','',''];
 assert.deepEqual(prepareOpeningChequeSheet([headers,row],'sales-only').errors,[]);
 for(const [direction,status] of [['صادر','قيد الانتظار'],['وارد','مجيّر']]){const r=[...row];r[0]=direction;r[1]=status;assert.equal(prepareOpeningChequeSheet([headers,r],'sales-only').errors.length,1);assert.deepEqual(prepareOpeningChequeSheet([headers,r]).errors,[]);}
});
test('offline checker explicitly selects lite;missing stock/supplier files allowed,filled stock rejected;debt/drawer exact',async()=>{
 const reference:LocalReference={format:1,asOf:'2026-11-09',categories:[{name:'شوكولاتة',active:true}],units:[{code:'PKT',name:'باكيت'},{code:'CTN',name:'طرد'}],products:[],customers:[{id:'customer1',name:'عميل وهمي',phone:'0790000000',active:true}],suppliers:[],chequeKeys:[]};
 const file=(name:string,rows:string[][])=>({name,bytes:writeXlsx([{name:'البيانات',rows}])});
 const inputs={products:file(INPUT_FILES.products,sheet()),customers:file(INPUT_FILES.customers,[GO_LIVE_COLUMNS.customers.map(c=>c.header),['0790000000','عميل وهمي','40.250','2025-01-01','']]),drawer:file(INPUT_FILES.drawer,[['العهدة الافتتاحية (د.أ)'],['25.500']])};
 const result=await checkFiles(inputs,reference,undefined,'2026-11-09',{operatingMode:'sales-only',noOpeningCheques:true});assert.equal(result.ok,true,JSON.stringify(result.issues));assert.equal(result.totals.customerDebtInMinor,'40250');assert.equal(result.totals.drawerInMinor,'25500');assert.match(arabicReport(result),/المخزون والتكلفة غير متتبّعين/);
 const stock=file(INPUT_FILES.stock,[GO_LIVE_COLUMNS.stock.map(c=>c.header),['LITE-01','','1','0']]);const bad=await checkFiles({...inputs,stock},reference,undefined,'2026-11-09',{operatingMode:'sales-only',noOpeningCheques:true});assert.equal(bad.ok,false);assert.ok(bad.issues.some(i=>i.reason.includes('المخزون والموردون مطفآن')));
});

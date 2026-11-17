import assert from 'node:assert/strict';
import test from 'node:test';
import {FLAVOR_WORKBOOK_COLUMNS,PRODUCT_WORKBOOK_COLUMNS,prepareProductWorkbook} from '../src/features/goLive/productWorkbook';

const row:Record<string,string>={
 sku:'CASE-225',name_ar:'صنف اختباري',barcode:'001234567890',category_name:'اختبار',
 base_unit_name:'PKT',purchase_unit_name:'CTN',units_per_purchase_unit:'20',sale_unit_name:'CTN',
 units_per_sale_unit:'20',sale_method:'الاثنين',sale_package_price:'17.000',packet_price:'0.900',
 purchase_package_price:'10.000',cost_per_base_unit:'0.500',min_stock_level:'0',opening_stock:'23',
};
const columns=PRODUCT_WORKBOOK_COLUMNS.map(c=>c.header);
const flavors=[FLAVOR_WORKBOOK_COLUMNS.map(c=>c.header),['CASE-225','ليمون','000123','CASE-225-LIME','3']];
const sheet=(changes:Record<string,string>={})=>[columns,PRODUCT_WORKBOOK_COLUMNS.map(c=>({...row,...changes})[c.key]??'')];
const accounting225={independentFullPrices:true};

test('ON225 optionally carries two separate prices without changing stock, barcode or flavor inheritance',()=>{
 const plan=prepareProductWorkbook(sheet({opening_stock:'',barcode:''}),flavors,'full',accounting225);
 assert.deepEqual(plan.errors,[]);
 assert.equal(plan.operatingMode,undefined);
 assert.equal(plan.products[0].singlePriceInMinorUnits,'900');
 assert.equal(plan.products[0].data.sale_package_price_in_minor_units,'17000');
 assert.equal(plan.products[0].data.cost_per_base_unit_in_minor_units,'500');
 assert.deepEqual(plan.products[0].flavors.map(f=>[f.sku,f.barcode,f.openingStock]),[['CASE-225-LIME','000123',3]]);
 assert.equal(plan.products[0].openingStock,null);
 const single=prepareProductWorkbook(sheet(),[],'full',accounting225);
 assert.deepEqual(single.errors,[]);
 assert.equal(single.products[0].data.barcode,'001234567890');
 assert.equal(single.products[0].openingStock,23);
 assert.match(prepareProductWorkbook(sheet(),[],'full').errors.map(e=>e.message).join(' '),/لا يطابق/);
});

test('ON225 importer prechecks the same exact integer rules and keeps an absent single price absent',()=>{
 for(const sale_package_price of ['0.900','18.001','0.000','17.0001']){
  assert.ok(prepareProductWorkbook(sheet({sale_package_price}),[],'full',accounting225).errors.length);
 }
 const legacy=prepareProductWorkbook(sheet({sale_method:'طرد',packet_price:''}),[],'full',accounting225);
 assert.deepEqual(legacy.errors,[]);
 assert.equal(Object.hasOwn(legacy.products[0],'singlePriceInMinorUnits'),false);
 const off=prepareProductWorkbook(sheet({opening_stock:''}),[],'sales-only');
 assert.deepEqual(off.errors,[]);
 assert.equal(off.products[0].singlePriceInMinorUnits,'900');
});

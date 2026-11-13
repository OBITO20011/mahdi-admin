import test from 'node:test';
import assert from 'node:assert/strict';
import {independentParcelPriceError,parcelDiscountInMinorUnits} from '../src/utils/independentParcelPrices';
import {PRODUCT_WORKBOOK_COLUMNS as columns,prepareProductWorkbook} from '../src/features/goLive/productWorkbook';
import {readProductEditSnapshot,snapshotToEditFields,compareProductEdits,reapplyProductEdits} from '../src/utils/productEditConflict';

test('independent minor-unit prices accept a discount or equality to the total, never N units for one unit or a surcharge',()=>{
 assert.equal(independentParcelPriceError(20,900,17000),null);
 assert.equal(independentParcelPriceError(20,900,18000),null);
 assert.equal(parcelDiscountInMinorUnits(20,900,17000),1000);
 assert.equal(parcelDiscountInMinorUnits(20,900,18000),0);
 for(const [n,s,p] of [[20,900,900],[20,900,18001],[20,0,17000],[20,-1,17000],[20,900,0],[20,900,-1],[1,900,17000],[1.1,900,900],[0,900,900],[2147483648,900,17000]]){
  assert.notEqual(independentParcelPriceError(n,s,p),null);
 }
 assert.equal(independentParcelPriceError(1,900,900),null);
 // A large product is compared exactly rather than overflowing JS multiplication.
 assert.equal(independentParcelPriceError(2147483647,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER-1),null);
});

const workbook=(mode:'full'|'sales-only',values:Record<string,string>={})=>{
 const row={sku:'PRICE-222',name_ar:'منتج اختبار سعرين',barcode:'00123456789',category_name:'اختبار',base_unit_name:'PKT',purchase_unit_name:'CTN',units_per_purchase_unit:'20',sale_unit_name:'CTN',units_per_sale_unit:'20',sale_method:'الاثنين',sale_package_price:'17.000',packet_price:'0.900',purchase_package_price:'10.000',cost_per_base_unit:'0.500',min_stock_level:'0',...values};
 return prepareProductWorkbook([columns.map(c=>c.header),columns.map(c=>row[c.key as keyof typeof row]??'')],[],mode);
};
test('OFF import carries both prices explicitly; full retains its historical rounded ratio contract',()=>{
 const off=workbook('sales-only');assert.deepEqual(off.errors,[]);
 assert.equal(off.products[0].singlePriceInMinorUnits,'900');assert.equal(off.products[0].data.sale_package_price_in_minor_units,'17000');
 assert.match(workbook('full').errors.map(e=>e.message).join(' '),/لا يطابق/);
 assert.equal(workbook('full',{sale_package_price:'18.000'}).errors.length,0);
 for(const sale_package_price of ['0.900','18.001'])assert.ok(workbook('sales-only',{sale_package_price}).errors.length>0);
 const single=workbook('sales-only',{sale_unit_name:'PKT',units_per_sale_unit:'1',sale_method:'باكيت مفرد',sale_package_price:'0.900'});
 assert.deepEqual(single.errors,[]);assert.equal(single.products[0].singlePriceInMinorUnits,'900');
});

test('OFF CAS snapshot preserves the independently edited single price when reapplying a different field',()=>{
 const snapshot=readProductEditSnapshot({productId:'price222',updatedAt:'2026-11-14T00:00:00Z',salePriceInMinorUnits:950,salePackagePriceInMinorUnits:17000,unitsPerSalePackage:20})!;
 assert.equal(snapshot.salePriceInMinorUnits,950);
 const current=snapshotToEditFields(snapshot),opened={...current,singleSalePrice:.9},mine={...opened,description:'تعديل الوصف فقط'};
 assert.ok(compareProductEdits(opened,mine,current).some(r=>r.field==='singleSalePrice'&&r.changedByOther&&!r.changedByMe));
 const result=reapplyProductEdits(opened,mine,current);assert.equal(result.singleSalePrice,.95);assert.equal(result.salePackagePrice,17);assert.equal(result.description,mine.description);
 const historical=readProductEditSnapshot({productId:'full',updatedAt:'2026-11-14T00:00:00Z'})!;
 assert.equal('salePriceInMinorUnits' in historical,false);assert.equal('singleSalePrice' in snapshotToEditFields(historical),false);
});

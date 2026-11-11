import {test,expect} from './isolated-test';
import {writeXlsx} from '../src/lib/xlsx';
import {productWorkbookColumns,flavorWorkbookColumns} from '../src/features/goLive/productWorkbook';
import {GO_LIVE_COLUMNS} from '../src/features/goLive/goLiveImport';
test.use({hasTouch:true});
test('lite GoLive keeps opening customer debt on existing guarded batches without inventory or supplier writes',async({page})=>{
 await page.setViewportSize({width:390,height:1000});await page.goto('/e2e/package-f-go-live-harness.html?sales-only');
 const card=page.getByTestId('go-live-card-customers');await card.getByRole('button',{name:'استيراد من Excel',exact:true}).tap();
 const bytes=writeXlsx([{name:'البيانات',rows:[GO_LIVE_COLUMNS.customers.map(c=>c.header),['0791111111','محمد العلي','12.345','2025-01-10','رصيد افتتاحي وهمي']]}]);
 await page.getByTestId('go-live-import-customers').locator('input[type=file]').setInputFiles({name:'synthetic-lite-debt.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
 const preview=page.getByTestId('go-live-preview-customers');await expect(preview).toContainText('كل الأسطر صالحة');await expect(preview).toContainText('12.345');
 await preview.getByRole('button',{name:'حفظ 1 سطر',exact:true}).tap();await expect(page.getByTestId('go-live-import-customers')).toContainText('تم الحفظ بنجاح: 1 سطر');
 const calls=await page.evaluate(()=>(window as unknown as {__goLiveCalls:{name:string;args:Record<string,unknown>}[]}).__goLiveCalls);
 const saved=calls.filter(c=>c.name==='record_customer_opening_balances_v1'&&!c.args.p_dry_run);expect(saved).toHaveLength(1);
 expect(saved[0].args.p_rows).toEqual([{customer_phone:'0791111111',customer_name:'محمد العلي',amount_in_minor_units:'12345',original_debt_date:'2025-01-10',notes:'رصيد افتتاحي وهمي'}]);
 expect(calls.filter(c=>/apply_inventory_opening_setup|record_supplier_opening_balances|import_go_live_products/.test(c.name))).toEqual([]);
 await expect(page.getByTestId('go-live-card-stock')).toHaveCount(0);await expect(page.getByTestId('go-live-card-suppliers')).toHaveCount(0);
});
test('lite workbook preview and existing resumed writer save zero-cost family without stock prompt or stock download',async({page})=>{
 await page.setViewportSize({width:390,height:1000});await page.goto('/e2e/package-f-product-workbook-harness.html?sales-only');
 const columns=productWorkbookColumns('sales-only'),flavors=flavorWorkbookColumns('sales-only');
 const values:Record<string,string>={sku:'LITE-IMPORT',name_ar:'ﺑﺮﺍﻭﻧﻲ',category_name:'شوكولاتة',base_unit_name:'PKT',purchase_unit_name:'CTN',units_per_purchase_unit:'12',sale_unit_name:'CTN',units_per_sale_unit:'12',sale_package_price:'9.000',sale_method:'الاثنين',packet_price:'0.750'};
 const bytes=writeXlsx([{name:'المنتجات',rows:[columns.map(c=>c.header),columns.map(c=>values[c.key]??'')]},{name:'النكهات',rows:[flavors.map(c=>c.header),flavors.map(c=>({master_sku:'LITE-IMPORT',name:'ليمون',barcode:'000123'}[c.key]??''))]}]);
 await page.getByLabel('ملف المنتجات',{exact:true}).setInputFiles({name:'synthetic-lite.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
 const preview=page.getByTestId('product-workbook-preview');await expect(preview).toContainText('براوني');await expect(preview).toContainText('000123');await expect(preview).toContainText('التكلفة الفارغة');await expect(preview).not.toContainText('يُعبأ بعد الجرد');
 await preview.getByRole('button',{name:'حفظ المنتجات والنكهات ومطابقتها'}).tap();await expect(page.getByTestId('saved')).toBeVisible();
 await expect(preview.getByRole('button',{name:/تنزيل ملف البضاعة/})).toHaveCount(0);
 const result=await page.evaluate(()=>JSON.parse(localStorage.getItem('product-workbook-fixture')??'null'));expect(result.products).toHaveLength(2);expect(result.products.every((p:Record<string,unknown>)=>p.cost_price_in_minor_units==='0')).toBe(true);expect(result.products.find((p:Record<string,unknown>)=>p.flavor_name_ar==='ليمون').barcode).toBe('000123');
});
test('GoLive lite hides stock and supplier cards while keeping customer openings and incoming cheque preparation',async({page})=>{
 await page.setViewportSize({width:390,height:1000});await page.goto('/e2e/package-f-go-live-harness.html?sales-only');
 await expect(page.getByTestId('go-live-card-products')).toBeVisible();await expect(page.getByTestId('go-live-card-customers')).toBeVisible();
 await expect(page.getByTestId('go-live-card-stock')).toHaveCount(0);await expect(page.getByTestId('go-live-card-suppliers')).toHaveCount(0);
 await expect(page.getByTestId('go-live-card-cheques')).toBeVisible();
});

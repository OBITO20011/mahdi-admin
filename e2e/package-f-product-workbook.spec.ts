import {test,expect} from './isolated-test';
import {checkLayout} from './package-f-layout';import type{Page}from'@playwright/test';import{readFile}from'node:fs/promises';
import{PRODUCT_WORKBOOK_COLUMNS as C,FLAVOR_WORKBOOK_COLUMNS as F}from'../src/features/goLive/productWorkbook';import{writeXlsx,readXlsxFirstSheet,XLSX_MIME}from'../src/lib/xlsx';
const url=(q='')=>'/e2e/package-f-product-workbook-harness.html?'+q;
const sample=(changes:Record<string,string>={})=>C.map(c=>({sku:'TPL',name_ar:'عائلة وهمية',category_name:'شوكولاتة',base_unit_name:'PKT',purchase_unit_name:'CTN',units_per_purchase_unit:'12',sale_unit_name:'CTN',units_per_sale_unit:'12',sale_package_price:'9.000',purchase_package_price:'6.000',cost_per_base_unit:'0.500',sale_method:'الاثنين',packet_price:'0.750',...changes}[c.key]??''));
const file=(flavors=true,changes:Record<string,string>={},flavorChanges:Record<string,string>={})=>({name:'وهمي.xlsx',mimeType:XLSX_MIME,buffer:Buffer.from(writeXlsx([{name:'المنتجات',rows:[C.map(c=>c.header),sample(changes)]},...(flavors?[{name:'النكهات',rows:[F.map(c=>c.header),F.map(c=>({master_sku:'TPL',name:'ليمون',barcode:'000123',...flavorChanges}[c.key]??''))]}]:[])]))});
const load=(page:Page,bytes=file())=>page.getByLabel('ملف المنتجات',{exact:true}).setInputFiles(bytes);
const fixture=(page:Page)=>page.evaluate(()=>(window as any).__workbookFixture.tables.products);

test.beforeEach(async({page})=>{await page.setViewportSize({width:390,height:844});});

test('actual generated workbook previews20columns and flavor autoSKU/leading zeros,zero writes',async({page})=>{
 await page.goto(url());await load(page,{name:'المنتجات.xlsx',mimeType:XLSX_MIME,buffer:await readFile('docs/handover/templates/المنتجات.xlsx')});
 const panel=page.getByTestId('product-workbook-preview');await expect(panel).toContainText('CHO-001-ليمون');await expect(panel).toContainText('0000000000001');await expect(panel).toContainText('رمز تلقائي');await expect(panel).toContainText('1 صنف بلا مخزون');expect(await fixture(page)).toEqual([]);await checkLayout(page,page.locator('main'));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('family save confirms final identities before stock export,packet units preserved',async({page})=>{
 await page.goto(url());await load(page,file(true,{}, {opening_stock:'25'}));const save=page.getByRole('button',{name:'حفظ المنتجات والنكهات ومطابقتها'});await expect(save).toBeEnabled();await save.click();await expect(page.getByTestId('saved')).toBeVisible();
 const rows=await fixture(page);expect(rows).toHaveLength(2);expect(rows.find((r:any)=>r.flavor_master_product_id)?.barcode).toBe('000123');expect(rows.some((r:any)=>r.sku==='TPL-ليمون')).toBe(true);
 const[download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:/تنزيل ملف البضاعة الموجودة/}).click()]);const downloaded=await readXlsxFirstSheet(await readFile((await download.path())!));expect(downloaded[1]).toEqual(['TPL-ليمون','','2','1']);
});
test('unknown create resumes after reload same journal/UUID,no second family',async({page})=>{
 await page.goto(url());await load(page);await expect(page.getByRole('button',{name:'حفظ المنتجات والنكهات ومطابقتها'})).toBeEnabled();await page.evaluate(()=>(window as any).__workbookFixture.loseCreate());await page.getByRole('button',{name:'حفظ المنتجات والنكهات ومطابقتها'}).click();await expect(page.getByRole('alert')).toContainText('IMP-01');const ids=(await fixture(page)).map((r:any)=>r.id);
 await page.reload();await load(page);const resume=page.getByRole('button',{name:'استئناف المحاولة ومطابقة بياناتها'});await expect(resume).toBeEnabled();await resume.click();await expect(page.getByTestId('saved')).toBeVisible();expect((await fixture(page)).map((r:any)=>r.id)).toEqual(ids);expect(await page.evaluate(()=>(window as any).__workbookFixture.calls.filter((c:any)=>c.name==='create_product_family_with_flavors_v2').length)).toBe(0);
});
test('invalid method/duplicate family identifier cannot save;finishedsetup refuses import',async({page})=>{
 await page.goto(url());await load(page,file(true,{packet_price:''},{sku:'TPL'}));await expect(page.getByRole('alert')).toContainText('مطلوب');await expect(page.getByRole('button',{name:'حفظ المنتجات والنكهات ومطابقتها'})).toBeDisabled();expect(await fixture(page)).toEqual([]);
 await page.goto(url('finished'));await load(page);await expect(page.getByRole('alert')).toContainText('بداية التشغيل منتهية');expect(await fixture(page)).toEqual([]);
});
async function fillForm(page:Page,query='form'){await page.goto(url(query));await page.getByLabel('اسم المنتج',{exact:true}).fill('عائلة شاشة وهمية');await page.getByLabel('رمز الصنف',{exact:true}).fill('FORM-TPL');await page.getByLabel('عدد باكيت في طرد الشراء',{exact:true}).fill('12');await page.getByLabel('سعر شراء الطرد',{exact:true}).fill('6');await page.getByLabel('سعر بيع الطرد',{exact:true}).fill('9');await page.getByText('متقدم: التغليف والمخزون والصورة',{exact:true}).click();await page.getByRole('switch').click();await page.getByPlaceholder('مثلاً: جبنة').first().fill('ليمون');}
test('form flavor camera fills only that flavor and duplicate barcodes prevent creation',async({page})=>{
 await fillForm(page);await page.getByRole('button',{name:'مسح باركود النكهة بالكاميرا 1',exact:true}).click();await expect(page.getByLabel('باركود النكهة (اختياري) 1',{exact:true})).toHaveValue('0099112233');await expect(page.getByLabel('باركود المنتج',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'إضافة نكهة أخرى'}).click();await page.getByPlaceholder('مثلاً: جبنة').nth(1).fill('برتقال');await page.getByLabel('باركود النكهة (اختياري) 2',{exact:true}).fill('0099112233');await page.getByRole('button',{name:'إنشاء المنتج و2 نكهة',exact:true}).click();await expect(page.getByRole('status')).toContainText('باركود النكهة مكرر');expect(await fixture(page)).toEqual([]);
});
test('form keeps persisted family recoverable after unknown barcode response,never creates twice',async({page})=>{
 await fillForm(page);await page.getByLabel('باركود النكهة (اختياري) 1',{exact:true}).fill('000999');await page.evaluate(()=>(window as any).__workbookFixture.loseWrite());await page.getByRole('button',{name:'إنشاء المنتج و1 نكهة',exact:true}).click();const recovery=page.getByRole('region',{name:'استكمال باركود النكهات'});await expect(recovery).toBeVisible();const ids=(await fixture(page)).map((r:any)=>r.id);
 await page.reload();await page.getByRole('button',{name:/استكمال باركود العائلة المحفوظة/}).click();await expect(page.getByTestId('saved')).toBeVisible();expect((await fixture(page)).map((r:any)=>r.id)).toEqual(ids);expect(await page.evaluate(()=>(window as any).__workbookFixture.calls.filter((c:any)=>c.name==='create_product_family_with_flavors_v2').length)).toBe(0);
});


test('existing product barcode refuses a new flavor before any creation',async({page})=>{await fillForm(page,'form&existing');await page.getByLabel('باركود النكهة (اختياري) 1',{exact:true}).fill('000555');await page.getByRole('button',{name:'إنشاء المنتج و1 نكهة',exact:true}).click();await expect(page.getByRole('status')).toContainText('الباركود مستخدم بالفعل لمنتج آخر');expect(await fixture(page)).toEqual([]);});
test('desktop1440 preview and mobile390 form remain readable with final identities',async({page,browserName})=>{
 await page.setViewportSize({width:1440,height:900});await page.goto(url());await load(page);await expect(page.getByTestId('product-workbook-preview')).toContainText('TPL-ليمون');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const folder=process.env.NAWASRAH_PRODUCT_WORKBOOK_SCREENSHOT_DIR;if(folder)await page.screenshot({path:folder+'/preview-'+browserName+'-1440.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await fillForm(page);await expect(page.getByLabel('باركود النكهة (اختياري) 1')).toBeVisible();await checkLayout(page,page.locator('main'));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(folder)await page.screenshot({path:folder+'/flavor-barcode-'+browserName+'-390.png',fullPage:true});
});


test('real browser lock prevents a second tab from writing the same journal or creating another family',async({page})=>{await page.goto(url());await page.evaluate(()=>(window as any).__holdImportLock());const second=await page.context().newPage();try{await second.goto(url());await load(second);await expect(second.getByRole('button',{name:'حفظ المنتجات والنكهات ومطابقتها'})).toBeEnabled();await second.getByRole('button',{name:'حفظ المنتجات والنكهات ومطابقتها'}).click();await expect(second.getByRole('alert')).toContainText('IMP-05');expect(await fixture(second)).toEqual([]);await page.evaluate(()=>(window as any).__releaseImportLock());await second.getByRole('button',{name:'استئناف المحاولة ومطابقة بياناتها'}).click();await expect(second.getByTestId('saved')).toBeVisible();expect((await fixture(second)).length).toBe(2);}finally{await page.evaluate(()=>(window as any).__releaseImportLock());await second.close();}});


test('late completion for an earlier file cannot mark another preview complete or export its stock',async({page})=>{
 await page.goto(url());await load(page,file(true,{}, {opening_stock:'25'}));await expect(page.getByRole('button',{name:'حفظ المنتجات والنكهات ومطابقتها'})).toBeEnabled();await page.evaluate(()=>(window as any).__workbookFixture.holdCreate());await page.getByRole('button',{name:'حفظ المنتجات والنكهات ومطابقتها'}).click();await expect.poll(async()=>(await fixture(page)).length).toBe(2);
 await load(page,{...file(false,{sku:'OTHER',name_ar:'منتج ثان وهمي',opening_stock:'5'}),name:'OTHER.xlsx'});await expect(page.getByTestId('product-workbook-preview')).toContainText('OTHER.xlsx');await expect(page.getByRole('alert')).toContainText('ملف آخر');await page.evaluate(()=>(window as any).__workbookFixture.releaseCreate());await expect(page.getByTestId('saved')).toBeVisible();await expect(page.getByTestId('product-workbook-preview')).not.toContainText('اكتمل تعريف');await expect(page.getByRole('button',{name:/تنزيل ملف البضاعة الموجودة/})).toHaveCount(0);expect((await fixture(page)).some((r:any)=>r.sku==='OTHER')).toBe(false);
});

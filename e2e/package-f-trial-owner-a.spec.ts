import {test,expect} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {receiptRow} from './package-f-purchasing.fixture';

for(const width of [390,1440]){
 test(`trial A flavor-only settings and preserved product packaging fields ${width}`,async({page})=>{
  await page.setViewportSize({width,height:950});
  await page.goto('/e2e/package-f-products-harness.html?view=parcel&trialA');
  const dialog=page.getByRole('dialog');await expect(dialog).toHaveAttribute('data-state','open');
  await expect(dialog).toHaveAccessibleName('الطرد المشكّل (خلط النكهات)');
  await expect(dialog.getByText('هنا تجهّز طرداً مشكّلاً من نكهات المنتج. الطرد العادي يُضبط من نموذج المنتج ولا يحتاج هذه الشاشة.')).toBeVisible();
  const families=dialog.getByLabel('الصنف / العائلة');await expect(families.locator('option')).toHaveCount(1);
  await expect(families).toHaveValue('88888888-8888-4888-8888-000000000005');
  await expect(dialog).not.toContainText('INV-0001');
  await expect(dialog.getByLabel('كم حبة بالطرد')).toHaveValue('24');
  await expect(dialog.getByLabel('حالة الميزة',{exact:true})).toBeHidden();
  await checkLayout(page,dialog);
  await dialog.getByRole('button',{name:'إغلاق',exact:true}).click();
  await page.getByRole('navigation',{name:'شاشات المعاينة'}).getByRole('button',{name:'نموذج المنتج',exact:true}).click();
  await dialog.getByText('متقدم: التغليف والمخزون والصورة',{exact:true}).click();
  await expect(dialog.getByLabel('نوع طرد الشراء')).toHaveCount(0);await expect(dialog.getByLabel('نوع طرد البيع')).toHaveCount(0);
  await expect(dialog.getByRole('checkbox',{name:'طرد بيع مختلف عن طرد الشراء'})).toBeVisible();await checkLayout(page,dialog);
 });

 test(`trial A server product search retains full receipt and previews two products ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  const item=receiptRow.supplier_receipt_items[0];
  const searched={...receiptRow,id:'88888888-8888-4888-8888-000000000899',receipt_number:'GR-SEARCH-A',supplier_receipt_items:[
   {...item,id:'a-parcel',products:{name_ar:'عصير فراولة',sku:'A'},package_quantity:10},
   {...item,id:'a-base',products:{name_ar:'عصير فراولة',sku:'A'},package_quantity:3,units_per_package:1,base_unit_name:'باكيت'},
   {...item,id:'b',product_id:'88888888-8888-4888-8888-000000000802',products:{name_ar:'أرز طويل',sku:'B'},package_quantity:2,units_per_package:1,base_unit_name:'شوال'},
   {...item,id:'c',product_id:'88888888-8888-4888-8888-000000000803',products:{name_ar:'صنف ثالث',sku:'C'}},
  ]};
  for(const row of searched.supplier_receipt_items)row.total_base_units=row.package_quantity*row.units_per_package;
  await page.route('**/rest/v1/rpc/get_supplier_receipt_display_context',route=>{
   const row=route.request().postDataJSON().p_receipt_id===searched.id?searched:receiptRow;
   return route.fulfill({json:{receiptId:row.id,lines:row.supplier_receipt_items.map(item=>({
    id:item.id,kind:item.units_per_package>1?'legacy_single_sku_parcel':'base_unit',commercialQuantity:item.package_quantity,
    unitsPerParcel:item.units_per_package>1?item.units_per_package:null,baseUnitName:item.base_unit_name,baseQuantity:item.total_base_units,
    grossInMinorUnits:item.line_total_in_minor_units,lineDiscountInMinorUnits:0,netInMinorUnits:item.line_total_in_minor_units,
    acquisitionInMinorUnits:item.line_total_in_minor_units,components:[{itemId:item.id,productId:item.product_id,
     nameAr:item.products.name_ar,sku:item.products.sku,baseQuantity:item.total_base_units,currentSaleUnitPriceInMinorUnits:600}],
   }))}});
  });
  let queries=0;
  await page.route('**/rest/v1/supplier_receipts?**',async route=>{
   const url=new URL(route.request().url());queries++;
   expect(url.searchParams.get('search_items.products.name_ar')).toBe('ilike.%فراولة%');
   expect(url.searchParams.get('or')).toContain('search_items.not.is.null');
   expect(url.searchParams.get('limit')).toBe('25');expect(url.searchParams.get('offset')).toBe('0');
   expect(url.searchParams.get('select')).toContain('supplier_receipt_items(*,products(');
   await route.fulfill({json:[searched],headers:{'content-range':'0-0/1'}});
  });
  await page.goto('/e2e/package-f-purchasing-harness.html?view=direct&serverSearchA');
  await expect(page.getByText(receiptRow.receipt_number,{exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'ابحث باسم الصنف أو المورد أو رقم السند'}).fill('فراولة');
  await expect(page.getByText('GR-SEARCH-A',{exact:true})).toBeVisible();expect(queries).toBeGreaterThan(0);
  const preview=page.getByLabel('أصناف السند');await expect(preview).toContainText('عصير فراولة — 10 طرد + 3 باكيت');
  await expect(preview).toContainText('أرز طويل — 2 شوال');await expect(preview).toContainText('+1 أصناف أخرى');
  await expect(preview).not.toContainText('صنف ثالث');
  await expect(page.getByText('الملخص لكل السندات ضمن الفلاتر المختارة؛ البحث يحدد قائمة السندات أدناه.')).toBeVisible();
  await checkLayout(page,page.getByTestId('purchasing-workbench'));
 });

 test(`trial A failed server search is an error rather than empty receipts ${width}`,async({page})=>{
  await page.setViewportSize({width,height:950});
  await page.route('**/rest/v1/supplier_receipts?**',route=>route.fulfill({status:400,json:{code:'P0001',message:'تعذر بحث السندات الآن'}}));
  await page.goto('/e2e/package-f-purchasing-harness.html?view=direct&serverSearchA');
  await expect(page.getByText(receiptRow.receipt_number,{exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'ابحث باسم الصنف أو المورد أو رقم السند'}).fill('صنف');
  await expect(page.getByRole('alert')).toContainText('تعذر بحث السندات الآن');
  await expect(page.getByText(receiptRow.receipt_number,{exact:true})).toHaveCount(0);
 });
}

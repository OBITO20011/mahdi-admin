import {test,expect} from './isolated-test';
test.use({hasTouch:true});
const id='88888888-8888-4888-8888-000000000123';
test('lite product definition uses existing writer with no mandatory cost or stock;unverified mode blocks saving',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const writes:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/units?**',route=>route.fulfill({json:[{id,name_ar:'باكيت',code:'PKT',is_active:true}]}));
 await page.route('**/rest/v1/categories?**',route=>route.fulfill({json:[{id,name_ar:'مشروبات وتسالي',is_active:true}]}));
 await page.route('**/rpc/create_product_with_opening_stock_v5',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{success:true,productId:id,openingStockCreated:false}});});
 await page.goto('/e2e/package-f-products-harness.html?sales-only&view=form');const form=page.getByRole('dialog');
 await expect(form.getByLabel('سعر شراء الطرد',{exact:true})).toHaveCount(0);await expect(form.getByText('ضبط المخزون',{exact:true})).toHaveCount(0);
 await expect(form.getByText(/ربح .*التقريبي/)).toHaveCount(0);
 await form.getByLabel('اسم المنتج',{exact:true}).fill('تعريف منتج مبسط');await form.getByLabel('رمز الصنف',{exact:true}).fill('LITE-LOCAL-NEW');
 await form.getByLabel('القسم',{exact:true}).selectOption('drinks');await form.getByLabel('عدد باكيت في طرد التغليف',{exact:true}).fill('5');
 await form.getByLabel('سعر بيع الطرد',{exact:true}).fill('5');await form.getByRole('button',{name:'إنشاء المنتج',exact:true}).tap();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({p_cost_price_in_minor_units:0,p_default_purchase_price_in_minor_units:0,p_opening_quantity:0,p_min_stock_level:0,p_max_stock_level:null,p_default_sale_price_in_minor_units:5000,p_units_per_sale_unit:5});
 await page.goto('/e2e/package-f-products-harness.html?sales-only&unverified&view=form');await expect(page.getByRole('button',{name:'إنشاء المنتج',exact:true})).toBeDisabled();expect(writes).toHaveLength(1);
});

test('owner converts a single carton only in verified OFF mode and saves through the versioned product writer',async({page})=>{
 const writes:Record<string,unknown>[]=[];
 const packet='88888888-8888-4888-8888-000000000121',carton='88888888-8888-4888-8888-000000000122';
 await page.route('**/rest/v1/units?**',route=>route.fulfill({json:[{id:carton,name_ar:'كرتونة',code:'CTN',is_active:true}]}));
 await page.route('**/rpc/update_product_master_v5',route=>{
  writes.push(route.request().postDataJSON());
  return route.fulfill({json:{success:true,productId:id,updatedAt:'2026-11-12T08:01:00Z'}});
 });
 async function open(query:string){
  await page.goto('/e2e/package-f-products-harness.html?'+query);
  await page.evaluate(async()=>{
   // @ts-expect-error Isolated Vite module.
   const {storeEngine}=await import('/src/stores/useAppStore.ts');
   storeEngine.openModal('edit_product',storeEngine.getState().products[0]);
  });
  return page.getByRole('dialog');
 }
 for(const query of ['single-carton','sales-only&single-carton&not-owner','sales-only&single-carton&unverified','sales-only']){
  const form=await open(query);
  await expect(form.getByRole('group',{name:'تعريف محتوى الطرد'})).toHaveCount(0);
  await expect(form.getByLabel('الوحدة الأساسية',{exact:true})).toBeDisabled();
 }
 const form=await open('sales-only&single-carton');
 const count=form.getByLabel('عدد الباكيتات الفعلي في الطرد',{exact:true});
 const confirm=form.getByRole('checkbox',{name:'أؤكد تحويل الوحدة إلى باكيت والبيع بالطرد فقط'});
 const save=form.getByRole('button',{name:'حفظ التعديلات',exact:true});
 await expect(count).toHaveValue('');
 await count.fill('12');
 await save.tap();
 await expect(form.getByText(/أدخل عدد الباكيتات الفعلي.*وأكّد التحويل/)).toBeVisible();
 expect(writes).toHaveLength(0);
 await confirm.check();
 await count.fill('13');
 await expect(confirm).not.toBeChecked();
 await count.fill('12');
 await confirm.check();
 await save.tap();
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({p_unit_id:packet,p_purchase_unit_id:carton,p_sale_unit_id:carton,
  p_units_per_purchase_unit:12,p_units_per_sale_unit:12,p_parcel_only:true,
  p_default_sale_price_in_minor_units:6000,p_cost_price_in_minor_units:0,
  p_expected_updated_at:'2026-11-12T08:00:00.000001Z'});
});
test('lite edit retains historical purchase cost and stock thresholds,without WAC query or zeroing them',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const writes:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/units?**',route=>route.fulfill({json:[{id,name_ar:'باكيت',code:'PKT',is_active:true}]}));
 await page.route('**/rpc/update_product_master_v5',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{success:true,productId:id,updatedAt:'2026-11-09T19:00:00Z'}});});
 await page.goto('/e2e/package-f-products-harness.html?sales-only');
 const original=await page.evaluate(async()=>{
  // @ts-expect-error Isolated Vite module.
  const {storeEngine}=await import('/src/stores/useAppStore.ts');const p=storeEngine.getState().products[0];storeEngine.openModal('edit_product',p);return {cost:p.costPrice,purchase:p.defaultPurchasePrice,min:p.reorderLevel,max:p.maxStockLevel};
 });
 const form=page.getByRole('dialog');await expect(form.getByText('ضبط المخزون',{exact:true})).toHaveCount(0);await expect(form.getByTestId('product-average-cost')).toHaveCount(0);
 await form.getByLabel('اسم المنتج',{exact:true}).fill('اسم محدّث بلا تغيير تكلفة');await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).tap();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0].p_cost_price_in_minor_units).toBe(Math.round(original.cost*1000));expect(writes[0].p_default_purchase_price_in_minor_units).toBe(Math.round((original.purchase??0)*1000));expect(writes[0].p_min_stock_level).toBe(original.min);expect(writes[0].p_max_stock_level).toBe(original.max??null);
});

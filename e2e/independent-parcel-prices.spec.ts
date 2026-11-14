import {test,expect,type Page} from './isolated-test';
import {formatJod} from '../customer-web/src/utils/money';

test.use({hasTouch:true,viewport:{width:390,height:844}});
const packet='88888888-8888-4888-8888-000000000121',parcel='88888888-8888-4888-8888-000000000122';
async function editor(page:Page,query:string){
 const writes:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/units?**',route=>route.fulfill({json:[{id:new URL(route.request().url()).searchParams.get('name_ar')==='eq.باكيت'?packet:parcel}]}));
 await page.route('**/rpc/update_product_master_v6',route=>{const args=route.request().postDataJSON();writes.push(args);return route.fulfill({json:{success:true,productId:args.p_product_id,updatedAt:'2026-11-14T00:00:01Z'}});});
 await page.route('**/rpc/update_product_master_v5',()=>{throw Error('OFF_MUST_NOT_DERIVE_SINGLE_PRICE');});
 await page.goto('/e2e/package-f-products-harness.html?sales-only&'+query);
 await page.evaluate(async()=>{
  // @ts-expect-error Isolated Vite module.
  const {storeEngine}=await import('/src/stores/useAppStore.ts');
  storeEngine.openModal('edit_product',storeEngine.getState().products[0]);
 });
 return{form:page.getByRole('dialog'),writes};
}

test('OFF adding a discounted parcel keeps the actual unit price and requires confirmation of both',async({page})=>{
 const {form,writes}=await editor(page,'unit-parcel');
 await form.getByRole('checkbox',{name:'هاد السعر سعر باكيت، بدي أضيف طرد',exact:true}).check();
 await form.getByLabel('كم باكيت بالطرد المضاف',{exact:false}).fill('24');
 const price=form.getByLabel('سعر الطرد المضاف',{exact:true});await expect(price).toHaveValue('20.4');
 await price.fill('20');await expect(form.getByText(/خصم.*0\.400/)).toBeVisible();
 const confirm=form.getByRole('checkbox',{name:/أؤكد سعر الطرد/});await expect(confirm).toHaveAccessibleName(/20\.000.*باكيت.*0\.850/);
 await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).tap();expect(writes).toHaveLength(0);
 await confirm.check();await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).tap();
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({p_sale_unit_id:parcel,p_units_per_sale_unit:24,p_sale_price_in_minor_units:850,p_default_sale_price_in_minor_units:20000,p_parcel_only:false});
});

test('OFF editing the single price never recalculates the saved parcel; the explicit calculate button does',async({page})=>{
 const {form,writes}=await editor(page,'independent-prices');
 const single=form.getByLabel('سعر بيع باكيت',{exact:true}),price=form.getByLabel('سعر بيع الطرد',{exact:true});
 await expect(single).toHaveValue('0.9');await expect(price).toHaveValue('17');
 await single.fill('1');await expect(price).toHaveValue('17');await expect(form.getByText(/خصم.*3\.000/)).toBeVisible();
 const confirm=form.getByRole('checkbox',{name:/أؤكد سعر باكيت/});await confirm.check();
 await form.getByRole('button',{name:'احسب الطرد = العدد × سعر باكيت',exact:true}).tap();
 await expect(price).toHaveValue('20');await expect(confirm).not.toBeChecked();
 await price.fill('17');await confirm.check();await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).tap();
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({p_units_per_sale_unit:20,p_sale_price_in_minor_units:1000,p_default_sale_price_in_minor_units:17000,p_parcel_only:false});
});

test('OFF defining old parcel contents exposes a positive rounded reference price before owner confirmation',async({page})=>{
 const {form,writes}=await editor(page,'unit-parcel');
 await form.getByLabel('وحدة المحتوى بعد التحويل',{exact:true}).selectOption('قنينة');
 await form.getByLabel('عدد وحدات المحتوى الفعلي في وحدة البيع',{exact:true}).fill('24');
 await expect(form.getByLabel('سعر الوحدة المرجعي بعد تعريف المحتوى',{exact:true})).toHaveValue('0.036');
 await expect(form.getByText(/البيع المفرد يبقى مطفأً/)).toBeVisible();
 await form.getByRole('checkbox',{name:'أؤكد التحويل والبيع بوحدة باكيت فقط بالسعر نفسه',exact:true}).check();
 await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).tap();
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({p_units_per_sale_unit:24,p_sale_price_in_minor_units:36,p_default_sale_price_in_minor_units:850,p_parcel_only:true});
});

test('store details and real cart constructors retain discounted parcel17000 and single900',async({page})=>{
 await page.goto('/e2e/lite-parcel-unit-guard-harness.html?view=store&discounted');
 const price=page.getByRole('region',{name:'إضافة طرد',exact:true});await expect(price).toContainText(formatJod(17000));
 await price.getByRole('button',{name:/إلى السلة/}).tap();
 await expect(page.locator('html')).toHaveAttribute('data-parcel-cart-price','17000');
 const single=page.getByRole('region',{name:'إضافة باكيت',exact:true});await expect(single).toContainText(formatJod(900));
 await single.getByRole('button',{name:/إلى السلة/}).tap();await expect(page.locator('html')).toHaveAttribute('data-single-cart-price','900');
});

test('POS uses each saved price without a ratio calculation',async({page})=>{
 await page.goto('/e2e/lite-parcel-unit-guard-harness.html?view=pos&discounted');
 const parcelButton=page.locator('[data-pos-add-method="legacy_single_sku_parcel"]'),single=page.locator('[data-pos-add-method="base_unit"]');
 await expect(parcelButton).toContainText('17.000');await expect(single).toContainText('0.900');
 await parcelButton.tap();await expect(page.locator('html')).toHaveAttribute('data-pos-price','17');
 await single.tap();await expect(page.locator('html')).toHaveAttribute('data-pos-price','0.9');
});

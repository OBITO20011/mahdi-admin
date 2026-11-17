import {expect,test,type Page} from './isolated-test';

test.use({hasTouch:true,viewport:{width:390,height:844}});

async function openProduct(page:Page,enabled=true){
 const writes:Record<string,unknown>[]=[];
 const packet='88888888-8888-4888-8888-000000000121',parcel='88888888-8888-4888-8888-000000000122';
 await page.route('**/rest/v1/units?**',route=>route.fulfill({json:[{id:new URL(route.request().url()).searchParams.get('name_ar')==='eq.باكيت'?packet:parcel}]}));
 await page.route('**/rpc/get_product_pricing_context225',route=>{
  const id=route.request().postDataJSON().p_product_id;
  return route.fulfill({json:{
   contractVersion:'on-independent-prices225-v1',productId:id,requestedProductId:id,updatedAt:'2026-11-17T08:00:00Z',
   parcelEnabled:enabled,originalUnitPrice:1000,originalParcelPrice:null,currentWacInMinorUnitsExact:'800.000000',
  }});
 });
 await page.route('**/rpc/update_product_master_v7',route=>{
  const args=route.request().postDataJSON();writes.push(args);
  if(Number(args.p_sale_price_in_minor_units)<800&&!args.p_below_cost_confirmation){
   return route.fulfill({status:400,json:{code:'P0001',message:'PRICES225_BELOW_WAC_CONFIRMATION_REQUIRED: السعر أقل من التكلفة',details:JSON.stringify({
    acknowledged:true,unitPrice:args.p_sale_price_in_minor_units,parcelPrice:args.p_default_sale_price_in_minor_units,
    unitsPerParcel:20,parcelEnabled:args.p_parcel_enabled,parcelOnly:false,risks:[{name:'الصنف التجريبي',productId:args.p_product_id,wacInMinorUnitsExact:'800.000000',unitBelowCost:true,parcelBelowCost:false}],
   })}});
  }
  return route.fulfill({json:{success:true,productId:args.p_product_id,updatedAt:'2026-11-17T08:00:01Z'}});
 });
 await page.route('**/rpc/update_product_master_v5',()=>{throw Error('ON225_MUST_PRESERVE_EXPLICIT_PRICES');});
 await page.goto('/e2e/package-f-products-harness.html?independent-prices');
 await page.evaluate(async()=>{
  // @ts-expect-error Isolated Vite module.
  const {storeEngine}=await import('/src/stores/useAppStore.ts');
  storeEngine.openModal('edit_product',storeEngine.getState().products[0]);
 });
 const form=page.getByRole('dialog');
 await form.getByLabel('سعر شراء الطرد',{exact:true}).fill('16.000');
 return {form,writes};
}

test('ON225 rejects the oversized active price and requests exact loss confirmation after pause',async({page})=>{
 const {form,writes}=await openProduct(page);
 const single=form.getByLabel('سعر بيع باكيت',{exact:true});
 const parcel=form.getByLabel('سعر بيع الطرد',{exact:true});
 const save=form.getByRole('button',{name:'حفظ التعديلات',exact:true});
 await expect(single).toHaveValue('0.9');
 await single.fill('0.500');
 await expect(save).toBeDisabled();expect(writes).toHaveLength(0);
 await form.getByRole('button',{name:'الطرد: متاح للبيع',exact:true}).tap();
 await expect(form.getByText(/السعر أقل من التكلفة.*0\.800/)).toBeVisible();
 await expect(parcel).toHaveValue('17');
 await save.tap();
 const warning=form.getByRole('alert',{name:'تأكيد السعر تحت التكلفة'});
 await expect(warning).toContainText('0.800');
 expect(writes).toHaveLength(1);
 expect(writes[0]).toMatchObject({p_sale_price_in_minor_units:500,p_default_sale_price_in_minor_units:17000,p_parcel_enabled:false,p_below_cost_confirmation:null});
 await warning.getByRole('button',{name:'أكّد الحفظ بهذا السعر',exact:true}).tap();
 await expect.poll(()=>writes.length).toBe(2);
 expect(writes[1]).toMatchObject({p_sale_price_in_minor_units:500,p_default_sale_price_in_minor_units:17000,p_parcel_enabled:false,p_below_cost_confirmation:{unitPrice:500,parcelPrice:17000,parcelEnabled:false}});
});

test('ON225 restores the saved single price without reactivating the parcel or changing its price',async({page})=>{
 const {form,writes}=await openProduct(page,false);
 await form.getByRole('button',{name:/رجّع السعر الأصلي لـباكيت/}).tap();
 await expect(form.getByLabel('سعر بيع باكيت',{exact:true})).toHaveValue('1');
 await expect(form.getByRole('button',{name:'الطرد: موقوف مؤقتاً',exact:true})).toHaveAttribute('aria-pressed','false');
 await form.getByRole('button',{name:'حفظ التعديلات',exact:true}).tap();
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({p_sale_price_in_minor_units:1000,p_default_sale_price_in_minor_units:17000,p_parcel_enabled:false,p_restore_original:'single'});
});

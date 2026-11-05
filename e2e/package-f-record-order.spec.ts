import {checkLayout} from './package-f-layout';
import {test,expect} from './isolated-test';
test.use({viewport:{width:390,height:844}});
const id=(n:number)=>'88880000-0000-4000-8000-'+String(n).padStart(12,'0');
test('supplier complete event history is newest-first without changing the original paged case request',async({page})=>{
 const requests:unknown[]=[];
 await page.route('**/rest/v1/rpc/get_supplier_replacement_options_v1',route=>route.fulfill({json:{contractVersion:208,products:[],suppliers:[],warehouses:[],lastSuppliers:[]}}));
 await page.route('**/rest/v1/rpc/get_supplier_replacements_page_v1',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{contractVersion:208,page:1,pageSize:25,totalCount:1,pendingQuantity:1,cases:[{
  id:id(5),supplierId:id(3),supplierName:'مورد وهمي',productId:id(2),productName:'صنف وهمي',warehouseId:id(4),branchId:'branch',origin:'shop',quantity:2,commercialQuantity:2,unitsPerCommercialUnit:1,unitName:'باكيت',baseUnitName:'باكيت',pendingQuantity:1,receivedQuantity:1,writtenOffQuantity:0,occurredAt:'2026-11-01T08:00:00Z',
  events:[{id:id(6),action:'send',quantity:2,heldDelta:2,occurredAt:'2026-11-01T08:00:00Z',reversesEventId:null,isReversed:false,reason:'وهمي-قديم'},{id:id(7),action:'receive',quantity:1,heldDelta:-1,occurredAt:'2026-11-02T08:00:00Z',reversesEventId:null,isReversed:false,reason:'وهمي-جديد'}],
 }]}});});
 await page.goto('/e2e/supplier-replacement208-harness.html');await page.getByRole('button',{name:'السجل',exact:true}).click();const card=page.getByTestId('replacement-case');await expect(card).toBeVisible();await card.getByText('⋯ السجل والخسارة والعكس',{exact:true}).click();
 const rows=card.locator('ul>li');await expect(rows).toHaveCount(2);await expect(rows.first()).toContainText('وهمي-جديد');await expect(rows.last()).toContainText('وهمي-قديم');await checkLayout(page,card);
 expect(requests).toContainEqual({p_supplier_id:null,p_branch_id:null,p_status:'all',p_page:1,p_page_size:25});
});
test('parcel pause copy keeps saved flavors/units and sends exactly the existing active=false request',async({page})=>{
 let active=true;const writes:Record<string,unknown>[]=[];
 const product=()=>({familyProductId:id(1),nameAr:'عائلة وهمية',sku:'FAKE',isFlavorMaster:true,unitsPerParcel:12,parcelPriceInMinorUnits:9000,configuration:{id:id(9),composition_mode:'configurable_mix',is_active:active,configuration_revision:1},allowedProductIds:[id(2),id(3)],components:[{productId:id(2),nameAr:'نكهة وهمية أ',sku:'FAKE-A',flavorNameAr:'أ'},{productId:id(3),nameAr:'نكهة وهمية ب',sku:'FAKE-B',flavorNameAr:'ب'}]});
 await page.route('**/rest/v1/rpc/get_admin_parcel_configuration_context_v1',route=>route.fulfill({json:{featureState:'ENABLED',products:[product()]}}));
 await page.route('**/rest/v1/rpc/save_product_parcel_configuration_v1',route=>{const body=route.request().postDataJSON();writes.push(body);active=body.p_is_active;return route.fulfill({json:{success:true,configuration:{family_product_id:id(1),composition_mode:'configurable_mix',is_active:active},unitsPerParcel:12,allowedProductIds:[id(2),id(3)]}});});
 await page.goto('/e2e/package-f-record-order-harness.html');const checkbox=page.getByRole('checkbox',{name:'الطرد المشكّل مفعّل للبيع',exact:true});await expect(checkbox).toBeChecked();await expect(page.getByText('أزل الإشارة لإيقافه مؤقتاً؛ يبقى الإعداد محفوظاً.',{exact:true})).toBeVisible();await checkbox.uncheck();expect(writes).toHaveLength(0);
 await page.getByRole('button',{name:'حفظ إعداد الطرد',exact:true}).click();await expect(page.getByRole('status')).toHaveText('تم حفظ إعداد الطرد.');await expect(checkbox).not.toBeChecked();await checkLayout(page,page.locator('main'));
 expect(writes).toEqual([{p_family_product_id:id(1),p_composition_mode:'configurable_mix',p_is_active:false,p_units_per_parcel:12,p_allowed_product_ids:[id(2),id(3)]}]);await expect(page.getByRole('checkbox',{name:'أ',exact:true})).toBeChecked();await expect(page.getByRole('checkbox',{name:'ب',exact:true})).toBeChecked();
});

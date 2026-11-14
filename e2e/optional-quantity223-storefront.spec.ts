import {test,expect,type Page} from './isolated-test';
import {inventoryProducts} from './package-f-inventory.fixture';
test.describe.configure({retries:0});
test.use({hasTouch:true,viewport:{width:390,height:950}});
const base='http://127.0.0.1:4174',productId=inventoryProducts[0].id;
const id=(n:number)=>`22300000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// UI contract test with a deterministic transport. Actual row locks, sale
// debit, replay and zero/cancel behavior are proved by the PostgreSQL runner.
async function setup(page:Page){
 const state={quantity:3,revision:1,manual:true,orders:0,ownerWrites:0};
 const raw=()=>({id:productId,sku:'COUNTER-UI',unitId:id(20),saleUnitId:id(20),nameAr:'صنف عدّاد وهمي',unitNameAr:'باكيت',saleUnitNameAr:'باكيت',unitsPerSalePackage:1,
  salePackagePriceInMinorUnits:1000,salePriceInMinorUnits:1000,quantityTracked:false,manualAvailable:state.manual&&state.quantity>0,availableQuantity:null,availableSalePackages:null,isAvailable:state.manual&&state.quantity>0});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>{
  const w=window as typeof window&{turnstile?:{render:(_container:HTMLElement,options:{callback:(token:string)=>void})=>string;reset:()=>void;remove:()=>void}};
  w.turnstile={render:(_container,options)=>{queueMicrotask(()=>options.callback('isolated-counter-widget'));return 'isolated-counter';},reset:()=>undefined,remove:()=>undefined};
 });
 await page.route('**/rpc/lite1_catalog_page2',route=>route.fulfill({json:{contractVersion:'lite2-catalog-v1',quantityTracked:false,items:[raw()],categories:[],brands:[],saleUnits:[],summary:{quantityTracked:false,availableProducts:state.quantity>0?1:0,availableSalePackages:null,lowStockProducts:0},total:1,limit:24,offset:0}}));
 await page.route('**/rpc/lite1_merchandising2',route=>route.fulfill({json:{contractVersion:'lite2-merchandising-v1',quantityTracked:false,newest:[],bestSellers:[],offers:[],lowStock:[]}}));
 await page.route('**/rpc/lite1_preview_guest2',route=>route.fulfill({json:{success:true,contractVersion:'phase3-customer-promotion-preview-v2',merchandiseSubtotalInMinorUnits:1000,promotionDiscountInMinorUnits:0,finalMerchandiseTotalInMinorUnits:1000,promotion:null}}));
 await page.route('**/functions/v1/submit-guest-order',route=>{
  expect(state.quantity).toBeGreaterThan(0);expect(route.request().postDataJSON()).toMatchObject({expectedQuote:{subtotalInMinorUnits:1000,totalInMinorUnits:1000}});
  state.quantity--;state.revision++;state.orders++;
  return route.fulfill({json:{success:true,order_id:id(100+state.orders),order_number:'COUNTER-'+state.orders,customer_id:id(200),customer_address_id:id(201),customer_reused:state.orders>1,idempotent_replay:false,subtotal:1000,discount:0,delivery_fee:0,total:1000,delivery_zone:'inside_ramtha',status:'new',payment_method:'cash_on_delivery',tracking_token:id(300+state.orders),tracking_path:'/#track='+id(300+state.orders)}});
 });
 const ownerRow=()=>({productId,name:raw().nameAr,flavorName:null,sku:'COUNTER-UI',unitId:id(20),unitName:'باكيت',enabled:true,quantity:state.quantity,threshold:2,revision:state.revision,everEnabled:true,active:true,manualAvailable:state.manual,effectiveAvailable:state.manual&&state.quantity>0});
 await page.route('**/rpc/lite3_counter_context223',route=>route.fulfill({json:{contractVersion:'optional-quantity223-v1',fullAccounting:false,productId,isFamily:false,products:[ownerRow()]}}));
 await page.route('**/rpc/lite3_set_counter223',route=>{
  const args=route.request().postDataJSON();expect(args.p_expected_revision).toBe(state.revision);expect(args.p_product_id).toBe(productId);
  state.quantity=args.p_quantity;state.revision++;state.ownerWrites++;
  return route.fulfill({json:{success:true,idempotentReplay:false,productId,enabled:true,quantity:state.quantity,threshold:args.p_low_threshold,revision:state.revision}});
 });
 return state;
}
const catalog=async(page:Page)=>{await page.goto(base+'/#catalog');await expect(page.getByTestId('catalog-products-grid')).toBeVisible();};
async function buyOne(page:Page){
 await page.getByRole('button',{name:'عرض تفاصيل صنف عدّاد وهمي',exact:true}).first().tap();
 await page.getByRole('region',{name:'إضافة باكيت',exact:true}).getByRole('button',{name:/إضافة .* باكيت من/}).tap();
 await page.keyboard.press('Escape');await page.getByRole('button',{name:/^فتح السلة،/}).tap();
 await page.getByRole('button',{name:'إتمام الطلب بدون تسجيل دخول'}).tap();
 const checkout=page.getByRole('dialog',{name:'إتمام طلب الجملة',exact:true});
 await checkout.getByLabel('الاسم الكامل*').fill('مستلم عدّاد تجريبي');await checkout.getByLabel('رقم الهاتف*').fill('0791234567');
 await checkout.getByLabel('المنطقة أو الحي*').fill('حي تجريبي');await checkout.getByLabel('تفاصيل العنوان والتوصيل*').fill('عنوان وهمي معزول');
 await checkout.getByRole('button',{name:'مراجعة الطلب قبل الإرسال'}).tap();
 const review=page.getByRole('dialog',{name:'راجع طلبك قبل الإرسال',exact:true});
 await expect(review.getByText('تم التحقق الأمني وجاهز للإرسال.')).toBeVisible();
 await review.getByRole('button',{name:'تأكيد وحفظ الطلب في الإدارة'}).tap();
 await expect(page.getByRole('heading',{name:'تم تسجيل طلبك',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'العودة للمتجر',exact:true}).tap();await expect(page.getByRole('heading',{name:'تم تسجيل طلبك',exact:true})).toHaveCount(0);
}
test('three OFF purchases reach zero without disclosing counts;actual owner panel replenishment restores storefront availability',async({page},info)=>{
 const state=await setup(page);
 for(let n=0;n<3;n++){await catalog(page);await buyOne(page);expect(state.orders).toBe(n+1);expect(state.quantity).toBe(2-n);}
 await catalog(page);await page.getByRole('button',{name:'عرض تفاصيل صنف عدّاد وهمي',exact:true}).first().tap();
 const purchase=page.getByRole('region',{name:'إضافة باكيت',exact:true});await expect(purchase.getByRole('button',{name:/إضافة .* باكيت من/})).toBeDisabled();
 await expect(page.getByRole('dialog')).toContainText('غير متوفر');await expect(page.getByRole('dialog')).not.toContainText(/المتبقي|متبقي|المتاح: [0-9]/);
 await page.screenshot({path:info.outputPath('zero-storefront.png'),fullPage:true});
 await page.goto('/e2e/package-f-products-harness.html?counter-quantity&sales-only&unit-parcel');
 await page.evaluate(()=>{
  // @ts-expect-error Isolated Vite module.
  return import('/src/stores/useAppStore.ts').then(({storeEngine})=>storeEngine.openModal('edit_product',storeEngine.getState().products[0]));
 });
 const panel=page.locator('[data-optional-quantity]');await panel.getByLabel('صار عندي — باكيت',{exact:true}).fill('5');
 await panel.getByRole('button',{name:/حفظ كمية/}).tap();await expect.poll(()=>state.ownerWrites).toBe(1);expect(state.quantity).toBe(5);
 await catalog(page);await page.getByRole('button',{name:'عرض تفاصيل صنف عدّاد وهمي',exact:true}).first().tap();
 await expect(page.getByRole('region',{name:'إضافة باكيت',exact:true}).getByRole('button',{name:/إضافة .* باكيت من/})).toBeEnabled();
 expect(state.orders).toBe(3);expect(state.manual).toBe(true);
});

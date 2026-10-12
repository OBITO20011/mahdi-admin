import {test, expect, type Page} from './isolated-test';

const base = process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';
const product = {
  id:'00000000-0000-4000-8000-000000000651',sku:'FOCUS-1',barcode:'',
  nameAr:'صنف تسليم التركيز',description:'',categoryId:'00000000-0000-4000-8000-000000000010',categoryCode:'TEST',categoryNameAr:'اختبار',
  brandId:'',brandNameAr:'',unitId:'00000000-0000-4000-8000-000000000020',unitNameAr:'حبة',
  saleUnitId:'00000000-0000-4000-8000-000000000021',saleUnitNameAr:'كرتونة',
  unitsPerSalePackage:1,salePackagePriceInMinorUnits:1250,salePriceInMinorUnits:1250,
  availableQuantity:10,availableSalePackages:10,minimumOrderPackages:1,imageUrl:'',isAvailable:true,
  createdAt:'2026-08-31T00:00:00Z',soldPackagesLast90Days:0,flavorMasterProductId:null,
  flavorNameAr:null,isFlavorMaster:false,flavorSortOrder:0,
};

async function openCart(page: Page) {
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_snapshot',route=>route.fulfill({json:{items:[product]}}));
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_page', route => route.fulfill({json:{
    items:[product],categories:[],brands:[],saleUnits:[],summary:{availableProducts:1,
      availableSalePackages:10,lowStockProducts:0},total:1,limit:24,offset:0,
  }}));
  await page.goto(`${base}/#catalog`, {waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:`إضافة ${product.nameAr} إلى السلة`}).click();
  const opener = page.getByRole('button',{name:/فتح السلة/});
  await opener.click();
  return opener;
}

test('real Cart -> Checkout commit keeps immediate real keyboard name input and its DOM identity',async({page})=>{
  await openCart(page);
  // Focus at the earliest committed opening, not after animation/readiness.
  // The old passive Cart guard and unconditional Checkout focus steal this.
  await page.evaluate(()=>{
    const observer=new MutationObserver(()=>{
      const input=document.querySelector<HTMLInputElement>('input[autocomplete="name"]');
      if(!input || input.closest('[inert], [aria-hidden="true"]'))return;
      input.dataset.handoverNode='original';
      input.focus();observer.disconnect();
    });
    observer.observe(document.body,{subtree:true,attributes:true,childList:true});
  });
  await page.getByRole('button',{name:'إتمام الطلب بدون تسجيل دخول'}).click();
  const name=page.getByLabel('الاسم الكامل*');
  await expect(name).toHaveAttribute('data-handover-node','original');
  await expect(name).toBeFocused();
  await page.keyboard.type('عميل يكتب فوراً');
  await expect(name).toHaveValue('عميل يكتب فوراً');
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('data-handover-node','original');
  await page.getByLabel('رقم الهاتف*').focus();
  await page.keyboard.type('0791234567');
  await expect(name).toHaveValue('عميل يكتب فوراً');
});

test('immediate Enter after Checkout opening does not activate close; normal cart close restores opener',async({page})=>{
  const opener=await openCart(page);
  await page.getByRole('button',{name:'إتمام الطلب بدون تسجيل دخول'}).click();
  const checkout=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'إتمام طلب الجملة'})});
  await expect(checkout).toHaveAttribute('tabindex','-1');
  await expect(checkout).toHaveAttribute('aria-labelledby','checkout-title');
  await expect(checkout).toHaveAccessibleName('إتمام طلب الجملة');
  await expect(checkout).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(checkout).toBeVisible();
  await expect(checkout).toBeFocused();
  await checkout.getByRole('button',{name:'إغلاق',exact:true}).click();
  await expect(checkout).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  const cart=page.getByRole('dialog',{name:'سلة طلب الجملة'});
  await expect(cart).toHaveAttribute('tabindex','-1');
  await expect(cart).toHaveAttribute('aria-labelledby','cart-drawer-title');
  await expect(cart).toHaveAccessibleName('سلة طلب الجملة');
  await cart.getByRole('button',{name:'إغلاق',exact:true}).click();
  await expect(cart).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test('inert predecessor cannot trap focus and teardown preserves a live nested dialog interaction',async({page})=>{
  await page.goto(base);
  const result=await page.evaluate(async()=>{
    const modulePath='/src/utils/dialogFocus.ts';
    const {activateDialog}=await import(/* @vite-ignore */ modulePath);
    const root=document.createElement('div');document.body.append(root);
    root.innerHTML='<button id="focus-opener">open</button><section role="dialog" tabindex="-1" id="focus-old"><button>close</button></section><section role="dialog" tabindex="-1" id="focus-new"><button>close</button><input id="focus-name"></section>';
    const opener=root.querySelector<HTMLElement>('#focus-opener')!;
    const old=root.querySelector<HTMLElement>('#focus-old')!;
    const next=root.querySelector<HTMLElement>('#focus-new')!;
    const name=root.querySelector<HTMLInputElement>('#focus-name')!;
    opener.focus();const closeOld=activateDialog(old,()=>undefined);
    old.inert=true;name.focus();
    const inertKeptName=document.activeElement===name;
    closeOld();const cleanupKeptName=document.activeElement===name;
    const closeNext=activateDialog(next,()=>undefined);
    const registrationKeptName=document.activeElement===name;
    next.inert=true;closeNext();const restoredOpener=document.activeElement===opener;
    root.remove();return {inertKeptName,cleanupKeptName,registrationKeptName,restoredOpener};
  });
  expect(result).toEqual({inertKeptName:true,cleanupKeptName:true,registrationKeptName:true,restoredOpener:true});
});

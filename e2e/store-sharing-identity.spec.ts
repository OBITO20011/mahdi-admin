import {test,expect} from './isolated-test';
const base=process.env.CUSTOMER_BASE_URL ?? 'http://127.0.0.1:4174';
for(const width of [360,390,768]){
 test(`official store name and all header actions fit ${width}`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:920});
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_page',r=>r.fulfill({json:{items:[],categories:[],brands:[],saleUnits:[],summary:{availableProducts:0,availableSalePackages:0,lowStockProducts:0},total:0,limit:24,offset:0}}));
  await page.route('**/rest/v1/rpc/get_public_storefront_catalog_snapshot',r=>r.fulfill({json:{items:[]}}));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  const header=page.locator('header').filter({has:page.getByRole('button',{name:'العودة إلى الصفحة الرئيسية',exact:true})}),brand=header.getByRole('button',{name:'العودة إلى الصفحة الرئيسية',exact:true});
  if(width<640){
   await expect(brand.getByText('النواصرة',{exact:true})).toBeVisible();
   await expect(brand.getByText('لتجارة الجملة والمواد الغذائية',{exact:true})).toBeVisible();
  }else await expect(brand.getByText('النواصرة لتجارة الجملة والمواد الغذائية',{exact:true})).toBeVisible();
  for(const label of ['فتح قائمة الأقسام','عرض المنتجات المفضلة'])await expect(header.getByRole('button',{name:label,exact:true})).toBeVisible();
  await expect(header.getByRole('button',{name:/فتح السلة،/})).toBeVisible();
  const boxes=await brand.locator('p:visible').evaluateAll(elements=>elements.map(e=>({width:e.clientWidth,scroll:e.scrollWidth,rect:e.getBoundingClientRect().toJSON()})));
  for(const b of boxes){expect(b.scroll).toBeLessThanOrEqual(b.width);expect(b.rect.x).toBeGreaterThanOrEqual(0);expect(b.rect.right).toBeLessThanOrEqual(width);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content',/\/nawasrah-social-card\.jpg$/);
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content','1200');
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content','630');
  await header.screenshot({path:testInfo.outputPath(`store-header-${width}.png`)});
  await testInfo.attach(`store-header-${width}`,{path:testInfo.outputPath(`store-header-${width}.png`),contentType:'image/png'});
 });
}

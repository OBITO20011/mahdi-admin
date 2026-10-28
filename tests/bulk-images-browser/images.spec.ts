import {readFileSync} from 'node:fs';
import type {Session} from '@supabase/supabase-js';
import {test,expect,assertLoopbackTestTarget} from '../../e2e/isolated-test';
const session=JSON.parse(process.env.BULK_IMAGES_SESSION??'null') as Session|null;
if(!session)throw Error('LOCAL_BULK_IMAGE_SESSION_REQUIRED');
const control=assertLoopbackTestTarget(process.env.BULK_IMAGES_CONTROL_URL??'','Bulk image fixture control'),nonce=process.env.BULK_IMAGES_CONTROL_NONCE;
const jpeg=readFileSync('tests/fixtures/bulk-images/landscape.jpg');
test('real local Auth/Storage/RPC:preview,flavor,late SKU,failure cleanup,lost reply,retry and resume',async({page},info)=>{
 const suffix=info.project.name==='chromium'?'C':'W';
 await page.setViewportSize({width:390,height:920});
 await page.addInitScript(value=>{(window as unknown as {bulkImageLiveSession:Session}).bulkImageLiveSession=value;},session);
 const pages:number[]=[],uploads:string[]=[],deletes:string[]=[];let loseReply=true;
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname.endsWith('/get_admin_product_page'))pages.push((request.postDataJSON() as {p_page:number}).p_page);if(url.pathname.includes('/storage/v1/object/product-images/')&&request.method()==='POST')uploads.push(url.pathname);if(request.method()==='DELETE'&&url.pathname.endsWith('/product-images'))deletes.push(url.pathname);});
 await page.route('**/rest/v1/rpc/set_product_primary_image',async route=>{
  if(loseReply){loseReply=false;const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('failed');return;}
  await route.continue();
 });
 await page.goto('/e2e/package-f-bulk-images-harness.html');
 await page.getByRole('button',{name:'رفع صور المنتجات حسب الرمز',exact:true}).click();await expect(page.getByRole('button',{name:'اختيار صور متعددة',exact:true})).toBeEnabled();
 expect(pages).toEqual([1,2]);
 const files=['SUG-10-','PRG-BBQ-','FAIL-','LAST-'].map(prefix=>({name:prefix+suffix+'.jpg',mimeType:'image/jpeg',buffer:jpeg}));
 await page.getByLabel('اختيار ملفات صور متعددة',{exact:true}).setInputFiles(files);await expect(page.getByRole('button',{name:'اختيار صور متعددة',exact:true})).toBeEnabled();expect(uploads.length).toBe(0);
 await page.getByRole('button',{name:'تأكيد رفع الصور المطابقة',exact:true}).click();
 await expect(page.getByText('نجح: 3 · فشل: 1 · متخطّى: 0',{exact:true})).toBeVisible();expect(uploads.length).toBe(4);expect(deletes.length).toBe(1);
 const enabled=await page.request.post(new URL('/enable-image-save',control).href,{headers:{'x-local-control':nonce??''},data:{sku:'FAIL-'+suffix}});expect(enabled.ok()).toBe(true);
 await page.getByRole('button',{name:'أعد المحاولة للفاشل',exact:true}).click();await expect(page.getByText('نجح: 4 · فشل: 0 · متخطّى: 0',{exact:true})).toBeVisible();expect(uploads.length).toBe(5);
 await page.reload();await page.getByRole('button',{name:'رفع صور المنتجات حسب الرمز',exact:true}).click();await expect(page.getByRole('button',{name:'اختيار صور متعددة',exact:true})).toBeEnabled();
 await page.getByLabel('اختيار ملفات صور متعددة',{exact:true}).setInputFiles(files);await expect(page.getByRole('button',{name:'اختيار صور متعددة',exact:true})).toBeEnabled();await page.getByRole('button',{name:'تأكيد رفع الصور المطابقة',exact:true}).click();await expect(page.getByText('نجح: 0 · فشل: 0 · متخطّى: 4',{exact:true})).toBeVisible();expect(uploads.length).toBe(5);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('actual-local-bulk-images.png'),fullPage:true});
});

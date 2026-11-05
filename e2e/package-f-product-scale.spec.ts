import {test,expect} from './isolated-test';
import {checkLayout} from './package-f-layout';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
test('actual1000parent/480flavor mobile preview stays responsive and never writes',async({page,request,browserName})=>{
 // Prepare the Vite entry first; cold translation is outside the workbook metric.
 expect((await request.get('/e2e/package-f-product-scale-harness.tsx')).ok()).toBe(true);
 await page.goto('/e2e/package-f-product-scale-harness.html');await expect(page.getByLabel('ملف المنتجات',{exact:true})).toBeVisible();
 const bytes=await readFile('scripts/testing/fixtures/product-workbook-scale/المنتجات-وهمي-1000.xlsx');
 await page.evaluate(()=>{(window as any).__scaleStart=performance.now();(window as any).__scaleRaf=[];let prior=performance.now();const tick=(now:number)=>{(window as any).__scaleRaf.push(now-prior);prior=now;(window as any).__scaleFrame=requestAnimationFrame(tick);};(window as any).__scaleFrame=requestAnimationFrame(tick);});
 await page.getByLabel('ملف المنتجات',{exact:true}).setInputFiles({name:'وهمي1000.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});
 const panel=page.getByTestId('product-workbook-preview');await expect(panel).toContainText('منتجات أساسية: 1000 · نكهات: 480');await expect(panel.getByRole('button',{name:'حفظ المنتجات والنكهات ومطابقتها'})).toBeEnabled();
 await expect(panel).toContainText('تم تطبيع 2 حقلاً وصفياً');await expect(panel).toContainText('براوني نكهة');
 const previewMs=await page.evaluate(()=>performance.now()-(window as any).__scaleStart);
 const t=Date.now();await page.getByLabel('اختبار الاستجابة',{exact:true}).fill('يستجيب');await expect(page.getByLabel('اختبار الاستجابة',{exact:true})).toHaveValue('يستجيب');const interactionMs=Date.now()-t;
 const measured=await page.evaluate(()=>{cancelAnimationFrame((window as any).__scaleFrame);return{rafGapsMs:(window as any).__scaleRaf,writes:(window as any).__scaleCalls.filter((c:any)=>c.name!=='get_go_live_setup_status_v1').length};});expect(measured.writes).toBe(0);
 // Responsiveness evidence, not a substitute for the authenticated8s DB limit.
 expect(interactionMs).toBeLessThan(1500);expect(Math.max(...measured.rafGapsMs)).toBeLessThan(1500);
 await checkLayout(page,page.locator('main'));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const next=panel.getByRole('button',{name:'التالي',exact:true}),prev=panel.getByRole('button',{name:'السابق',exact:true}),seen=new Set<string>();let pages=0,hasBrownie=false;
 await expect(prev).toBeDisabled();
 while(true){const rows=await panel.locator('tbody tr').allTextContents(),skus=await panel.locator('tbody tr td:nth-child(2)').allTextContents();expect(skus.length).toBeGreaterThan(0);expect(skus.length).toBeLessThanOrEqual(100);for(const sku of skus){expect(seen.has(sku),sku).toBe(false);seen.add(sku);}hasBrownie||=rows.some(r=>r.includes('براوني وهمي'));pages++;if(!await next.isEnabled())break;expect(pages).toBeLessThan(30);await next.tap();await expect(panel.getByRole('navigation',{name:'صفحات معاينة الملف'})).toContainText(`صفحة ${pages+1} من`);}
 expect(seen.size).toBe(1480);expect(hasBrownie).toBe(true);await prev.tap();await expect(next).toBeEnabled();
 const reader=await page.evaluate(()=>(window as any).__scaleMeasureRead());expect(reader).toMatchObject({rows:1000,errors:0});
 const folder=process.env.NAWASRAH_PRODUCT_SCALE_EVIDENCE??'test-results/product-scale';await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'preview-'+browserName+'.json'),JSON.stringify({browserName,viewport:390,parents:1000,flavors:480,pages,previewMs,interactionMs,...reader,...measured},null,2));await page.screenshot({path:path.join(folder,'preview-'+browserName+'.png'),fullPage:false});
});

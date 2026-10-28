import {readFileSync} from 'node:fs';
import {test,expect,type Page} from './isolated-test';
import {checkLayout} from './package-f-layout';
const fixture='tests/fixtures/bulk-images/',jpeg=readFileSync(fixture+'landscape.jpg'),png=readFileSync(fixture+'sample.png');
const id=(n:number)=>'11000000-0000-4000-8000-'+String(n).padStart(12,'0');
const row=(n:number,sku:string,extra:Record<string,unknown>={})=>({id:id(n),sku,name_ar:'صنف وهمي '+sku,image_url:'',is_active:true,updated_at:'2026-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z',unit_id:id(90),base_unit:{id:id(90),name_ar:'باكيت',code:'PKT'},is_flavor_master:false,flavor_master_product_id:null,...extra});
async function setup(page:Page,options:{failSave?:boolean;unknownUpload?:boolean;many?:boolean;role?:string;cleanupFails?:boolean}={}){
 const initial=options.many?Array.from({length:121},(_,i)=>row(10+i,'P'+(i+1))):[
  row(10,'SUG-10'),row(11,'EXIST',{image_url:'http://127.0.0.1:4176/fixture-existing.jpg'}),row(12,'PRG',{is_flavor_master:true}),row(13,'PRG-BBQ',{flavor_master_product_id:id(12),flavor_name_ar:'حار'}),
 ];
 const catalog=new Map(initial.map(r=>[r.id,r])),objects=new Set<string>(),refs=new Map<string,string>();
 const calls={uploads:[] as string[],saves:0,removes:[] as string[],pages:[] as number[]};let failSave=options.failSave??false,unknownUpload=options.unknownUpload??false,cleanupFails=options.cleanupFails??false;
 await page.route('**/rest/v1/rpc/get_admin_product_page',async route=>{const args=route.request().postDataJSON() as {p_page:number};calls.pages.push(args.p_page);const roots=[...catalog.values()].filter(p=>!p.flavor_master_product_id),rootPage=roots.slice((args.p_page-1)*100,args.p_page*100),keys=new Set(rootPage.map(p=>p.id));await route.fulfill({json:{products:[...catalog.values()].filter(p=>keys.has(p.id)||keys.has(String(p.flavor_master_product_id))),total_count:roots.length,metrics:{}}});});
 await page.route('**/rest/v1/rpc/search_admin_products',async route=>{const args=route.request().postDataJSON() as {p_product_id:string};const product=catalog.get(args.p_product_id);await route.fulfill({json:product?[product]:[]});});
 await page.route('**/rest/v1/rpc/set_product_primary_image',async route=>{const args=route.request().postDataJSON() as {p_product_id:string;p_image_url:string};calls.saves++;
  if(failSave&&args.p_product_id===id(13)){failSave=false;await route.fulfill({status:400,json:{code:'23514',message:'synthetic rejection'}});return;}
  const product=catalog.get(args.p_product_id)!;catalog.set(product.id,{...product,image_url:args.p_image_url});refs.set(args.p_image_url,product.id);await route.fulfill({json:id(500+calls.saves)});
 });
 await page.route('**/rest/v1/product_images?*',async route=>{const url=new URL(route.request().url()),image=url.searchParams.get('image_url')?.replace(/^eq\./u,'')??'';await route.fulfill({json:refs.has(image)?[{id:id(700)}]:[]});});
 await page.route('**/storage/v1/object/product-images/**',async route=>{const path=new URL(route.request().url()).pathname.split('/product-images/')[1];calls.uploads.push(path);if(objects.has(path)){await route.fulfill({status:409,json:{statusCode:'409',error:'Duplicate',message:'The resource already exists'}});return;}objects.add(path);if(unknownUpload){unknownUpload=false;await route.abort('failed');return;}await route.fulfill({json:{Key:'product-images/'+path,Id:id(800)}});});
 await page.route('**/storage/v1/object/product-images',async route=>{const body=route.request().postDataJSON() as {prefixes:string[]};if(cleanupFails){await route.fulfill({status:500,json:{message:'synthetic cleanup outage'}});return;}for(const path of body.prefixes){calls.removes.push(path);objects.delete(path);}await route.fulfill({json:body.prefixes.map(name=>({name}))});});
 await page.goto('/e2e/package-f-bulk-images-harness.html'+(options.role?'?role='+options.role:''));
 return {catalog,objects,refs,calls,allowCleanup:()=>{cleanupFails=false;}};
}
async function open(page:Page){await page.getByRole('button',{name:'رفع صور المنتجات حسب الرمز',exact:true}).click();await expect(page.getByRole('button',{name:'اختيار صور متعددة',exact:true})).toBeEnabled();}
const choose=async(page:Page,files:{name:string;mimeType:string;buffer:Buffer}[])=>{await page.getByLabel('اختيار ملفات صور متعددة',{exact:true}).setInputFiles(files);await expect(page.getByRole('button',{name:'اختيار صور متعددة',exact:true})).toBeEnabled();};
const image=(name:string)=>({name,mimeType:name.endsWith('.png')?'image/png':'image/jpeg',buffer:name.endsWith('.png')?png:jpeg});

test('bulk preview,flavor/default skip,middle failure/cleanup and failed-only retry 390',async({page},info)=>{
 await page.setViewportSize({width:390,height:920});const state=await setup(page,{failSave:true});await open(page);
 await choose(page,[image(' sug-١٠ .JPG'),image('prg-bbq.png'),image('NONE.jpg'),image('EXIST.jpg')]);
 await expect(page.getByTestId('bulk-image-row')).toHaveCount(4);expect(state.calls.uploads).toHaveLength(0);expect(state.calls.saves).toBe(0);
 await expect(page.getByRole('cell',{name:'ملف بلا منتج لا يوجد منتج أو نكهة بهذا الرمز.',exact:true})).toBeVisible();await expect(page.getByLabel('استبدال (الافتراضي: تخطَّ)',{exact:true})).not.toBeChecked();
 await page.getByRole('button',{name:'تأكيد رفع الصور المطابقة',exact:true}).click();
 await expect(page.getByText('نجح: 1 · فشل: 1 · متخطّى: 2',{exact:true})).toBeVisible();expect(state.calls.removes).toHaveLength(1);expect(state.objects.size).toBe(1);
 await page.getByRole('button',{name:'أعد المحاولة للفاشل',exact:true}).click();await expect(page.getByText('نجح: 2 · فشل: 0 · متخطّى: 2',{exact:true})).toBeVisible();expect(state.objects.size).toBe(2);expect(state.refs.size).toBe(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await checkLayout(page,page.getByTestId('bulk-product-images'));
 await page.screenshot({path:info.outputPath('bulk-images-390.png'),fullPage:true});
});
test('case/digit duplicates block all upload until removal;an existing image needs explicit replacement',async({page})=>{
 const state=await setup(page);await open(page);await choose(page,[image('SUG-10.jpg'),image('sug-١٠.png'),image('EXIST.jpg')]);
 await expect(page.getByRole('button',{name:'تأكيد رفع الصور المطابقة',exact:true})).toBeDisabled();expect(state.calls.uploads.length).toBe(0);
 await page.getByRole('button',{name:'إزالة sug-١٠.png',exact:true}).click();await expect(page.getByRole('button',{name:'تأكيد رفع الصور المطابقة',exact:true})).toBeEnabled();
 await page.getByLabel('استبدال (الافتراضي: تخطَّ)',{exact:true}).check();await page.getByRole('button',{name:'تأكيد رفع الصور المطابقة',exact:true}).click();await expect(page.getByText('نجح: 2 · فشل: 0 · متخطّى: 0',{exact:true})).toBeVisible();expect(state.calls.uploads.length).toBe(2);
});
test('reload/reselection skips completed files and resolves an unknown Storage reply on exactly the same path',async({page})=>{
 const state=await setup(page,{unknownUpload:true});await open(page);await choose(page,[image('SUG-10.jpg')]);await page.getByRole('button',{name:'تأكيد رفع الصور المطابقة',exact:true}).click();await expect(page.getByText('نجح: 0 · فشل: 1 · متخطّى: 0',{exact:true})).toBeVisible();expect(state.calls.removes.length).toBe(0);
 await page.getByRole('button',{name:'أعد المحاولة للفاشل',exact:true}).click();await expect(page.getByText('نجح: 1 · فشل: 0 · متخطّى: 0',{exact:true})).toBeVisible();expect(new Set(state.calls.uploads).size).toBe(1);expect(state.objects.size).toBe(1);
 await page.reload();await open(page);await choose(page,[image('SUG-10.jpg')]);await page.getByRole('button',{name:'تأكيد رفع الصور المطابقة',exact:true}).click();await expect(page.getByText('نجح: 0 · فشل: 0 · متخطّى: 1',{exact:true})).toBeVisible();expect(state.calls.uploads.length).toBe(2);
});
test('cleanup stays visible and durable across reload until a confirmed failed write can be cleaned',async({page})=>{
 const state=await setup(page,{failSave:true,cleanupFails:true});await open(page);await choose(page,[image('PRG-BBQ.jpg')]);await page.getByRole('button',{name:'تأكيد رفع الصور المطابقة',exact:true}).click();await expect(page.getByText('نجح: 0 · فشل: 1 · متخطّى: 0',{exact:true})).toBeVisible();expect(state.objects.size).toBe(1);
 await page.reload();await open(page);await expect(page.getByText(/هناك 1 صورة من رفع سابق/u)).toBeVisible();state.allowCleanup();await page.getByRole('button',{name:'تحقق من الرفع السابق ونظّف غير المحفوظ',exact:true}).click();await expect(page.getByText(/هناك 1 صورة من رفع سابق/u)).toHaveCount(0);expect(state.objects.size).toBe(0);
});
test('catalog beyond50 includes the last product;corrupt files fail before Storage',async({page})=>{
 const state=await setup(page,{many:true});await open(page);expect(state.calls.pages).toEqual([1,2]);
 await choose(page,[image('P121.jpg'),{name:'P120.jpg',mimeType:'image/jpeg',buffer:Buffer.from('broken')}]);
 await expect(page.getByText('ملف الصورة تالف أو تعذر قراءته. اختر صورة JPG أو PNG أو WebP سليمة.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'تأكيد رفع الصور المطابقة',exact:true}).click();await expect(page.getByText('نجح: 1 · فشل: 1 · متخطّى: 0',{exact:true})).toBeVisible();expect(state.calls.uploads.length).toBe(1);expect(state.catalog.get(id(130))?.image_url).not.toBe('');
});
test('a user without product edit rights cannot open the uploader or start any reads/writes',async({page})=>{
 const state=await setup(page,{role:'cashier'});await expect(page.getByTestId('bulk-product-images')).toHaveCount(0);expect(state.calls.pages.length).toBe(0);expect(state.calls.uploads.length).toBe(0);expect(state.calls.saves).toBe(0);
});
test('actual browser compression bakes EXIF90,accepts PNG/WebP and bounds side/bytes',async({page})=>{
 await setup(page);
 for(const [name,type] of [['rotate90.jpg','image/jpeg'],['sample.png','image/png'],['sample.webp','image/webp']]){
  const base64=readFileSync(fixture+name).toString('base64');
  const result=await page.evaluate(async({base64,name,type})=>{
   const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const bridge=window as unknown as {bulkCompress:(file:File)=>Promise<{file:File;width:number;height:number;fingerprint:string}>};
   const output=await bridge.bulkCompress(new File([bytes],name,{type})),bitmap=await createImageBitmap(output.file),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0);const top=[...context.getImageData(5,5,1,1).data],bottom=[...context.getImageData(5,canvas.height-6,1,1).data];bitmap.close();return {width:output.width,height:output.height,size:output.file.size,mime:output.file.type,hash:output.fingerprint,top,bottom};
  },{base64,name,type});
  expect(result.size).toBeLessThan(300_000);expect(result.mime).toBe('image/jpeg');expect(result.hash).toMatch(/^[a-f\d]{64}$/u);
  if(name==='rotate90.jpg'){expect([result.width,result.height]).toEqual([40,80]);expect(result.top[0]).toBeGreaterThan(200);expect(result.bottom[2]).toBeGreaterThan(200);}
 }
 const large=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=2400;c.height=1600;const context=c.getContext('2d')!,pixels=context.createImageData(c.width,c.height);let seed=7;for(let i=0;i<pixels.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=seed>>>8&255;pixels.data[i+2]=seed>>>16&255;pixels.data[i+3]=255;}context.putImageData(pixels,0,0);
  const blob=await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!),'image/jpeg',0.85));const bridge=window as unknown as {bulkCompress:(file:File)=>Promise<{file:File;width:number;height:number}>};const output=await bridge.bulkCompress(new File([blob],'LARGE.jpg',{type:'image/jpeg'}));return {width:output.width,height:output.height,bytes:output.file.size};
 });
 expect(Math.max(large.width,large.height)).toBeLessThanOrEqual(1200);expect(large.bytes).toBeLessThan(300_000);
});

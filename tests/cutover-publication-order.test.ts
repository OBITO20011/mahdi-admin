import{historical220Text}from'../scripts/testing/lite220-historical-test-view.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const read=(file:string)=>historical220Text(file,readFileSync(file,'utf8').replaceAll('\r\n','\n'));
const plan=read('docs/operations/GO_LIVE_CUTOVER_AR.md');
const card=read('docs/handover/ورقة-يوم-التشغيل.md');
const order=(text:string,markers:string[])=>{let previous=-1;for(const marker of markers){const at=text.indexOf(marker);assert.ok(at>previous,marker);previous=at;}};

test('cutover publishes both closed apps before entering real data on production, then rebuilds only the store before opening',()=>{
  order(card,['8أ. Auth','8ب. Edge Secrets','8ج. واتساب الرسمي','8د. كلمة المالك «انشر»','8هـ. بعد النشر','8و. تعريف الأقسام قبل الاستيراد','9. إدخال الحقيقي','10. مطابقة القوالب','11. نسخة «بداية حقيقية','15. بعد القبول والتوقيع','16. فتح ordersEnabled','17. أول بيع']);
  const first=card.split('| ☐ | 8د.')[1].split('\n')[0];
  for(const marker of ['نشر الإدارة والمتجر معاً','admin.alnawasreh.com','alnawasreh.com','verify-dist','ordersEnabled=false'])assert.ok(first.includes(marker),marker);
  assert.ok(card.split('| ☐ | 9.')[1].split('\n')[0].includes('https://admin.alnawasreh.com فقط'));
  const rebuild=card.split('| ☐ | 15.')[1].split('\n')[0];
  for(const marker of ['المتجر وحده مرة واحدة','بنفس SHA','والطلبات مغلقة','productRoutes/sitemapUrls','لا نشر إدارة ثانٍ'])assert.ok(rebuild.includes(marker),marker);
  for(const marker of ['**2.9 الانتقال للنشر المغلق:**','§8.1–8.4أ','§3','§8.4ب','§8.5','#58 يبقى Draft','لا RESET/resume بعد بدء هذه الكتابات الحقيقية'])assert.ok(plan.includes(marker),marker);
});

test('categories are matched and saved through the current admin modal before product import',()=>{
  const print=read('docs/handover/ورقة-يوم-التشغيل.html');
  order(print,['8د. كلمة المالك «انشر»','8هـ. بعد النشر','8و. تعريف الأقسام قبل الاستيراد','9. إدخال الحقيقي']);
  order(plan,['| 3.1 المواقع والإعدادات','| 3.1أ تعريف الأقسام قبل الاستيراد','| 3.2 المنتجات']);
  const products=read('src/features/products/ProductsView.tsx');
  assert.match(products,/openModal\('manage_categories'\)[\s\S]{0,600}الأقسام/u);
  const modal=read('src/components/modals/CategoriesModal.tsx');
  for(const label of ['قسم جديد','اسم القسم بالعربية','حفظ القسم'])assert.ok(modal.includes(label),label);
  for(const copy of [card,print])for(const label of ['قسم جديد','حفظ القسم','قسم مفقود أو غير نشط أو اسم مكرر'])assert.ok(copy.includes(label),label);
  const reference=read('src/features/goLive/productWorkbookReference.ts');
  assert.ok(reference.includes('c.active&&display(c.name)===row.data.category_name'));
});

test('documented two deployment commands really build and verify selected production output before uploading',()=>{
  const deployment=plan.split('### أوامر المرحلة الأولى')[1].split('### ما يقرأه المتجر')[0];
  const blocks=[...deployment.matchAll(/```powershell\n([\s\S]*?)```/gu)].map(m=>m[1]);
  assert.equal(blocks.length,2);
  order(blocks[0],['NAWASRAH_DEPLOYMENT_ENV=\'production\'','npm.cmd run deploy:admin','npm.cmd --prefix customer-web run deploy:cloudflare','verify-dist.mjs admin production dist','verify-dist.mjs customer production customer-web/dist']);
  assert.equal((blocks[1].match(/run deploy:cloudflare/gu)??[]).length,1);
  assert.doesNotMatch(blocks[1],/deploy:admin|run build:/u);
  order(blocks[1],['git rev-parse HEAD','git ls-remote','run deploy:cloudflare','verify-dist.mjs customer production customer-web/dist','verify-seo-output.mjs','productRoutes=','sitemapUrls=']);
  assert.ok(blocks.every(s=>s.includes('$releaseSha')));
  const pkg=JSON.parse(read('package.json')),store=JSON.parse(read('customer-web/package.json'));
  assert.equal(pkg.scripts['deploy:admin'],'node scripts/deployment/deploy-admin.mjs');
  const admin=read('scripts/deployment/deploy-admin.mjs');
  order(admin,["'run', 'build'",'await verifyEnvironmentDist(',"'pages',","'deploy',"]);
  order(store.scripts['deploy:cloudflare'],['assert-production-context.mjs','build:production','verify-dist.mjs customer production dist','wrangler pages deploy dist','--branch=main']);
  const run=read('scripts/environments/run-context.mjs');
  order(run,["'build'",'scripts/generate-seo-pages.mjs','scripts/verify-seo-output.mjs']);
  assert.ok(plan.includes('verify-seo-output يسمح بكتالوج فارغ'));
  assert.ok(plan.includes('sitemapUrls = 4 + categoryRoutes + productRoutes'));
});

test('runtime catalog and build-time SEO claims match actual readers without promising instantaneous refresh or empty SEO completeness',()=>{
  const app=read('customer-web/src/App.tsx'),catalog=read('customer-web/src/services/catalog.service.ts');
  for(const marker of ['CATALOG_STALE_TIME_MS = 90_000','fetchPublicProductCatalog(catalogQuery)','setProducts(catalog.items)',"window.addEventListener('focus'","window.addEventListener('online'"])assert.ok(app.includes(marker),marker);
  assert.ok(catalog.includes("readOperatingCatalog(operatingCatalogRpc,'lite1_catalog_page2'"));
  assert.ok(read('customer-web/src/services/operatingCatalog.ts').includes("supabase.rpc('get_public_storefront_catalog_page'"));
  assert.ok(read('customer-web/src/utils/operatingRead.ts').includes("lite1_catalog_page2:'get_public_storefront_catalog_page'"));
  const seo=read('customer-web/scripts/generate-seo-pages.mjs');
  for(const marker of ['lite1_catalog_page2',"p_availability:'available'",'seenProductRoutes.size','sitemapUrls: sitemapRoutes.length',"'sitemap.xml'",'JSON.stringify'])assert.ok(seo.includes(marker),marker);
  const routes=seo.match(/const sitemapRoutes = \[([\s\S]*?)\];/u)![1];
  assert.equal((routes.match(/route:/gu)??[]).length,4);
  for(const marker of ['runtime','نافذة تحديث90ثانية','p_availability=\'available\'','لا يوجد customer-web/public/_redirects','لا إجمالي صفوف products/النكهات']){
    assert.ok(plan.includes(marker),marker);
  }
});

test('closed-order verification documents both UI refusals and the current server guard, including idempotent replay',()=>{
  const app=read('customer-web/src/App.tsx'),checkout=read('customer-web/src/components/CheckoutModal.tsx');
  assert.ok(app.includes('if (!settingsTrusted)'));
  assert.ok(app.includes('if (!storefrontSettings.ordersEnabled)'));
  assert.ok(checkout.includes('if (!storefrontSettings.ordersEnabled)'));
  assert.ok(app.includes('الطلبات متوقفة مؤقتًا، لكن يمكنك تصفح الأصناف والتواصل معنا عبر واتساب.'));
  assert.ok(read('customer-web/src/services/storefront-settings.service.ts').includes("supabase.rpc('get_public_storefront_settings')"));
  assert.ok(read('supabase/functions/submit-guest-order/index.ts').includes("const rpcName = fullAccounting ? 'submit_guest_customer_order_v2' : 'lite1_guest2'"));
  order(read('docs/design/sales-only-phase2/guest-writer.sql'),["sales_lite1.lock_request(p_key,'guest2',p_request)",'RETURN replay','plan:=sales_lite2.plan','INSERT INTO public.orders']);
  const litePlan=read('docs/design/sales-only-phase2/commercial-plan.sql');order(litePlan,['SELECT * INTO settings','NOT settings.orders_enabled','PHASE3_CUSTOMER_ORDERS_DISABLED']);
  const definitions=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort().filter(f=>/CREATE (?:OR REPLACE )?FUNCTION public\.submit_guest_customer_order_v2\(/u.test(read('supabase/migrations/'+f)));
  assert.equal(definitions.at(-1),'209_product_sale_methods.sql','Update the documented current writer when a new definition is added');
  const body=read('supabase/migrations/'+definitions.at(-1)).split('CREATE OR REPLACE FUNCTION public.submit_guest_customer_order_v2(')[1];
  order(body,["v_replay->>'decision' = 'REPLAY'",'RETURN v_replay',"WHERE id = '00000000-0000-0000-0000-000000000001'::UUID FOR SHARE",'NOT COALESCE(v_settings.orders_enabled, false)','PHASE3_CUSTOMER_ORDERS_DISABLED','INSERT INTO public.orders']);
  for(const marker of ['ordersEnabled=false','get_public_storefront_settings','PHASE3_CUSTOMER_ORDERS_DISABLED','replay','لا ينشئ طلباً جديداً','عدم زيادة الطلبات','وليس تجربة رفض حية','لا ترسل طلباً حيّاً للتحقق من المنع قبل التوقيع'])assert.ok(plan.includes(marker),marker);
});

test('current owner cutover uses actual units before the signed workbook and records no opening debts or cheques',()=>{
  const current=readFileSync('docs/operations/GO_LIVE_CUTOVER_AR.md','utf8').replaceAll('\r\n','\n');
  const currentCard=readFileSync('docs/handover/ورقة-يوم-التشغيل.md','utf8').replaceAll('\r\n','\n');
  const printed=readFileSync('docs/handover/ورقة-يوم-التشغيل.html','utf8').replaceAll('\r\n','\n');
  order(current,['| 3.1 الفرع والوضع','| 3.1أ الوحدات','| 3.1ب الأقسام','| 3.2 المنتجات','| 3.5 عدّ الدرج','| 3.6 المطابقة','| 3.7 إنهاء البداية','| 3.8 إعدادات الطلبات']);
  const data=current.split('## 3. إدخال البيانات الحقيقية')[1].split('## 4.')[0];
  assert.doesNotMatch(data,/\| 3\.\d[^\n]*ديون العملاء القديمة|\| 3\.\d[^\n]*شيكات العملاء إن وجدت/u);
  for(const text of[current,currentCard,printed]){
    for(const value of['المنتجات-lite-بالوحدات-الفعلية.xlsx','1de0893f0fae400753d29227ddfa693987ceffe555d35203665636180b9be378','لا ديون قديمة ولا شيكات بداية','الوضع OFF مُثبت'])assert.ok(text.includes(value),value);
  }
  for(const value of['باكيت(PKT)','طرد(SALE-CARTON)','صندوق(BOX)','شرنك(SHRINK)','كرتونة(CTN)','15 اسماً','6دقائق و26ثانية'])assert.ok(current.includes(value),value);
  assert.equal(currentCard.split('<!-- PRINT_PAGE_BREAK -->').length,2);
  assert.ok(current.includes('مرجعD−1 جديد للـSHA النهائي'));
});

test('current cutover distinguishes a controlled acceptance opening from disabled orders and never invents a store deploy check',()=>{
  const current=readFileSync('docs/operations/GO_LIVE_CUTOVER_AR.md','utf8');
  for(const value of['لا يمكن إنشاء طلب جديد معordersEnabled=false','لا يوجد تجاوز تجريبي في الخادم','نافذة قبول معلنة','أغلق الطلبات إن بقي توقيع/فحص','تغيير واتساب مؤجل إلى ما بعد التشغيل'])assert.ok(current.includes(value),value);
  assert.ok(current.includes('أمرcustomer-web deploy:cloudflare الحالي لا يدعم --check'));
  assert.doesNotMatch(current,/npm\.cmd --prefix customer-web run deploy:cloudflare -- --check/u);
  assert.ok(current.includes('لا يُشغّل على220 بعد إفادة المالك'));
  assert.ok(current.includes('ناتجSEO المحليisolated-fixture مرفوض للنشر عمداً'));
});

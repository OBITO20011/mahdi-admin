import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {serviceInventory} from './service-access-inventory.mjs';
import {inventory} from './table-access-inventory.mjs';
import {generateAclPlan} from '../operations/frankfurt-acl-plan.mjs';
import {businessCronJobs} from '../operations/build-cron-report.mjs';
const root=path.resolve(import.meta.dirname,'../..'),oldRef='acjtabdqqnpwhdvbvnyw';
const safe=s=>String(s??'—').replaceAll('|','\\|').replaceAll('\r','').replaceAll('\n',' ');
export function assessSavedCatalog(catalog){return {
 storagePolicies:catalog.policies.filter(p=>p.schema==='storage'&&p.table==='objects'),
 storageBucketRows:Object.hasOwn(catalog,'storageBuckets')?catalog.storageBuckets:null,
 publicationMembership:Object.hasOwn(catalog,'publicationMembership')?catalog.publicationMembership:null,
 limits:['Catalog tables/schema do NOT prove bucket rows exist','Catalog functions/policies do NOT prove publication membership','No Auth,Edge environment or remote cron row snapshot in schema catalog'],
};}
export async function oldReferences(){
 const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 const matches=[];
 for(const file of [...new Set(files)].sort()){
  if(file.startsWith('supabase/migrations/')||/(^|\/)\.env[^/]*$/u.test(file)||/\.(?:png|jpg|webp|woff2?|pdf|zip|gz)$/u.test(file))continue;
  // Audit-generated evidence includes historical text by design;avoid recursion.
  if(file.startsWith('docs/operations/SERVICE_ACCESS_')||file.startsWith('scripts/audit/')||file==='tests/service-access-inventory.test.ts')continue;
  let text;try{text=await readFile(path.join(root,file),'utf8');}catch(error){if(error.code==='ENOENT')continue;throw error;}
  const lines=text.replaceAll('\r\n','\n').split('\n');
  const numbers=lines.flatMap((line,index)=>line.includes(oldRef)?[index+1]:[]);if(!numbers.length)continue;
  const category=file.startsWith('src/config/')||file.startsWith('customer-web/src/config/')?'APP_FALLBACK':
   file.endsWith('/_headers')?'CSP_CONNECT_SRC':file.startsWith('automation/')?'EXTERNAL_CONSUMER':
   file.startsWith('scripts/backup/')||file.startsWith('supabase/.temp/')||file==='supabase/config.toml'?'PRESERVE_OLD_BACKUP_LINK':
   file.startsWith('tests/')?'TEST_CONTRACT':file.startsWith('docs/')?'HISTORICAL_DOCUMENTATION':'BUILD_GUARD_OR_AUDIT';
  matches.push({file,lines:numbers,category});
 }
 return matches;
}
export function sevenFunctionReview(plan,source,evidence){
 return plan.objects.filter(o=>o.section==='functions').map(o=>{
  const name=o.row.identity.split('(')[0],sites=source.rpc.filter(r=>r.name===name||r.resolutions?.some(c=>c.name===name));
  return {identity:o.row.identity,sites:sites.map(s=>({file:s.file,line:s.line,role:s.role})),
   revokedEntries:o.before.acl.filter(e=>e.grantee!=='service_role'&&!o.after.acl.some(a=>JSON.stringify(a)===JSON.stringify(e))),
   effectiveLocal:evidence.execute.filter(e=>e.identity===o.row.identity),
   invocationResults:evidence.results.filter(r=>r.name===name).map(r=>({site:r.site,role:r.role,appRole:r.appRole,sqlstate:r.sqlstate,outcome:r.outcome})),
   triggerOnly:o.row.definition.includes('RETURNS trigger')};
 });
}
export function renderServiceAudit(source,evidence,observed,seven,refs,tableSource){
 const counts=Object.fromEntries(['success_rolled_back','permission_denied','body_validation_or_error'].map(k=>[k,evidence.results.filter(r=>r.outcome===k).length]));
 const requiredTables=[...new Set(tableSource.subscriptions.map(s=>s.table))].sort();
 const namedSites=[...source.rpc,...source.gatewayRpc.map(r=>({...r,id:r.file+':'+r.line}))];
 const rows=['## إضافة التحقيق: RPC وStorage وRealtime والإعدادات خارج migrations', '',
 '**لا تطبيق ACL ولا إعداد خدمات ولا نشر. هذا قياس محلي وقراءة ملفات محفوظة فقط؛الفجوة التشغيلية غير مغلقة.**', '',
 '### أ. RPC — EXECUTE الفعلي،لا افتراض نجاح من mock', '',
 `${source.rpc.length} موضعSDK .rpc و${source.gatewayRpc.length} موضعRESTGateway،${source.functionNames.length} اسم دالة. أسماءالأغلفةالديناميكية موثقةبالاستدعاءالذييوردها؛أيرابطغيرمحسوميفشلالجرد. ثلاثمصارفديناميكية تشملPOSV2 وإعدادالطرود،والبوابةتحوّلrpcName إلىsubmit_guest_customer_order_v2.`, '',
 `قاعدة${evidence.migrationCeiling} محلية جديدة: ${evidence.results.length} dispatch حقيقي إلىتواقيعالدوالالمستدعاة/overloads بأدوارهاالحقيقية؛${counts.permission_denied} رفض42501،${counts.success_rolled_back} نجاحمعrollback،${counts.body_validation_or_error} رفض/خطأداخلجسمالدالة. has_function_privilege موثق لكلتوقيع/دور. **فحصالصلاحيةلايعنيقبولكلدورحسبقواعدالعمل**؛المالك/admin/cashier منفصلون.`, '',
 'حدالقياسصريح:أُرسلتقيممحليةمحايدةمُنمّطةحسبتوقيعSQL(معرفعميل/فرع/مستودعfixtureحيثيوجد،NULL/JSONفارغلغيره)،وليستجميعحمولاتالتدفّقاتالصحيحةمنواجهةالتطبيق. النصالأصليلكلاستدعاءومعاملاتهفيSERVICE_ACCESS_INVENTORY.json؛قيمةكلprobeوأثرهفيSERVICE_ACCESS_DIAGNOSTIC.json. لا نسمّي274خطأتحققنجاحاًوظيفياً ولا42501. كلنجاحوكلخطأداخلsubtransactionأُرجع؛لاأثرماليأومخزنيباقٍ. اختباراتالمساراتالمتكاملةالقائمةتبقىمطلوبة؛هذهالإضافةتثبتEXECUTE/dispatchوليسإتمامكلسيناريو.', '',
 '| الدالة/مصدر الاستدعاء | الدور | EXECUTE محلي / نتائج dispatch |', '|---|---|---|',
 ...namedSites.flatMap(s=>(s.name?[s.name]:s.resolutions.map(r=>r.name)).map(name=>{
  const probe=evidence.results.filter(r=>r.site===s.id&&r.name===name);
  return `| ${name}؛${s.file}:${s.line} | ${s.role} | ${safe([...new Set(probe.map(r=>r.appRole+':'+(r.sqlstate??'success/rollback')))].join('؛ '))} |`;
 })), '',
 '#### الدوال السبع في خطة المواءمة القديمة', '',
 'الخطةتسحبمنحاًصريحة،ولايعنيذلكدائماًزوالEXECUTEالفعلي:PUBLICقديبقيموجوداً. الاختباراستخدمhas_function_privilegeلاقراءةحروفACLفقط. لا تنفيذلخطةالمواءمة.', '',
 '| الدالة | هل يستدعيها التطبيق؟ | ما يُسحب صراحةً / الفعلي فيالمرجع |', '|---|---|---|',
 ...seven.map(s=>`| ${s.identity} | ${s.sites.length?s.sites.map(x=>x.file+':'+x.line+' ('+x.role+')').join('؛ '):s.triggerOnly?'لا؛trigger function وليستRPCواجهة':'لا موضع مباشر'} | ${safe(s.revokedEntries.map(e=>e.grantee+':'+e.privilege).join(', '))}؛الفعلي:${safe(s.effectiveLocal.map(e=>e.role+'='+e.allowed).join(', '))} |`),
 '', 'authorize_admin_ai_assistant_request تستدعيهاEdge بالمستخدمauthenticated (JWTالمستخدم،لاservice_role). منحةauthenticatedموجودةفيالمرجع؛السحبالقديميخصanonغيرمستخدمهنا. الدوالالستالأخرىtrigger-only:لااستدعاءRPCمنالتطبيق،والمنحالصريحةالزائدةتكرّرPUBLICEXECUTEالقائم. لايجوزتجربتهامباشرةبـSELECTوادعاءأنهاعمليةتريغرحقيقية؛إطلاقهامنوظائفهاداخلDDL/DMLهوالمسارالصحيح.', '',
 '### ب. Storage — حاوية صور المنتجات وسياسات المستخدم', '',
 '| المصدر | bucket / العملية | الدور |', '|---|---|---|',
 ...source.storage.map(s=>`| ${s.file}:${s.line} | product-images / ${s.operation} | ${s.operation==='getPublicUrl'?'محلي لبناءURL؛لاطلبAPI':s.role} |`), '',
 'PRODUCT_IMAGE_BUCKET=product-images فيproduct-images.service.ts؛الصوروالأقسامتستخدمالحاويةنفسها. 020_product_image_storage.sql:8–31 ينشئstorage.buckets صراحةً(public=true،5MiB،JPEG/PNG/WebP)،والسياسات:publicread؛upload/update/deleteلـowner/admin/manager/warehouse_keeper وفيfolderauth.uid(). ليسإعداداًيدوياًمفقوداًمنmigrations. getPublicUrl يبنيالرابطمحلياًولايختبرإمكانيةGET. تحققالرفعوالحذفوالـbytesبخدمةStorageنفسها خارجقياسSQLهنا؛لمنشغّلهذاالتكامل.', '',
 `المحلي: ${safe(JSON.stringify(evidence.storageBuckets))}. في catalog-observed توجد ${observed.storagePolicies.filter(p=>/product images/u.test(p.name)).length} سياسات الصور الأربع. **صف bucket في فرانكفورت: ${observed.storageBucketRows===null?'غير قابل للتأكيد من اللقطة؛لا صفوف buckets في كتالوج البنية':safe(JSON.stringify(observed.storageBucketRows))}**. وجود جدول storage.buckets أو سياساته لا يثبت وجود صف product-images؛المطلوب فحص Dashboard/لقطة قراءة لاحقة من المالك فقط. لا اتصال من الوكيل.`, '',
 '### ج. Realtime — channels وpublication', '',
 `${source.channels.length} channel و${tableSource.subscriptions.length} postgres_changes فيالجرد. publicationالمحلية:${safe(JSON.stringify(evidence.publication))}. **موجودةبلامشاركةجداول؛allTables=false**. بحثmigrations001–138لايجدإضافةALTER PUBLICATION supabase_realtime ADD TABLE. إصلاحSELECTوحدهلايعيدالتحديثاتالحية. هذااقتراحإعداد/تغييرمستقللاينفّذهالتحقيق.`, '',
 '| الجدول المطلوب | العضويةالمحلية | فرانكفورتمناللقطة |', '|---|---|---|',
 ...requiredTables.map(t=>`| ${t} | ${evidence.publication.allTables||evidence.publication.tables.some(p=>p.schema==='public'&&p.table===t)?'ضمنpublication':'غيرمشترك'} | ${observed.publicationMembership===null?'غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك':safe(JSON.stringify(observed.publicationMembership))} |`), '',
 'publications/pg_publication_tables لايلتقطهماschema-catalogالحالي. لااستنتاجلعضويةفرانكفورت مننجاحالبناءأووجودrealtime schema؛ولا منوجودالجدولفيpublic. جدولالتفاصيلالأول يحفظكلchannel/اسمحدثومصدره.', '',
 '### د. مرجع المشروع القديم والإعدادات', '',
 `بحثGitلجميعالملفاتالمتتبعة+غيرالمتجاهلةخارجmigrationsالتاريخية(دونملفاتenv/القيمالسرية):${refs.length} ملفاً،القائمةأدناه. ملفاSERVICE_ACCESSالمولدانوكودأداةالبحثنفسهاواختبارهايُستثنيانمنالعدلتجنّبالتغذيةالراجعة؛المخرجاتتحفظأرقامأسطروتصنيفاًفقط. النصالعامللفرانكفورتلايُغيّرمنهذاالبحث.`, '',
 '| الملف | الأسطر | التصنيف/الأثر |', '|---|---|---|',
 ...refs.map(r=>`| ${r.file} | ${r.lines.join(', ')} | ${r.category} |`), '',
 `كلتعريفاتpublicالحاليةعلى138:المرجعالقديمفي${safe(evidence.currentOldRefFunctions.join(', '))} فقط. 139المعتمدةلهاعملمنفصلغيرمضمّن؛لاتدّعهذهالمرحلةإصلاحالرابط. ملفDB_FUNCTIONSفيشجرةالعملقديعكسمسودة139؛الحجةهناكتالوج138الحقيقي.`, '',
 'الأثر:تغييرVITE_SUPABASE_URLللوحدهلايكفي؛CSP connect-srcفيpublic/_headers وcustomer-web/public/_headers يثبتHTTP/WSSللمشروعالقديم. n8nworkflowلهأربعةروابطn8n-alert-feedقديمة. fallbackالمصدرفيالواجهتينقديم،وتجاوزenvيحسمruntimeفقط. رابطالنسخالاحتياطيوقفلpreflightوالـCLIالجذريقديمةعنقصد؛لايُغيّرهاالوكيلولاينقلالنسخالليليضمنالتحقيق.', '',
 '#### cron وروابط Edge', '',
 '| المهمة المنشأةبالتاريخ | ما تستدعيه | النقل |', '|---|---|---|',
 ...businessCronJobs.map(c=>`| ${c.name} (${c.migration}) | ${c.calls} | ${c.effect==='outbox'?'قاعدة/outbox؛المستهلكn8nخارجها':'قاعدةفقط'} |`), '',
 'لاتوجدHTTPURLفيأوامرcronالخمسة؛المستهلكيطلبn8n-alert-feed. fixtureالتشخيصأوقفتالجدولةمحلياًوحذفتrun-advanced-monitoringكمايفعلgoldenfixture،فأربعةصفوفactive=falseفيتقريرالتشخيصليستادعاءًبحالةالمشروعالبعيد. حالةتعليقفرانكفورتلأربعمهاموالتريغرDمعلومةتقريرالمالكالسابقفقط،ولمتُقرأالآن. تريغر033ورسالةاختبارpushيصلانإلىenqueueذيالرابطالقديم؛لااختبارpushأورفعالتعليققبلتسليم139وإعدادوجهتهاالمعتمد.', '',
 '#### أسماء إعدادات Edge منالمصدر (بلا قيم)', '',
 '| Edge | أسماءيقرأهاالكود |', '|---|---|',
 ...[...new Set(source.env.map(e=>e.file.split('/')[2]))].sort().map(name=>`| ${name} | ${[...new Set(source.env.filter(e=>e.file.split('/')[2]===name).map(e=>e.name))].sort().join(', ')} |`), '',
 'SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY أسماؤهافقط؛توفّرهاونوعالمفاتيحفيEdgeيحتاجلوحةSupabase. GEMINI_API_KEY **لايُضبطبقرارالمالك**؛الردودالحتميةتعملوالمسارالذييحتاجالنموذجيعيد503. لاوضعservice_roleفيواجهة. Vaultorder_push_webhook_secret تُنشئه033تلقائياً؛لاقراءةلقيمته. VAPIDالعامثابتفيpushNotifications.service.ts ويجبمطابقتهلزوجEdge؛تغييرهقديستلزمإعادةاشتراكالأجهزة. Turnstileلهadmin_login فيالإدارةوguest-order فيالمتجر؛أسماءSecretsAuth TURNSTILE_SECRET مقابلEdge TURNSTILE_SECRET_KEY مختلفة.', '',
 '### ما يجب إعداده يدوياً في فرانكفورت قبل staging', '',
 '1. إبقاء `--apply` موقوفاً؛اعتماد 150 ونطاق الأعمدة/العمليات وRLS،وحل العلاقات الأربع `PGRST201` أولاً. بعدها مرجع جديد وفحص وصول حقيقي؛لا تطبيق لخطة 279 REVOKE القديمة.',
 '2. تأكيد أن Data API مفعّلة وأن Automatically expose new tables مطفأة ومحفوظة بعد إعادة التحميل. هذا قرار المالك الحالي،ولا يسحب المنح القديمة. لا تفعيل عشوائي لـautomatic RLS يغيّر العقود.',
 '3. Auth إلزامياً: أطفئ **Allow new users to sign up** واحفظ ثمأعدتحميلاللوحةللتحقق؛التسجيلالذاتي ممنوع والموظفونينشئهمالمالك فقط. اضبط **Site URL وredirect URLs** للنطاقات النهائية **admin.alnawasreh.com وalnawasreh.com** وبالمساراتالمعتمدةمنالكود،لاlocalhost أوروابطpreview عامة. config المحلي يضعlocalhost:3000 وredirects فارغة؛ليسإثباتاًللإعدادالبعيد. تأكيدemail/password والمزودين وقوالبالبريد وSMTP والمرسل والاستعادة والتأكيد ومهلJWT/refresh وrate limits يحتاجلوحةSupabase؛لامزودOAuthمفترض ولاوصولمنالوكيل.',
 '4. تأسيس المالك الأول وprofile/role/branch بإجراء مدعوم ومعتمد؛اختبار موظف نشط ومتوقف وبلا دور،وTOTP/AAL2 والبصمة على المجالات المعتمدة. لا نقل جلسات أو عوامل قديمة،ولا تنفيذ أدوات أرصدة البداية المؤجلة.',
 '5. نشر Edge Functions الخمس عند إذن النشر المنفصل،ومطابقة verify_jwt في config وإعداد الأسماء المذكورة أعلاه خارج Git. `admin-ai-assistant` دون `GEMINI_API_KEY` بقرار المالك. اختبار CORS وJWT والأدوار،وليس نجاح النشر فقط.',
 '6. Turnstile: مطابقة site keys وsecrets ومجالات الإدارة والمتجر لكل مسار. ضبط TURNSTILE_ALLOWED_HOSTNAMES،وإطفاء test-mode،ورفض hostname/action الخاطئين. لا قيم اختبار في staging المعتمد.',
 '7. Storage: إثبات المالك وجود bucket `product-images` ومحدداته وسياساته الأربع كما في 020؛لا إعادة إنشاء يدوية بلا سبب. اختبار رفع وقراءة عامة وحذف ورفض دور غير مخوّل. فحص روابط الصور القديمة وbytes وموافقة نقلها قبل حذف القديم.',
 '8. Realtime: يلتقط المالك عضوية pg_publication_tables في الجديد؛تُعتمد قائمة الجداول أعلاه قبل أي ALTER PUBLICATION. اختبار قناتين حقيقيتين مع RLS ودور غير مخوّل؛وجود publication وحده لا يكفي.',
 '9. تسليم 139 واعتماد تطبيقها كخطوة مستقلة،ثم إعداد Vault `order_push_webhook_url` لفرانكفورت عند التفعيل فقط. إبقاء التريغر D والـcron المعلّقة حتى قرار رفع التعليق. `send_test_push_notification` لا يحميه تعطيل التريغر؛لا إرسال خارجي قبل الإذن.',
 '10. Push/n8n: مطابقة زوج VAPID وWEB_PUSH_SUBJECT وسر webhook داخل المسار المعتمد،ومراجعة إعادة اشتراك الأجهزة. تحديث روابط n8n-alert-feed الأربعة وNAWASRAH_AUTOMATION_SECRET عند الإذن،لا الآن. مهام outbox لا ترسل Telegram دون مستهلك معدّ.',
 '11. الواجهتان/Cloudflare: ضبط VITE_SUPABASE_URL وVITE_SUPABASE_PUBLISHABLE_KEY (أو VITE_SUPABASE_ANON_KEY المعتمد) للجديد في staging،وتحديث CSP HTTP/WSS قبل التجربة. مطابقة VITE_STOREFRONT_PUBLIC_URL للإدارة وVITE_PUBLIC_SITE_ORIGIN للمتجر،وVITE_TURNSTILE_SITE_KEY للمتجر ومفتاح الإدارة من config،وVITE_STORE_WHATSAPP_NUMBER وVITE_SENTRY_DSN إن كان مفعّلاً. لا preview عامة على بيانات التشغيل؛اختبار CORS وتحديث service worker/cache والروابط المطبوعة على الهاتف.',
 '12. النسخ والحارس: إعادة توجيه النسخ الليلي وkeep-alive وقياس 400MB وتنبيهات Telegram عند تفويض النقل فقط،بإجراء لا يكسر ربط الجذر القديم. النقل لجهاز المحل الدائم خطوة لاحقة معتمدة؛لا أسرار أو مهام مراقبة تُنشأ بهذا التحقيق.',
 '13. عند تحويل GitHub إلى private بقرار التسليم: تعطيل جدول public-uptime وقتها فقط وتفعيل PRIVATE_CI_BUDGET_MODE بالإعداد الواحد الموثق،مع full CI قبل أي نشر. لم يُفعّل ذلك الآن.',
 '14. بوابة staging: full CI والأسرار على نفس SHA،وتجربة واجهة حقيقية بلا mocks للجداول وRPC وStorage وRealtime وAuth وEdge،ثم golden day ومطابقة الأرصدة والمراقبة والنسخ. كل بند غير مثبت من اللوحة يبقى «يحتاج تأكيد المالك من لوحة Supabase»،لا نجاحاً افتراضياً.', '',
 '### إعادة إنتاج الإضافة', '', '```powershell','node scripts/audit/service-access-inventory.mjs','node scripts/audit/run-service-access-diagnostic.mjs',
 'node scripts/audit/service-access-report.mjs <diagnostic.json> <local-reference.json> <catalog-observed.json>','```', '',
 `لاconnectionstringأومفتاحخدمةبعيدفيهذهالأوامر. الأمرالأخيرقراءةملفاتمحفوظةفقط؛لاقيملأسرارفيالمخرجات. قياسEXECUTE على${evidence.migrationCeiling} ومصدرالاستدعاءاتالحالي؛150 لاتغيرEXECUTE بدليل مقارنةالكتالوجالكاملة،و139تغيّر جسمenqueueغيرالمستدعىمنالواجهةمعإبقاءACL.139سُلّمتمنفصلة3a3893b،وقياسهاالحقيقيأثبتصفرمرجعقديمفيتعريفاتpublic بعدالتطبيقالمحلي؛لايعنيهذاأنهاتطبقتعلىفرانكفورت.`,
 ];return rows.join('\n')+'\n';
}
export async function generateServiceReport(diagnostic,referenceFile,observedFile){
 const evidence=JSON.parse(await readFile(diagnostic,'utf8')),reference=JSON.parse(await readFile(referenceFile,'utf8')),catalog=JSON.parse(await readFile(observedFile,'utf8'));
 assert.equal(evidence.ok,true);const source=await serviceInventory();assert.deepEqual(source.sourceHashes,evidence.sourceHashes,'STALE_SERVICE_EVIDENCE');
 const plan=generateAclPlan(reference.catalog,catalog),seven=sevenFunctionReview(plan,source,evidence),observed=assessSavedCatalog(catalog),refs=await oldReferences(),tables=await inventory();
 await writeFile(path.join(root,'docs/operations/SERVICE_ACCESS_DIAGNOSTIC.json'),JSON.stringify({...evidence,savedCatalogAssessment:observed,sevenFunctions:seven,oldReferences:refs},null,2)+'\n');
 const markdown=renderServiceAudit(source,evidence,observed,seven,refs,tables);
 await writeFile(path.join(root,'docs/operations/SERVICE_ACCESS_AUDIT.md'),'# إضافة جرد الخدمات والإعدادات —2026-10-15\n\n'+markdown);
 return markdown;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 await generateServiceReport(...process.argv.slice(2));console.log('OFFLINE_SERVICE_REPORT_GENERATED');
}

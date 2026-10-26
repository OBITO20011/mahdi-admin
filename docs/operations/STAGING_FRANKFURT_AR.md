> دليل تاريخي لمعاينة فرانكفورت قبل التشغيل. لا تنفذ أوامره بعد فصل البيئات. المرجع الحالي: [ENVIRONMENT_SEPARATION_AR.md](ENVIRONMENT_SEPARATION_AR.md). تبقى previews مغلقة من يوم التشغيل حتىT+7 ثم تُربط بسنغافورة المستقلة.

# دليل staging فرانكفورت للمالك

محدّث18أكتوبر2026؛أبلغ المالك بنشر المعاينة بواسطةClaude بإذنه.
هذا الوكيل لا ينشر ولا يقرأ أسراراً ولا يتصل بفرانكفورت؛مهمته الحالية إصلاح أداة التأسيس محلياً.
المشروع: **nawasrah-fra — kzevmysfydaslxcerogt — eu-central-1**.
المصدر: SERVICE_ACCESS_AUDIT.md وsupabase/config.toml وكود التطبيقين.
قد يتغير اسم تبويب في اللوحة؛ إذا لم تجد الخيار توقف وتحقق، لا تخمّن بديلاً.

## إيصال نشر المعاينة —18أكتوبر،نقله المالك/Claude

- إذن«انشر» صدر للمعاينة المحمية فقط،ونفّذهClaude من7c22eef وCI أخضر.
- Restrict previews مفعّل للمشروعين؛staging-frankfurt وروابطhash تعيد302
  إلىcloudflareaccess؛productionpages.dev القديم200 دون تغيير،بحسبClaude.
- Edgeالخمس منشورة علىkzevmysfydaslxcerogt بخياراتverify_jwt المطابقةللـconfig.
- الإدارة `https://staging-frankfurt.nawasrah-admin.pages.dev`،deploy `4424b80c`.
- المتجر `https://staging-frankfurt.nawasrah-store.pages.dev`،deploy `b77e2a4a`.
- استُعملت متغيراتالقسم7 حرفياً؛distبلاالمرجعالقديم وCSP لفرانكفورت،
  وSEOولّد0منتجات لأنالقاعدةفارغة. هذه نتائجClaude،لا فحصشبكي لهذاالوكيل.
- Authمؤكد: `abo3zoubi3@gmail.com`،UUID `441d69b5-9705-4d01-987a-c235b10995f3`.
  الاسم«المالك»،branch-code `BR-MAIN`،الفرع«الفرع الرئيسي» كما أكدالمالك.
  أبلغ المالك لاحقاً: --apply ok=true وownerBound=true وصفر فروق،في
  `first-owner-2026-10-18T19-38-37-920Z`. ربط ERP تم بحسب تقريره؛TOTP ينتظر
  تفعيله من الملف الشخصي. لا اتصال مستضاف أو تحقق حي من هذا الوكيل.

لا تعِد أمر التأسيس بعد نجاحه. حجز الإشعارات والنسخ على القديم باقيان كما كانا.
تغيير مصطلحات الوحدات اللاحق يحتاج إعادة نشر المعاينة بيد المالك بعد تسليمه.

## حالة أبلغ بها المالك وراجعهاClaude —17أكتوبر

- الترقية حتى198:--apply ok=true،12/12مطبقة ومسجلة(180–182 و190–198)،
  صفر فروق غير متوقعة،وحجز الإشعارات باقٍ. التقرير
  `upgrade198-2026-10-17T18-49-30-627Z`.
- --verify-only ok=true،صفر فروق وبلا كتابة؛التقرير
  `upgrade198-2026-10-17T18-54-59-238Z`.
- معلومة من المالك:المحاولة الأولى18:54:11فشلت بـCONNECTED_VERSION_READ_FAILED؛
  تلتها محاولتان ناجحتان18:54:59و18:55:38. سبب الأولى غير مثبت؛لا نعدّها فشل ترقية.
- signup مطفأ؛SiteURL وredirectURL =
  `https://staging-frankfurt.nawasrah-admin.pages.dev`؛TOTP مفعّل.
- bucket الصور وسياساته وعضويةRealtime13 مطابقان بحسب مراجعةClaude.
- AuthCAPTCHA(Turnstile) مفعّل بسرwidgetالإدارة. لا يُحفظ السر هنا.
- أُبلغ بضبط أسماءEdge التالية:TURNSTILE_ALLOWED_HOSTNAMES،
  TURNSTILE_TEST_MODE=false،TURNSTILE_SECRET_KEY،GUEST_ORDER_HASH_SECRET،
  NAWASRAH_AUTOMATION_SECRET،WEB_PUSH_VAPID_PUBLIC_KEY،
  WEB_PUSH_VAPID_PRIVATE_KEY من الزوج الجديد،WEB_PUSH_SUBJECT.
  أكد المالك أن العدد ثمانية فقط،لا تاسع ولاservice_role يدوي؛توفر المنصة
  SUPABASE_* تلقائياً. GEMINI_API_KEY يبقى غير مضبوط.

هذه حالة لوحة/تقارير نقلها المالك،لا اختبارواجهة أو نشر أو وصولحي من الوكيل.
حمايةCloudflareAccess ونشرEdge/الواجهتين أُبلغبإنجازها18أكتوبر أعلاه؛
قبول تدفقاتالتطبيق الحية وتأسيسERPوTOTP المستخدم لا تُستنتج من نجاح النشر.

بموافقةالمالك17أكتوبر:فُصلإعدادStorageللنسخعنإعدادالواجهةفي
scripts/backup/backup-public-config.mjs؛النسخيبقىعلىالقديم،معرفضأي
عدم تطابقproject-refأواتصالDB. لا تشغّلبbackup:preflightضمنهذهالمهمة؛
فهوفحصشبكيحقيقي. نقلنظامالنسخلفرانكفورتمهمةمنفصلة،وليسأثرجانبيّاًللبناء.

## 1. تحقق من القاعدة وData API

Supabase → المشروع المحدد → Settings → Data API:

- Data API مفعّل، و**Automatically expose new tables مطفأ**. احفظ ثم أعد تحميل الصفحة للتأكد.
- لا تفعّل Automatic RLS عشوائياً؛ السياسات والمنح من migrations.
- المشروع وصل198 وفق تقريريالمالك أعلاه؛160ملفاً فعلياً في السلسلة المعتمدة،لا198ملفاً. لا تعد تطبيق ترقيات171/182/198 الناجحة؛راجع FRANKFURT_UPGRADE_198_AR.md والحجز باقٍ.
- لا تشغّل frankfurt-align-acl --apply أو db reset --linked.

## 2. امنع التسجيل الذاتي واضبط Auth

Authentication → Sign In / Providers أو General configuration:

1. أطفئ **Allow new users to sign up**، ثم Save وReload للتحقق.
2. أبقِ مسار Email/password الحالي. لا تضف OAuth provider غير معتمد.
3. Authentication → URL Configuration: أثناء التجربة المحمية يكون Site URL:
   `https://staging-frankfurt.nawasrah-admin.pages.dev`.
   Redirect URLs تكون للأصل المحدد فقط؛ لا localhost أو wildcard عام.
   عند التحويل الرسمي يصبح Site URL هو `https://admin.alnawasreh.com` وتراجع القائمة للنطاقات النهائية. المتجر ضيوف، ولا يحتاج signup.
4. Attack Protection → CAPTCHA: Turnstile، بالسر المطابق لمفتاح الإدارة العام في src/config/supabase-public-config.ts. لا تضع السر في VITE.
5. Multi-Factor → TOTP: فعّل Enrollment وVerification. اتبع FIRST_OWNER_FRANKFURT_AR.md لتأسيس المالك ثم تحقق من aal2.
6. راجع SMTP والمرسل والقوالب ومهل JWT وrefresh وrate limits من اللوحة. ليست هناك قيم تشغيل معتمدة لها في المستودع؛ **تحتاج تأكيد المالك من لوحة Supabase**، بلا تخمين أو تخفيف.

التحقق: signup غير المسموح مرفوض؛ دخول المالك وCAPTCHA صحيحان؛ بعد تفعيل TOTP تُرفض جلسة aal1 القديمة. حساب بلا ERP role لا يفتح الإدارة. لا تنقل جلسات المشروع القديم.

## 3. تحقق من الصور وRealtime

Storage → Files → `product-images`: public، وحد الملف 5MiB، والأنواع JPEG/PNG/WebP فقط، كما في 020.
Storage → Policies: أربع سياسات: قراءة عامة؛ upload/update/delete للموظف المخوّل داخل مجلد UUID الخاص به.
اختبر رفع صورة بالمالك وقراءتها العامة وحذفها ورفض دور غير مخوّل. وجود السياسات وحده لا يثبت وجود صف bucket أو الملف نفسه.

Database → Publications → `supabase_realtime`: بعد 151 يجب وجود **13 جدولاً** فقط:
customer_addresses، customers، inventory_balances، inventory_movements، orders، products،
purchase_order_items، purchase_orders، purchase_receipts، supplier_payments،
supplier_receipt_items، supplier_receipts، suppliers. لا FOR ALL TABLES.

التحقق: قناة حقيقية لموظف نشط تستقبل INSERT على orders؛ anon وحساب بلا ERP role لا يستقبلان بيانات السجل. تقرير المالك يثبت العضوية، لا نجاح كل تدفقات الواجهة.

## 4. أسرار Edge Functions الخمس

Supabase → Edge Functions → Secrets. أدخل القيم هناك فقط؛ لا Git ولا أوامر terminal تحتوي قيماً سرية.
يقرأ المصدر SUPABASE_URL وSUPABASE_ANON_KEY وSUPABASE_SERVICE_ROLE_KEY التي توفرها المنصة؛ تحقق من توفرها وتوافق المفاتيح في runtime. لا تضع service_role أو secret key في المتصفح.

| Function | أسماء إعداداتها الإضافية | التحقق بعد إذن النشر |
|---|---|---|
| submit-guest-order | GUEST_ORDER_HASH_SECRET، TURNSTILE_SECRET_KEY، TURNSTILE_ALLOWED_HOSTNAMES، TURNSTILE_TEST_MODE | رفض CAPTCHA/Origin/hostname/action الخاطئة، وtest mode مطفأ |
| manage-staff-users | لا إعداد إضافي فوق SUPABASE_* | JWT حقيقي ومالك فقط لإنشاء الموظفين |
| admin-ai-assistant | GEMINI_MODEL اختياري؛ `GEMINI_API_KEY` غير مضبوط بقرار المالك | الرد الحتمي يعمل؛ مسار النموذج يعيد 503 عند غياب المفتاح |
| n8n-alert-feed | NAWASRAH_AUTOMATION_SECRET | header صحيح فقط؛ لا تشغيل مستهلك Telegram الآن |
| send-order-push | WEB_PUSH_VAPID_PUBLIC_KEY، WEB_PUSH_VAPID_PRIVATE_KEY، WEB_PUSH_SUBJECT | سر webhook صحيح؛ لا إرسال اختبار حقيقي قبل الإذن |

Cloudflare → Turnstile → Widget الإدارة: أضف hostname المعاينة المحدد والنطاق النهائي.
Widget المتجر: أضف `staging-frankfurt.nawasrah-store.pages.dev` وalnawasreh.com.
الإدارة ترسل action=admin_login، والمتجر action=guest-order.
سر Auth اسمه في config: TURNSTILE_SECRET؛ سر Edge للمتجر TURNSTILE_SECRET_KEY. لا تخلط بينهما.
TURNSTILE_ALLOWED_HOSTNAMES قائمة hostnames بلا https أو مسارات؛ تشمل المتجر ومعاينته المحددة. TURNSTILE_TEST_MODE=false.

طابق VAPID العام في src/services/pushNotifications.service.ts مع الزوج الجديد الذي وضعه المالك في Edge؛ الخاص يبقى في Secrets ولا يُقرأ للتشخيص. بعد إذن النشر فقط: أعد تفعيل الإشعارات على جهاز الاختبار، ثم أثبت وصول إشعار طلب حقيقي من فرانكفورت. وصوله إثبات عملي أن الخاص المحفوظ يطابق العام؛ لا إرسال تجريبي من الوكيل الآن ولا تغيير للمشروع القديم.
لا تولّد زوجاً جديداً دون خطة إعادة اشتراك الأجهزة. راجع WEB_PUSH_SUBJECT وn8n URLs عند إذن التفعيل.
Vault: أبقِ order_push_webhook_secret كما هو. قيمة order_push_webhook_url عند **التفعيل فقط**:
`https://kzevmysfydaslxcerogt.supabase.co/functions/v1/send-order-push`.
لا ترفع حجز التريغر D أو مهام cron الأربع في هذه المرحلة.

## 5. أوامر Edge محضّرة فقط

**لا تُشغّل قبل كلمة «انشر» وCI كامل أخضر على نفس SHA،وبعد إثبات حمايةAccess
في القسم6 وقبلأيbuild.** لا تضبط GEMINI_API_KEY. تسلسل القسم7 هو المرجع
لتنفيذEdge ثم الواجهتين؛هذا القسم يوثق flags فقط ولا يقدّم إذن نشر.

الأوامر الخمسة موجودة مرة واحدة في تسلسل القسم7،بغلاف يتوقف عند أيexitغيرصفري.
submit-guest-order وn8n-alert-feed وsend-order-push تستخدم--no-verify-jwt؛
manage-staff-users وadmin-ai-assistant تبقيان verify_jwt=true كمافيconfig.

الخيارات تطابق verify_jwt الحالي في config. المرجع صريح؛ لا supabase link في جذر المستودع.
بعد النشر راجع Logs بلا أسرار أو رموز، واختبر CORS وJWT والأدوار. نجاح deploy ليس نجاحاً وظيفياً.

## 6. اجعل Cloudflare Preview غير عام أولاً

Workers & Pages → nawasrah-admin ثم nawasrah-store → Settings → General → Enable access policy / Access.
سياسة Allow لبريد المالك والمراجعين المحددين فقط؛ لا Everyone أو Bypass.
اختبر في incognito قبل رفع build: الزائر غير المخوّل يصل إلى Access challenge أو رفض، لا HTML التطبيق.
احمِ branch alias وروابط hash القديمة أيضاً. noindex ليست حماية.
حماية HTML لا تجعل REST العام لكتالوج الضيوف خاصاً؛ لا تضع بيانات تشغيل حقيقية في التجربة.

هذه بوابة قبل أيbuild،وليست خطوة بعدرفعdist. تحقق من أن سياسةAccess تشمل
`staging-frankfurt.nawasrah-admin.pages.dev` و`staging-frankfurt.nawasrah-store.pages.dev`
وجميع روابطhash للمعاينات،لا أن حمايةالنطاقالأصلي وحدها تكفي. إعدادPages
يحمي المعاينات لا نطاقProductionالأصلي أوcustomdomain؛لا تغيّر وصول القديم.
إن لم يوجد نشرمعاينة سابق،يمكن إثبات سياسةالنطاق مسبقاً منAccess؛بعد أول
رفع أعد اختبار رابطhash والalias فوراً قبل مشاركة الرابط أو إدخال بيانات.
إن لم يمكن إثبات شمول الحماية قبلالبناء،توقف ولا ترفع محتوى لتجربة الحماية.

Settings → Variables and Secrets → **Preview فقط**، دون تغيير Production القديم:

| المتغير | القيمة المطلوبة |
|---|---|
| VITE_SUPABASE_URL للواجهتين | https://kzevmysfydaslxcerogt.supabase.co |
| VITE_SUPABASE_PUBLISHABLE_KEY للواجهتين | المفتاح العام من Settings → API Keys لفرانكفورت، لا service_role |
| VITE_STOREFRONT_PUBLIC_URL للإدارة | https://staging-frankfurt.nawasrah-store.pages.dev |
| VITE_PUBLIC_SITE_ORIGIN للمتجر | https://alnawasreh.com،عنوانcanonical العام المعتمد؛لاpages.dev |
| VITE_TURNSTILE_SITE_KEY للمتجر | site key العام لويدجت المتجر |
| VITE_STORE_WHATSAPP_NUMBER | رقم المحل المعتمد، لا رقم مخمّن |
| VITE_SENTRY_DSN | اختياري؛ فارغ إن لم يُعتمد |

لا VITE_BROWSER_QA_ISOLATED أو SEO_AUDIT_* في staging حقيقي.
احذف VITE_SUPABASE_ANON_KEY إن كان بديلاً متعارضاً. مفتاح Turnstile للإدارة من config المصدر، لا VITE جديداً.
Cloudflare build env لا ينتقل إلى terminal المحلي؛ أدخل المتغيرات العامة المطابقة في جلسة البناء المحلية عند الإذن.

عنوانcanonical ليس عنوانAPI ولا رابطالمعاينة. فاحصSEO الحالي يفرض
alnawasreh.com ويرفضpages.dev؛يبقى كما هو بلا تخفيف. صفحاتالمعاينة نفسها
تحميهاAccess ويُتحقق منX-Robots-Tag:noindex الذي تضيفهPages للمعاينات؛
هذا لا ينشر المتجر على النطاق النهائي. كل قراءةCatalog/Offers أثناءSEO
يجب أن تستهدفconfig فرانكفورت لا قاعدةالمشروع القديم.

## 7. بوابتا CSP ومصدرSEO — تحضير17أكتوبر،لا نشر

1. في public/_headers وcustomer-web/public/_headers استبدل داخل connect-src HTTP وWSS للمرجع القديم بـ:
   `https://kzevmysfydaslxcerogt.supabase.co` و`wss://kzevmysfydaslxcerogt.supabase.co`.
   تبقى بقية CSP والترويسات حرفياً؛ لا wildcard. التبديل نُفّذ في شجرة
   التحضير بإذن17أكتوبر،ويثبته اختبار تطابق كامل مع40ecf12 بعدعكس المرجعين
   فقط؛لا يعني ذلك أن الترويسات نُشرت.
2. customer-web/scripts/generate-seo-pages.mjs يقرأ config المصدر، لا VITE_SUPABASE_URL.
   لذلك VITE وحدها لا تكفي. قرار17أكتوبر:URL والمفتاحالعام في ملفَيconfig
   المصدر يصبحان لفرانكفورت؛الإدارة تبقيTURNSTILE_SITE_KEY نفسه،ولا تتغير
   قراءةenv أوآليةAuth. أرسل المالك مفتاحPublishable العام منSettings→API Keys؛
   أُدخل معURLفرانكفورت في الملفين. مولّدSEO نفسه يقرأ config المتجر؛اختبار
   بلا شبكة يثبت الرابط والمفتاح الفعليين لطلبيcatalog/offers،لا مجردenv.
   **النشر محجوب حتى إغلاقهما؛لا نتخطىSEO ولا نستخدمaudit loopback بديلاً.**

بعد كلمة «انشر» وإغلاق البوابتين وCI أخضر،الترتيب الإلزامي:
Access(القسم6) ← Edgeالخمس ← buildالإدارة/preview ← buildالمتجر/preview.
منجذرالمستودع وبجلسةعامة فقط؛القيمالسرية تبقى فيلوحاتالخدمات:

```powershell
# بعد تحقق المالك من Access؛لا تشغل الآن.
function Invoke-StagingStep {
  param([Parameter(Mandatory=$true)][scriptblock]$Step)
  & $Step
  if ($LASTEXITCODE -ne 0) { throw 'فشلت الخطوة؛توقف ولا تكمل النشر.' }
}

if ([string]::IsNullOrWhiteSpace($env:VITE_TURNSTILE_SITE_KEY) -or
    [string]::IsNullOrWhiteSpace($env:VITE_STORE_WHATSAPP_NUMBER)) {
  throw 'اضبط مفتاحTurnstile العام للمتجر ورقمWhatsApp المعتمدين في جلسةالبناء أولاً.'
}

Invoke-StagingStep { npx.cmd supabase functions deploy submit-guest-order --project-ref kzevmysfydaslxcerogt --no-verify-jwt }
Invoke-StagingStep { npx.cmd supabase functions deploy manage-staff-users --project-ref kzevmysfydaslxcerogt }
Invoke-StagingStep { npx.cmd supabase functions deploy admin-ai-assistant --project-ref kzevmysfydaslxcerogt }
Invoke-StagingStep { npx.cmd supabase functions deploy n8n-alert-feed --project-ref kzevmysfydaslxcerogt --no-verify-jwt }
Invoke-StagingStep { npx.cmd supabase functions deploy send-order-push --project-ref kzevmysfydaslxcerogt --no-verify-jwt }

# امسح أي overrides لفحص محلي من هذه الجلسة؛لا أسرار في هذه المتغيرات.
Remove-Item Env:VITE_BROWSER_QA_ISOLATED -ErrorAction SilentlyContinue
Remove-Item Env:NAWASRAH_SEO_AUDIT_API_URL -ErrorAction SilentlyContinue
Remove-Item Env:NAWASRAH_SEO_AUDIT_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:VITE_SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
$env:VITE_SUPABASE_URL = 'https://kzevmysfydaslxcerogt.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_d4TElxRQFkC-AZko3_ASeg_YotqxGjV'
# بعد اكتمال البوابة2:config المصدر وحده يثبت URL+المفتاح العام الصحيحين.
# المتغيران العامان الصريحان يمنعان .env محلياً قديماً من تجاوز المصدر أثناء هذا البناء.
$env:VITE_STOREFRONT_PUBLIC_URL = 'https://staging-frankfurt.nawasrah-store.pages.dev'
$env:VITE_PUBLIC_SITE_ORIGIN = 'https://alnawasreh.com'

Invoke-StagingStep { npm.cmd run build }
Invoke-StagingStep { npx.cmd wrangler pages deploy dist --project-name=nawasrah-admin --branch=staging-frankfurt }
Push-Location customer-web
try {
  # VITE_TURNSTILE_SITE_KEY وVITE_STORE_WHATSAPP_NUMBER العامان بقيم المالك المعتمدة.
  # إن لم يكونا مضبوطين لهذه الجلسة،توقف قبلالبناء؛لا تستخدم placeholders.
  Invoke-StagingStep { npm.cmd run build }
  Invoke-StagingStep { npx.cmd wrangler pages deploy dist --project-name=nawasrah-store --branch=staging-frankfurt }
} finally { Pop-Location }
```

نفّذ كل أمر بعد نجاح السابق فقط. المتجر يرفع customer-web/dist، لا dist الإدارة.

بوابتاالمصدر/CSP مثبتتان محلياً:1227وحدةإدارة+191متجر،42متصفح،بناءان
وSEOمعزول،صفرطلباتإنتاجهاربة. CIالكامل لنفسSHA وكلمة«انشر» ومراجعةAccess
تبقى شروطاً مستقلة لأي نشرلاحق. حدثالنشرالمحمي بواسطةClaudeوفقإيصال18أكتوبر.
تفاصيل التحضير FRANKFURT_STAGING_PREPARATION_198_AR.md.
لا deploy:admin أو deploy:cloudflare الحاليين ولا --branch=main؛ كلها مسارات نشر الإنتاج.

أُعدّتالأوامر17أكتوبر،وأبلغClaude بتنفيذها18أكتوبر فيالإيصالأعلاه؛
ليستإذناً بإعادةالنشر. فرعPages هوstaging-frankfurt بغض النظر عن
فرعGit المحلي،ولا يغيرproductionbranch. احتفظبـbuild provenance وSHAالمقبول
في تقريرالنشر،واختبرAccess علىalias وhash وNetwork قبلقبولالمعاينة.

## 8. قبول staging قبل التحويل

- Network: REST/RPC/WSS/الصور/Edge كلها إلى kzevmysfydaslxcerogt، لا acjtabdqqnpwhdvbvnyw.
- دخول وTOTP ورفض غير المخوّل، Storage وRealtime حقيقيان، وcheckout كضيف؛ لا mocks.
- اختبار Origin وhostname/action الخاطئة، وبقاء الحجز حتى إذن رفعه.
- يوم تجريبي ومطابقة الوردية والأرصدة والأرباح والمراقبة والنسخ من الواجهة.
- نقل النسخ الليلي والحارس للجديد عمل منفصل بإذن؛ لا تغيّر root project-ref القديم أو n8n URLs بالخطأ. أكمل نقل الحارس لجهاز المحل، keep-alive و400MB وTelegram بحسب قائمتها المعتمدة.
- عند تحويل GitHub إلى private لاحقاً فقط: إيقاف جدول public-uptime وتفعيل PRIVATE_CI_BUDGET_MODE وفق وثيقته، مع FULL CI قبل النشر.
- بعد التجربة: TRIAL_RESET_FRANKFURT_AR.md، ثم مراجعة التقرير وقبول المالك قبل التسليم.
- بعد نجاح التصفير، سجّل الخروج وامسح بيانات موقع التجربة من أجهزة الاختبار قبل فتح يوم التشغيل؛ لا تحمل سلة أو مسودة أو محاولة POS قديمة إلى القاعدة المعاد بناؤها. حساب Auth وTOTP يبقيان، وقد يلزم تسجيل الدخول وربط الجهاز مجدداً. هذه خطوة أجهزة، لا تعديل لمنطق التطبيق.

مراجع اللوحات: [Auth](https://supabase.com/docs/guides/auth/general-configuration)، [Redirects](https://supabase.com/docs/guides/auth/redirect-urls)، [Edge Secrets](https://supabase.com/docs/guides/functions/secrets)، [Pages Preview/Access](https://developers.cloudflare.com/pages/configuration/preview-deployments/).
الإعدادات المنجزة وفق المالك/Claude موثقة أعلى الدليل؛ما عداها يبقى بحاجة
إلى تحقق المالك،ولا يُفترض أن نجاح اللوحة يثبت نجاح التدفقات بعد النشر.

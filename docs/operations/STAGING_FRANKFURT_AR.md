# دليل staging فرانكفورت للمالك

تحضير 2026-10-16 فقط. لا نشر، لا إعداد أسرار، ولا اتصال بفرانكفورت من الوكيل.
المشروع: **nawasrah-fra — kzevmysfydaslxcerogt — eu-central-1**.
المصدر: SERVICE_ACCESS_AUDIT.md وsupabase/config.toml وكود التطبيقين.
قد يتغير اسم تبويب في اللوحة؛ إذا لم تجد الخيار توقف وتحقق، لا تخمّن بديلاً.

## 1. تحقق من القاعدة وData API

Supabase → المشروع المحدد → Settings → Data API:

- Data API مفعّل، و**Automatically expose new tables مطفأ**. احفظ ثم أعد تحميل الصفحة للتأكد.
- لا تفعّل Automatic RLS عشوائياً؛ السياسات والمنح من migrations.
- المشروع وصل171 وفق تقرير المالك؛ بعد إذنه بترقية182 راجع تقريرها والتحقق اللاحق:151ملفاً، صفر فروق غير متوقعة، والحجز باقٍ. لا تستخدم أدوات182 على مشروع171 قبل الترقية؛ راجع FRANKFURT_REFERENCE_182_AR.md.
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

طابق VAPID العام في src/services/pushNotifications.service.ts مع زوج مفاتيح Edge؛ الخاص يبقى في Secrets.
لا تولّد زوجاً جديداً دون خطة إعادة اشتراك الأجهزة. راجع WEB_PUSH_SUBJECT وn8n URLs عند إذن التفعيل.
Vault: أبقِ order_push_webhook_secret كما هو. قيمة order_push_webhook_url عند **التفعيل فقط**:
`https://kzevmysfydaslxcerogt.supabase.co/functions/v1/send-order-push`.
لا ترفع حجز التريغر D أو مهام cron الأربع في هذه المرحلة.

## 5. أوامر Edge محضّرة فقط

**لا تُشغّل قبل كلمة «انشر» وCI كامل أخضر على نفس SHA.** لا تضبط GEMINI_API_KEY.

```powershell
npx supabase functions deploy submit-guest-order --project-ref kzevmysfydaslxcerogt --no-verify-jwt
npx supabase functions deploy manage-staff-users --project-ref kzevmysfydaslxcerogt
npx supabase functions deploy admin-ai-assistant --project-ref kzevmysfydaslxcerogt
npx supabase functions deploy n8n-alert-feed --project-ref kzevmysfydaslxcerogt --no-verify-jwt
npx supabase functions deploy send-order-push --project-ref kzevmysfydaslxcerogt --no-verify-jwt
```

الخيارات تطابق verify_jwt الحالي في config. المرجع صريح؛ لا supabase link في جذر المستودع.
بعد النشر راجع Logs بلا أسرار أو رموز، واختبر CORS وJWT والأدوار. نجاح deploy ليس نجاحاً وظيفياً.

## 6. اجعل Cloudflare Preview غير عام أولاً

Workers & Pages → nawasrah-admin ثم nawasrah-store → Settings → General → Enable access policy / Access.
سياسة Allow لبريد المالك والمراجعين المحددين فقط؛ لا Everyone أو Bypass.
اختبر في incognito قبل رفع build: الزائر غير المخوّل يصل إلى Access challenge أو رفض، لا HTML التطبيق.
احمِ branch alias وروابط hash القديمة أيضاً. noindex ليست حماية.
حماية HTML لا تجعل REST العام لكتالوج الضيوف خاصاً؛ لا تضع بيانات تشغيل حقيقية في التجربة.

Settings → Variables and Secrets → **Preview فقط**، دون تغيير Production القديم:

| المتغير | القيمة المطلوبة |
|---|---|
| VITE_SUPABASE_URL للواجهتين | https://kzevmysfydaslxcerogt.supabase.co |
| VITE_SUPABASE_PUBLISHABLE_KEY للواجهتين | المفتاح العام من Settings → API Keys لفرانكفورت، لا service_role |
| VITE_STOREFRONT_PUBLIC_URL للإدارة | https://staging-frankfurt.nawasrah-store.pages.dev |
| VITE_PUBLIC_SITE_ORIGIN للمتجر | نفس رابط المتجر المحمي أعلاه؛ النهائي عند التحويل فقط |
| VITE_TURNSTILE_SITE_KEY للمتجر | site key العام لويدجت المتجر |
| VITE_STORE_WHATSAPP_NUMBER | رقم المحل المعتمد، لا رقم مخمّن |
| VITE_SENTRY_DSN | اختياري؛ فارغ إن لم يُعتمد |

لا VITE_BROWSER_QA_ISOLATED أو SEO_AUDIT_* في staging حقيقي.
احذف VITE_SUPABASE_ANON_KEY إن كان بديلاً متعارضاً. مفتاح Turnstile للإدارة من config المصدر، لا VITE جديداً.
Cloudflare build env لا ينتقل إلى terminal المحلي؛ أدخل المتغيرات العامة المطابقة في جلسة البناء المحلية عند الإذن.

## 7. بوابتان تمنعان نشر الواجهتين الآن

1. في public/_headers وcustomer-web/public/_headers استبدل داخل connect-src HTTP وWSS للمرجع القديم بـ:
   `https://kzevmysfydaslxcerogt.supabase.co` و`wss://kzevmysfydaslxcerogt.supabase.co`.
   تبقى بقية CSP والترويسات حرفياً؛ لا wildcard. هذا commit تحويل معتمد لاحقاً؛ لم يتغير الملفان هنا.
2. customer-web/scripts/generate-seo-pages.mjs يقرأ config المصدر، لا VITE_SUPABASE_URL.
   لذلك VITE وحدها قد توجّه runtime للجديد وSEO للقديم. حدّث إعداد المصدر العام في checkout النشر المعتمد أو أصلح المولّد بتفويض منفصل، وأثبت أن SEO يقرأ فرانكفورت.
   **النشر محجوب حتى إغلاق ذلك؛ لا نتخطى SEO ولا نستخدم audit loopback بديلاً.**

بعد كلمة «انشر» وإغلاق البوابتين، هذه أوامر preview فقط من جذر المستودع:

```powershell
npm run build
npx wrangler pages deploy dist --project-name=nawasrah-admin --branch=staging-frankfurt
Push-Location customer-web
npm run build
npx wrangler pages deploy dist --project-name=nawasrah-store --branch=staging-frankfurt
Pop-Location
```

نفّذ كل أمر بعد نجاح السابق فقط. المتجر يرفع customer-web/dist، لا dist الإدارة.
لا deploy:admin أو deploy:cloudflare الحاليين ولا --branch=main؛ كلها مسارات نشر الإنتاج.

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
حالة اللوحات الفعلية تحتاج تحقق المالك؛ هذا الدليل لا يدّعي أنها ضُبطت.

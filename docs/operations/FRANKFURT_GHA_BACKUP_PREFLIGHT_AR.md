# النسخ الليلي على GitHub Actions — فحص تمهيدي وقرار مطلوب

الأساس `9070eb9a9e702a0efa5e60c180d760bddf911a9f` بعد دمج PR46 على
`15201a81727260c5c644e5ca4b1a8f532dc0da5d` مع FULL53 للدفع وPR.
المجلد الرئيسي مطابق مع حفظ19 ملفاً محلياً وإضافات project-state؛مرجع217
الجديد مقبول وPlan/dry-run محليان ناجحان. لا اتصال بفرانكفورت أو سنغافورة أوR2.

## نتيجة الصلاحيات المثبتة محلياً

بُنيت قاعدة Supabase اصطناعية نظيفة حتى217/179،واستُخدم الدور الموجود
`pg_read_all_data` عبر SET ROLE في الاختبار فقط. لم يُنشأ دور ولم تتغير منحة.

| الفحص | النتيجة |
|---|---|
| SELECT على public.products وauth.users وstorage.objects وschema_migrations | منحة SELECT متاحة |
| BYPASSRLS | false |
| قراءة products كاملة مع row_security=off كما يتطلب dump | مرفوضة بسببRLS |
| pg_dump الكامل تحت الدور القرائي | مرفوض بسببRLS؛لا نسخة ناقصة ناجحة |
| pg_dumpall --roles-only --no-role-passwords | ناجح؛لا حاجة لقراءة كلمات مرور الأدوار |
| USAGE على cron وEXECUTE على cron.schedule | متاحان في بيئة الاختبار؛ليس دوراً معزولاً عن كل مسارات الكتابة |

الدليل خارج Git: `C:\Users\TOP\NawasrahFrankfurt\frankfurt-nightly-actions-local\roles-feasibility.json`.
لم تُشغّل دالة cron أوnet أثناء الفحص. حُذفت حاوية الاختبار بعده.
هذه نتيجة محلية،ولا تثبت أن منح الدور على فرانكفورت مماثلة.

الكود الحالي في `scripts/backup/backup-public-config.mjs` يقبل postgres
أوpostgres.PROJECT_REF فقط. و`nativeSource` في complete-backup.mjs يستخدم
ذلك الحارس،ولقطة read-only وpg_dump الكامل وroles-only بلا كلمات مرور.
لا يُوسع الحارس لقبول اسم دور حر أو مرجع حر.

## لماذا يلزم قرار قبل التنفيذ

إنشاء LOGIN مستقل ومنح SELECT محددة وBYPASSRLS إعداد DB جديد. لا يوجد دور
نسخ مستقل جاهز مثبت في العقد الحالي. وdefault_transaction_read_only إعداد
اتصال،وليس عزلاً لصلاحيات الحساب إذا سُرقت كلمته:يمكن لصاحب الاتصال محاولة
إعادة ضبطه. كما أن EXECUTE الموروث من PUBLIC قد يتيح كتابة غير مباشرة.

لا نمنح pg_read_all_data عميانياً:توثق Supabase وصوله إلىcron/Vault،ومع
BYPASSRLS يتسع نطاقه. النسخة الحالية كاملة،فلا يجوز حذف auth أوstorage أو
أجزاء dump أو تخفيف مقارنة الاسترجاع للحصول على نجاح ظاهري.

الخيار المفضّل للدراسة:دور نسخ مستقل بحد أدنى من القراءات المثبتة،دون ملكية
أو عضوية postgres/service_role أو CREATEROLE/CREATEDB/REPLICATION،مع فحوص
سلبية للكتابة المباشرة وPUBLIC/SECURITY DEFINER وcron/net/Vault. قبل اقتراح
SQL مالك يجب أن ينجح إنشاء الأرشيف الحالي واسترجاعه الصارم،وأن تُوثق أي
منحة أو تقييد إضافي لازم. لا وعد بصلاحية دور كهذا على Supabase دون إثبات.

البديل هو كلمة postgres في GitHub Secrets:هي credential إدارية قادرة على
تعديل البيانات والبنية والمنح؛TLS والتشفير وread-only داخل السكربت لا يزيلان
خطر تسريبها أو تغيير workflow. **هذا البديل غير معتمد ولن يُستخدم دون قرار صريح.**

## خصوصية المستودع:الفرضية لم تتحقق

قراءة GitHub API بتاريخ2026-10-29T23:53:53Z أرجعت
`OBITO20011/mahdi-admin`: `private:false`،`visibility:public`،والفرع main.
لم تُغيّر الخصوصية. يلزم أن يحدد المالك هل سيحوّله إلىخاص بنفسه أو يعتمد
بقاءه عاماً مع حراسة مسار الأسرار. لا تحفظ قاعدة أو أرشيفاً خاماً في Git
أو artifacts مهما كانت الخصوصية.

المستودع العام يستفيد من حصة runners القياسية المجانية،لكن توثق GitHub
تعطيل الجدولة بعد60 يوماً من غياب نشاط المستودع العام. هذا مختلف عن فرضية
المستودع الخاص؛ولا يجوز الادعاء أن خطر الخمول غير موجود في الحالة الحالية.

## التصميم المقترح بعد القرار — غير منفذ وغير مفعّل

- موعد يومي مقترح `23 21 * * *`،أي00:23 Asia/Amman حالياً،مع workflow_dispatch.
- نفس createCompleteBackup والتشفيرAES-256-GCM والأرشيفv2 والتحقق وTLS verify-full.
- اسم فريد يتضمن gha وrun_id/run_attempt/nonce؛daily وmonthly تحت البادئة المعتمدة
  `erp/frankfurt-kzevmysfydaslxcerogt/`. الاحتفاظ90/365 والقفلerp/30 لا يتغيران.
- تحقق وتنزيل/فك تشفير/manifest واسترجاع Docker صارم أسبوعياً؛لا استثناء مقارنة.
- فحص مستقل لعمر أحدث **نسخة مكتملة التحقق والرفع**،بحد26ساعة. وجود ملف محلي
  أو انتهاء job بخروج0 دون رفع لا يكفي. الجدولة ليست ضماناً؛إذا عُطّل Actions
  كله فلن يعمل منبّه داخله،ويجب إظهار هذا الحد للمالك.
- channel المطوّر الحالي وحده،وwatchlist في developer-alerts.yml. لا تنبيه لصاحب المحل.
- لا تعديل أو حذف أو إعادة تسجيل لمهام Windows الخمس.

## R2 وأقل صلاحية

توثق Cloudflare مفاتيح طويلة العمر Read & Write أوRead،بحدbucket،ولا توفر
خيارWrite-only/prefix-only في نموذج المفتاح المعتاد. الاعتمادات المؤقتة تدعم
prefix/object بمدة محدودة،لكن وضع مفتاح الأب في runner لا يزيل صلاحياته الأوسع.
سنفصل كاتب النسخ وقارئ التحقق متى أمكن،ولا ندّعي تقييد prefix حقيقياً بواسطة
حارس برمجي وحده. لا مفتاحAdmin لتعديل سياسة R2،ولا تغيير لقواعدها.

## تقدير أولي للدقائق — افتراض لا قياس فعلي

30 نسخة ×8–12 دقيقة =240–360دقيقة؛4 استرجاعات ×15–25 =60–100؛
وفحص26ساعة يومي مستقل ×1–2 =30–60:المجموع330–520دقيقة شهرياً،قبلCI
والتشغيل اليدوي والإعادات. افتراض الوقت يحتاج قياساً على runner بعد الاعتماد.
حسب تسعير GitHub الحالي Linux القياسي0.006دولار/دقيقة:1.98–3.12دولار،
مقابل12دولار compute فيFree،أي ما يعادل2000دقيقة Linux عند هذا السعر.
الخطة والرصيد الفعليان للحساب لم يُقرآ؛الحصة مشتركة مع بقيةCI. المستودع
الحالي عام،فتنطبق عليه مجانيةrunners القياسية بدلاً من هذا افتراض الخاص.

## الملفات المتوقعة لاحقاً

workflow نسخ وworkflow فوات،adapter تشغيل محدود ضمن scripts/backup أوoperations،
اختبارات localDB/R2 وactionlint،وتحديث RUNBOOK وGO_LIVE وورقة التشغيل.
مسار الأسرار ونوع حساب DB يُحسمان قبل هذه الكتابة؛لا migration أضيفت.

## المصادر الرسمية

- [PostgreSQL17:الدور القرائي لا يتجاوزRLS](https://www.postgresql.org/docs/17/predefined-roles.html).
- [PostgreSQL17:roles-only دون كلمات مرور يقرأpg_roles](https://www.postgresql.org/docs/17/app-pg-dumpall.html).
- [Supabase:مخاطر أدوار النسخ وcron/Vault](https://supabase.com/kb/troubleshooting/revoking-privileges-on-storage-pg_cron-vault-and-extension-objects-has-no-effect).
- [GitHub:الجدولة والخمول](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
- [GitHub:الأسعار والحصة](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
- [Cloudflare:صلاحياتR2](https://developers.cloudflare.com/r2/api/tokens/)،[الاعتمادات المؤقتة المحدودة](https://developers.cloudflare.com/api/resources/r2/subresources/temporary_credentials/methods/create/).

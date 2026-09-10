# حالة Nawasrah ERP وخطة الإطلاق

هذه الوثيقة تعرض الحالة الحالية والمتبقي الحقيقي فقط. التاريخ التقني التفصيلي
موجود في migrations وGit، وليس في قائمة TODO قديمة.

## Live & Verified

- Admin وCustomer Store على Cloudflare Pages.
- Supabase migrations `001–102` متطابقة محليًا وعلى Production.
- الطلبات، POS، المخزون، الاستلام، المشتريات، WAC، الذمم، المدفوعات، المصاريف،
  الورديات، المرتجعات والعكس والتقارير تعمل من PostgreSQL/RPCs المحمية.
- Server-side pagination للشاشات التشغيلية الثقيلة والكتالوج العام.
- Guest checkout عبر Turnstile Gateway وrate limits وHMAC وidempotency.
- انتهاء حجز website/new بعد خمس ساعات وتنظيف rate-limit عبر bounded cron.
- Shift Archive وimmutable closing snapshots للورديات الجديدة.
- Developer Alerts منفصلة عن Business delivery، مع CI/Uptime/Cloudflare/n8n/
  backup/cron/integrity/security checks.
- Business Telegram والتنبيهات والملخصات اليومية والأسبوعية عبر outbox hardened.
- Business Integrity وDB/RPC monitoring وHealth Dashboard للمالك/AAL2.
- ERP وn8n encrypted backups، وERP isolated Restore Drill.
- Privacy Policy وتقليل PII في Web Push وBusiness automation وbrowser storage.

## Remaining Before Final Launch

### قرارات Business/Legal

- اعتماد الاسم والعنوان القانونيين لمسؤول معالجة البيانات ووسيلة اتصال الخصوصية.
- اعتماد legal basis/consent wording ومدد الاحتفاظ وإجراءات طلبات الوصول أو
  التصحيح أو التقييد أو الحذف.
- اعتماد مصفوفة الأدوار التي تحتاج قراءة بيانات اتصال العميل كاملة.

### إطلاق الواجهة العامة

- تم ربط `alnawasreh.com` و`www.alnawasreh.com` و`admin.alnawasreh.com`، وتعمل
  جميعها على Production عبر HTTPS.
- اكتمل SEO Part 2: canonical origin و`robots.txt` و`sitemap.xml` تعمل من
  الدومين الرسمي، وDNS يحتوي Google site-verification token.
- نجح Final Production/Website Smoke بتاريخ 2026-09-11 على Chromium وMobile
  WebKit للصفحات الرئيسية والمنتجات والعروض وعن المتجر وصفحات القسم والمنتج.
- المتبقي الإداري فقط هو تأكيد ملكية Search Console من حساب صاحب العمل والتأكد
  من إرسال `sitemap.xml` داخله.

### Business recipient cutover

- Business Telegram يستخدم حاليًا المستلم المؤقت المحمي في الإعداد المحلي.
- عند التسليم النهائي يُستبدل بمستلم صاحب المحل الحقيقي ويُختبر failure/recovery
  دون تغيير Developer Telegram. لا تُحفظ Chat IDs أو tokens في Git أو الوثائق.

### Operational recovery — مكتمل 2026-09-11

- `Nawasrah Docker Safe Startup` أعادت `0`، وDocker وn8n و`/healthz` سليمة.
- `Nawasrah ERP Nightly Backup` اشتغلت فعليًا تحت `SYSTEM` وأعادت `0`، والأرشيف
  الجديد اجتاز فحص التشفير والـchecksums.
- أُعيد تسجيل `Nawasrah n8n Daily Backup` تحت `SYSTEM`، وشُغلت فعليًا وأعادت
  `0` مع `restoreVerified=true`.
- رُفعت أحدث نسختي ERP وn8n إلى R2، ونجح download/verify والـRestore Drill
  المعزول لكليهما دون لمس Production.
- أُعيد تسجيل Developer Watchdog، ونفذ دورة تلقائية تحت `SYSTEM`؛ الحالة الحالية
  لا تحتوي active incidents.
- GitHub Code Quality وSecret Scanning وDeveloper Alerts للـcommit الحالي خضراء.

## Deferred وغير مانع حاليًا

- WhatsApp Business Cloud يبقى غير مفعّل إلى أن يعتمد صاحب العمل المزود والقالب.
- حدود Business غير المعتمدة (قرب انتهاء الطلب، وقت إغلاق الوردية، حد المصروف)
  تبقى `NULL` ومقفلة حتى يصدر قرار Business.
- تحذيرا DB lint المعروفان: `v_product_id` في receiving و`p_transfer_date` في
  warehouse transfer؛ لا يتغيران ضمن Documentation cleanup.
- GPS حي للمندوب وForecasts وAI Business analysis ليست مطلوبة للإطلاق الحالي.

راجع [docs/HANDOFF.md](./docs/HANDOFF.md) للأوامر وخطوات التشغيل الآمنة.

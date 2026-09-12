# حالة Nawasrah ERP وخطة الإطلاق

هذه الوثيقة تعرض الحالة الحالية والمتبقي الحقيقي فقط. التاريخ التقني التفصيلي
موجود في migrations وGit، وليس في قائمة TODO قديمة.

## Live & Verified

- Admin وCustomer Store على Cloudflare Pages.
- Supabase migrations `001–108` متطابقة محليًا وعلى Production.
- الطلبات، POS، المخزون، الاستلام، المشتريات، WAC، الذمم، المدفوعات، المصاريف،
  الورديات، المرتجعات والعكس والتقارير تعمل من PostgreSQL/RPCs المحمية.
- Server-side pagination للشاشات التشغيلية الثقيلة والكتالوج العام.
- Guest checkout عبر Turnstile Gateway وrate limits وHMAC وidempotency.
- انتهاء حجز website/new بعد خمس ساعات وتنظيف rate-limit عبر bounded cron.
- Shift Archive وimmutable closing snapshots للورديات الجديدة.
- Developer Alerts منفصلة عن Business delivery، مع CI/Uptime/Cloudflare/n8n/
  backup/cron/integrity/security checks.
- Business Telegram والتنبيهات والملخصات اليومية والأسبوعية عبر outbox hardened.
- Business Integrity وDB/RPC monitoring وHealth Dashboard للمالك فقط، مع تطبيق
  سياسة MFA المركزية التي تتطلب AAL2 بعد تسجيل عامل MFA موثّق.
- ERP وn8n encrypted backups، وERP isolated Restore Drill.
- Privacy Policy وتقليل PII في Web Push وBusiness automation وbrowser storage.
- Monitoring Phases 1–5 وR2 Off-site Backup وCloudflare Insights cleanup مكتملة.
- Guided Store Assistant وAdmin Light Mode Visual Comfort مكتملان ومتحققان على
  Production.
- `PWA-01 = RESOLVED`: إصدار Admin Service Worker مرتبط بالـGit commit SHA لكل
  release بدل `0.0.0`، مع تنظيف cache الإصدار السابق واختبار انتقال A→B على
  Chromium وMobile WebKit.
- Admin Session Security تطبق قفل خمول بعد 15 دقيقة وحدًا أقصى للجلسة بعد 12
  ساعة من تسجيل الدخول الكامل. القفل يزيل Admin shell الحساس من DOM ويوقف
  subscriptions التابعة للشاشات عبر unmount، ثم يعيد mount/refetch عند الفتح.
  timestamps معزولة بحسب المستخدم ومتزامنة بين tabs، وعودة Safari من الخلفية
  تعيد التقييم فورًا. حد 12 ساعة `CLIENT-ENFORCED` ولا يُعاد ضبطه بفك القفل أو
  token refresh. Logout يستدعي Supabase للجلسة الحالية فقط.
- `A11Y-01 = RESOLVED`: صفحة Customer `/about/` والـHeader والتنقل والمحتوى
  الرئيسي والفوتر وStore Info اجتازت Axe على Chromium وMobile WebKit. رُفع
  تباين نص رسوم التوصيل إلى WCAG AA، وأصبحت landmarks وأسماء التنقل مميزة.
- SKU إلزامي ومطبّع إلى uppercase/trimmed وفريد دون حساسية لحالة الأحرف،
  والباركود اختياري لكنه trimmed وفريد عند وجوده. Flavor Child يخضع لنفس
  القواعد، وFlavor Master للتجميع فقط بلا باركود بيع. الحماية في DB والواجهة،
  والـPOS يرفض التطابق الغامض أو غير القابل للبيع.
  `SKU & BARCODE INTEGRITY = VERIFIED`.

## Remaining Before Final Launch

### Technical blockers

لا توجد blockers تقنية معروفة حاليًا. Custom Domain وSEO Part 2 والإعداد التقني
لـGoogle Search Console وR2 Off-site Backup وMonitoring Phases 1–5 والتنفيذ
التقني للخصوصية وGuided Store Assistant وAdmin Light Mode Visual Comfort و
Cloudflare Insights cleanup وPWA-01 كلها مكتملة، وليست بنودًا معلقة.
كما أن A11Y-01 مكتملة وليست blocker للإطلاق.

### Manual / Business decisions

- اعتماد الاسم والعنوان القانونيين لمسؤول معالجة البيانات ووسيلة اتصال الخصوصية.
- اعتماد legal basis/consent wording ومدد الاحتفاظ وإجراءات طلبات الوصول أو
  التصحيح أو التقييد أو الحذف.
- اعتماد مصفوفة الأدوار التي تحتاج قراءة بيانات اتصال العميل كاملة.

- تم ربط `alnawasreh.com` و`www.alnawasreh.com` و`admin.alnawasreh.com`، وتعمل
  جميعها على Production عبر HTTPS.
- اكتمل SEO Part 2: canonical origin و`robots.txt` و`sitemap.xml` تعمل من
  الدومين الرسمي، وDNS يحتوي Google site-verification token.
- نجح Final Production/Website Smoke بتاريخ 2026-09-11 على Chromium وMobile
  WebKit للصفحات الرئيسية والمنتجات والعروض وعن المتجر وصفحات القسم والمنتج.
- المتبقي الإداري فقط هو تأكيد ملكية Search Console من حساب صاحب العمل والتأكد
  من إرسال `sitemap.xml` داخله.

- Business Telegram يستخدم حاليًا المستلم المؤقت المحمي في الإعداد المحلي.
- عند التسليم النهائي يُستبدل بمستلم صاحب المحل الحقيقي ويُختبر failure/recovery
  دون تغيير Developer Telegram. لا تُحفظ Chat IDs أو tokens في Git أو الوثائق.

### Operational recovery — `OPERATIONAL RECOVERY = VERIFIED`

- `Nawasrah Docker Safe Startup` أعادت `0`، وDocker وn8n و`/healthz` سليمة.
- `Nawasrah ERP Nightly Backup` اشتغلت فعليًا تحت `SYSTEM` وأعادت `0`، والأرشيف
  الجديد اجتاز فحص التشفير والـchecksums.
- أُعيد تسجيل `Nawasrah n8n Daily Backup` تحت `SYSTEM`، وشُغلت فعليًا وأعادت
  `0` مع `restoreVerified=true`.
- رُفعت أحدث نسختي ERP وn8n إلى R2، ونجح download/verify والـRestore Drill
  المعزول لكليهما دون لمس Production.
- أُعيد تسجيل Developer Watchdog، ونفذ دورة تلقائية تحت `SYSTEM`؛ الحالة الحالية
  لا تحتوي active incidents.
- GitHub Code Quality وSecret Scanning وDeveloper Alerts اجتازت baseline
  التشغيلي الموثق، وتُعاد بوابات CI لكل commit جديد.

### Optional future enhancements

- WhatsApp Business Cloud يبقى غير مفعّل إلى أن يعتمد صاحب العمل المزود والقالب.
- GPS حي للمندوب وForecasts وAI Business analysis ليست مطلوبة للإطلاق الحالي.
- Passkey server-side كامل يبقى
  `DEFERRED — REQUIRES SEPARATE WEBAUTHN IMPLEMENTATION`. دعم Face ID الحالي هو
  local device unlock عبر WebAuthn ولا يُقدّم نفسه كمصادقة Supabase Passkey.
- Step-up Auth منفصل لاحقًا لتغيير الأدوار/الصلاحيات، وإعدادات الأمن وMFA،
  واعتمادات التكاملات الحرجة. لم يتغير سلوك هذه العمليات في هذه المرحلة.

## DB lint والحالة النهائية لقواعد Business Alerts

- أُزيل المتغير المحلي غير المستخدم `v_product_id` من
  `_receive_purchase_order_impl` عبر migration
  `104_remove_unused_receive_purchase_order_product_id.sql` مع الحفاظ على تحقق
  UUID وسلوك الاستلام. `V_PRODUCT_ID DB LINT CLEANUP = VERIFIED`.
- يبقى `p_transfer_date` intentional unused parameter في
  `transfer_inventory_between_warehouses` لأجل legacy/backward compatibility.
  لا يُحذف من signature، ولا يُعد Bug مفتوحًا أو Production blocker.
- migration `105_harden_business_alert_rules_and_thresholds.sql` اعتمدت:
  Delayed Order بعد ساعتين، وCash Difference لأي فرق غير صفري، والمصروف اليومي
  حسب يوم `Asia/Amman` دون حد مالي، وحد الوردية
  `min(opened_at + 15h, next local midnight)` كتنبيه فقط بلا إغلاق تلقائي.
  `BUSINESS ALERT RULES & THRESHOLDS = VERIFIED`.
- migration `106_align_monitoring_owner_mfa_policy.sql` أبقت Health Dashboard
  للمالك فقط، وربطت AAL2 بسياسة MFA المركزية بدل اشتراطه قبل تسجيل عامل MFA.
  `MONITORING / HEALTH DASHBOARD = VERIFIED`.
- أُغلق `TEST-01` بتصحيح stale reversal test fixture فقط: الـFlavor Master أصبح
  grouping-only بلا stock، والبيع والحركات والعكس تستهدف Flavor Child حقيقيًا.
  لم يظهر أي Production accounting defect. `TEST-01 REVERSAL COVERAGE = VERIFIED`.
- migration `107_canonical_schema_reconciliation.sql` وحّدت Fresh replay مع
  Production: أعادت تعريف `_receive_inventory_impl` بالعقد الموسع، أضافت قفلًا
  حتميًا وآمنًا لأول إنشاء لرصيد المخزون، أعادت triggers الخاصة بـ`updated_at`،
  وحذفت كائنات legacy الفارغة فقط عبر بوابة count و`RESTRICT`. بقي
  `rls_auto_enable` ككائن منصة خارج canonical application schema. تطابقت نسخة
  Fresh 001–107 مع Production بعد استثناء كائنات/صلاحيات المنصة المثبتة.
  `MIGRATION 107 CANONICAL SCHEMA RECONCILIATION = VERIFIED`.
- مسار البناء الرسمي هو `HYBRID SANCTIONED BOOTSTRAP`: نسخة مؤقتة من migrations
  مع compatibility patch محصور على migration 034، ثم تطبيق 001–108 والتحقق
  canonical. لا تُعدّل migration 034 التاريخية. `DB-01 DATABASE REBUILD PATH = VERIFIED`.
- migration `108_harden_product_sku_barcode_integrity.sql` أضافت normalized
  unique indexes وcanonical checks وrace-safe cross-field collision guard دون
  تعديل بيانات المنتجات القائمة. زر «توليد» هو مولّد SKU وليس Barcode؛ أصبح
  bounded ويتحقق من identifiers المحملة، مع بقاء DB خط الحماية النهائي.
  `SKU & BARCODE INTEGRITY = VERIFIED`.

راجع [docs/HANDOFF.md](./docs/HANDOFF.md) للأوامر وخطوات التشغيل الآمنة.

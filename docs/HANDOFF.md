# Nawasrah ERP — Developer Handoff

هذه نقطة البداية العملية لأي مطور أو مشغّل جديد. لا تحتوي أسرارًا أو Chat IDs،
ولا تستبدل فحص Production الحي أو ملفات migrations.

## 1. ماذا يفعل المشروع

Nawasrah ERP نظام جملة عربي RTL:

- Admin للطلبات وPOS والمخزون والتوريد والموردين والعملاء والذمم والمصاريف
  والورديات والمرتجعات والتقارير والمراقبة.
- Customer Store عام للكتالوج والسلة وCheckout والتتبع والإيصال.
- Supabase/PostgreSQL مصدر الحقيقة وCloudflare Pages للاستضافة.
- n8n محلي لتسليم Business Alerts فقط.
- Windows Developer Watchdog وGitHub Actions للمراقبة التقنية المستقلة.

راجع [ARCHITECTURE.md](../ARCHITECTURE.md) و[DATABASE_DESIGN.md](../DATABASE_DESIGN.md).

## 2. Production baseline

لقطة الحالة الحالية: 2026-09-14 بعد migration 111 وإغلاق إثبات R2 قبل التدريب.

| Component | Verified state |
| --- | --- |
| Git | `main`؛ تحقّق دائمًا من التطابق الحالي عبر `git rev-parse HEAD` و`git rev-parse origin/main` |
| Supabase | migrations المحلية والبعيدة `001–111` |
| Admin | Runtime SHA `95377d98b6f789cce05cbd14ecf6abc77e19284a`؛ Cloudflare Deployment `75e00664-f783-41b7-b2ea-424e900e85bf`؛ Light Mode و`PWA-01` متحققان |
| Customer Store | Deployment `b127d695-b262-4afa-9ea7-ba48997ba2a9` بقي دون تغيير؛ Custom Domain وSEO Part 2 وGuided Store Assistant مكتملة |
| Guest push | `send-order-push` Edge Function version 12 |
| n8n | container `nawasrah-n8n` running/healthy و`/healthz` = 200 وقت الفحص |
| GitHub | Code Quality وSecret Scanning وDeveloper Alerts تعمل على `main` |
| Privacy | التنفيذ التقني للخصوصية وCustomer Privacy Policy منشوران؛ المدخلات القانونية Business decision منفصلة |

الـdocs-only commit اللاحق لا يحتاج deploy. قارن كل deployment بآخر commit غيّر
ذلك التطبيق، وليس دائمًا بأحدث commit وثائقي على `main`.

## 3. Architecture مختصرة

```text
Admin / Customer Store
        |
Supabase Auth + RLS + RPCs + Edge Functions
        |
PostgreSQL transactions / audit / movements / outbox / cron
        |
Business outbox -> n8n -> temporary Business Telegram recipient

Developer Watchdog + GitHub Actions -> separate developer Telegram
Sanitized monitoring -> owner-only Admin Health Dashboard + central MFA policy
```

- n8n لا يملك PostgreSQL credentials ولا `service_role`.
- Developer وBusiness credentials/recipients منفصلان تقنيًا.
- Business recipient الحالي مؤقت؛ cutover لصاحب المحل الحقيقي ما زال مطلوبًا.
- Monitoring للقراءة/التجميع ولا يصلح Business data تلقائيًا.

## 4. التشغيل المحلي والتحقق

```powershell
npm.cmd install
npm.cmd --prefix customer-web install
npm.cmd run lint
npm.cmd test
npm.cmd --prefix customer-web run lint
npm.cmd --prefix customer-web test
npm.cmd run build
npm.cmd --prefix customer-web run build
npm.cmd run test:e2e
```

بوابة كاملة: `npm.cmd run quality`. استخدم `npm.cmd` على Windows إذا منعت
Execution Policy ملف `npm.ps1`.

## 5. الأسرار والإعدادات

لا تنسخ القيم إلى Git أو docs أو tickets أو logs.

- Frontend: Publishable Supabase config فقط؛ لا `service_role`.
- Supabase: Edge Function secrets في Supabase secrets store.
- n8n: credentials مشفرة داخل n8n؛ feed/channel config في ملفات ignored تحت
  `automation/n8n` مثل `.env.feed` و`.env.channels`.
- Developer Monitoring: machine-protected config تحت
  `C:\ProgramData\NawasrahDeveloperMonitoring` باستخدام DPAPI/ACL.
- ERP Backup: current-user وmachine-scope DPAPI config تحت
  `%LOCALAPPDATA%\NawasrahBackup`.
- GitHub: Developer Telegram values repository secrets، وenable flag repository
  variable؛ لا تُطبع القيم للتحقق.

## 6. Migrations

```powershell
git status --short
npx supabase migration list
npm.cmd run backup:run
npm.cmd run backup:verify
npm.cmd run backup:restore-test
npm.cmd run test:db:isolated
```

بعد نجاح CI والنسخة والاستعادة المعزولة فقط، طبّق الملف الجديد المتسلسل بأداة
Supabase، ثم أعد `migration list` وDB lint واختبارات العقد. لا تعدّل migrations
قديمة، ولا تستخدم SQL Editor لتجاوز history، ولا تعمل rollback عشوائيًا.

آخر migrations الحالية:

- `103_flavor_receiving_hardening.sql`
- `104_remove_unused_receive_purchase_order_product_id.sql`
- `105_harden_business_alert_rules_and_thresholds.sql`
- `106_align_monitoring_owner_mfa_policy.sql`
- `107_canonical_schema_reconciliation.sql`
- `108_harden_product_sku_barcode_integrity.sql`
- `109_admin_large_catalog_read_models.sql`
- `110_fix_deferred_cash_shift_snapshot_guard_privileges.sql`
- `111_harden_pos_sale_idempotency_replays.sql`

### DB-01: مسار Fresh الرسمي

المسار المعتمد هو `HYBRID SANCTIONED BOOTSTRAP`:

1. ينشئ `npm.cmd run test:db:isolated` نسخة مؤقتة منفصلة من مجلد Supabase.
2. يطبّق compatibility patch المعروف على النسخة المؤقتة من migration 034 فقط؛
   لا يغيّر الملف التاريخي في المستودع.
3. يعيد تشغيل migrations `001–111` ثم اختبارات canonical schema/runtime.

سبب المسار الهجين هو أن ledger التاريخي كان متطابقًا، لكن إعادة التشغيل من صفر
كانت تعيد كائنات legacy وتكشف اختلافات في دالة الاستلام وtriggers. لا يمكن إثبات
الآلية التاريخية الدقيقة لكل فرق من Git وحده، لذلك أصلحت migration 107 الحالة
النهائية بشكل idempotent وآمن بدل إعادة كتابة التاريخ.

- `_receive_inventory_impl` يحتفظ بالاستجابة الموسعة وaudit reference والتحقق
  والحجوزات والحركات والـrollback، ولا يحسب WAC. أضيف advisory lock حتمي قبل
  إنشاء أول `inventory_balances` لمنع race دون تغيير wrapper أو callers.
- أُعيدت triggers الخمسة لـ`updated_at`، وعُززت
  `update_updated_at_column` مع `search_path = public` وصلاحياتها الخاصة.
- تُحذف جداول/دالة legacy فقط بعد lock وcount صفري، وبـ`RESTRICT` دون `CASCADE`.
- `rls_auto_enable` كائن منصة مستثنى عمدًا ولا تعدله migration 107.

`MIGRATION 107 CANONICAL SCHEMA RECONCILIATION = VERIFIED`.
`DB-01 DATABASE REBUILD PATH = VERIFIED`.

### Fresh Build مقابل Backup Restore

- **Fresh Build**: لإثبات أن schema والعقود قابلة لإعادة البناء من migrations في
  قاعدة مؤقتة فارغة؛ لا يحتوي بيانات Production ولا يستبدل خطة التعافي.
- **Backup Restore**: لاستعادة بيانات وأدوار وStorage من أرشيف Production المشفّر
  والمتحقق داخل بيئة معزولة. هذا هو مسار disaster recovery، ولا يُستخدم Fresh
  Build بدلًا منه.
- يمكن لاحقًا إنشاء clean baseline اختياري لتبسيط bootstrap، لكنه ليس blocker
  ولا يبرر تعديل migrations `001–111`.

### SKU وBarcode integrity

- SKU إلزامي لكل Product، ويُخزن uppercase/trimmed وتُفرض فرادته بعد التطبيع.
- Barcode اختياري؛ القيمة الفارغة تصبح `NULL`، وعند وجوده يكون trimmed وفريدًا
  دون حساسية لحالة الأحرف.
- لا يجوز أن يصطدم SKU بباركود منتج آخر؛ trigger محمي مع advisory locks يغلق
  السباق، وتبقى normalized unique indexes خط حماية مستقل.
- Flavor Master grouping-only بلا باركود بيع. كل Flavor Child يملك SKU مستقلًا
  ويخضع لنفس قواعد Barcode/SKU لكل المنتجات.
- Admin ينفذ validation مسبقًا ويحوّل duplicate errors إلى رسائل عربية بلا raw
  PostgreSQL details. زر «توليد» يولّد SKU bounded، وليس Barcode.
- POS يطابق Barcode/SKU/ID إلى نتيجة واحدة، ويرفض ambiguous أو hidden/
  non-sellable وFlavor Master. المسح يضيف للسلة محليًا فقط ولا ينشئ بيعًا أو
  حركة مخزون.

اختبار DB المعزول:

```powershell
npm.cmd run test:product-identifiers:runtime
```

`SKU & BARCODE INTEGRITY = VERIFIED`.

### إغلاقات الاعتمادية الحالية

- migration `109_admin_large_catalog_read_models.sql` نقلت قراءات الكتالوج
  والمخزون الثقيلة إلى server-side pagination/search محدودة دون تغيير مسارات
  الكتابة.
- migration `110_fix_deferred_cash_shift_snapshot_guard_privileges.sql` ثبّتت
  صلاحيات deferred closing-snapshot guard؛ الدالة داخلية، owner موثوق،
  `search_path = public, pg_temp`، والتنفيذ المباشر غير ممنوح للـAPI roles.
- migration `111_harden_pos_sale_idempotency_replays.sql` تمنع تعديل العملية
  الأصلية عند replay، وتعيد النتيجة المخزنة للطلب المتطابق وترفض payload مختلفًا
  بالمفتاح نفسه دون Business writes.
  `POS IDEMPOTENCY BLOCKER = VERIFIED FIXED`.
- قراءة MFA status تستخدم generation مشتركة ومحدودة، مع timeout/error/retry
  صريحة وتجاهل late/stale responses وربط النتيجة بالمستخدم والجلسة الحاليين.
  لا يوجد automatic retry على enroll/challenge/verify/unenroll.
  `MFA RETRY RECOVERY = VERIFIED FIXED`.

## 7. Deploy

### Admin

```powershell
npm.cmd run deploy:admin:check
npm.cmd run deploy:admin
```

سكربت النشر يتحقق من `main = origin/main` ثم يمرر SHA الكامل عبر
`NAWASRAH_ADMIN_RELEASE_ID` إلى Vite. يسجل Admin الـService Worker بعنوان
`/sw.js?build=<commit-sha>` وتستخدم cache الهوية نفسها؛ `local-dev` fallback
محصور في builds المحلية غير المنشورة. لا تستخدم `package.json` version كهوية
release. `PWA-01 = RESOLVED`.

### Customer Store

```powershell
npm.cmd --prefix customer-web run build
npm.cmd --prefix customer-web run deploy:cloudflare
```

قبل أي deploy: working tree نظيف، `main = origin/main`، CI/Secret Scan أخضران،
ثم smoke read-only وasset HTTP 200 بعد النشر. لا تنشئ معاملات مالية أو مخزنية
حقيقية لاختبار النشر.

`A11Y-01 = RESOLVED`: صفحة `/about/` وlandmarks الأساسية للمتجر اجتازت Axe
على Chromium وMobile WebKit. نص رسوم التوصيل يستخدم تباين WCAG AA، وشريط
التحديث وروابط التواصل العائمة داخل landmarks معنونة، وأسماء navigation
المتزامنة مميزة. لم يتغير منطق الطلب أو البيانات.

## 8. Backup وRestore

```powershell
npm.cmd run backup:status
npm.cmd run backup:run
npm.cmd run backup:verify
npm.cmd run backup:restore-test
```

- ERP backup مشفر AES-256-GCM بأدوات PostgreSQL 17 الأصلية وchecksums.
- Nightly task تعمل تحت `SYSTEM`; Restore Drill يبقى معزولًا ويستخدم Docker.
- `Nawasrah ERP Nightly Backup` تعمل تحت `SYSTEM` وآخر نتيجة مجدولة قبل هذا
  الإغلاق هي `0`.
- أُنشئت نسخة ERP مشفرة حديثة بعد بداية إغلاق 2026-09-14 باسم
  `nawasrah-backup-2026-09-14T03-34-51Z.nwb`، حجمها `3769909` بايت، وSHA-256:
  `10343485a94b004623d88483390dd37bf952ade551fb79f0761e3a23746612c6`.
  اجتازت `backup:verify` على المسار الصريح مع `116` ملفًا متحققًا.
- أحدث Restore Drill أعاد 54 جدولًا و109 foreign keys و0 unvalidated constraints
  مع `liveSupabaseTouched=false`.
- أُعيد تسجيل `Nawasrah n8n Daily Backup` تحت `SYSTEM` واختبارها فعليًا؛ أعادت
  `0` وأنشأت أرشيفًا جديدًا مع `restoreVerified=true`.
- رُفعت نسخة ERP نفسها عبر الـworkflow الرسمي إلى
  `erp/daily/2026/09/14/nawasrah-backup-2026-09-14T03-34-51Z.nwb`. تحققت R2
  metadata و`.sha256` sidecar، ثم نُزّل object نفسه وتطابق الحجم والـSHA حرفيًا
  مع النسخة المحلية التي اجتازت `backup:verify`.
- لا توجد Custom Domains مرتبطة بالـbucket وpublic `r2.dev` معطل، لذلك object
  يبقى private. أعاد الـworkflow التحقق من أحدث n8n artifact الموجود دون إنشاء
  n8n backup جديدة؛ container `nawasrah-n8n` بقي running/healthy ولم يتغير
  Runtime أو بياناته. Restore Drill المعزول السابق يبقى دليلًا منفصلًا، ولم
  يحدث Restore إلى Production في هذا الإغلاق.

التفاصيل في [scripts/backup/README.md](../scripts/backup/README.md) و
[automation/n8n/README.md](../automation/n8n/README.md).

## 9. Docker Safe Startup وn8n

- Safe Startup task: `Nawasrah Docker Safe Startup` تحت حساب `TOP`، وآخر نتيجة
  بتاريخ 2026-09-11 هي `0` مع Docker `29.7.2` وn8n healthy و`/healthz = 200`.
- runner/log/status خارج Docker تحت `C:\ProgramData\NawasrahDockerRecovery`.
- لا Factory Reset ولا حذف VHDX/images/volumes/containers.
- عند socket runtime تالف، runner يعزل مجلد runtime المحدد بمحاولة bounded فقط.

```powershell
docker info
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\automation\n8n\status.ps1
```

## 10. Monitoring وHealth Dashboard

```powershell
npm.cmd run monitoring:status
```

- Developer Alerts: Docker/n8n/backup/restore/Supabase cron/outbox/CI/Uptime/
  Cloudflare/integrity/performance/security، بلا PII.
- Business Alerts/Summaries: Business outbox → n8n → صاحب العمل فقط.
- لوحة Admin: `المزيد → الإدارة والمتجر → مراقبة صحة النظام`، Owner فقط. وفق
  سياسة MFA المركزية، يتطلب العقد الخادمي AAL2 بعد وجود عامل MFA مسجّل وموثّق،
  ويسمح بـAAL1 قبل تسجيل العامل.
- الحالة `Unknown` ليست `Healthy`.

اتبع [Monitoring Runbooks](./operations/MONITORING_RUNBOOKS.md) ولا تصلح
incident عبر تعديل Business rows أو حذف incident state.

## 11. Incident state بعد Recovery — `OPERATIONAL RECOVERY = VERIFIED`

بتاريخ 2026-09-11 أُعيد تسجيل Developer Watchdog تحت `SYSTEM`، ثم أثبت سجلّه
تشغيلًا تلقائيًا ناجحًا كل خمس دقائق. دورة الـstate machine أغلقت الحالات القديمة
طبيعيًا، و`npm.cmd run monitoring:status` يعيد حاليًا `activeIncidents = {}`.

قد تعيد جلسة Windows غير المرتفعة `task = null` لأن ACL المهمة يمنع تعدادها، لذلك
الدليل التشغيلي المعتمد هو registration status تحت `SYSTEM` وسجل watchdog المتجدد؛
لا تحذف `incidents.json` ولا ترسل recovery يدويًا.

## 12. DB lint compatibility note

- أُزيل `v_product_id` غير المستخدم من `_receive_purchase_order_impl` عبر
  `104_remove_unused_receive_purchase_order_product_id.sql` مع الحفاظ على تحقق
  UUID وكل عقود receiving/WAC/inventory/flavor/accounting.
  `V_PRODUCT_ID DB LINT CLEANUP = VERIFIED`.
- `p_transfer_date` في `transfer_inventory_between_warehouses` هو intentional
  unused parameter محفوظ لأجل legacy/backward compatibility. لا تحذفه من
  signature؛ ليس Bug مفتوحًا ولا Production blocker.

## 13. Business Alert Rules — `BUSINESS ALERT RULES & THRESHOLDS = VERIFIED`

Migration `105_harden_business_alert_rules_and_thresholds.sql` تعتمد القواعد
النهائية التالية عبر البنية الحالية للـdedup/recovery:

- Delayed Order = ساعتان من `created_at` بحسب وقت الخادم.
- Cash Difference = أي فرق غير صفري، موجبًا أو سالبًا.
- Daily Expenses = يوم تقويمي `Asia/Amman` بلا monetary threshold.
- Shift max close = `min(opened_at + 15h, next local midnight)`.
- الوردية المتأخرة تُطلق alert فقط ولا تُغلق تلقائيًا.

## 14. Reversal fixture recovery — `TEST-01 REVERSAL COVERAGE = VERIFIED`

كان `TEST-01` ناتجًا عن stale reversal test fixture أعطت Flavor Master رصيدًا
مباشرًا. أصبحت fixture تستخدم Master للتجميع فقط وFlavor Child للبيع والمخزون
والحركات والعكس، مع SKU عادي مستقل لسيناريو الائتمان. لم يظهر Production
accounting defect ولم تتغير business logic أو migrations.

## 15. Remaining Before Final Launch

### Technical blockers

عدد Critical/High/Medium blockers المفتوحة أو غير المحلولة ضمن نطاق المراجعة
المكتمل = `0`. Custom Domain وSEO Part 2 والإعداد التقني
لـGoogle Search Console وR2 Off-site Backup وMonitoring Phases 1–5 والتنفيذ
التقني للخصوصية وGuided Store Assistant وAdmin Light Mode Visual Comfort و
Cloudflare Insights cleanup وPWA-01 مكتملة ولا تظهر كمهام معلقة.
A11Y-01 مكتملة كذلك ولا تظهر كـTechnical blocker.

المرحلة التشغيلية التالية المسموحة هي
`CONTROLLED ONE-TIME OWNER TRAINING`. لا يبدأ Cleanup أو Go-Live تلقائيًا.

### Manual / Business decisions

1. إغلاق Business/Legal privacy inputs في
   [PRIVACY_DATA_MAP.md](./operations/PRIVACY_DATA_MAP.md).
2. Cutover Business Telegram من المستلم المؤقت إلى صاحب المحل الحقيقي، مع test
   آمن وعدم لمس Developer recipient.
3. تأكيد ملكية Search Console من حساب صاحب العمل وإرسال `sitemap.xml`؛ DNS
   verification والدومينات وSEO Part 2 وProduction Website Smoke مكتملة.

### Optional future enhancements

- WhatsApp Business Cloud بعد اعتماد المزود والقالب والاعتمادات.
- Driver GPS الحي.
- Forecasting وAI Business analytics إضافية.

لا تبدأ أي بند من هذه الوثيقة لمجرد قراءته؛ كل تغيير Production يحتاج scope
صريحًا وbackup/CI/verification مناسبًا.

## 16. Admin Session Security

- Idle Lock = 15 دقيقة من نشاط مستخدم حقيقي فقط؛ polling وRealtime وطلبات
  الخلفية لا تمدد المهلة.
- `lastActivityAt` و`absoluteSessionStartedAt` محفوظان لكل user بصورة منفصلة،
  ومتزامنان بين tabs عبر storage events. reload وإغلاق tab وعودة Safari من
  الخلفية تعيد التقييم فورًا، وتغيير الساعة للخلف يفشل بأمان.
- Absolute Session = 12 ساعة من تسجيل الدخول الكامل. لا يعيد password/biometric
  unlock أو MFA unlock أو token refresh ضبط البداية.
- `ABSOLUTE SESSION LIMIT = CLIENT-ENFORCED`. لم يتغير Supabase Auth configuration
  ولم تُنشأ مصادقة موازية. الجلسات السابقة لأول تحميل للإصدار المحسّن تبدأ
  tracking محليًا عند أول مشاهدة آمنة، ثم تصبح كل عمليات الدخول اللاحقة دقيقة.
- عند القفل لا يبقى Admin shell أو modal أو toast في DOM/accessibility tree؛
  unmount يزيل subscriptions الخاصة بالشاشات، وunlock يعيد mount ويحدّث ملخصات
  الطلبات والمنتجات والتنبيهات.
- password fallback يعيد التحقق من البريد المعروف للجلسة بدون إدخاله مجددًا،
  ويحافظ على TOTP/AAL2 للحسابات المسجل لها عامل MFA.
- Face ID/Windows Hello الحالي هو local WebAuthn device unlock. ليس Supabase
  Passkey server-side؛ المسار الكامل مؤجل إلى Phase منفصلة ولا يوجد تنفيذ ناقص.
- Logout = current Supabase session فقط عبر `scope: 'local'`، مع انتشار
  `SIGNED_OUT` إلى tabs وحذف timestamps المحلية الخاصة بالمستخدم. الأجهزة الأخرى
  لا تُسجل خروجًا.
- Sensitive-action step-up لم يتغير. المرشحون لمرحلة مستقلة لاحقة: تعديل
  الأدوار/الصلاحيات، إعدادات الأمن وMFA، واعتمادات التكاملات الحرجة.

اختبارات السياسة والـDOM/password fallback:

```powershell
npx.cmd tsx --test tests/admin-session-security.test.ts tests/biometric-unlock-options.test.ts tests/turnstile-auth.test.ts tests/mfa-security.test.ts
npx.cmd playwright test e2e/admin-session-security.spec.ts --project=desktop-chromium --project=mobile-webkit
```

`ADMIN SESSION SECURITY HARDENING = VERIFIED`.

## 17. Lean pre-training operational readiness audit — 2026-09-14

Audit baseline: documentation `121798aec6d5f15b2633ef7404ff7fe0dfc26555`, Admin
runtime `95377d98b6f789cce05cbd14ecf6abc77e19284a`, Production migrations `001–111`.
This section records a read-only review, not a new runtime test or Go-Live approval.
Only existing Markdown files were edited. No backup/upload/restore/job execution,
Auth change, business transaction, dependency upgrade or deployment was requested.

Evidence vocabulary: `DIRECTLY VERIFIED` (live read),
`VERIFIED FROM LOCAL CONFIG/METADATA`, `REPOSITORY-INFERRED`,
`USER CONFIRMATION REQUIRED`, `UNKNOWN`. An accessible developer session is not
proof of the business owner's account ownership, billing or recovery readiness.

### Release compatibility and emergency decision

| Admin SHA | Deployment | Expected DB at release | DB 001–111 compatibility | Backup linkage | Action |
| --- | --- | --- | --- | --- | --- |
| `95377d98b6f789cce05cbd14ecf6abc77e19284a` | `75e00664-f783-41b7-b2ea-424e900e85bf` | 111 | Current baseline; live identity/signature/head directly verified; earlier runtime tests reused | Fresh 2026-09-14 archive created after live head 111 check; not a frontend-image backup | Retain current release; fix-forward for any new defect |
| `6ca8918badabe13b27671a86a87c130310bcd660` | `a60ad4b6-5de5-40e4-965a-ad9a1de080f6` | 110 (Git tree) | UNKNOWN: no previous-frontend/current-DB runtime proof in this audit | No direct artifact linkage established | Not an approved rollback target; would also lose the newer MFA retry fix |

Cloudflare API directly returned the full current Admin SHA above and Customer SHA
`221ecd0c6e789528a5c58ea41649333bec38e5ad` / deployment
`b127d695-b262-4afa-9ea7-ba48997ba2a9`. Both deployments remained unchanged.
The live Admin entry bundle contains the runtime SHA; deployed `sw.js` equals the
repository worker and reads its build ID from the registration query. A bare
`sw.js` need not contain a literal commit SHA. No new browser-controller smoke was run.

`NO VERIFIED SAFE ROLLBACK TARGET — FIX-FORWARD REQUIRED`.
DB changes default to a new reviewed migration: never delete an applied migration,
rewrite history or manually restore old function bodies. A previous green CI does
not prove backward DB compatibility. Frontend rollback requires a separately
verified compatibility matrix and owner-authorized incident action. Stop only the
affected workflow, or the whole write surface when the DB/shared integrity is at risk.

After migration timeout, read migration history plus function/schema/grants and
classify `APPLIED / NOT APPLIED / AMBIGUOUS`. Do not infer rollback or success from
the client error. `AMBIGUOUS` means stop retries until state is known. Restore is
for proven data loss/corruption with a reviewed cutoff and reconciliation plan,
not the default response to an application regression. The recommended decision
owner is the shop owner, advised/executed by the developer during Hypercare; a
named replacement operator and recovery custodian are required at handoff.

### Disaster recovery: recommendation versus proof

- Existing encrypted artifact/download/SHA/private-bucket evidence from the prior
  closure is retained. Local status still names the exact 2026-09-14 archive and
  matching remote download digest. No new backup or restore was performed.
- Remote restore evidence names the 2026-09-10 archive, not the new archive.
  Byte-identical download plus local archive verification proves artifact integrity;
  it does not mean a new end-to-end project restore or timed recovery was performed.
- Recommended RPO: at most 24h for the local nightly copy while the host/schedule
  are healthy. The documented 23:30 backup / 02:10 off-site upload creates a worst
  normal off-site window of about 26h40m plus execution time; use about 27h as the
  current off-site planning bound. Missed jobs can exceed it. If the owner needs
  less data loss, approve a separate backup-frequency/platform-recovery change.
- Recommended RTO: host-only recovery target 4h, planning ceiling one business day
  (8h), conditional on working hardware, internet, operator and recovered secrets.
  Full Supabase-project recovery is not timed/verified: 8h is a proposed objective,
  not a promise; Auth identity/configuration restoration can exceed it.
- `OWNER APPROVAL REQUIRED = YES` for RPO/RTO/restore decision owner.
- New-machine steps and public-schema/Auth limitations are documented in
  [backup README](../scripts/backup/README.md#new-machine-recovery-checklist-not-executed-by-documentation-audit).
- A 90-day local/remote drill gate is already documented. Retain quarterly drills
  and require a separately authorized drill after substantial recovery-pipeline
  changes; do not register another duplicate schedule.

### Access and recovery ownership

The following is a handoff inventory, not certification of owner access. `UNKNOWN`
does not prove missing access. Confirmation was requested without secrets; no
ownership, secret or MFA changes were made. Completion of owner access/custody is
required before independent handoff. Removal of excessive developer access comes
after successful handoff/Hypercare, with a known emergency operator retained.

| Service | Current evidence / ownership | Recovery method exists | Developer access | Owner access ready | Handoff action / timing |
| --- | --- | --- | --- | --- | --- |
| Cloudflare account + billing | DIRECTLY VERIFIED Pages read access; legal owner/billing UNKNOWN | UNKNOWN | YES, scoped observed access | UNKNOWN | Confirm account/billing/recovery custodian BEFORE GO-LIVE |
| R2 | LOCAL CONFIG/METADATA: protected S3 config and prior successful download; ownership UNKNOWN | UNKNOWN for account/key custody after host loss | YES, existing local workflow access | UNKNOWN | Independent account and archive-key recovery BEFORE GO-LIVE |
| Supabase + billing | DIRECTLY VERIFIED read-only DB, secret names, one Owner role and one verified MFA factor; human account/billing owner UNKNOWN | UNKNOWN | YES, privileged maintenance credential exists locally | UNKNOWN | Confirm project/billing/Auth recovery, least privilege BEFORE GO-LIVE |
| GitHub repository/org/billing | DIRECTLY VERIFIED origin access; account/org/billing owner UNKNOWN | UNKNOWN | YES, existing repository session | UNKNOWN | Confirm owner/admin/recovery access BEFORE GO-LIVE; developer reduction AFTER HYPERCARE |
| Domain registrar/renewal/payment | USER CONFIRMATION REQUIRED; working domain does not prove registrar access | UNKNOWN | UNKNOWN | UNKNOWN | Registrar/renewal/recovery confirmation BEFORE GO-LIVE |
| DNS | DIRECTLY VERIFIED working official domains; DNS control/recovery custody UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Confirm registrar/zone authority BEFORE GO-LIVE |
| n8n | DIRECTLY VERIFIED local healthy container, one user, Telegram workflow active | LOCAL CONFIG/METADATA: encrypted n8n artifact; human recovery UNKNOWN | YES, host/container maintenance | UNKNOWN | Owner operation and encryption/config custody DURING HANDOFF |
| Telegram developer/business bots | REPOSITORY-INFERRED separation; LOCAL CONFIG/METADATA routing configured; human bot owner UNKNOWN | UNKNOWN | YES, local configuration exists | UNKNOWN | Business recipient/bot custody BEFORE GO-LIVE; developer bot separate |
| Recovery email | USER CONFIRMATION REQUIRED | UNKNOWN | UNKNOWN | UNKNOWN | Confirm access without collecting addresses/codes BEFORE GO-LIVE |
| App Owner/Admin + MFA device | DIRECTLY VERIFIED one Owner membership / verified factor; holder/device/recovery UNKNOWN | UNKNOWN; no native recovery-code capability assumed | UNKNOWN for human account | UNKNOWN | Owner demonstrates Login/Unlock/MFA, recovery procedure DURING HANDOFF |
| Windows administrator / Scheduled Tasks | DIRECTLY VERIFIED current host/read access; some SYSTEM task definitions hidden | UNKNOWN for lost-host administrator recovery | YES, current host | UNKNOWN | Administrator recovery and protected-task visibility DURING HANDOFF |
| Backup DPAPI configuration / passphrase | LOCAL CONFIG/METADATA protected configuration; independent off-device passphrase custody unconfirmed | UNKNOWN outside this host | YES, current machine tooling | UNKNOWN | Confirm independent passphrase copy BEFORE GO-LIVE; never record the value here |
| OneDrive/local backup ownership | LOCAL CONFIG/METADATA backup path under developer Windows profile | UNKNOWN for cloud-account recovery | YES, filesystem access | UNKNOWN | Confirm backup ownership/storage access DURING HANDOFF |
| Emergency operator | USER CONFIRMATION REQUIRED | UNKNOWN | Current developer available; replacement unconfirmed | UNKNOWN | Name recovery custodian BEFORE GO-LIVE and successor BEFORE access removal |
| Sentry, Turnstile, optional Gemini, Web Push | REPOSITORY-INFERRED integrations / DIRECTLY VERIFIED secret names only | UNKNOWN | Configured access does not prove external ownership | UNKNOWN | Confirm required integration owners BEFORE GO-LIVE; optional Gemini separately |

Essential-service recovery-path sign-off remains `USER CONFIRMATION REQUIRED`.
Do not turn unknown billing into a demonstrated defect, or silently mark this
strict sign-off requirement PASS. No conclusion that a recovery path is absent
has been established.

### Dependency / supply-chain snapshot

Checks at 2026-09-14 04:21–04:26 UTC used read-only npm audit, lockfile/install
metadata, imports/build scripts and vendor advisories. No installation or lifecycle
script was executed. This is a targeted package/configuration review, not a full
OS/container-image vulnerability scan or proof that every package is trustworthy.

| Scope | Raw results | Installed path / relevance | Project assessment |
| --- | --- | --- | --- |
| Admin all / omit-dev | 0 Critical, 0 High, 3 Moderate | `express@4.22.2 → body-parser@1.20.6 / qs@6.15.3`; no imports in application or build scripts inspected; Pages publishes static output | No demonstrated Production Express parser exposure; LOW maintenance item, not a training blocker |
| Customer omit-dev | 0 vulnerabilities | React/Supabase/Sentry browser dependencies | No reported package advisories in this scan |
| Customer build/deploy tools | 0 Critical, 3 High package flags from one advisory | `wrangler@4.120.0 → miniflare@5.20260801.1-alpha → sharp@0.35.2` | HIGH upstream; no sharp image processing in static build/SEO path and no production Miniflare server. No demonstrated exploit path; MEDIUM toolchain remediation before future untrusted-image processing |
| n8n runtime | `2.35.5`, pinned running digest below | Latest reviewed expression advisory affects legacy engine; installed config defaults to `vm`, env does not override it. One local user; no Git/OpenAI nodes in active workflow | No demonstrated exploit path for reviewed advisories; keep maintenance scheduled; this is not a clean full-image CVE scan |

Sources: [qs parsing](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx),
[qs DoS](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g),
[sharp/libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c),
[n8n legacy expression engine](https://github.com/n8n-io/n8n/security/advisories/GHSA-6xcw-7xm6-48c6).
The sharp advisory requires processing untrusted image input; reassess reachability
if image transformations or Miniflare routes are introduced. A reviewed toolchain
patch has lower scope than a broad dependency upgrade, but was not performed here.

Local Node `24.18.0`, npm `11.16.0`, Supabase CLI `2.114.0`; Vite `6.4.3` in both
locks. Effective Admin Wrangler `4.131.1` differs from Customer lock `4.120.0`.
Admin deploy uses npm exec Wrangler without a project pin: LOW reproducibility
gap. GitHub Actions are full-SHA pinned with read-scoped workflow permissions;
CI uses npm ci/lockfiles and Node major 24. Lock entries use npm registry URLs and
integrity hashes; no alternate resolved hosts or missing integrity found.
Expected esbuild/workerd binary-install scripts can download registry binaries;
protobufjs postinstall was inspected. No unexpected install-time destination was
found in inspected scripts; no sandboxed install/network capture was performed.

n8n running digest:
`sha256:c5861e6016c8f283142584190e3874e6aa6f322eca8771ceead09d08b4766a1e`.
Compose/environment use a mutable `stable` tag: record/pin a reviewed release in a
future maintenance task. No pull/restart occurred. Gitleaks reviewed repository
history (176 commits at baseline) without findings; this does not prove external
credentials have never been exposed or are all needed.

### Configuration and schedule evidence

- DIRECTLY VERIFIED: official Admin/Customer pages and entry assets HTTP 200,
  expected Supabase project in both bundles, unchanged Cloudflare deployments,
  gateway OPTIONS 204 for the official Customer origin. No checkout POST performed.
- `localhost` strings in bundles are validation branches/SDK defaults, not the
  selected DB URL. n8n is intentionally loopback-only on this Windows host; this
  is an active local integration, not a test destination mistakenly deployed.
- DIRECTLY VERIFIED: Supabase secret names do not include `TURNSTILE_TEST_MODE`.
  Hostname secret value and external Turnstile dashboard controls were not exposed
  or fully revalidated: UNKNOWN; code allowlist includes local development origins
  and hostname verification remains independently enforced in the gateway.
- DIRECTLY VERIFIED: five active DB cron jobs (gateway cleanup, stale-order expiry,
  advanced monitoring, summaries, core alerts), zero duplicate command/schedule
  groups and zero recorded cron failures in preceding 24h. DB clock UTC is normal;
  business calendar code explicitly uses Asia/Amman.
- DIRECTLY VERIFIED: n8n has two workflows, one active Telegram feed each minute,
  one inactive WhatsApp feed; live HTTP nodes target the expected Supabase host.
  Both workflow settings and container timezone are Asia/Amman. Business/developer
  recipient ownership/cutover remains a handoff confirmation, not changed here.
- DIRECTLY VERIFIED: ERP nightly task SYSTEM/ServiceAccount, last result 0,
  23:30/startup trigger, IgnoreNew; quarterly drill is an interactive daily due gate
  at 02:17. Windows timezone is Jordan Standard Time.
- VERIFIED FROM LOCAL CONFIG/METADATA: off-site/n8n/watchdog registration and
  successful recent artifact/runtime evidence. Current definitions of five protected
  tasks are not visible in this session; absence from enumeration is not proof of
  deletion. Exact current schedule/disabled state/duplicates for these remain UNKNOWN.
  Watchdog logs at 07:15/07:20/07:25 local returned 0, incident state has no active
  entries. Protected-task enumeration should be confirmed during handoff.
- Off-site defaults (02:10/startup, Sunday 03:00 verify, 03:30 90-day drill gate)
  are REPOSITORY-INFERRED plus registration metadata, not newly certified live
  schedules. No current overlap was demonstrated; complete overlap proof requires
  those hidden task definitions. No job was started to improve the evidence.
- All local automation shares the Windows host: if it is powered off, n8n/backup/
  watchdog stop together. GitHub public uptime remains external but does not prove
  local backup freshness. This is a MEDIUM operational monitoring limitation, not
  an observed accounting corruption incident. Assign a freshness check owner.
- Failure-mode evidence and operator stop/recovery steps are consolidated in the
  existing [Monitoring Runbook](./operations/MONITORING_RUNBOOKS.md).

`FINAL CONFIG RECHECK REQUIRED = YES` after training, owner/MFA/account changes,
Telegram cutover and test-data cleanup. No configured integration was changed.

### Findings and gate limits

No confirmed Critical/High project-exploitable defect or new Inventory/Cash/
Accounting corruption was established in this scope. Reported npm High flags
must not be relabeled as exploitable Production vulnerabilities without reachability.

| ID | Severity / type | Remaining action / evidence |
| --- | --- | --- |
| OWN-01 | MEDIUM HANDOFF GAP | USER CONFIRMATION REQUIRED: essential account recovery and off-device archive key custody. Strict recovery-path sign-off not yet evidenced |
| DR-01 | MEDIUM OPERATIONAL RISK | Public-schema backup excludes managed Auth/config; full-project recovery time unproven. Procedure documented; owner accepts scope/RPO/RTO before Go-Live |
| DEP-01 | MEDIUM OPERATIONAL RISK | Customer sharp advisory in local toolchain; no demonstrated active input path. Review patch before untrusted-image processing |
| MON-01 | MEDIUM OPERATIONAL RISK | Local host loss removes local backup/monitoring together; assign freshness responsibility before independent handoff |
| CFG-01 | LOW EVIDENCE GAP | Protected task definitions not visible; confirm current schedules/duplicates during handoff/final recheck |
| REL-01 | LOW MAINTAINABILITY | Mutable n8n stable tag / unpinned Admin Wrangler affect rebuild reproducibility |
| DEP-02 | LOW MAINTENANCE | Admin qs advisory chain unused in inspected deployed application path |
| DOC-01 | LOW DOCUMENTATION GAP, CLOSED | Updated stale scheduled-backup failure wording, rollback decision, new-machine and incident procedures |
| OPS-01 | INFO OPERATING LIMIT | POS key survives retry within mounted view, not reload. UNKNOWN-sale procedure now explicit; no new duplicate transaction proven |

Read-only audit findings and documentation completion do not themselves establish
owner recovery control. Until OWN-01 confirmation, the strict final readiness
sign-off is NOT VERIFIED (evidence pending), rather than a claim that a High
defect or missing recovery method has been proved. The next permitted phase after
the gate is satisfied is `CONTROLLED ONE-TIME OWNER TRAINING`; training is not run here.

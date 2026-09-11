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

لقطة الحالة النهائية: 2026-09-11 قبل Documentation-only sync.

| Component | Verified state |
| --- | --- |
| Git | `main`, baseline business-rules SHA `11be4f0d3802237df1ad3cbbdcb5d8c50ed58441` |
| Supabase | migrations المحلية والبعيدة `001–106` |
| Admin | Cloudflare Production متحقق؛ Admin Light Mode Visual Comfort مكتمل |
| Customer Store | Cloudflare Production متحقق؛ Custom Domain وSEO Part 2 وGuided Store Assistant مكتملة |
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

## 7. Deploy

### Admin

```powershell
npm.cmd run deploy:admin:check
npm.cmd run deploy:admin
```

### Customer Store

```powershell
npm.cmd --prefix customer-web run build
npm.cmd --prefix customer-web run deploy:cloudflare
```

قبل أي deploy: working tree نظيف، `main = origin/main`، CI/Secret Scan أخضران،
ثم smoke read-only وasset HTTP 200 بعد النشر. لا تنشئ معاملات مالية أو مخزنية
حقيقية لاختبار النشر.

## 8. Backup وRestore

```powershell
npm.cmd run backup:status
npm.cmd run backup:run
npm.cmd run backup:verify
npm.cmd run backup:restore-test
```

- ERP backup مشفر AES-256-GCM بأدوات PostgreSQL 17 الأصلية وchecksums.
- Nightly task تعمل تحت `SYSTEM`; Restore Drill يبقى معزولًا ويستخدم Docker.
- تشغيل `Nawasrah ERP Nightly Backup` تحت `SYSTEM` بتاريخ 2026-09-11 أعاد `0`،
  وأنتج `nawasrah-backup-2026-09-10T21-43-43Z.nwb` ثم اجتاز verify.
- أحدث Restore Drill أعاد 54 جدولًا و109 foreign keys و0 unvalidated constraints
  مع `liveSupabaseTouched=false`.
- أُعيد تسجيل `Nawasrah n8n Daily Backup` تحت `SYSTEM` واختبارها فعليًا؛ أعادت
  `0` وأنشأت أرشيفًا جديدًا مع `restoreVerified=true`.
- رُفعت النسختان الجديدتان إلى R2، ونجح download/verify والـRestore Drill المعزول
  لكل من ERP وn8n دون لمس Production.

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
- لوحة Admin: `المزيد → الإدارة والمتجر → مراقبة صحة النظام`، Owner فقط، والعقد
  الخادمي يتطلب AAL2.
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

لا توجد blockers تقنية معروفة حاليًا. Custom Domain وSEO Part 2 والإعداد التقني
لـGoogle Search Console وR2 Off-site Backup وMonitoring Phases 1–5 والتنفيذ
التقني للخصوصية وGuided Store Assistant وAdmin Light Mode Visual Comfort و
Cloudflare Insights cleanup مكتملة ولا تظهر كمهام معلقة.

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

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

لقطة الفحص: 2026-09-08 قبل Documentation-only commit.

| Component | Verified state |
| --- | --- |
| Git | `main`, baseline code SHA `dd733d16ef96cff05d68d2f3cb84ec68dbab53b7` |
| Supabase | migrations المحلية والبعيدة `001–102` |
| Admin | Cloudflare production deployment `0920c0d6-db07-44e2-a849-5f0685b415ad`, source `06cea6c`؛ لم تتغير Admin production files في privacy/docs commits |
| Customer Store | deployment `ef9fb298-bf92-43b0-972a-5b39c8314af3`, source `dd733d1` |
| Guest push | `send-order-push` Edge Function version 12 |
| n8n | container `nawasrah-n8n` running/healthy و`/healthz` = 200 وقت الفحص |
| GitHub | Code Quality وSecret Scanning وDeveloper Alerts خضراء للـbaseline |
| Privacy | migration `102` وCustomer Privacy Policy منشورتان |

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
Sanitized monitoring -> owner+AAL2 Admin Health Dashboard
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

آخر migration الحالية: `102_privacy_minimize_business_alert_payload.sql`.

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
- أحدث backup يدوي وقت الفحص: `nawasrah-backup-2026-09-08T08-30-11Z.nwb`،
  verified، وأحدث drill أعاد 54 جدولًا و109 foreign keys و0 unvalidated constraints
  مع `liveSupabaseTouched=false`.
- آخر تشغيل Scheduled Nightly Task أعاد exit code `1`. لا تعتمد على نجاح manual
  وحده؛ راجع `backup.log` ثم أثبت Scheduled run = 0 قبل الإطلاق.
- n8n latest archive status كان `ok=true` و`restoreVerified=true`، لكن مهمة
  `Nawasrah n8n Daily Backup` لم تظهر في Task Scheduler وقت هذا الفحص رغم وجود
  registration status سابق؛ أعد التحقق/التسجيل الآمن دون تغيير credentials.

التفاصيل في [scripts/backup/README.md](../scripts/backup/README.md) و
[automation/n8n/README.md](../automation/n8n/README.md).

## 9. Docker Safe Startup وn8n

- Safe Startup task: `Nawasrah Docker Safe Startup` تحت حساب `TOP`، وآخر نتيجة
  وقت الفحص `0`.
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

## 11. Open incident state وقت الفحص

`npm.cmd run monitoring:status` أعاد `task = null` ومفاتيح مفتوحة:

- `developer:n8n:container`
- `developer:n8n:healthz`
- `developer:n8n:workflow-executions`
- `developer:backup:scheduled-tasks`
- `developer:supabase:monitoring-query`
- `developer:cloudflare:admin`
- `developer:cloudflare:customer`
- `developer:github:ci`
- `developer:uptime:admin`
- `developer:uptime:customer`

الفحص المباشر خالف بعض هذه الحالات: n8n healthy، CI أخضر، deployments موجودة،
والنسخة/الاستعادة اليدويتان ناجحتان. المطلوب هو إصلاح/إثبات Scheduled Watchdog
ثم دورة recovery واحدة، لا حذف `incidents.json` أو إرسال recovery يدوي.

## 12. Known deferred warnings

- DB lint: متغير `v_product_id` غير مقروء في `_receive_purchase_order_impl`.
- DB lint: parameter `p_transfer_date` غير مستخدم في
  `transfer_inventory_between_warehouses`.
- لا تُصلح أيًا منهما ضمن handoff؛ يحتاج كل تغيير migration واختبارات العقود.

## 13. Remaining Before Final Launch

1. إغلاق Business/Legal privacy inputs في
   [PRIVACY_DATA_MAP.md](./operations/PRIVACY_DATA_MAP.md).
2. Cutover Business Telegram من المستلم المؤقت إلى صاحب المحل الحقيقي، مع test
   آمن وعدم لمس Developer recipient.
3. إغلاق/reconcile incidents أعلاه وإثبات Scheduled ERP/n8n backup وWatchdog.
4. اعتماد Custom Domain ثم SEO Part 2 وcanonical origin/Search Console.
5. Final Production/Website Smoke Test من الدومين المعتمد.

لا تبدأ أي بند من هذه الوثيقة لمجرد قراءته؛ كل تغيير Production يحتاج scope
صريحًا وbackup/CI/verification مناسبًا.

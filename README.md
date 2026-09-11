# Nawasrah ERP — نظام نواصرة لإدارة الجملة

نظام عربي RTL لإدارة محل جملة، يتكون من تطبيق Admin ومتجر Customer Store
ويستخدم مشروع Supabase واحدًا كمصدر الحقيقة للطلبات والمخزون والاستلام والذمم
والمدفوعات والمصاريف والورديات والتقارير.

الحالة الموثقة في 2026-09-12:

- Production migrations مطابقة للمستودع من `001` حتى `107`، ومسار Fresh
  `HYBRID SANCTIONED BOOTSTRAP` متحقق.
- Admin وCustomer Store منشوران على Cloudflare Pages.
- n8n يشغل Business Telegram والتنبيهات والملخصات عبر outbox محمية؛ WhatsApp
  يبقى غير مفعّل حتى اعتماد مزوده.
- Developer Monitoring مستقل عن n8n وعن قناة صاحب المحل.
- النسخ المشفرة وRestore Drill المعزول مطبقان، وOperational Recovery موثق
  كـverified في [وثيقة التسليم](./docs/HANDOFF.md).
- لوحة Health/Integrity داخل Admin للمالك مع AAL2 وللقراءة فقط.
- Privacy Policy وتقليل PII في التنبيهات الخارجية مطبقان، وأحدث canonical
  schema reconciliation مثبتة في migration `107`.

> ابدأ أي استلام أو تشغيل جديد من [docs/HANDOFF.md](./docs/HANDOFF.md). هذه
> الوثيقة هي نقطة الدخول العملية، بينما تبقى migrations والكود مصدر الحقيقة.

## الوظائف التشغيلية

- كتالوج جملة مقسّط وبحث خادمي، عروض، أقسام، سلة وCheckout آمن.
- Guest Order Gateway محمي بـTurnstile وrate limits وHMAC وidempotency، مع حد
  50 بندًا وحجز مخزون ذري.
- POS مرتبط بالوردية والعميل والمخزون، وإيصالات عامة منقحة.
- الاستلام والمشتريات والموردون وWAC والمخزون والجرد والتحويلات.
- ذمم العملاء والموردين وسندات القبض والدفع والمصاريف.
- الطلبات والتوصيل والتتبع الآمن والمرتجعات.
- أرشيف ورديات كامل وتقارير إغلاق ولقطات immutable للورديات الجديدة.
- عكس وردية كامل للمالك/AAL2 ضمن Support Matrix المثبتة فقط.
- تقارير المبيعات وCOGS والربح والمصاريف والذمم وحركات المخزون.
- Business Alerts وDaily/Weekly Summaries، ومراقبة سلامة وأداء وأمان.

## قواعد لا يجوز تجاوزها

- PostgreSQL/RPCs المحمية هي مصدر الحقيقة؛ لا تعدّل المال أو المخزون من React.
- لا تستخدم `service_role` أو كلمة مرور PostgreSQL داخل الواجهات أو n8n.
- لا تطبق SQL يدويًا على Production ولا تعدّل migration تاريخية.
- لا تشغّل `supabase db reset` على Production.
- لا تنفذ Factory Reset لـDocker أو تحذف volumes كخطوة معالجة أولى.
- لا تضع tokens أو Chat IDs أو كلمات مرور داخل Git أو logs أو الوثائق.

## تشغيل محلي

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run lint
npm.cmd test
npm.cmd run build

npm.cmd --prefix customer-web install
npm.cmd --prefix customer-web run dev
npm.cmd --prefix customer-web run lint
npm.cmd --prefix customer-web test
npm.cmd --prefix customer-web run build
```

الحزمة الكاملة:

```powershell
npm.cmd run quality
```

تغطي الجودة TypeScript وESLint واختبارات Admin وCustomer وPlaywright وaxe.
تعمل GitHub Actions من:

- `.github/workflows/quality.yml`
- `.github/workflows/secrets.yml`
- `.github/workflows/public-uptime.yml`
- `.github/workflows/developer-alerts.yml`

## Production وعمليات التشغيل

- Admin: <https://admin.alnawasreh.com/>
- Customer Store: <https://alnawasreh.com/>
- Admin deploy/check: `npm.cmd run deploy:admin` و`npm.cmd run deploy:admin:check`
- Customer deploy: `npm.cmd --prefix customer-web run deploy:cloudflare`
- Migration alignment: `npx supabase migration list`
- Backup status: `npm.cmd run backup:status`
- Backup verification: `npm.cmd run backup:verify`
- Isolated restore drill: `npm.cmd run backup:restore-test`
- n8n status: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\automation\n8n\status.ps1`
- Developer monitoring status: `npm.cmd run monitoring:status`

لا تنشر من working tree متسخ. يجب أن تكون CI خضراء وأن يطابق SHA المحلي
`origin/main`. نشر Admin يثبت SHA داخل Cloudflare metadata؛ وبالنسبة لكل تطبيق
يُقارن deployment بآخر commit غيّر ملفات ذلك التطبيق، لا بمجرد أحدث docs commit.

## الوثائق

- [Handoff وتشغيل النظام](./docs/HANDOFF.md)
- [المعمارية](./ARCHITECTURE.md)
- [تصميم قاعدة البيانات](./DATABASE_DESIGN.md)
- [حالة المشروع والمتبقي للإطلاق](./PROJECT_PLAN.md)
- [نظام التصميم](./DESIGN_SYSTEM.md)
- [Supabase](./supabase/README.md)
- [الطلبات والحجوزات](./supabase/README-orders.md)
- [النسخ والاستعادة](./scripts/backup/README.md)
- [Developer Monitoring](./scripts/monitoring/README.md)
- [n8n وBusiness delivery](./automation/n8n/README.md)
- [Monitoring Runbooks](./docs/operations/MONITORING_RUNBOOKS.md)
- [Privacy Data Map](./docs/operations/PRIVACY_DATA_MAP.md)

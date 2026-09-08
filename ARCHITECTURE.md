# معمارية نظام نواصرة لإدارة الجملة

## الحالة الحالية

النظام يتكون من تطبيقين React 19/TypeScript يشتركان في Supabase واحد:

- `src/`: Admin للطلبات وPOS والمخزون والتوريد والحسابات والورديات والتقارير.
- `customer-web/src/`: متجر عام للطلبات بالجملة من دون حساب عميل.

المخطط الحي والمستودع متطابقان من migration `001` حتى `102`. PostgreSQL هو
مصدر الحقيقة؛ Zustand وLocalStorage يحتفظان بحالة واجهة وسلة وتفضيلات جهاز
محدودة فقط.

## مخطط الطبقات

```text
Admin / Customer Store (React + TypeScript + RTL)
              |
      typed services / Edge Gateway
              |
Supabase Auth + RLS + protected/public-minimal RPCs
              |
PostgreSQL transactions + movements + audit + outbox + cron
       |                                  |
       |                                  +--> Business n8n plane
       |                                       --> Business Telegram
       |
       +--> sanitized monitoring RPCs
            --> Windows Developer Watchdog / GitHub Actions
            --> developer-only Telegram
            --> owner+AAL2 read-only Health Dashboard

Cloudflare Pages hosts Admin and Customer Store.
Encrypted ERP/n8n backups are stored outside runtime data and verified by drills.
```

## حدود المسؤولية

1. React لا يكتب أرصدة أو قيودًا أو ذممًا مباشرة.
2. العمليات المالية والمخزنية تمر عبر RPCs ذرية وتُسجل في movements/audit.
3. Checkout العام يمر عبر `submit-guest-order`، ويتحقق من Turnstile ثم يستدعي
   العقد الخادمي الخاص؛ canonical order creation ليس متاحًا مباشرة للـanonymous.
4. n8n طبقة Business delivery فقط، بلا PostgreSQL credentials أو `service_role`.
5. Developer Alerts لا تمر عبر n8n حتى تستمر عند توقفه، ولا تحمل PII أو مبالغ
   Business تفصيلية.
6. Health Dashboard للقراءة فقط؛ monitoring لا يصلح البيانات تلقائيًا.

## Admin

- Supabase Auth وRBAC وRLS وMFA/AAL2 للعمليات الحساسة.
- الطلبات والمخزون وCRM والمشتريات والاستلام والدفعات والورديات تقرأ صفحات
  وفلاتر خادمية، ولا تحمل السجل التاريخي كاملًا.
- Orders realtime يستخدم targeted invalidation/refetch مع بقاء تفاصيل الطلب
  محملة عند الحاجة.
- Shift Archive مقسّط ومحمي، وclosing snapshot للورديات الجديدة immutable.
- Full Shift Reversal للمالك/AAL2 ويفشل قبل الكتابة عند وجود عملية غير مدعومة.
- Health Dashboard يعرض `Healthy / Warning / Critical / Unknown` وملخصات
  sanitized للمطور، من دون credentials أو PII.

## Customer Store

- كتالوج عام مقسّط، بحث خادمي، deep links نظيفة، merchandising محدود، وسلة
  تتحقق من السعر والمخزون عند الفتح وقبل Checkout.
- Guest Order Gateway محمي بـTurnstile وHMAC rate limits وidempotency.
- الحد الأقصى 50 line items؛ السعر والخصم والرسوم والمخزون تحسب خادميًا.
- طلب `website/new` يحجز المخزون خمس ساعات ثم يصبح eligible للانتهاء الذري إذا
  بقي في الحالة نفسها. لا يوجد backfill تلقائي للطلبات التاريخية.
- التتبع يتطلب token عشوائيًا أو رقم الطلب مع الهاتف؛ رقم الطلب وحده لا يكفي.
- سياسة الخصوصية متاحة من Footer وCheckout، والتخزين الاختياري لبيانات العميل
  مدته 30 يومًا ولا يحتفظ بملاحظات الطلب.

## Supabase وعمليات الخلفية

- RLS على الجداول المحمية، و`SECURITY DEFINER` مع `search_path` مقيد حيث يلزم.
- crons الخاصة بانتهاء الحجز وتنظيف rate-limit وتنبيهات الأعمال والملخصات
  والمراقبة تعمل بدفعات محدودة وبلا grants للمتصفح.
- Business Alerts تستخدم outbox واحدة مع lease وbounded retry وdead-letter.
- الملخص اليومي 08:00 لليوم السابق، والأسبوعي 09:00 صباح الاثنين للأسبوع
  السابق بتوقيت `Asia/Amman`.
- migrations `099`–`101` تضيف Business Integrity/Health monitoring وتصحيحاته؛
  migration `102` تقلل payload الطلب الجديد قبل خروجه إلى automation.

## قناتا التنبيه

### Developer plane

- Windows Watchdog وGitHub Actions يرسلان incidents تقنية للمطور فقط.
- يراقب Docker/n8n والنسخ والاستعادة وcron وCI/Uptime/Cloudflare وDB/RPC
  والأمان وسلامة الأعمال.
- deduplication وcooldown وrecovery وbounded retry مطبقة.

### Business plane

- Supabase outbox → Edge Function scoped → n8n → Business Telegram.
- طلبات ومخزون وورديات وحالات شراء وتنبيهات وملخصات يومية/أسبوعية.
- التفاصيل الإدارية تبقى داخل Admin؛ لا تُرسل PII في developer incidents.
- credentials والمستلم منفصلان تقنيًا عن Developer plane. Cutover المستلم
  المؤقت إلى صاحب المحل الحقيقي مؤجل للتسليم النهائي.

## Backup وRecovery

- ERP backup يومي مشفر AES-256-GCM تحت `SYSTEM` باستخدام PostgreSQL 17 native
  tools، مع checksums وretention محدود وstatus/log خارج Docker.
- n8n backup مشفر يشمل بياناته وملفات الاعتماد المشفرة اللازمة للاستعادة، ولا
  يُنشر إلا بعد verification/restore check.
- Restore Drill يعيد ERP إلى PostgreSQL container معزول ولا يلمس Supabase الحية.
- Docker Safe Startup يعالج runtime socket failure بتدخل bounded؛ لا يلمس VHDX
  أو images أو volumes ولا يستخدم Factory Reset.

## الخصوصية

راجع [docs/operations/PRIVACY_DATA_MAP.md](./docs/operations/PRIVACY_DATA_MAP.md).
لا تحمل Developer Alerts بيانات العملاء، وBusiness new-order payload لا يحمل
اسمًا أو هاتفًا أو عنوانًا أو موقعًا بعد migration `102`. هذا توصيف تقني وليس
ادعاء توافق قانوني كامل.

## التشغيل والتسليم

الإجراءات والأوامر وحالة Production الحالية موجودة في
[docs/HANDOFF.md](./docs/HANDOFF.md). لا تُستخدم هذه الوثيقة بدل migrations أو
التحقق الحي من CI/deployments/incidents.

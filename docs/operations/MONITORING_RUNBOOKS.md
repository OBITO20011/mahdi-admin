# Nawasrah monitoring runbooks

هذه الصفحة للمطور/المالك التقني. لوحة Admin للقراءة فقط، ولا تعالج البيانات تلقائيًا.

## Backup failure

- **المعنى:** النسخة لم تكتمل، أو تجاوز عمرها 36 ساعة، أو فشل فحص الاستعادة.
- **أول فحص:** راجع حالة `Nawasrah ERP Nightly Backup` وآخر ملف status/log خارج مجلدات Docker.
- **لا تفعل:** لا تحذف آخر نسخة سليمة، ولا تعمل Factory Reset لـDocker، ولا تطبع secrets.
- **التصعيد:** إذا غابت نسخة سليمة أو فشل Restore Drill، أوقف migrations المالية حتى نجاح backup + restore معزول.

## n8n down

- **المعنى:** container أو `/healthz` غير سليم وقد تتأخر Business deliveries.
- **أول فحص:** Docker Safe Startup ثم `docker inspect nawasrah-n8n` و`/healthz`.
- **لا تفعل:** لا تحذف volume ولا تعيد إنشاء credentials.
- **التصعيد:** استخدم آخر backup مشفر لـn8n فقط بعد إثبات تلف البيانات، وباستعادة معزولة أولًا.

## Supabase / database issue

- **المعنى:** فشل availability/connection/cron أو ارتفع استهلاك الاتصالات.
- **أول فحص:** Supabase status و`pg_stat_activity` وcron run details، قراءة فقط.
- **لا تفعل:** لا تقتل sessions أو تعيد migration أو تعدل Business rows عشوائيًا.
- **التصعيد:** أوقف writes/deploy إذا كان Critical، وخذ backup قبل أي remediation معتمدة.

## Business delivery dead-letter

- **المعنى:** استنفدت رسالة Business المحاولات المحدودة أو علقت lease.
- **أول فحص:** عدادات outbox والقناة المتأثرة دون فتح payload في Telegram التقني.
- **لا تفعل:** لا تغيّر recipient ولا ترفع retry بلا حد ولا ترسل الرسالة يدويًا قبل فحص idempotency.
- **التصعيد:** أصلح transport ثم أعد queue وفق RPC الرسمية وبـevent key نفسه.

## Integrity violation

- **المعنى:** invariant محاسبي/مخزني أو حجز/حركة/وردية لا يتطابق.
- **أول فحص:** حدّد check key والعدد من Dashboard، ثم نفّذ reconciliation read-only مستقل.
- **لا تفعل:** لا تعدل الرصيد أو الحركة مباشرة ولا تحذف audit/reversal record.
- **التصعيد:** أوقف العملية المتأثرة؛ remediation مالية تحتاج migration/RPC مدروسة وbackup ومراجعة مستقلة.

## Deployment mismatch

- **المعنى:** GitHub main لا يطابق Cloudflare asset المناسب أو CI/Uptime فاشل.
- **أول فحص:** main SHA، deployment source SHA، وآخر Code Quality/Secret Scan/Uptime.
- **لا تفعل:** لا deploy من working tree متسخ ولا force push.
- **التصعيد:** أعد deployment من SHA أخضر معروف؛ rollback للأصل المنشور فقط إذا ظهر regression مثبت.

## Security anomaly

- **المعنى:** ارتفاع rate-limit/gateway errors أو Auth audit failures أو configuration drift.
- **أول فحص:** عدادات نافذة 15 دقيقة وCloudflare/Supabase logs بدون PII.
- **لا تفعل:** لا تعطل Turnstile أو RLS/MFA، ولا توسع grants، ولا ترسل stack/token إلى Telegram.
- **التصعيد:** دوّر secret فقط إذا ثبت compromise، واحتفظ بالأدلة وسجل التدقيق.

## State meanings

- `Healthy`: آخر فحص نجح ولم يجد مخالفة.
- `Warning`: يحتاج متابعة، ولا يثبت فساد بيانات وحده.
- `Critical`: invariant أو خدمة أساسية تحتاج تدخلًا سريعًا.
- `Unknown`: المصدر غير متاح أو لا يخزن telemetry كافيًا؛ لا يعامل كـHealthy.

# Nawasrah monitoring runbooks

هذه الصفحة للمطور/المالك التقني. لوحة Admin للقراءة فقط، ولا تعالج البيانات تلقائيًا.

## Docker Safe Startup failure

- **المعنى:** Docker Server لم يبدأ أو ظهر runtime socket/IPC تالف قبل تشغيل n8n.
- **أول فحص:** راجع `Nawasrah Docker Safe Startup` و`C:\ProgramData\NawasrahDockerRecovery\logs` و`last-status.json` ثم `docker info`.
- **لا تفعل:** لا تستخدم Factory Reset، ولا تحذف VHDX أو images أو volumes أو containers، ولا تعمل force-kill متكررًا.
- **التصعيد:** إذا ثبت socket runtime تالف والعمليات متوقفة، اعزل مجلد runtime المحدد مرة واحدة وفق Safe Startup؛ توقف إذا تكرر الفشل بعد المحاولة المحدودة.

## Backup failure

- **المعنى:** النسخة لم تكتمل، أو تجاوز عمرها 36 ساعة، أو فشل فحص الاستعادة.
- **أول فحص:** راجع حالة `Nawasrah ERP Nightly Backup` وآخر ملف status/log خارج مجلدات Docker.
- **لا تفعل:** لا تحذف آخر نسخة سليمة، ولا تعمل Factory Reset لـDocker، ولا تطبع secrets.
- **التصعيد:** إذا غابت نسخة سليمة أو فشل Restore Drill، أوقف migrations المالية حتى نجاح backup + restore معزول.

## Off-site backup failure

- **المعنى:** نسخة ERP أو n8n المشفرة لم تصل إلى R2 الخاصة، أو فشل تنزيلها بنفس SHA-256، أو تجاوز عمر الرفع 36 ساعة، أو غاب دليل Restore Drill الدوري.
- **أول فحص:** راجع ملف الحالة الموافق وآخر log داخل `C:\ProgramData\NawasrahOffsiteBackup`، ثم تأكد أولًا أن النسخة المحلية للمسار نفسه سليمة.
- **لا تفعل:** لا تحذف أو تستبدل أي archive في R2، ولا تعطل Bucket Lock، ولا تكشف اعتماد S3، ولا تستعد إلى Production.
- **التصعيد:** عند فشل authentication، أو immutable-key conflict، أو اختلاف SHA-256، أو فشل Restore Drill المعزول لأي من المسارين.

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

## Incident state لا يطابق الفحص المباشر

- **المعنى:** قد تبقى incident مفتوحة لأن watchdog لم يكمل دورة recovery حتى لو أصبح المصدر سليمًا.
- **أول فحص:** قارن `npm.cmd run monitoring:status` مع Task Scheduler وآخر watchdog log والفحص المباشر للمصدر.
- **لا تفعل:** لا تحذف `incidents.json` ولا ترسل recovery يدويًا ولا تغيّر cooldown لإخفاء الحالة.
- **التصعيد:** أصلح تشغيل watchdog نفسه ثم نفّذ دورة واحدة؛ يجب أن يصدر recovery واحدًا ويغلق المفتاح من خلال state machine الحالية.

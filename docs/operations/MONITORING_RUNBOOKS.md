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

- **المعنى:** Cloudflare لا يطابق آخر runtime release معتمد للتطبيق، أو CI/Uptime فاشل.
- **أول فحص:** runtime SHA وdeployment ID وbuild/SW identity وآخر CI؛ قد يتقدم
  `main` بـdocs-only commit دون الحاجة إلى deployment جديد.
- **لا تفعل:** لا deploy من working tree متسخ ولا force push.
- **التصعيد:** لا يكفي أن SHA سابق كان أخضر. استخدم مصفوفة التوافق في HANDOFF؛
  عند عدم إثبات توافقه مع DB الحالية يلزم fix-forward. لا rollback فعلي دون قرار معتمد.

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

## قرارات التشغيل والتصعيد

هذه إجراءات يطبقها الشخص المسؤول؛ لا تضيف قفلًا آليًا أو تعديلًا للـRuntime.
الموظف يوقف العملية الملتبسة فورًا ويحفظ مرجعها، والمالك يقرر استمرار بقية العمل
بالتشاور مع المطور أثناء Hypercare. إعادة تشغيل المسار تتطلب تحققًا من الخدمة
ومصالحة مستقلة لأي أثر مالي/مخزني سابق. قرار Restore يتطلب موافقة المالك وخطة
فنية محددة؛ لا تُعتبر صلاحية إدارة السيرفر تفويضًا لاستبدال بيانات العمل.

| الحادث / إشارة الكشف | أول إجراء وما يُمنع | الاستمرار والتصعيد | تحقق التعافي |
| --- | --- | --- | --- |
| POS لا يحمل أو لا يقبل البيع | افحص الاتصال وAdmin والوردية قراءة فقط؛ لا تنقل البيع إلى SQL أو تتجاوز Auth | أوقف تسجيل POS، ويمكن استخدام الشاشات السليمة للقراءة؛ يصعّد الموظف للمالك/المطور | الصفحة والخدمة سليمتان؛ العملية التالية الحقيقية فقط بإذن صاحب المحل |
| Sale UNKNOWN بعد timeout/انقطاع | احفظ وقت المحاولة والوردية وطريقة الدفع والمبلغ ومرجعًا إن ظهر، دون PII في بلاغ المطور؛ ابحث في الفواتير ومدفوعات الوردية والحركات قبل أي إعادة | أوقف هذه المعاملة؛ عند تعذر فصل الأثر في نفس الوردية أوقف الكتابات عليها أيضًا | طابق أثرًا واحدًا مؤكدًا أو أثبت عدم وجود أثر قبل retry؛ لا blind retry ولا Reversal لحالة مجهولة |
| DB unavailable | افحص provider/network/connection قراءة فقط؛ لا تعِد migration ولا تعدّل الأرصدة | أوقف جميع الكتابات المعتمدة على DB؛ لا تدّعِ وجود offline POS | اتصال ثابت، ثم حسم كل pending/UNKNOWN transaction قبل الاستئناف |
| Customer checkout unavailable | افحص الصفحة وgateway/Turnstile والإشعارات؛ لا تعطّل الحماية ولا تطلب إعادة الدفع عشوائيًا | أوقف الطلب المتأثر؛ POS يمكنه الاستمرار فقط إذا كان مساره مستقلًا وسليمًا | تحقق من الطلب السابق أولًا؛ عودة gateway وحدها لا تثبت أن الطلب الملتبس لم يُحفظ |
| Cash mismatch | عدّ النقد الفعلي وطابق opening cash والمبيعات والدفعات والمصروفات والعكس وطريقة الدفع؛ CliQ ليس نقد درج | أوقف التسوية/إغلاق الوردية الملتبسة؛ يقرر المالك وقف باقي كتاباتها إذا أعاقت التحقيق | Cash reconciliation بلا تعديل رصيد مباشر أو فاتورة وهمية؛ أي تصحيح لاحق رسمي ومعتمد |
| Backup/R2 failure | راجع artifact/status وفك التشفير المرجعي؛ لا تحذف نسخة سليمة ولا تعِد التشغيل مع lock نشط | يمكن البيع إذا DB سليمة؛ المالك يقيّم تجاوز نافذة فقد البيانات المقبولة، وتؤجل migrations الخطرة | إثبات تشغيل جديد وربط artifact/size/hash/download في مرحلة إصلاح معتمدة |
| Deployment mismatch | قارن runtime release الفعلي، لا docs HEAD؛ لا clear-all-cache افتراضيًا | أوقف المسار الذي يظهر regression؛ لا يلزم إيقاف المتجر كله لمجرد اختلاف docs SHA | build/assets/SW متسقة وHTTP سليم؛ توافق DB مثبت قبل الرجوع لأي نسخة |
| Business integrity alert | راجع check key وreconciliation قراءة فقط؛ لا حذف audit ولا تعديل DB مباشر | أوقف العملية/الوردية المتأثرة؛ المطور يحلل والمالك يعتمد القرار | invariant سليم ومصالحة مستقلة؛ إغلاق التنبيه وحده ليس إثباتًا |

### ملاحظة POS UNKNOWN بعد إعادة فتح الصفحة

`PosView.tsx` يحفظ idempotency key داخل `useRef` ويغيره بعد نجاح البيع؛ إعادة
mount/reload تنشئ مفتاحًا جديدًا. Migration 111 تحمي replay بنفس المفتاح، ولا
يمكنها استنتاج أن مفتاحًا جديدًا يمثل المحاولة القديمة. لذلك لا تغلق الصفحة أو
تُعد البيع لحسم timeout؛ إن أُعيد فتحها، ابحث عن الأثر الأصلي أولًا وصعّد أي
حالة غير محسومة. هذا حد تشغيلي مستنتج من الكود، وليس إثباتًا لبيع مكرر في Production.

### Failure-mode evidence — مراجعة 2026-09-14

لم تُنفذ failure injection أو معاملات اختبار Production في هذه المراجعة.
`TEST-PROVEN` يقتصر على نتائج اختبار سابقة محددة؛ وجود test source وحده لا يثبت
نجاح سيناريو كامل. بقية السلوك أدناه `CODE-INFERRED`.

| الحالة | خطر بيانات الأعمال | تجربة المستخدم والتعافي | الاستمرار / مانع تدريب |
| --- | --- | --- | --- |
| انقطاع الإنترنت بعد POS submit | UNKNOWN حتى حسم أثر commit؛ إعادة بمفتاح جديد قد تكرر البيع | لا retry تلقائي معتمد؛ اتبع الإجراء أعلاه. replay/conflict بنفس المفتاح مثبتان في اختبار 111 السابق فقط | لا كتابة على المعاملة الملتبسة؛ لا مانع تدريب مع شرح هذا الإجراء |
| Supabase unavailable | لا فساد مثبت من outage وحده؛ معاملات طائرة تحتاج reconciliation | أخطاء تحميل/كتابة؛ عودة الشبكة لا تعيد submit بأمان تلقائيًا | توقف DB workflows حتى التعافي |
| Checkout backend unavailable | UNKNOWN للطلب الذي أُرسل قبل الفشل | المفتاح pending محفوظ محليًا؛ تحقق من الطلب قبل إعادة المحاولة | POS المستقل السليم يمكنه الاستمرار |
| n8n offline | لا تعديل Inventory/Cash/Accounting من workflow الإشعارات؛ التسليم يتأخر | outbox/leases/retry موجودة؛ dead-letter يحتاج مراجعة | يمكن البيع مع DB سليمة؛ لا مانع تدريب |
| Telegram unavailable | لا فساد أساسي مثبت؛ إشعار قد يتأخر/يتكرر عند ACK ملتبس | bounded retry وdead-letter؛ لا إرسال يدوي أعمى | يمكن البيع؛ متابعة التنبيهات من Admin |
| R2 unavailable | النسخة المحلية لا تُبطل؛ حماية فقد الجهاز أضعف | upload failure ظاهر؛ إعادة تشغيل معتمدة بعد إزالة السبب والتأكد من lock | يمكن البيع بقرار المالك حسب RPO |
| Backup machine offline | DB السحابية لا تتوقف؛ نافذة فقد البيانات تكبر، وn8n/watchdog المحليان يتوقفان | startup catch-up عند العودة؛ التنبيه المحلي لا يعمل وجهازه مطفأ | البيع السحابي ممكن؛ يلزم مسؤول يفحص freshness، وغياب الجهاز طويلًا يصعّد |
| Cloudflare frontend unavailable | لا فساد DB مثبت؛ submit طائر يبقى UNKNOWN | لا offline navigation مضمون؛ لا تجاوز إلى privileged API | توقف الواجهة المتأثرة حتى عودتها |

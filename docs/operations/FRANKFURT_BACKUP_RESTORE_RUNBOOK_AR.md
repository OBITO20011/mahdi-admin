# نسخ فرانكفورت واسترجاعها — أوامر المالك

هذه الحزمة تُضيف فرانكفورت **بجانب القديم**. لم يشغّل الوكيل أي اتصال بالمشروعين أو R2، ولم يسجّل مهام أو يرسل Telegram. لا migration جديدة؛ السقف 214. لا تصبح الحماية الحية مثبتة إلا بعد تنفيذ المالك الخطوات وظهور التقارير الناجحة.

## التنفيذ الأول بالترتيب

استخدم PowerShell **كمسؤول** من النسخة التي تحتوي هذا PR بعد اعتماده. إذا لم يُدمج بعد، استخدم worktree الحزمة صراحة، ولا تفترض توفر الأوامر في المجلد الرئيسي.

```powershell
Set-Location C:\Users\TOP\mahdi-admin
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Plan
```

1. **Plan:** خطة محلية بلا اتصال أو فك أسرار. يجب رؤية المرجع kzevmysfydaslxcerogt وlegacyUnchanged=true وbusinessAlertsEnabled=false. القديم يبقى بنسخه ومهامه الحالية.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Setup -Apply
```

2. **Setup:** اكتب مرجع فرانكفورت حرفياً ثم رابط الاتصال بلا كلمة مرور. Enter يستخدم الاتصال المباشر؛ إن كان IPv6 غير متاح، استخدم **Session pooler 5432** من لوحة المشروع، باسم postgres.kzevmysfydaslxcerogt. يُرفض transaction pooler 6543 وأي مشروع آخر. أدخل كلمة المرور في خانة مخفية. تُحفظ محلياً مشفّرة بـDPAPI ضمن C:\ProgramData\NawasrahFrankfurtBackup بصلاحيات SYSTEM/Administrators/المالك، ولا تدخل المستودع. لا يبدأ اتصال أو جدولة هنا.

مفتاح تشفير الأرشيف هو **نفس مفتاح النسخ القديم** المشفّر محلياً، دون تغييره. احفظ نسخته الأصلية في مدير كلمات مرور ونسخة طوارئ مستقلة؛ DPAPI وحده لا يُنقل لجهاز جديد. البيانات المنطقية تشمل Auth الفعلية؛ لا تعيد كلمات مرور أدوار PostgreSQL لأن roles.sql يُنشأ بـno-role-passwords. مفاتيح Edge/VAPID وR2 وTelegram وبيئة التشغيل ليست بديلاً عن نسخة إعدادات أسرار مستقلة.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Backup -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Restore -Apply
```

3. **Backup:** أول اتصال للمالك بفرانكفورت، قراءة فقط بقاعدة default_transaction_read_only، وTLS verify-full مع شهادة Supabase العامة المرفقة والمثبتة بالبصمة؛ لا اعتماد على مخزن الثقة النظامي وحده. لقطة repeatable-read مشتركة للداتا وpg_dump، وقائمة الصور من storage.objects، ثم تنزيل كل صورة برابطها العام والتحقق من حجمها. تغيير بنية/أدوار/تسلسل/قائمة صور أثناء النسخ يرفض النسخة لتعاد في وقت أهدأ. يُرفض تاريخ غير كامل: المطلوب 176 migration فعلية حتى 214. الناتج .nwb مشفّر AES-256-GCM، وبصمات الملفات داخل الأرشيف؛ لا تُرفع نسخة خام. محلياً تُحتفظ آخر 30 نسخة **داخل مجلد فرانكفورت وحده**.

4. **Restore:** يعيد النسخة المشفرة إلى حاوية مؤقتة بلا شبكة وبلا منفذ أو volume حي. يعيد كامل dump، والأدوار والمنح والمالكين، وAuth، وسجل migrations الحقيقي، وملفات product-images. يقارن بصمات وصفوف كل جداول public/Auth/Storage/history وتسلسلاتها والكتالوج. يُشغّل فحوص سلامة النظام الحالية على النسخة المعزولة فقط ثم يتراجع عنها. يجب رؤية ok=true وhistoryCeiling=214، وكل حقول Match=true وintegrityChecks healthy/0. تُحذف الحاوية والملفات الخام بعد الاختبار؛ تقرير restore-local.json يبقى. الصور تُستعاد كملفات داخل الحاوية مع metadata القاعدة وتُفحص بايتاتها؛ هذا ليس نشراً أو رفعاً إلى bucket حي.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Upload -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode VerifyRemote -Apply -Force
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode RestoreRemote -Apply -Force
```

5. **Upload:** يستخدم اعتماد R2 المشفّر الحالي ويضيف تحت `erp/frankfurt-kzevmysfydaslxcerogt/` فقط، دون حذف أو تعديل كائنات القديم. نسخة يومية ونسخة شهرية، وأسماء غير قابلة للاستبدال وبصمة SHA-256 جانبية.
6. **VerifyRemote:** ينزّل فعلياً من R2، ويطابق SHA والحجم والملف الجانبي، ويفك التشفير ويفحص manifest. ليس HEAD فقط.
7. **RestoreRemote:** تجربة الاسترجاع الحقيقية المطلوبة: التنزيل من R2 ثم نفس الاسترجاع الكامل المعزول. لا تتصل بالقاعدة الحية. **هذه الخطوة على أرشيف فرانكفورت الحقيقي هي دليل قبول H01**، وليست تجربة fixture المحلية. احفظ restore-remote.json وoffsite-status.json.

## الاحتفاظ في R2

لا يستطيع مفتاح الرفع تعديل إعدادات bucket. بعد نجاح أول RestoreRemote، يعرض المالك القواعد الحالية بحساب Cloudflare الإداري؛ يحتفظ بقواعد القديم وn8n. أضف للفرع الجديد فقط: يومي 90 يوماً، شهري 365 يوماً، وقفل 30 يوماً إن لم يكن القفل الحالي `erp/` يغطيه بالفعل. لا تستخدم lifecycle set الذي يستبدل القائمة كلها. [توثيق Cloudflare للأوامر](https://developers.cloudflare.com/r2/reference/wrangler-commands/).

```powershell
npx.cmd wrangler r2 bucket lifecycle list nawasrah-offsite-backups --jurisdiction eu
npx.cmd wrangler r2 bucket lock list nawasrah-offsite-backups --jurisdiction eu
npx.cmd wrangler r2 bucket lifecycle add nawasrah-offsite-backups frankfurt-daily90 erp/frankfurt-kzevmysfydaslxcerogt/daily/ --expire-days 90 --jurisdiction eu
npx.cmd wrangler r2 bucket lifecycle add nawasrah-offsite-backups frankfurt-monthly365 erp/frankfurt-kzevmysfydaslxcerogt/monthly/ --expire-days 365 --jurisdiction eu
# فقط إن لم يكن قفل erp/ الحالي يغطي الفرع الجديد:
npx.cmd wrangler r2 bucket lock add nawasrah-offsite-backups frankfurt-lock30 erp/frankfurt-kzevmysfydaslxcerogt/ --retention-days 30 --jurisdiction eu
npx.cmd wrangler r2 bucket lifecycle list nawasrah-offsite-backups --jurisdiction eu
npx.cmd wrangler r2 bucket lock list nawasrah-offsite-backups --jurisdiction eu
```

احفظ نتيجة list بعد التعديل محلياً؛ لا تدّعِ إثبات الاحتفاظ قبل قراءتها. لا تكرّر add إذا كانت القاعدة موجودة. لا تنفّذ remove لأي قاعدة قديمة.

## الجدولة والحارس والتنبيه الوحيد

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Register -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode TestAlert -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Watchdog -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Status
```

8. **Register:** خمس مهام SYSTEM جديدة باسم Nawasrah Frankfurt: Backup 23:50؛ Upload 02:35؛ VerifyRemote الأحد 03:10؛ RestoreRemote بوابة يومية 03:50 ينفذ كل 90 يوماً؛ Watchdog كل 5 دقائق. StartWhenAvailable، ومنع التداخل، ومحاولتا إعادة بعد 10 دقائق. لا يشغّل الاختبار أو المهمة فوراً، ولا يغيّر مهام القديم. تشغيل الاسترجاع تحت SYSTEM يحتاج Docker Desktop جاهزاً بعد دخول المستخدم؛ لا يبدأ Docker أو يعيد تشغيله تلقائياً. عند عدم توفره يسجَّل فشل ويبلغ المطوّر.
9. **TestAlert:** أمر المالك لإرسال رسالة تقنية واحدة لقناة المطوّر الحالية فقط. يسجّل محاولة قبل الإرسال، بمحاولة HTTP واحدة، ويرفض تكرارها ولو انقطع الاتصال؛ افحص Telegram قبل معالجة نتيجة غير مؤكدة. لم يرسل الوكيل شيئاً.
10. **Watchdog:** يقرأ فرانكفورت فقط: keep-alive يومي من قارئ إعداد المتجر الحالي، وحجم القاعدة عند 400,000,000 بايت، وحالة الفحص التقني الحالي، ونجاح/عمر النسخ والرفع والتنزيل والاسترجاع. لا يكتب snapshot في القاعدة ولا يفعّل cron. كل الرسائل التقنية للمطوّر، بلا أسماء أو مبالغ. `ok` يعني نجاح توصيل التنبيهات؛ `healthy` يعني سلامة الفحوص المفعّلة. `internalScanHeld=true` يعني أن cron الفحص الداخلي ما زال مؤجلاً بقرار المالك؛ لا ندّعي فحصاً حياً للمال والمخزون في تلك الحالة، ويثبت الاسترجاع سلامته محلياً. تعطل الكمبيوتر أو عدم اتصاله يمنع مهامه المحلية من العمل؛ يلزم أن يبقى الجهاز يعمل.

11. **Status:** محلي فقط، بلا فك أسرار أو اتصال. افحص الأوقات وok والمرجع. الجرد كمسؤول:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/inventory-backup-local.ps1
Get-ScheduledTask | Where-Object TaskName -like 'Nawasrah*' | Get-ScheduledTaskInfo | Select-Object TaskName,LastRunTime,LastTaskResult,NextRunTime
```

## التنبيهات يوم التشغيل

`routing-plan.json` تجهيز فقط: businessAlertsEnabled=false وstoreOrderPushEnabled=false. لا يُنسخ chat المطوّر إلى تنبيهات الشغل. يوم التشغيل يثبت المالك قناة صاحب المحل المستقلة ويختبر نقص المخزون والطلبات المتأخرة وملخص اليوم وإشعار المتجر عبر مسارات الإعداد القائمة؛ تفعيلها مهمة تحويل مستقلة مع اعتماد المالك، بما فيها cron والحارس الخاص بالأعمال. قنوات CI/فشل النسخ/keep-alive/الحجم/أخطاء النظام تبقى للمطوّر. مهام n8n القديمة لا تتغير الآن.

## الاسترجاع في الطوارئ

1. أوقف البيع والتحويلات الجديدة واعزل المصدر المشتبه به؛ لا تحذف النسخ أو قاعدة القديم. دوّن وقت آخر نسخة سليمة ووقت آخر عملية عمل مقبولة.
2. على جهاز Windows موثوق: ثبّت Node 24 وDocker وأدوات PostgreSQL 17، واستعد المستودع على SHA هذه الحزمة والأسرار من مدير كلمات المرور. مفاتيح DPAPI لجهاز سابق لن تعمل على جهاز جديد؛ أعد Setup على الجهاز الجديد بالمفاتيح الأصلية عبر آلية إعداد النسخ وR2 وTelegram الحالية قبل Setup فرانكفورت. لا تحفظها في Git أو history.
3. شغّل Plan وStatus، ثم VerifyRemote -Force وRestoreRemote -Force. إن كان R2 غير متاح فاستخدم Restore على آخر نسخة محلية موثوقة. لا تجعل connection تشير إلى جهاز الاسترجاع؛ الاسترجاع لا يقبل target URL ويختار الحاوية المعزولة بنفسه.
4. لا تعتمد الاسترجاع إذا ظهر أي اختلاف في صفوف/بصمات/منح/تسلسلات/صور أو فحوص السلامة. احفظ التقرير وخذ أرشيفاً أقدم للمراجعة؛ لا تخفف التحقق. الصورة المثبتة هي Supabase PostgreSQL 17.6.1.158، نفس صورة bootstrap في CLI المثبتة، وأي اختلاف امتدادات/منصة يحتاج مراجعة تطابق بيئة الاسترجاع.
5. بعد نجاح الاسترجاع المعزول ومراجعة المالك، جهّز خطة مستقلة لاستعادة الخدمة على مشروع بديل ومراجعة أسراره ورفع ملفات Storage للـbucket، والتحقق الصارم حتى 214، وRLS والمنح والإشعارات والتكاملات. الأدوات هنا لا تنشر، ولا تستبدل قاعدة حية، ولا تنقل البيع تلقائياً. يحسم المالك العمليات بين آخر نسخة ووقت التوقف يدوياً بمستندات موثقة قبل استئناف البيع.
6. جدول النسخ القديم يبقى حتى قرار لاحق؛ مرور أسبوع بعد التشغيل لا يوقفه آلياً.

إذا بقي ملف lock بعد انقطاع: اقرأ PID والوقت، وتحقق من عدم وجود العملية ومهمة Docker الخاصة بها؛ لا تحذف lock لمجرد قِدمه. الملفات الخام مؤقتة وتُحذف في finally؛ انقطاع الجهاز قد يترك مجلد nِawasrah-complete/full-restore في TEMP. اعزل بقاياه واحذفها فقط بعد تحديدها، واستخدم تشفير القرص لحماية البيانات أثناء العمل.

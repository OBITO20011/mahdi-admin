# جرد النسخ والحارس — 25 أكتوبر 2026

جرد محلي فقط على main 682dcaf؛ لا اتصال بالمشروعين أو R2، ولا تشغيل مهام أو إرسال رسائل. الدليل الآلي: `dual-backup-evidence/local-inventory.json`. قابل للإعادة من PowerShell باستخدام `scripts/operations/inventory-backup-local.ps1`، بصلاحية المسؤول لرؤية المهام المحجوبة.

|المسار|المكان والهدف الحالي|آخر دليل نجاح محلي|
|---|---|---|
|نسخة ERP الليلية|Windows: Nawasrah ERP Nightly Backup، يومياً 23:30 وعند الإقلاع؛ scripts/backup/run-backup.ps1 في C:\Users\TOP\mahdi-admin؛ المشروع القديم فقط؛ إعداد DPAPI في AppData\Local\NawasrahBackup|24 أكتوبر 23:30 +03، نتيجة المهمة 0؛ تفاصيل الأرشيف في JSON|
|اختبار ERP|Windows: Nawasrah ERP Quarterly Restore Drill؛ فحص الاستحقاق يومياً 02:17، وليس استرجاعاً كل يوم|25 أكتوبر 02:17، نتيجة 0 لا تثبت وحدها تشغيل اختبار جديد|
|نسخة n8n|Windows SYSTEM: Nawasrah n8n Daily Backup، 01:30؛ automation/n8n/backup.ps1|25 أكتوبر 01:30:40 +03؛ restoreVerified=true، liveVolumesModified=false|
|Offsite ERP وn8n|Windows SYSTEM؛ scripts/offsite-backup؛ C:\ProgramData\NawasrahOffsiteBackup؛ R2 prefixes erp وn8n|25 أكتوبر 02:10 +03؛ remoteVerified=true؛ تنزيل تحقق 18 أكتوبر؛ استرجاع بعيد مسجل 11 سبتمبر|
|Watchdog|Windows SYSTEM؛ scripts/monitoring؛ C:\ProgramData\NawasrahDeveloperMonitoring|25 أكتوبر 14:22:07 +03؛ EXIT=0، 32 فحصاً، 9 إشعارات حسب السجل؛ لم نرسلها نحن|
|Docker|مهمة الدخول Nawasrah Docker Safe Startup؛ C:\ProgramData\NawasrahDockerRecovery|آخر PASS محفوظ 18 أكتوبر؛ تشغيل 20 أكتوبر انتهى C000013A بعد وصول Docker إلى ready|
|n8n الفعلي|container nawasrah-n8n، healthy، volumes nawasrah_n8n_data/files؛ قراءة SQLite فقط|Telegram workflow فعّال ويشير للقديم؛ WhatsApp غير فعّال؛ آخر execution ناجح 25 أكتوبر 11:23 UTC، وآخر error 11:15 UTC|
|GitHub Actions|quality/secrets/developer-alerts/private-weekly-ci/public-uptime في .github/workflows؛ uptime عند الدقيقتين 7 و37|دليل تسليم main 682dcaf: quality 40165022251 وsecrets 40165022246 ناجحان؛ لم نحدّث حالة cron البعيدة في هذا الجرد المحلي|

## لماذا اختفت المهام من M02؟

استدعاء Scheduler COM بالاسم أعاد **80070005 (رفض الوصول)** للحارس ومهام Offsite الثلاث ونسخة n8n. ملفات تسجيل SYSTEM والسجلات الحديثة موجودة؛ الجرد السابق فسّر عدم الظهور كغياب. لا نعيد إنشاء هذه المهام أو نغيّرها عشوائياً. الجرد بصلاحية المسؤول مطلوب للمالك لتأكيد حالتها الحالية.

## Docker 3221225786

القيمة الست عشرية C000013A تخص انقطاع العملية، وليست إثبات فشل Docker. سجل 20 أكتوبر 16:38:39 يقول Docker Server became ready: 29.7.2 ثم لا توجد نهاية أو تحديث PASS. ن8n الآن healthy. هوية من أنهى العملية (إغلاق جلسة/إيقاف/مقاطعة) **غير مثبتة**؛ قراءة سجل TaskScheduler التفصيلي غير متاحة لهذا الحساب. لا ننسبها إلى سبب غير مثبت ولا نمسح أثرها.

## ثغرات التغطية المثبتة

1. فرانكفورت غير مشمولة بالسكربت الحالي ذي مرجع القديم الثابت.
2. إعداد الحارس لا يحتوي supabaseDailyChecksEnabled؛ keep-alive و400MB غير مفعّلين فعلياً بهذا الإعداد.
3. سرد product-images بالمفتاح العام يتعارض مع منع السرد في 213؛ الاسترجاع الحالي يفحص ملفات الصور فقط، ولا يعيد ACL أو Auth الفعلية (ينشئ placeholders). هذا لا يثبت الاسترجاع الكامل المطلوب لفرانكفورت.
4. نجاح مهمة ربع سنوية لا يعني تنفيذ الاسترجاع إذا لم يحلّ الاستحقاق.

قرار المالك: إضافة فرانكفورت مع الإبقاء على القديم؛ تنبيهات التقنية للمطوّر فقط، والشغل لصاحب المحل يوم التشغيل. التنبيه الاختباري أمر للمالك فقط. تشغيل نسخة فرانكفورت الحقيقية واسترجاعها ينتظر أوامر المالك؛ لا يوجد ادعاء نجاح حي من هذا الجرد.

## ما جُهّز واختُبر في الحزمة

دليل المالك: `FRANKFURT_BACKUP_RESTORE_RUNBOOK_AR.md`. مسار فرانكفورت جديد مستقل؛ لا تغيير على مهام/إعداد/أرشيف/حارس القديم. قائمة مراجع مغلقة، وحماية مجلد الاحتفاظ من الخلط، وتشفير السياسة الحالية، وR2 اليومي والشهري، وخمس مهام يثبّتها المالك فقط. إضافة workflow اختبار استرجاع محلي وتنبيه فشله لقناة المطوّر عبر آلية CI الحالية، دون تشغيلها يدوياً كتنبيه اختباري.

`dual-backup-evidence/local-complete-restore214.json` يثبت تجربة **fixture محلية غير صفرية**: استلام 20 وبيع 2، ومخزون 18، وذمة مورد 10,000 فلس وبيع نقدي 2,000 وافتتاح درج 10,000. تطابق 141 جدولاً وبصماتها والمنح والأدوار والتسلسلات وسجل 176 migration حتى214 والصورة. 17 فحص سلامة مال/مخزون/ذمم/وردية: healthy و0. جرى رفع/تنزيل/استرجاع عبر بديل S3 محلي بالمسار الإنتاجي، مع رفض نسخة تالفة واختبار إعادة الرفع بلا ازدواج. **ليست نسخة فرانكفورت الحية ولا إثبات إعداد lifecycle البعيد**.

نجاح H01 الفعلي ينتظر تشغيل المالك Backup ثم RestoreRemote على النسخة الحقيقية، وقراءة قواعد R2. تجهيز M02 لا يفعّل cron أو إشعارات الشغل؛ نموذج توجيه غير فعّال في `automation/n8n/frankfurt-go-live-routing.example.json`. مهام SYSTEM المحجوبة يستعرضها المالك كمسؤول؛ جرد الوكيل لم ينسب لها حالة Scheduler حالية غير مقروءة.

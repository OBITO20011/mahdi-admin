# ترقية219 إلى220 — وضع البيع بلا محاسبة

**مسودة المرحلة3؛ لا تُنفّذ قبل اعتماد الحزمة ودمجها ونجاح CI الكامل على main ثم إذن المالك المحدد.** لا يوجد تطبيق مستضاف أو نشر ضمن أدلة هذه الحزمة. 220 لوضع lite وحده:628 دالة أصلية محفوظة حرفياً، والثمانية بالفرق المعتمد فقط؛ محتوى#79 مؤجل إلى221 بعد التشغيل.218 محجوزة.

## قبل الترقية

- لا محاولة RESET219/RESET220 غير منتهية. احتفظ بأدوات219 ومرجعها في إصدار219 المجمد؛ لا تعِد تسمية لقطة أو مرجع219 إلى220.
- ثبّت SHA main المقبول وCI الكامل والأسرار وسلسلة النسخ. حدّث checkout الأساسي بـff-only مع حفظ ملفات المالك/البيئة وحقول project-state المعتمدة،ثم `npm.cmd run agent:preflight`.
- أغلق الكتابات فعلياً:المعاينات وروابطhash والأجهزة وPOS والمهام الكاتبة والناقلات وcron،وأغلق `ordersEnabled`. احفظ حالتها وأثبت وقت آخر كتابة؛ لا يكفي إغلاق طلبات المتجر وحده.
- جهّز مرجع220 محلياً بأمر [عدّةD−1 لسقف220](D1_REFERENCE_KIT220_AR.md)،ثم اعتماد مستقل وتثبيت محروس. لا يستعمل مرشح الاختبار المحلي في الإنتاج.

## الأوامر — PowerShell كـAdministrator عند التنفيذ المعتمد

من checkout الرئيسي،مع ربط workdir المالك القائم دون تغيير ربط المستودع:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\operations\frankfurt-backup-owner.ps1 -Mode Plan
npm.cmd run frankfurt-owner-upgrade220 -- --dry-run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\operations\frankfurt-backup-owner.ps1 -Mode Backup -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\operations\frankfurt-backup-owner.ps1 -Mode Restore -Apply
$backup219Evidence = Read-Host "مسار تقرير Backup219 الناجح الحالي"
npm.cmd run frankfurt-owner-upgrade220 -- --apply --backup-evidence $backup219Evidence
```

`--dry-run` محلي ولا يتصل؛ يثبت جاهزية المرجع والمصدر فقط،ولا يدّعي قراءة حالة فرانكفورت. `--apply` يتحقق من219/180 ومن بصمة دليل النسخة ومن ثبات البيانات منذ النسخ،ثم يقارن الكتالوج/ACL/Realtime والأموال والصفوف والتسلسلات وإعدادات التنبيهات قبل تسجيل220 رسمياً. جميع مهام Windows الخمس يجب أن تكون مفعّلة وتشير إلى checkout الصحيح.أي فرق يوقف التنفيذ،ولا تسجيل يدوي لـmigration فاشلة.

**نجاح apply لا يكمل الترقية.** احفظ مسار تقريره ثم:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\operations\frankfurt-backup-owner.ps1 -Mode Backup -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\operations\frankfurt-backup-owner.ps1 -Mode Restore -Apply
$backup220Evidence = Read-Host "مسار تقرير Backup220 الناجح"
$restore220Evidence = Read-Host "مسار تقرير Restore220 المعزول المطابق"
$upgrade220Report = Read-Host "مسار report.json من apply220"
npm.cmd run frankfurt-owner-upgrade220 -- --verify-only --backup-evidence $backup220Evidence --restore-evidence $restore220Evidence --upgrade-report $upgrade220Report
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\operations\frankfurt-backup-owner.ps1 -Mode Upload -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\operations\frankfurt-backup-owner.ps1 -Mode VerifyRemote -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\operations\frankfurt-backup-owner.ps1 -Mode RestoreRemote -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\operations\frankfurt-backup-owner.ps1 -Mode Watchdog -Apply
```

الإكمال يتطلب220/181 وRestore معزول لنفس SHA الأرشيف ودليل الصفوف،وصفر استثناءات،وحالةpg_net الخام متطابقة،وintegrity0.أي كتابة/تغيير بعد النسخ والاسترجاع يجعل الدليل قديماً.تبقى أرشيفات214–219 مقبولة بالمقارنة الصارمة؛النسخ تشمل جداولsales_lite1 وsales_lite2،والـRestore الافتراضي يحذف حاويته دائماً.

## بعد نجاح الترقية

التفعيل المحاسبي **يبقىON افتراضياً**؛migration لا تقلب وضع قاعدة قائمة تلقائياً. يوم القطع يستخدم [RESET220](RESET220_OWNER_AR.md)،ثم بعد نشر الإدارة والطلبات مغلقة يدخل المالك معTOTP ويختار «التشغيل بلا محاسبة» قبل استيراد القالب المبسّط. لاحقاً لا تعِد ON بالمفتاح:استخدم أداة «تشغيل المحاسبة» بجرد افتتاحي وتكاليف وتاريخ تفعيل،مع بقاء الديون والفواتير بمعرّفاتها.ربح مبيعاتlite الماضية لا يُخمن.

## التراجع والتوقف

لا migration عكسية تلقائية ولا إسقاط بيانات220 للرجوع إلى219. عند فشل apply/التحقق تبقى الكتابات مغلقة،ويُحفظ التقرير والنسخة ويُصعّد للمالك؛الاسترجاع الحي قرار منفصل. لا تعِد apply بعد نجاحه:استعمل verify-only بالأدلة المطابقة. تعليمات التصفير وإيقاف المعاينات والنشر في [خطة القطع](GO_LIVE_CUTOVER_AR.md).

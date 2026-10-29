# ترقية فرانكفورت217 — المالك،بعد اعتماد الحزمة ودمجها

216 مطبقة حسب إفادة المالك:verify-only صحيح،Backup216/178 وRestore151 جدولاً/17healthy. لا يثبت هذا أن217 مطبقة. لم يتصل Codex بأي مشروع ولم يشغّل Backup أو ترقية أو تصفير أو نشر مستضاف.

217 تغيّر نقل Telegram فقط:نفس outbox وحسابات/payload الملخص والمحاولات العشر،حجز دفعة عالمية3 رسائل،حراسة n8n القديم،وcron دقيقة غير نشط وDB.enabled=false. لا يتغير البيع أو المخزون أو الذمم أو الدرج أو Push أو الوجهة التقنية. السقف الحالي217/179 ملفاً له مصدر واحد في project-state. صيغة الأرشيف v2 وأرشيفات214–216 تبقى قابلة للتحقق والاسترجاع،بمقارنة صارمة ودون استثناء ACL.

## قبل الأوامر

1. اعتمد PR الحزمة وCI الكامل لنفس SHA ثم ادمجه؛يحدّث Codex المجلد الرئيسي بأمان مع حفظ docs المحلية ومواءمة بيانات التشغيل. **لا تشغّل217 من مجلد216 أو من فرع WIP**. لا تحذف ملفاتك لتجعل git نظيفاً. إذا لزم سحب يدوي،احفظها واطلب مواءمة الحالة قبل الترقية.
2. المرجع الجديد المستقل اسمه `local-reference-through217-ready.json` في `C:\Users\TOP\NawasrahFrankfurt\nawasrah-fra-001-138`،ناتج بناء محلي جديد216→217 ومقارنته ببناء217 نظيف وقراءات SDK فعلية. لا تعِد تسمية مرجع216 أو تستبدله،ولا تتجاوز manifest/ACL/owner/search_path. المصدر/المرجع يجب أن يطابقا SHA المدموج.
3. افتح **PowerShell كمسؤول Administrator**؛تتحقق apply من الارتفاع ورؤية مهام Windows الخمس ومساراتها إلى المجلد نفسه قبل كلمة المرور أو أي اتصال. غير المسؤول يحصل على `UPGRADE_BACKUP_TASKS_NOT_VISIBLE_RUN_AS_ADMINISTRATOR`. لا Setup أو Register جديد إذا بقيت المهام الصحيحة تشير إلى المجلد الرئيسي المحدّث.

## الترتيب — المالك فقط

توقف عند أول فشل؛نفّذ السطر التالي فقط بعد نجاح السابق. جميع كلمات DB/عبارات التأكيد تدخل تفاعلياً؛لا توضع في الأمر أو env محفوظ أو تقرير.

```powershell
cd C:\Users\TOP\mahdi-admin
git rev-parse HEAD
$backupScript = '.\scripts\operations\frankfurt-backup-owner.ps1'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupScript -Mode Plan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupScript -Mode Backup -Apply
npm.cmd run frankfurt-owner-upgrade217 -- --dry-run
npm.cmd run frankfurt-owner-upgrade217 -- --apply
npm.cmd run frankfurt-owner-upgrade217 -- --verify-only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupScript -Mode Backup -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupScript -Mode Restore -Apply
```

| الخطوة | ما تتوقعه | متى تتوقف |
|---|---|---|
| SHA وPlan | الإصدار المدموج المعتمد؛supportedSchemaCeiling=217 والأرشيفv2 مع دعم214/215/216 | SHA أو مسار مهمة قديم،أو فشل manifest |
| Backup قبل الترقية | نسخة216/178 مشفرة مع Storage وبصمة وok:true | أي فشل؛لا تبدأ apply دون نسخة سليمة |
| dry-run | محلي فقط،179 ملفاً وpending217،remoteWriteAttempted=false؛لا يقرأ الحالة الحية | مرجع/مصدر غير مطابق؛لا تدّع أنه تحقق حي |
| apply | مرجع فرانكفورت وكلمة DB مخفية؛تطبيق وتسجيل217 فقط،صفر فرق كتالوج/ACL،تريغر Push والخمس الأصلية كما هي،المهمة السادسة مغلقة | أي فرق أو خطأ؛لا إصلاح منح تلقائي ولا إعادة تسمية المرجع |
| verify-only | قراءة فعلية صارمة:التاريخ179 والكتالوج وACL والمالك والإعدادات والمنح وحجز المهمة مطابق؛لا إصلاح أو كتابة | ok:false أو حجز مختلف؛لا تتجاوز فحص ACL |
| Backup ثمRestore | نسخة217/179 وStorage ثم استرجاع **محلي معزول**،كل الصفوف/البصمات/الأدوار/المنح/التسلسلات مطابقة وexceptionsApplied=[] | أي اختلاف حقيقي؛لا تخفيف المقارنة ولا تجاهل جدول/ACL |

بعدها «افحص» والمطابقات المعتمدة. التقارير الآمنة تحت مجلد NawasrahFrankfurt لكل تشغيل؛لا تلصق سراً أو اتصالاً كاملاً. هذه الأوامر لا تنشر الدالة ولا ترسل رسالة ولا تفعّل cron. اتبع [إعداد تنبيهات السيرفر](FRANKFURT_OWNER_BUSINESS_ALERTS_AR.md) لاحقاً بتفويض المالك. التصفير يوم التشغيل يستعمل [RESET217](RESET217_OWNER_AR.md) مع الاستئناف نفسه،وليس الآن.

التحقق الصارم المذكور قبل فك حجز التشغيل. تفعيل cron/Push يوم التشغيل قرار منفصل موثق بلقطة جديدة؛اختلاف active عن مرجع الحجز بعده متوقع ومعلن،ولا يُسوّى بمنح صلاحيات أو إسكات verify-only.

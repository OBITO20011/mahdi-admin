# ترقية215 مع استمرار النسخ والتصفير

للمالك بعد اعتماد PR43 ودمجه فقط. هذه أوامر جاهزة للمراجعة؛لم يتصل الوكيل بأي مشروع ولم ينفذها. نفس TLS verify-full والإدخال المخفي في الذاكرة فقط.

## الترتيب الإلزامي

1. من PowerShell كمسؤول داخل `C:\Users\TOP\mahdi-admin`، اسحب main:

   ```powershell
   git status --short
   git pull --ff-only origin main
   git rev-parse HEAD
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Plan
   ```

   لا تحذف أو تستبدل ملفات docs المحلية. إذا رفض Git لتعارض محلي فتوقف واحفظ الملفات للمراجعة. يجب أن يطابق SHA إصدار التسليم بعد الدمج، وأن تعرض Plan دعم215 وصيغة أرشيف2 وتوافق214. لا حاجة لإعادة Setup: نفس الإعداد المحمي وكلمة مرور الأرشيف. إن كانت المهام تشير إلى مستودع آخر فتوقف ثم حدّث تسجيل المهام من هذا المجلد بأمر `-Mode Register -Apply` فقط بعد مراجعة المسارات. لا تُعطّل نسخ سنغافورة.

2. نسخة قبل الترقية، على214:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Backup -Apply
   ```

   المتوقع ok:true وhistoryCeiling:214 وhistoryFiles:176. احفظ اسم الأرشيف وبصمته ومسار التقرير. لا ترقِّ عند فشل النسخ. الأرشيف214 الموجود يبقى قابلاً للاسترجاع؛لا يحتاج تغيير صيغة أو إعادة تشفير.

3. المعاينة ثم التطبيق ثم التحقق:

   ```powershell
   npm.cmd run frankfurt-owner-upgrade215 -- --dry-run
   npm.cmd run frankfurt-owner-upgrade215 -- --apply
   npm.cmd run frankfurt-owner-upgrade215 -- --verify-only
   ```

   المعاينة محلية بلا اتصال أو كلمة مرور، وتحتاج `local-reference-through215-ready.json` في مجلد NawasrahFrankfurt المعتاد. المرجع جديد باسمه وبصمته؛لا تعِد تسمية214. إن لم يكن موجوداً يُبنى محلياً بـ`node scripts/operations/build-acl-reference215.mjs`،ولا تستبدل مرجعاً موجوداً.

   قبل اتصال apply، تُفحص صلاحية المسؤول أولاً، ثم manifest الأدوات محلياً، ثم مهام `Nawasrah Frankfurt Backup/Upload/VerifyRemote/RestoreRemote/Watchdog`: كلها موجودة ومفعلة وتشير إلى نفس المستودع وسكربت المالك المحدّث وبنفس الاستدعاء المحروس. يفشل الفحص قبل كلمة المرور إذا اختلف المسار أو كانت المهمة معطلة. لا يعيد التسجيل تلقائياً.

   **شغّل apply كـAdministrator**: افتح PowerShell عبر «تشغيل كمسؤول»، ثم انتقل إلى المجلد الرئيسي. عضوية حسابك في مجموعة المسؤولين وحدها لا تكفي؛ المطلوب طرفية مرفوعة الصلاحية. أول فحص في apply هو صلاحية الطرفية، قبل قراءة المهام أو طلب كلمة DB أو الاتصال. الطرفية العادية تُرفض بالكود `UPGRADE_BACKUP_TASKS_NOT_VISIBLE_RUN_AS_ADMINISTRATOR`. لا تعِد Setup أو Register بسبب هذا الكود؛ أغلق الطرفية وافتحها كمسؤول وأعد apply.

   إذا تعذّر الاستعلام عن المهام بعد نجاح فحص المسؤول يظهر `UPGRADE_BACKUP_TASKS_READ_FAILED`، وإذا تعذّر فحص صلاحية الطرفية يظهر `UPGRADE_ADMINISTRATOR_CHECK_FAILED`. غياب PowerShell يظهر `UPGRADE_POWERSHELL_NOT_FOUND`، وانتهاء المهلة `UPGRADE_PREPARATION_TIMEOUT`. تبقى المهمة الغائبة أو المعطّلة أو ذات المسار الخطأ مرفوضة بكودها المحدد واسم وضعها فقط. أخطاء الملفات أو JSON أو مدخلات الأمر لها أكواد ثابتة؛ لا تُطبع رسائل PowerShell الخام أو قيم الإعدادات. المعاينة وverify-only لا يشغّلان جرد المهام ولا يتطلبان هذا الفحص؛ verify-only يبقى اتصال قراءة ينفذه المالك فقط.

   عند الطلب اكتب `kzevmysfydaslxcerogt` ثم كلمة DB المخفية. يقبل تاريخ214 الكامل أو215 الكامل فقط. يطبق215 مرة،ويفحص الكتالوج والمنح والمالك والإعدادات قبل تسجيله. المتوقع ok:true و177ملفاً وفروق0 وأوامر مواءمة0. verify-only قراءة صارمة للدوال والجداول والأعمدة؛لا يصلح المنح. عند اختلاف توقف واحتفظ بالتقرير.

4. نسخة بعد الترقية:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Backup -Apply
   ```

   المتوقع ok:true وhistoryCeiling:215 وhistoryFiles:177 وformatVersion:2. نفس R2 والاحتفاظ والتشفير. مهام الليلة التالية تستدعي نفس السكربت المحدّث؛لا يوجد وقت يسمح فيه بتطبيق215 بأدوات214.

5. استرجاع معزول لهذه النسخة:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Restore -Apply
   ```

   المتوقع ok:true و215/177،ومطابقة الصفوف والبصمات والأدوار والمنح والتسلسلات وStorage،وفحوص السلامة سليمة. الاسترجاع إلى Docker محلي معزول فقط؛لا يكتب على المشروع. لا تُتجاوز مقارنة أو خطأ pg_restore. RestoreRemote يستعمل نفس القبول والمقارنة مع تنزيل R2 المتحقق.

6. من الإدارة افتح «افحص»،وتأكد من سلامة الفحوص. عند فشل أي خطوة ابقِ الكتابات متوقفة وراجع السبب؛لا تنشر أو تصفّر أو تصلح مالياً لتجاوزها.

## يوم التشغيل

أمر التصفير الحالي بعد215 هو `frankfurt-owner-reset215`،بمرجع215 الجديد،مع dry-run ثم apply واستئناف محروس عند الانقطاع. اتبع [RESET215_OWNER_AR.md](RESET215_OWNER_AR.md). يحتفظ بحساب المالك وMFA والقيم المخصصة نفسها،ويعيد177ملفاً كاملة عند الاستئناف. أدوات214 ومراجعها تبقى تاريخية ولا تُستخدم على215.

## مصدر السقف

`docs/agent/project-state.json: migrationCeiling` هو مصدر السقف؛`operationalSchema.manifestSha256` التزام بكل الملفات المعتمدة. `npm.cmd run test:operations-schema` يرفض migration أحدث أو بصمة مختلفة أو غياب محول التصفير/الترقية الحالي. كل ترحيل لاحق يحدّث الأدوات والمرجع والاختبارات في PR نفسه قبل تطبيقه.

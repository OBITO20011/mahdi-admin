# ترقية فرانكفورت219 — المالك بعد الاعتماد والدمج

هذه أوامر معدّة،وليست منفذة. الترقية من217/179 إلى219/180؛218 محجوزة ولن تُنشأ أو تُطبّق. 219 تُضيّق إسقاط أعمدة قارئ الحقائق، وتشارك مسح الشهر والأسبوع العابر للشهر بمساعدين خاصين (بلا منح تطبيق)، مع المعالجة اللاحقة208/215 نفسها. لا تغيير معادلات أو فترات أو كتابة مالية أو صلاحيات تطبيق أو حركات تاريخية. لا تُشغّل قبل اعتماد PR وCI ودمجه وتحديث المجلد الأساسي.

افتح PowerShell كـAdministrator. تحقّق من SHA وملفات المالك المحفوظة. المرجع الجديد local-reference-through219-ready.json يجب أن يكون ناتج بناء محلي مستقل217→219 ومطابقة بناء219نظيف وSDKحقيقي؛لا تعِد تسمية مرجع217. تبقى مهامWindowsالخمس كما هي إذا كانت تشير إلى المجلد المحدّث.

الترتيب،مع التوقف عند أول فشل:

```powershell
cd C:\Users\TOP\mahdi-admin
git rev-parse HEAD
$backupScript = '.\scripts\operations\frankfurt-backup-owner.ps1'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupScript -Mode Plan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupScript -Mode Backup -Apply
npm.cmd run frankfurt-owner-upgrade219 -- --dry-run
npm.cmd run frankfurt-owner-upgrade219 -- --apply
npm.cmd run frankfurt-owner-upgrade219 -- --verify-only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupScript -Mode Backup -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupScript -Mode Restore -Apply
```

ثم «افحص» وفق خطة يوم التشغيل. dry-run محلي دون اتصال؛apply يطلب المرجع الثابت وكلمةDB بإدخال مخفي في الذاكرة،ويتحقق من رؤية مهام النسخ قبلها. verify-only صارم على الكتالوج وACLوالمالك/search_path/التاريخ،ولا يمنح صلاحية أو يصلح فرقاً بصمت. المتوقع pending219وحدها،180تاريخاً،صفر فرق كتالوج وACL؛التكرار بلا كتابة. لا Setup/Register أو رفع219 على مشروع آخر.

تدعم الأدوات أرشيفv2لـ214/215/216/217/219 بالمقارنة الصارمة بلا استثناءات. تبقى تنبيهات217وcronمحجوزة؛لا نشرEdgeولا تفعيل.

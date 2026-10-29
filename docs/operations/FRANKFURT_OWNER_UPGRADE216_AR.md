# ترقية 216 — الدفعة الجزئية في البيع المباشر

أوامر المالك **بعد اعتماد PR ت-ج ودمجه ونجاح CI الكامل فقط**. لا ينفّذ الوكيل أي اتصال أو خطوة على المشروع. المرجع الجديد اسمه `local-reference-through216-ready.json`، وليس نسخة معاد تسميتها من 215. السقف 216 يتضمن 178 ملفاً.

## قبل هذه الأوامر

أكمل أولاً ترتيب [ترقية 215](FRANKFURT_OWNER_UPGRADE215_AR.md)، بما فيه النسخة والاسترجاع والفحص. ترقية 216 تقبل تاريخ 215 كاملاً أو 216 كاملاً فقط؛ لا تقفز من 214. شغّل PowerShell عبر «تشغيل كمسؤول» داخل `C:\Users\TOP\mahdi-admin`. لا حاجة لإعادة Setup لمجرد هذه الترقية.

1. اسحب main المعتمد دون المساس بملفاتك المحلية:

   ```powershell
   git status --short
   git pull --ff-only origin main
   git rev-parse HEAD
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Plan
   ```

   طابق SHA مع تسليم الحزمة. يجب أن تعرض Plan دعم 216 وتوافق أرشيفَي 214 و215 وصيغة الأرشيف 2. إذا منع Git السحب بسبب تعديل محلي، توقف واحفظ الملفات للمراجعة؛ لا تحذفها أو تستبدلها.

2. خذ نسخة قبل الترقية:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Backup -Apply
   ```

   المتوقع `ok:true` وتاريخ 215/177. احتفظ باسم الأرشيف وبصمته والتقرير. فشل النسخ يوقف الترقية.

3. المعاينة، ثم التطبيق، ثم التحقق الصارم:

   ```powershell
   npm.cmd run frankfurt-owner-upgrade216 -- --dry-run
   npm.cmd run frankfurt-owner-upgrade216 -- --apply
   npm.cmd run frankfurt-owner-upgrade216 -- --verify-only
   ```

   المعاينة محلية بلا كلمة مرور أو اتصال، وتحتاج مرجع 216 الجاهز في مجلد العمل الخارجي المعتاد. إن لم يوجد المرجع، لا تعِد تسمية ملف قديم؛ يُبنى محلياً بالأمر `node scripts/operations/build-acl-reference216.mjs` بعد استكمال أدلة الحزمة.

   apply يفحص رفع صلاحية الطرفية أولاً، ثم manifest ومهام النسخ الخمس والمسارات المحروسة قبل طلب كلمة DB أو الاتصال. الكود `UPGRADE_BACKUP_TASKS_NOT_VISIBLE_RUN_AS_ADMINISTRATOR` يعني إعادة فتح الطرفية كمسؤول، ولا يعني إعادة تسجيل مهام صحيحة. عند الطلب يكتب المالك مرجع فرانكفورت، ثم كلمة المرور بإدخال مخفي في الذاكرة فقط.

   المتوقع تطبيق وتسجيل 216 مرة واحدة، و`ok:true` و178 ملفاً، وصفر فرق كتالوج/ACL وصفر أمر مواءمة. verify-only يفحص الدوال والجداول والأعمدة والمالكين والإعدادات، ولا يصلحها. أي فرق أو فشل يوقف الخطوات التالية للمراجعة؛ لا تُمنح صلاحيات إضافية لتجاوز الفحص.

4. خذ نسخة بعد الترقية:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Backup -Apply
   ```

   المتوقع `ok:true` وتاريخ 216/178 وصيغة 2. تبقى أرشيفات 214 و215 قابلة للتحقق والاسترجاع، وتستعمل المهام الليلية نفس السكربت المحدّث؛ لا تُرقِّ قاعدة بأدوات نسخ قديمة.

5. استرجع النسخة الجديدة إلى البيئة المحلية المعزولة:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Restore -Apply
   ```

   المتوقع `ok:true` مع تطابق الصفوف والبصمات والأدوار والمنح والتسلسلات وملفات الصور، بلا استثناءات مقارنة. هذا الاسترجاع لا يكتب على فرانكفورت.

6. افتح «افحص» من الإدارة وتأكد من سلامة الفحوص. لا نشر ولا تصفير ضمن هذه الترقية.

## يوم التشغيل

بعد اكتمال 216، أمر التصفير الحالي هو `frankfurt-owner-reset216` بمرجع 216 الجديد، مع نفس اللقطة المحمية والعلامة والاستئناف والحارس على الكتابات. اتبع [RESET216_OWNER_AR.md](RESET216_OWNER_AR.md) وخطة يوم التشغيل. لا تستعمل مرجع 215 على قاعدة 216.

## بوابة التسليم الحالية

هذا الدليل جزء من العمل الجاري على الفرع. المرجع النهائي وبروفات الترقية والتصفير والنسخ وCI الكامل لم تُعتمد بعد؛ وجود الأوامر في الفرع لا يعني جاهزيتها للتشغيل على المشروع.

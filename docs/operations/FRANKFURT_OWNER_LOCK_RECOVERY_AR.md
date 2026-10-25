# قفل عملية فرانكفورت وتشخيص الإخفاق المبكر

الأساس main `5fdd0fd` بعد PR26. هذه حزمة أدوات تشغيل محلية فقط؛ لا تغيير للقاعدة أو الحسابات أو صلاحياتها أو تشفير الأرشيف أو إعدادات المالك، ولا اتصال بأي مشروع أو نشر.

## ما ثبت

- هناك فجوتان في الشجرة السابقة: قراءة البيئة بين إنشاء القفل وبدء try، وكتابة تقرير النجاح في finally قبل إغلاق القفل وحذفه. فشل الكتابة كان يمنع التنظيف.
- أُعيد إنتاج الثانية فعلياً على 5fdd0fd في مجلد مؤقت: وجهة التقرير غير قابلة للاستبدال، فيفشل الحفظ ويبقى القفل. نفس التجربة على الإصلاح تحفظ تقريراً بديلاً وتحذف القفل. الدليل `owner-lock-evidence/blocked-report-regression.json`.
- لا يمكن الجزم بأن هذه كانت علة محاولة المالك 19:34Z دون تقريرها. source() كان يُستدعى أصلاً داخل try؛ وفك DPAPI يتم في PowerShell قبل دخول Node، لذلك فشل DPAPI وحده لا يفسّر قفلاً أنشأه Node. لا نفك بيانات المالك للتحقق.

## السلوك الجديد

كل ما يلي إنشاء القفل، بما فيه كتابة بياناته وقراءة البيئة والتحقق من الأدوات وإنشاء المصدر، محمي بـtry/finally. يُحفظ تقرير العملية تحت القفل ثم يحاول finally مستقل الإغلاق والحذف حتى إذا فشل التقرير. يُتحقق من هوية الملف ومحتواه قبل الحذف، ولا يُحذف قفل عملية أخرى.

إذا تعذر استبدال `operation-Backup.json` مثلاً، يُحاول حفظ `operation-Backup-fallback.json` ويُعلن `REPORT_WRITE_FAILED`. إذا مُنعت كل الكتابة إلى المجلد فلا يمكن ضمان تقرير على القرص؛ يبقى تشخيص JSON الآمن في الطرفية. موت العملية قسراً أو انقطاع الكهرباء لا ينفّذ finally؛ تنظيف اليتيم صريح وليس تلقائياً.

أكواد ثابتة: `LOCKED`، `MISSING_ENV` (اسم المتغير المعتمد فقط)، `DPAPI_UNPROTECT_FAILED`، `PG_BIN_NOT_FOUND`، `CONFIG_INVALID`، `CONFIG_READ_FAILED`، `ARCHIVE_PASSPHRASE_INVALID`، `REPORT_WRITE_FAILED`، `LOCK_CLEANUP_FAILED`، `LOCK_FILE_INVALID`، `LOCK_PROCESS_CHECK_FAILED`. وتبقى فئات TLS وSQLSTATE والتوقيت والأداة ورمز الخروج من PR26. خطأ Node العام يصبح `OPERATION_FAILED`؛ لا يُنسب لأداة أصلية دون دليل.

PowerShell يحفظ أيضاً الإخفاق قبل Node، ولا يستبدل تشخيص Node المطبوع بخطأ عام. الرسائل الخام وكلمة المرور وpassphrase وسلسلة الاتصال لا تُسجل. اختبارات Windows استعملت بيانات مصطنعة فقط، بما فيها DPAPI إيجابي وسلبي.

## تنظيف القفل اليتيم

`CleanupLock` خاص بمدخل Windows وبـ`-Apply` وصلاحية المسؤول. يقرأ القفل `backup-offsite.lock` فقط في مجلد الإعداد، ويتحقق من JSON وPID. يحجز الملف بمقبض يمنع القراء والكتّاب المتنافسين؛ في Windows يبقى الاسم قيد الحذف حتى إغلاق المقبض، فلا يستبدله تشغيل آخر بين فحص PID والحذف.

- PID موجود، ولو أُعيد استخدام رقمه: `LOCKED`، دون حذف أو إنهاء عملية.
- PID غائب بشكل مثبت: حذف الملف فقط، ثم `removed:true`.
- القفل غير موجود: نجاح بلا حذف، `removed:false` و`LOCK_NOT_PRESENT`.
- بيانات غير صالحة أو تعذّر إثبات غياب العملية: رفض محافظ. لا يكفي قدم التاريخ، ولا تستخدم حذفاً قسرياً أو تمسح مجلد الإعداد.

لا يقرأ هذا الوضع كلمة مرور مفكوكة ولا يستخدم DPAPI ولا يتصل بمشروع. لا يُنظّف الوكيل القفل الفعلي؛ المالك يشغّل الأمر بعد الدمج.

## أوامر المالك — بعد الموافقة والدمج وتحديث المجلد الرئيسي

**لا حاجة لإعادة Setup.** افتح PowerShell كمسؤول:

```powershell
Set-Location C:\Users\TOP\mahdi-admin

powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode CleanupLock -Apply
if ($LASTEXITCODE -ne 0) { throw 'لم ينظف القفل بأمان؛ راجع diagnostic ولا تحذفه بالقوة.' }

powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Backup -Apply
if ($LASTEXITCODE -ne 0) { throw 'فشل Backup؛ راجع diagnostic ولا تشغل Restore.' }

powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Restore -Apply
if ($LASTEXITCODE -ne 0) { throw 'فشل فحص الاسترجاع؛ راجع diagnostic.' }
```

المتوقع: تنظيف آمن أو لا حاجة للتنظيف؛ ثم Backup بـ`ok:true` وأرشيف مشفر؛ ثم Restore المعزول بـ`ok:true` وفحوص التطابق. إذا فشل أي أمر أرسل JSON التشخيص فقط، لا config.json ولا كلمة المرور أو passphrase. `MISSING_ENV` أو `DPAPI_UNPROTECT_FAILED` ليسا إذناً لتغيير كلمة الأرشيف أو إعادة Setup عشوائياً؛ يجب أولاً فهم التقرير لأن الأرشيفات القائمة تعتمد على نفس المفتاح.

الدمج وتحديث المجلد الرئيسي ينتظران موافقة المالك على PR هذه الحزمة. لا يوجد ادعاء نجاح نسخة فرانكفورت من الاختبارات المحلية.

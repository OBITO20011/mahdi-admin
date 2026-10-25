# إصلاح فشل snapshot في نسخة فرانكفورت

الأساس: main af44765 وPR25. لا اتصال بأي مشروع، حتى لفحص TLS، ولا فك إعدادات DPAPI أو قراءة كلمة مرور المالك. ملف CA عام فقط حُمّل من توزيع Supabase الرسمي.

## ما ثبت وما لا يمكن حسمه

- كان SnapshotSession يتجاهل stderr بالكامل، ثم أغلفة Backup وCLI تستبدل الخطأ برسالة عامة. لذلك **لا يمكن استخراج سبب المحاولة الحية القديمة من التقارير الحالية**، ولا يجوز نسبتها جزماً إلى TLS.
- النقل كان يستخدم sslrootcert=system. وفق PostgreSQL هذا مخزن مكتبة TLS/المنصة، وليس ضماناً لاشتماله على CA الخاصة بالخدمة. شهادة Supabase Root 2021 CA غير موجودة في مخزنَي Windows Root المحليين في هذا الفحص. وثائق Supabase توصي بملف CA صريح مع verify-full، بما فيه session pooler.
- أُضيفت الشهادة العامة وبصمتا PEM وDER وفحص الصلاحية والتوقيع، ويُمرر مسارها المطلق إلى psql وpg_dump وpg_dumpall. لا fallback إلى require أو disable؛ أي فشل ثقة/اسم يظل فشلاً.
- pg_dump وpsql المثبتان محلياً هما 17.11. في ترتيب البرنامج لا يبدأ pg_dump إلا بعد snapshot وsource-evidence وroles-dump؛ لذلك تعارض إصدار pg_dump لا يفسّر فشل snapshot نفسه. اختلاف الإصدار الفرعي عن خادم17.6 ليس سبب رفض إصدار بذاته؛ pg_dump17 يدعم خادماً من نفس الإصدار الرئيسي. يُميّز التشخيص رفض الإصدار إن وقع فعلاً.
- قالب session pooler المعطى (aws-1-eu-central-1،5432،postgres.<المرجع>) يطابق الحارس المحلي. لم نجرِ DNS أو TCP أو authentication إليه. لا يمكن إثبات صحة كلمة المرور أو توجيه المستأجر دون محاولة المالك.
- تبقى repeatable-read READ ONLY والجلسة المصدِّرة مفتوحة حتى نهاية pg_dump --snapshot. لا تحويل إلى transaction pooler6543، ولا استبدال hostname بعنوان IP يلغي تحقق الاسم.

## التشخيص الآمن

آخر مرحلة في backupRoot/last-backup-status.json تتضمن diagnostic، وكذلك operation-Backup.json في مجلد الإعداد، وJSON الطرفية. الحقول: tool،stage،category،sqlstate إن أرجعه العميل،exitCode،signal،libpqMessage.

libpqMessage **تصنيف بصياغة ثابتة** مستخرج من الخطأ، وليس نسخاً للنص الخام. لا stdout أو stderr خام، أو SQL أو stack/cause أو command line أو connection string أو أسماء المستخدمين في التقارير. SQLSTATE قد يكون null لفشل TLS/DNS قبل بروتوكول SQL. فئات منفصلة للثقة والاسم والشهادة المفقودة، والمصادقة، والمستأجر، وDNS وtimeout وTCP، وخيارات startup، والإصدار، وsnapshot، والصلاحيات والقراءة فقط.

يُنتظر close لتصريف stderr قبل إعلان فشل العميل؛ EPIPE الثانوي لا يمحو سبب TLS. إذا لم توجد نسخة ناجحة، يُرفض Restore بفئة BACKUP_NOT_AVAILABLE قبل تشغيل Docker.

## أوامر المالك التالية — بعد موافقته ودمج هذا الإصلاح

**لا حاجة لإعادة Setup.** نفس config.json المحمي ونفس كلمة المرور والمجلدات تُستخدم كما هي. تغيير الثقة في الكود المدموج، وليس في إعداد المالك أو مخزن Windows. افتح PowerShell كمسؤول بعد تحديث المجلد الرئيسي إلى الإصلاح المعتمد:

```powershell
Set-Location C:\Users\TOP\mahdi-admin
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Backup -Apply
if ($LASTEXITCODE -ne 0) { throw 'لم تنجح النسخة؛ راجع diagnostic ولا تشغّل Restore بعد.' }
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Restore -Apply
```

المتوقع: Backup يعيد ok:true وأرشيفاً مشفراً، ثم Restore المعزول يعيد ok:true وحقول التطابق وفحوص السلامة. إذا فشلت النسخة، أرسل diagnostic فقط؛ لا ترسل config.json أو أسراراً. لا تكرر Setup عشوائياً ولا تخفّض التحقق من TLS.

## المصادر

- [Supabase: PSQL مع session pooler وملف CA وverify-full](https://supabase.com/docs/guides/database/psql).
- [Supabase: SSL enforcement وشهادة CA](https://supabase.com/docs/guides/platform/ssl-enforcement).
- [PostgreSQL17: sslrootcert=system ومخازن TLS](https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNECT-SSLROOTCERT).
- [PostgreSQL17: pg_dump وتوافق الإصدارات وsnapshot](https://www.postgresql.org/docs/17/app-pgdump.html).
- بصمات المصدر والشهادة العامة في scripts/backup/certs/README.md.

## الدليل المحلي

`backup-snapshot-evidence/native-windows17.json`: أدوات Windows17.11 الأصلية، عبر proxy STARTTLS محلي لكل جلسة إلى قاعدة disposable17.6 حتى214. أعاد sslrootcert=system فئة TLS_CA_UNTRUSTED؛ فشلت CA غير مطابقة وكذلك hostname غير مطابق بكود خروج2. نجحت CA الصريحة مع verify-full. بعد export snapshot أُضيف صف محلي بجلسة أخرى، وظل pg_dump على اللقطة السابقة. رُفضت كتابة داخل READ ONLY بـ25006. نجح أرشيف مشفّر كامل واسترجاعه مع141 جدولاً و17فحص سلامة. هذه ليست محاكاة لضمانات Supavisor الداخلية ولا اتصالاً به؛ هي إثبات للنقل الحقيقي libpq واللقطة والتحقق من الشهادة على localhost.

مفتاح CA الخاص بالاختبار يُنشأ مؤقتاً ولا يدخل المستودع؛ لا نملك مفتاح Supabase الخاص ولا نصنع شهادة localhost باسمها. شهادة Supabase الفعلية العامة مثبتة بالبصمات، واختبار localhost الإيجابي يستخدم CA اختبار مستقلة. النسخة الحية التالية للمالك ستؤكد السبب الفعلي بفئة آمنة إن بقي سبب آخر.

CI الكامل يُستكمل قبل جاهزية PR. الدمج ينتظر موافقة المالك؛ لا ادعاء نجاح نسخة فرانكفورت الحقيقية من اختبارات localhost.

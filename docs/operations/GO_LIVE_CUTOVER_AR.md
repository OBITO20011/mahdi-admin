# يوم التشغيل بالمحاسبة الكاملة — ON على 225

قرار المالك 18 نوفمبر 2026. هذه خطة للمراجعة. تسلسل البيع بلا محاسبة محفوظ في [خطة OFF التاريخية](GO_LIVE_CUTOVER_OFF_ARCHIVE_AR.md)، وهو غير مستخدم في هذا القطع. تظل 221 محجوزة، وقيد opening epoch يخص الرجوع من OFF إلى ON. هذه العملية تبقى على ON من بداية RESET225.

## 1. قبل نافذة القطع

1. ثبّت SHA main وCI الكامل وGitleaks، وتحقق من بصمات SQL والمرجع والأرشيف. جهّز واعتمد [مرجع D−1/225](D1_REFERENCE_KIT225_AR.md) قبل النافذة، وجهّز مراجع 222 و223 و224 بأدواتها المرقّمة من الرأس نفسه. مرجع 224 من رأس قديم قد يُرفض بسبب بصمة دليل الوصول. أعد بناءه كما في دليل 224، ثم اختبر قبول المراجع الأربعة بأوامر dry-run قبل التجميد. هدف 225 هو 185 ملفاً و705 دوال عامة و51 خاصة و13 عضواً في Realtime. أي فرق يوقف القطع.
2. اختبر النسخ وUpload وVerifyRemote وRestoreRemote وWatchdog. المرجع ونسخة البداية والنسخة الفاصلة أدلة مستقلة. أبقِ التجميد بعيداً عن 03:00 بتوقيت عمّان. الواجهات الفعلية وEdge وAuth وTurnstile وDNS والأسرار تحتاج قبولها المعتاد وإذن النشر المستقل.
3. جهّز ورقة تعبئة ON [واتبع دليلها](ON225_OPENING_WORKBOOK_AR.md). أصل الكتالوج `المنتجات-lite-نهائي.xlsx` وبصمته `3310da575b28e763fed079bf775f4010ac0a32ad23118b7216d18ca8de608e6c`. طابق 748 أساسياً و108 عائلات و444 نكهة و1084 قابلاً للبيع و15 قسماً. جردّ البضاعة فعلياً وسجّل تكلفة الفاتورة ووحدة الشراء ومحتواها لكل صنف. قبل الحفظ الفعلي في القاعدة تُنشأ المنتجات من ملف المحوّل حتى يمكن ربط أرصدة الجرد بمعرّفاتها.
4. لا ديون قديمة ولا شيكات افتتاحية. الدرج 0 دينار. أجور التوصيل والحد الأدنى يضبطهما المالك من الإعدادات. يبدّل رقم واتساب بعد التشغيل. يحتفظ المالك بقرار الإبقاء على صنف كندر بوينو واحد من الإدارة بعد المطابقة، والملف المرجعي يبقى كما هو.
5. ثبّت تقرير البروفة على الرأس والأرشيف والبصمة قبل اختيار الموعد. بروفة ON225 المحلية النظيفة في 19 نوفمبر، على `c2942fdd`، قاست **17.65 دقيقة من التجميد حتى فتح الطلبات وقبولها**، منها **5.38 دقيقة للاستيراد والمطابقة** و3.25 ثانية للجرد. مرجع المقارنة من 13 نوفمبر هو 14.31 دقيقة للفتح المحلي و33.9 ثانية لـRESET220، بنطاق مختلف. في التخطيط، **فرانكفورت أبطأ من البيئة المحلية**؛ هذا افتراض تخطيط، وليس قياساً حياً أو ضماناً لوقت القطع. تقدير الاستيراد يأتي من [أداة القياس القرائية في متصفح المالك وشبكته](IMPORT225_BROWSER_LATENCY_READ_ONLY_AR.md): المرجع المقاس **9438 طلباً** للاستيراد، ويُضرب في متوسط زمن GET المقاس. تُضاف معالجة الكتابات والملفات والمراجعة البشرية، وزمن التشغيل يتضمن إدخال المحل وتوقيعه. [دراسة إعادة استعمال اللقطات](IMPORT225_FRESH_SNAPSHOT_REUSE_STUDY_AR.md) مرجع للمراجعة فقط؛ لم يُنفّذ تحسين للاستيراد.

## 2. حجز الترقية ثم الحماية بالترتيب

أوقف جميع الكتّاب وضع المتجر في الحجز. نفّذ بالأمر الرسمي من نفس checkout. بعد التطبيق يجب أن تكون الطلبات مغلقة والوظائف الست معلّقة، وفق اللقطة الأصلية المحفوظة في تقرير الأداة.

```powershell
node scripts/operations/frankfurt-owner-cutover-hold225.mjs --hold-upgrade --plan --workdir '<مجلد العمل المعتمد>'
node scripts/operations/frankfurt-owner-cutover-hold225.mjs --hold-upgrade --dry-run --workdir '<مجلد العمل المعتمد>'
node scripts/operations/frankfurt-owner-cutover-hold225.mjs --hold-upgrade --apply --workdir '<مجلد العمل المعتمد>'
node scripts/operations/frankfurt-owner-cutover-hold225.mjs --hold-upgrade --verify --workdir '<مجلد العمل المعتمد>'
```

6. [220/181 إلى 222/182](UPGRADE222_AR.md). Backup220 وRestore مطابق، ثم dry-run وapply، ثم Backup222 وRestore وverify-only. انتظر `complete:true`.
7. [222/182 إلى 223/183](UPGRADE223_AR.md). أكمل النسخة والاسترجاع وverify-only لكل مرحلة. طابق التقرير بالنسخة قبل المتابعة.
8. [223/183 إلى 224/184](UPGRADE224_AR.md). نفّذ `--preflight-registration` على 223 قبل Backup223، ثم اتّبع دليل 224 حتى `complete:true`.
9. [224/184 إلى 225/185](UPGRADE225_AR.md). نفّذ `--preflight-registration` على 224 قبل Backup224، ثم اتّبع دليل 225 حتى `complete:true`. عند `SQL_APPLIED_REGISTRATION_PENDING` استعمل أمر الاستئناف في دليل الإصدار نفسه. أوقف الكتابات حتى اكتمال الحماية.
10. أعد مطابقة مرجع D−1/225 المحضّر مع SHA هذا القطع وبصمته. إذا تغيّر الرأس أو المرجع، أوقف القطع حتى إعداد المرشح والتحقق منه من جديد.

## 3. حجز RESET والنسخة الفاصلة وفحص الصلاحية

11. شغّل [فحص قدرة Storage للقراءة فقط](RESET224_STORAGE_CAPABILITY_READ_ONLY.sql) بدور تنفيذ RESET. النتيجة المطلوبة `actor=postgres` و`session_actor=postgres` و`policy_configuration_allows=true`. إذا غاب الصف أو كانت القيمة مختلفة، توقّف قبل أي تصفير. يفحص RESET225 قدرات إعادة البناء أيضاً. أي رفض من الحارس يوقف التنفيذ.

```powershell
node scripts/operations/frankfurt-owner-cutover-hold225.mjs --hold-reset --plan --workdir '<مجلد العمل المعتمد>'
node scripts/operations/frankfurt-owner-cutover-hold225.mjs --hold-reset --dry-run --workdir '<مجلد العمل المعتمد>' --verify-report '<تقرير verify-only225>'
node scripts/operations/frankfurt-owner-cutover-hold225.mjs --hold-reset --apply --workdir '<مجلد العمل المعتمد>' --verify-report '<تقرير verify-only225>'
node scripts/operations/frankfurt-owner-cutover-hold225.mjs --hold-reset --verify --workdir '<مجلد العمل المعتمد>'
```

12. تحقق من بقاء cleanup وحدها نشطة وفق الحجز، ومن غلق الطلبات. أثبت وقت آخر كتابة. خذ Backup225 فاصلة واسترجعها واعتمد البصمة وتقرير التطابق. احفظ النسخة الفاصلة مستقلة عن نسخة «بداية حقيقية». إذا فشل الاسترجاع أو حصلت كتابة جديدة، أوقف التصفير.

```powershell
powershell.exe -NoProfile -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Status
powershell.exe -NoProfile -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Backup -Apply
powershell.exe -NoProfile -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Upload -Apply
powershell.exe -NoProfile -File scripts/operations/frankfurt-backup-owner.ps1 -Mode VerifyRemote -Apply
powershell.exe -NoProfile -File scripts/operations/frankfurt-backup-owner.ps1 -Mode RestoreRemote -Apply
```

أوامر النسخ الرسمية تعمل بـ`powershell.exe` كما هي؛ أي سكربت تشغيل خارجي يُشغّل بـ`pwsh` 7 أو يصرّح `UTF8` عند قراءة JSON والمسارات العربية. أداة النسخ الرسمية تقرأ JSON بترميز UTF8 صراحةً؛ لا تستبدلها بقراءة `Get-Content` الافتراضية في PowerShell 5.

13. اتبع [RESET225](RESET225_OWNER_AR.md) بالترتيب plan ثم dry-run ثم apply بعد توقيع المالك. النتيجة `ok:true` و`complete:true` و225/185. عند توقف جزئي راجع التقرير واستعمل الاستئناف الرسمي عند السماح به. بعد قبول RESET وإذن النشر المستقل، اعزل المعاينات وانشر الإدارة والمتجر والطلبات مغلقة وفق بوابات الهوية وAuth وEdge وTurnstile وverify-dist في [المرجع التاريخي، القسم 8](GO_LIVE_CUTOVER_OFF_ARCHIVE_AR.md#8-النشر-على-مرحلتين--بعد-كلمة-انشر-فقط). استخدم تسلسل ON الوارد هنا. تحقق من الدخول وTOTP وغلق الطلبات، ثم وقّع **«الوضع ON مُثبت»** قبل إدخال البيانات.

## 4. الاستيراد ثم تثبيت الجرد الافتتاحي

14. من الإدارة، طابق المستودعات ووحدات الباكيت والكرتونة والصندوق والشرنك والكيس والعلبة والربطة والشوال. طابق 15 اسماً حرفياً وأعد استخدام أقسام CAT-* الموجودة. أضف الأقسام الثلاثة الخاصة «بسكويت 10 قروش» و«شوكلاتة غوالي» و«أخرى» عند الحاجة، وأخفِ الأقسام القديمة الفارغة. أي قسم مكرر أو رمز مجهول يمنع الاستيراد.
15. من «بداية التشغيل» اختر استيراد المنتجات والنكهات. ارفع `المنتجات.xlsx` الناتج من محوّل ON، راجع المعاينة واحفظ. طابق 1192 سجلاً و1084 قابلاً للبيع، والأسعار والوحدات والباركود. صور المنتجات لاحقاً حسب خطة المحل. إذا رفضت الشاشة ملفاً، احفظ تقرير الصفوف وأصلح مدخلات التحويل.
16. ارفع `البضاعة-الموجودة.xlsx` لكل مستودع من مسار الجرد الافتتاحي في الشاشة. راجع وحدات الشراء والمفرد والتكلفة بالباكيت والقيمة الإجمالية قبل الحفظ. طابق رصيد كل مستودع وWAC بعد الحفظ. التكلفة الصفرية مع رصيد موجب تمنع المتابعة. راجع فروق التقريب في تقرير المحوّل. لا تسجل فاتورة شراء صورية لهذا الرصيد.
17. عدّ الدرج وافتحه على 0، واترك الديون والشيكات الافتتاحية فارغة. نفّذ مراجعة «افحص» ثم «إنهاء بداية التشغيل» بتأكيد الشاشة بعد مطابقة الأصناف والجرد. خذ نسخة «بداية حقيقية» واسترجعها قبل أول بيع.

## 5. القبول والفتح

18. بعد قبول الكتالوج يشغّل المالك مفتاح الطرد المشكّل إذا اختاره، ويجرب الأصناف والكميات وأسعار الطرد والمفرد. اختبر سلة متجر وPOS ووصلاً ومرتجعاً واستلاماً، وتحقق من الرصيد المحجوز والتكلفة وتقارير الوردية.
19. بعد قبول الكتالوج وإذن النشر المستقل، أعد بناء ونشر المتجر وحده بنفس SHA والطلبات مغلقة. قبل الفتح طابق هوية الهدف وverify-dist وSEO وproductRoutes وsitemapUrls. أوقف الفتح إذا نقصت مسارات أصناف مؤهلة أو بقيت إعدادات Edge وAuth وTurnstile دون تحقق.
20. شغّل التنبيهات بتوقيع المالك وبعد قبول المستلم. تنبيهات الشغل وملخص 00:00 بتوقيت عمّان لصاحب المحل، والتنبيهات التقنية للمطوّر. اختبر التوجيه دون بيانات تجريبية في الطابور. اعتمد [دليل Telegram المالك](FRANKFURT_OWNER_BUSINESS_ALERTS_AR.md) ومعاملات A وB أدناه و[تفعيل C الرسمي](OWNER_TELEGRAM217_ENABLE.sql).
21. افتح الطلبات بعد قبول النسخ والواجهات والبيانات. طابق أول طلب وبيع ورصيد متاح ودرج وقرار التسليم. إذا فشل القبول أغلق الطلبات واحفظ الأدلة. يحدد المالك الرجوع من النسخة الفاصلة أو متابعة التصحيح. إذا بدأت مبيعات حقيقية، احفظها وراجعها قبل أي قرار استرجاع.

## معاملات التنبيهات المشتركة

تُنفّذ بعد قبول الجاهزية والوجهة وبإذن التشغيل. نص المعاملتين A وB محفوظ حرفياً.

A — يتحقق من العقد الحالي للـ scan ثم يفعله؛الغياب أو التكرار أو اختلاف الحالة/command يوقف المعاملة:

```sql
BEGIN;
DO $gate$
DECLARE j record;
BEGIN
 IF (SELECT count(*) FROM cron.job WHERE jobname='run-advanced-monitoring')<>1
 THEN RAISE EXCEPTION 'CUTOVER_SCAN_JOB_COUNT'; END IF;
 SELECT * INTO j FROM cron.job WHERE jobname='run-advanced-monitoring';
 IF j.active OR j.schedule<>'*/5 * * * *'
 OR regexp_replace(lower(j.command),'\s','','g')<>'selectpublic.run_advanced_monitoring_checks();'
 THEN RAISE EXCEPTION 'CUTOVER_SCAN_JOB_STATE'; END IF;
 PERFORM cron.alter_job(j.jobid,active:=true);
END $gate$;
COMMIT;
```

B — بعد البيانات الحقيقية وعزل preview وتجربة مستلم الأعمال،وطابور خالٍ من أحداث التجربة. طابق schedules مع [جرد المصدر](../../scripts/operations/build-cron-report.mjs) واللقطة المعتمدة؛لا تغيير لها هنا. تُراجع كل الأسطر قبل أول تفعيل:

```sql
BEGIN;
DO $gate$
DECLARE j record; expected text;
BEGIN
 IF (SELECT count(*) FROM cron.job WHERE jobname IN
 ('expire-stale-new-website-orders','scan-core-business-alerts','scan-business-summaries'))<>3
 THEN RAISE EXCEPTION 'CUTOVER_BUSINESS_JOB_COUNT'; END IF;
 IF (SELECT count(DISTINCT jobname) FROM cron.job WHERE jobname IN
 ('expire-stale-new-website-orders','scan-core-business-alerts','scan-business-summaries'))<>3
 THEN RAISE EXCEPTION 'CUTOVER_BUSINESS_JOB_NAMES'; END IF;
 FOR j IN SELECT * FROM cron.job WHERE jobname IN
 ('expire-stale-new-website-orders','scan-core-business-alerts','scan-business-summaries') LOOP
 expected:=CASE j.jobname
 WHEN 'expire-stale-new-website-orders' THEN 'selectpublic.expire_stale_new_website_orders(100);'
 WHEN 'scan-core-business-alerts' THEN 'selectpublic.scan_core_business_alerts(now(),100);'
 ELSE 'selectpublic.scan_business_summaries(now());' END;
 IF j.active OR j.schedule<>'*/5 * * * *'
 OR regexp_replace(lower(j.command),'\s','','g')<>expected
 THEN RAISE EXCEPTION 'CUTOVER_BUSINESS_JOB_STATE'; END IF;
 END LOOP;
 FOR j IN SELECT jobid FROM cron.job WHERE jobname IN
 ('expire-stale-new-website-orders','scan-core-business-alerts','scan-business-summaries')
 LOOP PERFORM cron.alter_job(j.jobid,active:=true); END LOOP;
END $gate$;
COMMIT;
```

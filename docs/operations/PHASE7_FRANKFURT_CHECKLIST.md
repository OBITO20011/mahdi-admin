# قائمة تجهيز Phase 7 — مشروع فرانكفورت

## قرار الترقيم الخطي2026-10-15

140–149 فجوة دائمة غير مستخدمة؛152–159 لمسارCodex،160–169 محجوزة لبداية
التشغيل التي تعيد ترقيم ملفاتها إلى160–162. لا دمج حالياً ولا--include-all.
راجع [ترتيب التطبيق والتكامل](MIGRATION_ORDER_151_160_AR.md). أمر المالك
الحالي139+150+151 فقط؛لا تغيير للسقف151. إطفاء **Allow new users to sign up**
مع إعادة تحميلAuth للتحقق إلزامي قبلstaging،كما هو مفصل أدناه.

## البوابة الحالية151 — أمر مستقل للمالك فقط

المرجع الحالي هو001–139 ثم150 و151، وليس138 أو150. راجع
[المرجع الجديد والأمر الواحد](FRANKFURT_REFERENCE_151_AR.md).
`node scripts/operations/frankfurt-owner-upgrade.mjs --apply` مخصص للمالك
بكلمة سره، لا ينفذه الوكيل. يطبق139+150+151 الناقصة ثم المواءمة الدقيقة
والتسجيل الرسمي وdry-run والتحقق الصارم من publication. يبقي التعليق
المؤقت للإشعارات وcron ولا يكتب أسراراً. الوضع الافتراضي/--dry-run أوفلاين.

## بوابة150 السابقة — سجل تاريخي، ليست تعليمات التشغيل الحالية

سُلّمت139 مستقلة3a3893b ثم150 مستقلة204f1ed،والعلاقات الصريحة746d6bc؛كلها
بوابات محلية وليست تطبيقاً على فرانكفورت. `frankfurt-align-acl --apply`
محظور برمجياً حتى قرار لاحق. المعاينة فقط بـ`--dry-run` تستهدف
`local-reference-001-139-150-ready.json` وترفض138؛لا تسحب القراءات المعتمدة.
راجع [نتيجة المعاينة وشروطها](FRANKFURT_ACL_ALIGNMENT_AR.md):462 أمراً
للمراجعة،مع139 كمتطلب مستقل وapplicationReady=false. لا تنفذ preview.sql.
التعليمات التاريخية أدناه ليست أمراً بتجاوز فشل preflight أو تطبيق بعيد.

## Auth قبلstaging — قرار المالك2026-10-15

أطفئ **Allow new users to sign up** فيAuth واحفظ ثمأعدتحميلاللوحة وتحقق
منبقاءالإيقاف؛التسجيلالذاتي ممنوع والموظفونينشئهمالمالك فقط. اضبط
**Site URL وredirect URLs** للنطاقات النهائية `admin.alnawasreh.com`
و`alnawasreh.com` ومساراتالعودةالمثبتةفيالتطبيق،لابدائلlocalhost أوpreview.
الحالةالفعلية تحتاجتأكيدالمالكمناللوحة؛لاوصولمنالوكيل ولاافتراضمنconfig.

## شرط إلزامي قبل بناء أي مشروع —2026-10-15

فيData API أطفئ **Automatically expose new tables** واحفظ،ثم أعد تحميل
اللوحة وتحقق أن المفتاح بقي مطفأً **قبل أولmigration**. لا تفترض أن الإطفاء
يسحب منحاًقديمة. المالك أطفأه فيnawasrah-fra والعدادات لم تتغير؛مواءمة
المنح القائمة مستقلة. هذايستبدل حالةauto-expose المفعّل بسجل الإنشاء أدناه؛
Data API نفسها ليست مطلوبة الإطفاء. راجع
[أداة المالك للمواءمة](FRANKFURT_ACL_ALIGNMENT_AR.md):معاينة بلا اتصال فقط
حالياً؛التطبيق وكلمة السر والتفعيل ليست ضمن هذا التسليم.

## 139 معتمدة2026-10-15 — تطبيق لاحق مستقل للمالك

راجع [عقد139 وأمر المالك](ORDER_PUSH_URL_139.md). بعد نجاح --verify-only138
وحسم الفروق الحقيقية فقط: `node scripts/operations/frankfurt-owner-build.mjs --apply-139`.
لا إعادة --apply001–138، ولا ربط الجذر. كلمة السر مخفية؛ تطبيق139 الأصلي
والتسجيل الرسمي وdry-run وفرق دالة واحد فقط، مع بقاء حجزtrigger/cron.
إعداد Vault `order_push_webhook_url` يُضبط على رابط فرانكفورت **عند التفعيل
فقط**، وليس في139 أو في تجهيز الليلة. بلا إعداد: لا إرسال ولا fallback قديم،
والطلب محفوظ مع تحذير. أداة --verify-only الحالية تبقى لمرجع138؛139 لها تقرير
مستقل `last-139-report.json`. تنفيذ الوكيل محلي معزول فقط.

## تحديث2026-10-15: بعد تطبيق المالك، تشخيص قراءة فقط

طبّق المالك138/138 وسجل138 وحجزtrigger/cron،لكنبوابةfull-catalogفشلت
ولمتُحفظالفروقفيالإصدارالأول. **لا إعادة--apply**. الأمرالحالي
`node scripts/operations/frankfurt-owner-build.mjs --verify-only` للمالك
فيTerminal؛لاlinkأوتغييرDB. يستخدمالربطالخارجيالموجودوكلمةسرمخفية،
ويتحققمنجلسةREADONLY. تفاصيلكلschema/object/type/local/remoteمحفوظةفي
catalog-differences.jsonوفيlast-verify-report.jsonحتىعندالرفض،معcatalog-observed.json
خارجGit. last-report.jsonالأصلييبقىكماهو. الفرقالمتوقعكتالوجياًواحد
للتريغر؛الأربعactive=falseتُفحصكبياناتجدولةمستقلةبأسمائهاوبقيةحقولها.
لااستثناءعاملمخططاتالخدمةأوموافقةضمنيةعلىفروقإضافية؛ننتظردليلالمالك.

**تحديث المالك2026-10-15:** أنشأ `nawasrah-fra`، المرجع
`kzevmysfydaslxcerogt` فيeu-central-1، Free/Nano؛ Data API وauto-expose
مفعّلان وautomatic RLS مطفأ، بلا GitHub link. تحقق CLI قراءة فقط من
الاسم/المنطقة/ACTIVE_HEALTHY وPG17.11.0.003 (البروفةPG17.6، نفس الرئيسي17).
ليس هذا تطبيقDB أو نشر. تجهيز المجلد الخارجي وأمر المالك وحراس034 والتتبع
والكتالوج والمرجع في [FRANKFURT_OWNER_BUILD_AR](FRANKFURT_OWNER_BUILD_AR.md).
لا تربط هذا المستودع بالجديد؛ يظل ربط النسخ القديم كما هو. عبارة «لم يُنشأ
مشروع» أدناه تصف حالة كتابة القائمة الأصلية فقط، لا الحالة الحالية.

تاريخ التوثيق: 2026-10-13. مرجع القراءة: commit `b211c33`، والسقف
في [project-state.json](../agent/project-state.json) هو **138**.
هذه قائمة عمل مستقبلية، لا إذن بتنفيذها: لم يُنشأ مشروع، ولم تُقرأ لوحة
Supabase/Cloudflare أو ملفات الأسرار المحلية، ولم يُنفَّذ نشر أو نقل بيانات.
كل خانة أدناه تحتاج دليلاً مؤرخاً واسم المشغّل والـSHA عند التنفيذ المعتمد.

المصدر هو المستودع فقط؛ معلومات الحساب والخطة والمنطقة والحدود والإعدادات
الحيّة **يحتاج تأكيد من لوحة Supabase**. وجود كود أو CI أخضر لا يثبت إعداد
مشروع جديد. README التي تصف 001–111 تاريخية؛ لا تجعلها سقف هذه البروفة.

## 0. حدود الدخول وخطة البيانات

- [ ] موافقة المالك على مشروع جديد في فرانكفورت على الخطة المجانية،
  واختيار هدف اختبار/تشغيل مسمّى ونافذة التحويل. المرجع:
  [OWNER_DECISIONS](../agent/OWNER_DECISIONS.md). المنطقة الفعلية والخطة
  وproject ref ونسخة PostgreSQL وإتاحة الإضافات: **يحتاج تأكيد من لوحة Supabase**.
- [ ] حسم هل المطلوب قاعدة فارغة أم استيراد بيانات مع cutoff ومصالحة.
  لا يُفترض نسخ كل بيانات المشروع القديم. حزمة الأرصدة وExcel والجرد
  الافتتاحي مؤجلة لآخر خطوة قبل التشغيل؛ لا ينفذها هذا الدليل.
- [ ] الاحتفاظ بالمشروع القديم والنسخ السليمة إلى نهاية التحقق وموافقة
  مستقلة على الحذف؛ لا حذف تلقائي بعد النشر.
- [ ] تسجيل snapshot لإعدادات التشغيل السابقة بطريقة محمية، دون قيم أسرار
  في Git أو التقرير. أي مشروع/مفتاح/ربط CLI جديد يراجع بمقارنة الوجهة لا بالطباعة.

**التحقق:** محضر هدف واضح، SHA مقبول بـfull CI + secrets، وقرار البيانات
والـcutoff. لا يُسمح بالتحويل إن بقيت وجهة أو سياسة بيانات غير محسومة.

## 1. قاعدة البيانات — 001–138 بالترتيب

- [ ] تجهيز extensions التي يطلبها التاريخ: `pgcrypto`،
  `pg_net`، `supabase_vault`، `pg_cron`. توفرها وصلاحية تثبيتها
  في المشروع الجديد **يحتاج تأكيد من لوحة Supabase**.
- [ ] تطبيق كل ملف في الملحق بالترتيب الرقمي مرة واحدة، بلا فجوات أو تكرار،
  مع توقف فوري عند خطأ. لا تعديل 001–138 ولا text-patching ولا تنفيذ seed
  تجريبي أو دمج تاريخي عشوائي. 123–127 مطلوبة أيضاً في السلسلة، رغم أن 132
  تسحب الطبقة الخاصة؛ لا تُحذف من history.
- [ ] **بوابة بناء مهمّة:** `034_prelaunch_test_data_cleanup.sql` تجري
  TRUNCATE. الـbootstrap المعزول يضيف إلى **نسخة مؤقتة فقط** جداول مرجعية
  (`supplier_return_items/supplier_returns/stock_count_items/stock_counts`)
  لمعالجة compatibility التاريخية. لا يُنقل هذا الترقيع إلى مشروع مُدار
  ولا يُعدّل التاريخ بناءً على نجاح الاختبار المحلي. إجراء بناء Managed
  001–138 بلا تعديل تاريخي يحتاج بروفة وخطة معالجة معتمدة؛ عند الفشل توقف.
  المستودع لا يقدم في هذا الدليل إثباتاً حيّاً لذلك: **يحتاج تأكيد من لوحة Supabase**.
- [ ] مقارنة history، التعريفات النهائية والتواقيع وowners وgrants وRLS،
  وعدم وجود `phase5_private` بعد 132. المرجع
  [DB_FUNCTIONS](../generated/DB_FUNCTIONS.md) للصيانة، **ليس سكربت تطبيق**.
- [ ] مراجعة المرجعيات المطلوبة للتشغيل: الأدوار، الفرع، المستودع، الأقسام
  والوحدات. `supabase/seed.sql` يجمع بيانات تأسيس وبيانات اختبار، ومنها
  brands تجريبية؛ لا يُطبق كبيانات المحل تلقائياً. تعتمد قائمة المرجعيات
  الفعلية وإجراء إدخالها مع المالك قبل اختبار حسابه الأول، دون افتراض أن
  migrations وحدها تعبئ كل مرجعيات المتجر.
- [ ] على نسخة بروفة معزولة: اليوم الكامل `test:package-e:golden`،
  supplier/closing، aftercare/parcel/POS، وقراءات135/aging136/filters137/
  statement138. CI الحالي يحتوي العقود؛ لا تغيير الاختبارات أو مهلاتها.
- [ ] تحقق أدلة كل التاريخ في البروفة وفق قرار 134 قبل التحويل؛ مراقبة آخر
  7 أيام لا تقوم مقامه. طريقة استدعاء كل verifier من العقود الحالية
  واختباراته، دون كشف الأدلة المالية في قناة التنبيه.

**التحقق:** 138 ملفاً مطابقاً للملحق والبصمات، grants/RLS مطابقة،
golden reconciliation وDB lint والعقود كلها ناجحة. لا `db reset` على
هدف التشغيل، ولا إدراج مباشر لتسوية رصيد أو تجاوز فشل migration.

### خطوة البيئة034 — اعتماد المالك2026-10-14، مشروع فارغ فقط

**تحديث اعتماد2026-10-14 — ما قبل034:** لا مسح يدوي. الجداول الأربعة
`supplier_returns/supplier_return_items/stock_counts/stock_count_items` يجب
أن تكون فارغة بالكامل. باقي مجموعةTRUNCATE تسمح فقط بصفوف زرع تاريخية
مطابقة حرفياً محددة مسبقاً، وأي عدد أو صف آخر يرفض بالجدول. هذا القرار
يحل محل شرط الفراغ الشامل قبل034، وطُبّق في السكربت مع استثناء audit
المعتمد أدناه. البروفة لازمة قبل القبول؛ لا تُحذف بيانات فعلية أو تعدّل migrations.

قائمة صفوف الزرع المسموحة، مصدرها `008_purchase_orders.sql:206–212` فقط:

| الجدول | العدد بالضبط | الاسم | الهاتف | الرقم الضريبي |
| --- | --- | --- | --- | --- |
|suppliers|صف لكل اسم؛ المجموع2|شركة الأردن التجارية المحدودة|0791234567|102938475|
|suppliers|صف لكل اسم؛ المجموع2|مجموعة البركة للتوريدات العمومية|0788765432|987654321|

المطابقة تشمل أيضاً contact_person/email/address بالنصوص الأصلية لنفس
INSERTين، ولا تسمح بأرصدة أو معاملات أو حقول أعمال مخالفة للقيم الابتدائية.
لا توجد صفوف مسموحة معلنة في أي جدول آخر من مجموعةTRUNCATE؛ لا تُضاف
قائمة أخرى بمجرد أنها تشبه بيانات تجربة. UUID/أوقات الإدراج تولدها defaults
ولا تكون معياراً لتخمين أن صفاً فعلياً «تجريبي»؛ الاختبار على مشروع بدأ
فارغاً بالسكربت فقط، والمطابقة الكاملة والعدد والتاريخ المصدر إلزامية.

**شرط ما بعد034 المعتمد2026-10-14:**034 الأسطر61–73 تُدرج بعدTRUNCATE في
audit_logs سجل `PRELAUNCH_TEST_DATA_CLEANUP`، entity_name=`system`،
user_id/entity_id=NULL، details تحتوي أعداد التنظيف وcleaned_at. لذلك لا
يمكن اشتراطCOUNT=0 لهذا الجدول بعد إكمال034 مع حفظ الملف الأصلي.
صفر لكل جداول الأعمال، وسجل audit الوحيد هذا مطابقاً لأعداد ما قبل
التنظيف الملتقطة تحت الأقفال، وcreated_at وcleaned_at بوقتtransaction
الأصلية؛ action/entity/NULLs/ip_address مطابقة. أي سجل/حقل آخر يرفض.
لا مسح سجل التدقيق أو تعديل034. هذا الشرط مباشرة بعد034 وقبل إعادة
القيود فقط، وليس بعد035–138 التي قد تضيف سجلات تدقيق مشروعة.

البروفة ومقارنة الكتالوج والمرجع والجودة الكاملة لازمة؛ وجود السكربت
وحده ليس إثباتاً ولا موافقة تفعيل مشروع خارجي.

**نتيجة البروفة2026-10-14:**001–138 نجحت ومعها حراس الزرع/audit/القيود؛
المقارنة الكاملة توقفت عند7 فروق فقط فيsupabase_migrations: المخطط
وجداولschema_migrations/seed_files مع مفاتيحها وفهارسها، لا فرق في
مخطط التطبيق/دواله/صلاحياته. لم تُستبعد الفروق، ولم تُنشأ metadata أو
يسجّلhistory من السكربت بعد. إنشاء البنية المطابقة وتسجيل الملفات التي
نجحت فعلياً فقط يحتاج قراراً؛DB_FUNCTIONS والجودةالكاملة لم يبدآ بعده.
تفاصيل الدليل والأعداد فيPRE_FRANKFURT_READINESS،لا يُعد نجاح138 تسليماً.

**تحديث النتيجة النهائي للبناء2026-10-14:**استُخدمت CLIrepair الرسمية
بعد كلملفناجح بالترتيب138/138؛migrationlist نجحت والتحققالمكافئمنجدول
التاريخ يطابقالملفاتحرفياً؛dbpush --local --dry-run --skip-vault لايطبق
شيئاً.seed_files0 لأنseedلميشغّل. المقارنةالكاملةمعbootstrap أصبحت0
فروق،بلااستثناءmetadata. أضيفتعندغيابها بنيةseed_filesالفارغةالمطابقة
فقط؛repairلاينشئهابلاseed،ولاوجودلصفوفمزورة. نتيجة7فروقالسابقة تاريخية.
DB_FUNCTIONS والجودةوالتسليملازمةبعدهذاالبناء؛لاإذنمشروع/نشرفعلي.

**نتيجةالمحطة2026-10-14:**DB_FUNCTIONS PASS410 بعدالبناءالمعزول138.
الجودةالكاملةالمحلية توقفت فيisolated-vite-cache عندB-lucide-react
readiness:1025/1026وحدةAdminناجحة،ولاوحداتCustomer/بناء/متصفح بعدها.
لااعتمادتشغيل/تسليمفرانكفورت؛تشخيصالسببومتابعةالبواباتيحتاجان قراراً.

السكربت الوحيد `scripts/operations/build-empty-supabase.mjs` يبني001–138
من الملفات الأصلية. للبروفة يستخدم حاوية اختبار مسماة؛ في فرانكفورت لاحقاً
يستخدم psql وPGSERVICE خارجي محمي، **بموافقة نشر مستقلة**. لا URL أو
كلمات مرور في أوامر أو تقارير، ولا تنفيذ خارجي ضمن محطة الفحص الحالية.

```sh
node scripts/operations/build-empty-supabase.mjs --container supabase_db_nawasrah-empty-build-rehearsal-test --cli-workdir PATH_TO_ISOLATED_PROJECT
# لاحقاً فقط بعد اعتماد الهدف الفارغ وPGSERVICE خارج المستودع:
node scripts/operations/build-empty-supabase.mjs --psql-empty-target --confirm-empty-project
```

يرفض المشروع إذا وجد جدولpublic أو مستخدمAuth قبل001. قبل034 يقفل
الجداول28 ويشترط COUNT=0 لكل منها عدا صفّيsuppliers المطابقين للقائمة،
ثم يلتقط تعريف واسم وجدول وخصائص
DELETE/UPDATE/DEFERRABLE/validated للأربعة، ويتحقق منها قبل أي DROP.
يرفض أي بايت034 غير بصمته المثبتة، ولا يغيّر SQL أو يضيف CASCADE.
المطابقة بعد الاستعادة JSON حرفية، وvalidated=true إلزامي قبل035.
أي فشل = توقف، ولا يجوز بدء تطبيق عبرCLI بالتوازي أو إعادة تطبيقه على
قاعدة مستخدمة. بعد نجاح ملف فعلياً، وقبل الملف التالي، يُنفَّذ رسمياً
`migration repair --local --status applied NNN` ضمنworkdir المطابق للحاوية.
ملفات workdir يجب أن تطابق بايتاتالمصدر. لا linked ولا اتصال خارجي
ضمن البروفة. failureSQL أوrepair يوقف المتابعة؛ لا history متقدماً عنSQL.
بعد البناء migrationlist تُثبت138 وdbpush --local --dry-run --skip-vault
تثبت عدم أي pendingmigration، دون تحديث أسرارVault أو نشر.

إذاrepair لا ينشئseed_files (وهو لا يسجل seed لم يُشغّل)، تُضاف **البنية
الفارغة فقط عند غيابها** بتعريفCLI الملتقط منbootstrap، ولا تُدخل أي
صفseed. وضعPGSERVICE المستقبلي ليسربطCLI أوURL؛ لتجنب أي secret علىargv
يستخدم fallback لبنيةCLIالمطابقة وتسجيل الملفالناجح. اختيار/اتصالالهدف
الخارجي والتحقق منه فيPhase7 فقط؛ لا يُنفّذ ضمن البروفة الحالية.

**حدّ transaction المعلن:** فحص الفراغ والحذف و034 في transaction
تنهيهاCOMMIT الأصلية داخل034. الاستعادة والتحقق في transaction ثانية؛
BEGIN الأصلية داخل transaction مفتوحة لا تنشئ transaction متداخلة.
لا يمكن إبقاء الثلاثة فيtransaction واحدة دون تعديل أو تجاوزCOMMIT
التاريخية. عند خطأSQL يحاول السكربت استعادة القيود المفقودة تلقائياً
من اللقطة ويؤكد المطابقة؛ أي فشل استعادة يمنع اعتبار المشروع صالحاً.
انقطاع العملية/الاتصال/الطاقة بعدCOMMIT وقبل الاستعادة لا يضمن تعويضاً
آلياً؛ المشروع يجب أن يبقى بلا مستخدمين/واجهات حتى اكتمال البروفة والتطابق.
لا يُستخدم هذا الاستثناء على قاعدة حية أو لتجاوز رفض جدول غير فارغ.

البروفة والمقارنة الآلية:
`node scripts/testing/run-empty-project-build-runtime.mjs`، ثم
`npm run docs:db-functions:check`. النتائج المؤرخة في
[PRE_FRANKFURT_READINESS](PRE_FRANKFURT_READINESS.md)، وليست موافقة نشر.

**التاريخ منGit فقط:**010 أُضيفت مع قيودها في
`908e8ba9832087a4f938f07b8e7480d62ef70cf1` بتاريخ2026-07-25، و034 أُضيفت
في`2fb2c9b27030be4c2ea0d9ac7b76dfdd19b87d41` بتاريخ2026-08-22.
نسخة010 في commit034 تتضمن القيود بالفعل؛ لا دليل أنها أُضيفت بعد034.
Git لا يسجل جلسةSQL التاريخية للموقع القديم أو كيفية تنفيذ034/تجاوزها،
لذلك طريقة تطبيقها فعلياً **غير مثبتة**؛ لم نفحص أي مشروع حي.

## 2. Auth والحسابات

مصدر الإعداد المقصود [supabase/config.toml](../../supabase/config.toml)،
وليس دليلاً على إعدادات Dashboard الحالية:

- [ ] `site_url` الحالي محلي، و`additional_redirect_urls` فارغة:
  اعتماد URL للإدارة ومسارات الرجوع الفعلية في التشغيل، لا نسخ localhost.
  قائمة redirect النهائية **يحتاج تأكيد من لوحة Supabase**.
- [ ] `auth.enable_signup=false`، لكن `auth.email.enable_signup=true`
  أيضاً موجودة. لا تُحسم الدلالة الفعلية أو سياسة إنشاء الحسابات بالتخمين:
  **يحتاج تأكيد من لوحة Supabase**. لا فتح تسجيل عام؛ إنشاء الموظفين
  يبقى عبر `manage-staff-users` والأدوار والتحقق الحاليين.
- [ ] `auth.email.enable_confirmations=true`، `max_frequency`،
  `otp_length` وفق config. SMTP/المرسل والقوالب وتسليم البريد ومهلة
  JWT وسياسات refresh وكلمة المرور وrate limits غير مفصّلة هنا:
  **يحتاج تأكيد من لوحة Supabase**. لا تخفيفها لتحسين نجاح الاختبار.
- [ ] CAPTCHA مفعّل بمزود Turnstile؛ اسم سر config هو `TURNSTILE_SECRET`.
  الـsite key العام لتسجيل الإدارة يأتي من
  `src/config/supabase-public-config.ts`، وليس متغير VITE جديداً.
- [ ] TOTP: `enroll_enabled=true` و`verify_enabled=true`.
  إعادة تهيئة MFA على المشروع الجديد واختبار AAL2 في الأعمال المحمية،
  لا نقل عوامل/جلسات قديمة أو الكتابة في Auth internals.
- [ ] إنشاء المالك الأول عبر إجراء Auth مدعوم، ثم ربط UUID بالـprofile
  والدور والفرع اعتماداً على خطة تأسيس معتمدة. لا توجد هنا وصفة موثقة
  كافية لتأسيس أول owner بقاعدة فارغة: **يحتاج تأكيد من لوحة Supabase**.
  عند نقل بيانات قديمة، يجب mapping معتمد، لا تغيير UUID عشوائياً.
- [ ] اختبار موظف نشط، غير نشط، بلا دور، ودور أقل، وMFA قبل قراءة البيانات،
  وحفظ الملف الشخصي/تغيير البريد/نسيان كلمة المرور. لا صلاحيات احتياطية.

**التحقق:** الدخول وCAPTCHA وTOTP فعلياً، ورفض غير المخوّل؛ طلبات الإدارة
تصل للمشروع الجديد فقط. الأرشيف الحالي لا يحتوي Auth users/passwords/
sessions/MFA؛ لا يعد backup public نسخة Auth قابلة لاسترجاع الحسابات.

## 3. Edge Functions وأسماء الإعدادات فقط

تنشر النسخ من `supabase/functions/` على المشروع الجديد بإذن منفصل.
`SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY` أسماء يقرأها
الكود؛ توفرها ونوع المفاتيح المتوافق في بيئة Edge **يحتاج تأكيد من لوحة Supabase**.
لا توضع service-role أو أي سر خاص في build الواجهتين.

| الوظيفة | verify_jwt في config | الأسماء التي تحتاج مطابقة |
|---|---|---|
| `submit-guest-order` | false | `SUPABASE_URL`، `SUPABASE_SERVICE_ROLE_KEY`، `TURNSTILE_SECRET_KEY`، `GUEST_ORDER_HASH_SECRET`؛ إعدادا `TURNSTILE_ALLOWED_HOSTNAMES` و`TURNSTILE_TEST_MODE` |
| `admin-ai-assistant` | true | `SUPABASE_URL`، `SUPABASE_ANON_KEY`؛ `GEMINI_MODEL` اختياري؛ **بقرار المالك ينشر دون `GEMINI_API_KEY`** |
| `manage-staff-users` | true | `SUPABASE_URL`، `SUPABASE_ANON_KEY`، `SUPABASE_SERVICE_ROLE_KEY` |
| `send-order-push` | false | `SUPABASE_URL`، `SUPABASE_SERVICE_ROLE_KEY`، `WEB_PUSH_VAPID_PUBLIC_KEY`، `WEB_PUSH_VAPID_PRIVATE_KEY`، `WEB_PUSH_SUBJECT` |
| `n8n-alert-feed` | false | `SUPABASE_URL`، `SUPABASE_SERVICE_ROLE_KEY`، `NAWASRAH_AUTOMATION_SECRET` |

- [ ] لا Gemini secret أثناء هذا التسليم. الكود يدعم ردوداً حتمية وبعض قراءات
  الأعمال قبل مسار Gemini؛ طلب يحتاج النموذج يرجع 503 عند غياب المفتاح.
  لا يُدّعى أن كل المساعد معطل أو أن كل الطلبات ستنجح.
- [ ] `GUEST_ORDER_HASH_SECRET` يتطلب طولاً لا يقل عن 32 حسب البوابة؛
  يجهز سرياً خارج Git. لا مفاتيح اختبار Turnstile في التشغيل،
  ولا تفعيل test-mode؛ `guest-order` هو action العميل و`admin_login` للإدارة.
- [ ] نشر الوظيفتين الأخريين والـpush والـfeed عند اعتماد تشغيل المستخدمين
  والتنبيهات؛ لا اعتبار نشر guest/AI وحدهما تجهيزاً لكل التكاملات.
- [ ] Vault يحتفظ بـ`order_push_webhook_secret` الذي يولّده033؛
  `send-order-push` يقرأه بـ`get_push_webhook_secret` ويقارن
  ترويسة `x-order-push-secret`. **لا تعرض decrypted_secret** للتحقق.
- [ ] مفتاح VAPID العام في `src/services/pushNotifications.service.ts`
  ثابت في المصدر. يجب أن يطابق زوج Edge المعتمد؛ تغيير الزوج يحتاج
  خطة إعادة الاشتراكات، لا نسخ اشتراكات مستخدمين قدامى عشوائياً.

**التحقق:** guest V2 صالح + replay بلا طلب مكرر، CAPTCHA/Origin/غياب
contractVersion مرفوضة؛ staff بلا JWT/دور كاف مرفوض؛ AI يرفض غير المخوّل
ويعطي الرد الحتمي أو 503 المتوقع دون الاتصال بـGemini. push بتفويض صحيح
يسلم مرة واحدة والخاطئ يرفض. feed health بترويسة السر الصحيحة ينجح، والخاطئة
ترجع401؛ اختبارات claim/complete مع event synthetic فقط في البروفة.

## 4. cron والتنبيهات

### قرار2026-10-15: حجز مؤقت بعد138 قبل cutover

المعتمد في سكربت بناء **فرانكفورت الجديد فقط**: حفظ `notification-before.json`
و`restore-notifications.sql` خارج المستودع قبل التغيير. في transaction واحدة
SERIALIZABLE يقفلorders لتعديل trigger فقط، ويعيد فحص التعريفات والحالات
الملتقطة. لا قفل مباشر علىcron.job ولا زيادة صلاحيات؛ يستخدم الواجهة الرسمية:

```sql
ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;
-- لكل jobid محفوظ من الأسماء الأربعة أدناه:
-- SELECT cron.alter_job(<saved_jobid>, active := false);
```

الأسماء: expire-stale-new-website-orders، scan-core-business-alerts،
scan-business-summaries، run-advanced-monitoring. تبقى cleanup فعالة؛ لا
unschedule ولا تغيير schedule/command/owner/host/port أو صلاحية. التحقق
يقارن كل صفوف cron.job كاملة قبل/بعد، مع تبديلactive للأربع فقط؛ كتالوج
البناء كله يبقى مطابقاً سوى `enabled:O→D` للتريغر المحدد. لا استبعاد مخطط.

**العكس الدقيق (ليس الآن، وليس تلقائياً):** بعد قرار المالك واختبار139
وتجهيز الوجهة الجديدة والمستهلك، شغّل الملف المولد بنفس اتصال PostgreSQL
17 الموثق، من مجلد العمل الخارجي، وكلمة السر تفاعلية:

```powershell
& "$env:LOCALAPPDATA/NawasrahBackup/postgresql-17.11/bin/psql.exe" -h <نفس-session-pooler> -p 5432 -U postgres.kzevmysfydaslxcerogt -d postgres -W -X -v ON_ERROR_STOP=1 -f C:/Users/TOP/NawasrahFrankfurt/nawasrah-fra-001-138/restore-notifications.sql
```

لا تكتب كلمة السر في السطر أو env دائم. الملف محروس: يتأكد أن التريغر
ومهامcron ما زالت مطابقة لحالة الحجز، ثم ENABLE TRIGGER ويعيدactive=true
للمعرفات الأصلية الأربعة، ويتحقق منsnapshot الأصلي حرفياً ويعملCOMMIT؛
أي اختلاف يوقفtransaction بلا تصحيح. إذا غيّرت139 نفس التريغر أو تعريفات
cron، يفشل الحارس عمداً ويحتاج اعتماد مسار عكس مطابق للحالة الجديدة.

**مقترح139 فقط، لا تنفيذ:** CREATE OR REPLACE صريح لجسم
`enqueue_order_push_webhook(jsonb)` ليقرأ HTTPS endpoint من إعداد موثوق
مقيد للمالك/خدمة النشر (مثلاًVault باسم إعداد مستقل)، دون كشف السر أو
التغيير في الأدوار/grants/search_path/حمولةالتنبيه. غياب/عدمصلاحيةالإعداد
يرفض enqueue ولا يعود للقديم. يُحفظ wrapper trigger المبتلع للأخطاء كما
هو حتىلايفشلالطلب. اختباراتمعزولة: إعدادناقص/وجهةخاطئة→لاHTTP، وجهة
اختبارمحلية→نفسbody/headers/grants، anon/authenticatedمرفوضان للدالة
الداخلية، وزرالاختباروالتريغر يستخدماننفسالوجهة. لا cutover قبل قرار139.

بحث جميع001–138 وكل410تعريفاتpublic فيDB_FUNCTIONS وجد الرابط/مرجع
القديم فقط في033/`enqueue_order_push_webhook`; لا مرجعقديم في أوامرcron
الخمسة (تُقرأأيضاًفيالبروفة). روابطGoogleMaps ليستمراجعSupabase ولا
استدعاءاتHTTPمنقاعدةالبيانات. `send_test_push_notification()` يستدعي
دالةenqueue مباشرة؛ تعطيلtriggerلايعطله: ممنوعاختبارPush/فتحالتشغيل
الفعليقبل139.033تنشئسرWebhookتلقائياً،فلايعتمدالأمانعلىغيابالإعداداليدوي.

النص التالي يسجل وقفة ما قبل اعتماد الحجز، وقد حُسمت بهذا القرار:

**وقفة تجهيز 2026-10-15:** آثار migrations الأصلية معتمدة، لكن تدقيق
الأثر الخارجي يستلزم قراراً قبل اعتماد البناء. أربع مهام أدناه (كلها عدا
cleanup) تنتج طابور تنبيهات، بما فيها expiry عبر trigger097؛ لا HTTP مباشر
منها. اقتراح تعطيلها مؤقتاً قبل ربط المستهلك لم يُنفذ. خطر033 مستقل:
trigger إدراج طلب متجر يستهدف Edge في المشروع القديم عبر HTTP وسر مولّد
داخل migration؛ عدم نشر Edge الجديد ليس حاجزاً له. يلزم قرار تعطيل هذا
trigger مؤقتاً قبل اختبار طلب متجر. لا تعديل تاريخي أو تعطيل فعلي الآن.
راجع [دليل المالك](FRANKFURT_OWNER_BUILD_AR.md)؛ لا تشغّل --apply حالياً.

هذه الوظائف تضيفها migrations؛ لا تنشئ نسخاً ثانية يدوياً:

| jobname | الجدول | الاستدعاء |
|---|---|---|
| `expire-stale-new-website-orders` | `*/5 * * * *` | `expire_stale_new_website_orders(100)` |
| `cleanup-guest-order-gateway-requests` | `2,17,32,47 * * * *` | `cleanup_guest_order_gateway_requests(500)` |
| `scan-core-business-alerts` | `*/5 * * * *` | `scan_core_business_alerts(NOW(),100)` |
| `scan-business-summaries` | `*/5 * * * *` | `scan_business_summaries(NOW())` |
| `run-advanced-monitoring` | `*/5 * * * *` | `run_advanced_monitoring_checks()` |

- [ ] مقارنة `cron.job` بالخمسة وبـrun details بعد الدورة؛ صلاحيات
  الوظائف الداخلية غير متاحة للمتصفح. timezone Scheduler الفعلي
  **يحتاج تأكيد من لوحة Supabase**؛ حساب summaries يستخدم `Asia/Amman`.
- [ ] مراجعة `business_alert_settings` وملكية Business recipient.
  المصدر يوثق summary يومياً08:00 وأسبوعياً الاثنين09:00 بتوقيت عمّان؛
  القيم الفعلية والاستلام **يحتاج تأكيد من لوحة Supabase**.
- [ ] فحص `integrity:aftercare:durable-evidence` في134 لآخر7 أيام
  يعيد النتيجة بين الدورات لمدة6 ساعات؛ CRITICAL عند خلل، وتحذير التقارير
  عند فشل/غياب/قدم أكثر من24 ساعة. لا تعطيل تحقق الكتابة121/122/132.
- [ ] تحديث وجهة `n8n-alert-feed` في التكامل المحمي على جهاز المحل، وتطابق
  `NAWASRAH_AUTOMATION_SECRET` مع encrypted Header Auth الحالي.
  n8n لا يستلم database password أوservice_role. قناة Business منفصلة
  عن bot المطور؛ المستلم الحقيقي لا يُحفظ في الوثائق.

**التحقق:** لا missing/stale/failed jobs، وhealthy integrity، واختبار فشل/
تعافٍ synthetic بإذن المالك يعطي تنبيهاً واحداً لكل انتقال، بلا بيانات عميل.
مرجع [n8n](../../automation/n8n/README.md) و[runbooks](MONITORING_RUNBOOKS.md).

## 5. Storage

- [ ] bucket الوحيد المثبت بإنشاء في التاريخ: `product-images`، public،
  حد5242880 bytes، وMIME JPEG/PNG/WebP وفق020.
  مقارنة policies النهائية بعد كل migrations، لا إضافة bucket بديل تخمينياً.
- [ ] تحميل/تحديث/حذف بالـERP role والـuser folder كما policies؛ anon يقرأ
  الصور العامة ولا يكتب. رفع صورة مسموحة/ملف مخالف ودور غير مخوّل في البروفة.
- [ ] إن نُقلت الصور، نقل bytes والتحقق من checksum وإعادة ربط URLs المعتمدة؛
  روابط الصور القديمة لا تُصلح تلقائياً بتغيير متغير اتصال المتصفح.
  أي bucket إضافي خارج التاريخ **يحتاج تأكيد من لوحة Supabase**.

**التحقق:** public image GET ناجح، anon write ودور غير مخوّل مرفوضان،
حدود النوع/الحجم صحيحة، ولا رابط للصور يعتمد على مشروع سيحذف.

## 6. Cloudflare Pages ومتغيرات الواجهتين — أسماء فقط

لا تعديل Cloudflare في هذه المهمة. أسماء المشاريع الموجودة:
`nawasrah-admin` و`nawasrah-store`؛ التطبيقان ينتهيان إلى `dist`
ضمن جذر كل تطبيق. المتجر build يضيف SEO؛ إعداد الجذر وNode/build الفعليين
في Pages يجب مراجعتهما وقت التنفيذ ولا يُفترضان من اسم المشروع.

| الاسم | الإدارة | المتجر | ملاحظة من الكود |
|---|---|---|---|
| `VITE_SUPABASE_URL` | مطلوب للمشروع الجديد | مطلوب للمشروع الجديد | runtime يتجاوز fallback المصدر |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | مطلوب | مطلوب | مفتاح متصفح عام فقط |
| `VITE_SUPABASE_ANON_KEY` | بديل قديم | بديل قديم | لا تترك بديلاً متعارضاً |
| `VITE_STOREFRONT_PUBLIC_URL` | روابط تتبع/إيصال | غير مستخدم هنا | اسم الإدارة مختلف عن المتجر |
| `VITE_PUBLIC_SITE_ORIGIN` | غير مستخدم هنا | روابط وSEO | أصل المتجر العام |
| `VITE_TURNSTILE_SITE_KEY` | غير مستخدم؛ key منconfig المصدر | Widget الطلبات | public، لا secret |
| `VITE_STORE_WHATSAPP_NUMBER` | غير مستخدم هنا | اتصال المحل | معلومات اتصال عامة |
| `VITE_SENTRY_DSN` | اختياري | اختياري | تنقيح الخصوصية الموجود؛ لا يعدل الأسرار |
| `NAWASRAH_ADMIN_RELEASE_ID` | override اختياري للـbuild ID | غير مستخدم هنا | SHA كامل؛ أو `CF_PAGES_COMMIT_SHA` التلقائي ثم `GITHUB_SHA` |

- [ ] Production وPreview إعدادان منفصلان؛ لا توجه preview العامة إلى
  بيانات التشغيل. المالك اعتمد تقييد/تنظيف روابط المعاينة؛ هذه خطوة تشغيل
  منفصلة، وليست مكتملة بتهيئة CORS فقط.
- [ ] لا `VITE_BROWSER_QA_ISOLATED` أو `NAWASRAH_SEO_AUDIT_API_URL`/
  `NAWASRAH_SEO_AUDIT_API_KEY` في تشغيل حقيقي؛ الأخيرة تقبل loopback للاختبار
  فقط، ولا تصلح حلاً لوجهة SEO الجديدة.
- [ ] مراجعة build المنفصل لكلا التطبيقين من نفسSHA، release marker،
  تحديثservice worker والكاش على هاتف سبق استخدامه؛ لا جلسة قديمة تعيد
  المستخدم إلى مشروع قديم. لا طباعة مفاتيح فيnetwork logs أوالتقرير.

**التحقق:** Network/طلباتAPI وREST وrealtime وimages وEdge للمشروع الجديد،
وتطابقSHA/المجالات، ومتجر SEO منشأ من نفس كتالوج الهدف، مع login/checkout/
receipt/tracking وcamera/geolocation وفق سياسات كل تطبيق.

## 7. CORS والمجالات وTurnstile

من allowlists الحالية، وليست إثبات ملكية DNS أوإعداد لوحة:

- الإدارة: `admin.alnawasreh.com` و`nawasrah-admin.pages.dev` وpreview
  subdomains تحت الأخير؛ guest لا يقبلها تلقائياً.
- المتجر: `alnawasreh.com` و`nawasrah-store.pages.dev` وpreview تحت الأخير؛
  تحقق Turnstile للمتجر يقارن `TURNSTILE_ALLOWED_HOSTNAMES` أيضاً،
  والـdefault لا يضيف كلpreviewhostname تلقائياً.
- `www.alnawasreh.com` redirect إلى canonical store حسب
  [www-redirect](../../infra/cloudflare/www-redirect/README.md)، وليس Origin
  إضافياً معتمداً للـguest gateway.
- localhost ports الموجودة للمعاينة المحلية ليست تصريحاً بإضافتها إلى
  Auth/Turnstile تشغيل. محتوى قوائم Dashboard **يحتاج تأكيد من لوحة Supabase**.
- JWT الحقيقي والأدوار إلزاميان للـstaff/AI؛ CORS ليس آلية صلاحيات.
  push/feed server-to-server لهما سر header،لا CORS مفتوحة للمتصفح.

**التحقق:** OPTIONS/POST من كلOrigin معتمد، رفضOrigin الغريب،
CAPTCHA صالحة/ناقصة/منتهية وبـaction/hostname مختلف؛ Auth redirects المقصودة
فقط. الحفاظ علىHSTS/CSP/X-Frame-Options/X-Content-Type-Options، وعدم توسيع
CSP إلىwildcard لتجاوز حظر الوجهة.

## 8. عوائق التحويل المثبتة بالمصدر — لا تُصلح ضمن هذا التوثيق

| الموضع | الخطر | بوابة المعالجة قبل التشغيل |
|---|---|---|
| `src/config/supabase-public-config.ts` ونسخةcustomer-web | fallback URL/key وadmin Turnstile ثابتة | تحديث معتمد/مطابقة إعدادات الهدف، لا الاعتماد علىغيابenv |
| `customer-web/scripts/generate-seo-pages.mjs` | يقرأ URL/key منملفconfig وليس `VITE_SUPABASE_URL`؛audit override محلي فقط | حل مصدرإعدادSEO بخطوة معتمدة،ثم إثبات كتالوجهدفالبناء |
| `public/_headers` و`customer-web/public/_headers` | CSP تحدد host المشروع القديم وwss | إعادةربط محددة مع الحفاظ علىالحماية،وفحص الترويسات |
| `033`، `enqueue_order_push_webhook(JSONB)` | `send-order-push` URL مثبت علىالمشروع القديم؛لم يُعدتعريفه بتاريخلاحق فيالسقف الحالي | قرار SQL/config مستقل بصيغةصريحة؛لا تعديل033 ولاenvتخمينياً |
| `scripts/backup/preflight.mjs` | `expectedProjectRef` مثبت علىالقديم | حارسهدف جديد معتمد،لا تجاوزه أوتعطيله |
| `scripts/backup/create-backup.mjs` | manifest `projectRef` ثابت؛صورمنconfigالمصدر،DBمنCLIlinkedpooler | توحيدثلاثوجهات الهدف ثم إثبات manifest/restore |
| `034` وبناءmanagedفارغ | hybrid compatibility محلي فقط | إجراءبناءمعتمد وبروفة كاملة؛لا ترقيعالتاريخ |

**التحقق:** قبل التحويل لا طلب إلىHost القديم،ولاmanifest يسمي مشروعاً مختلفاً
عنمصدرdump/Storage،ولاCSP تمنعالجديد. لا تجري تجربةطلبعميل حقيقي إن كانت
وجهةwebhookمازالت خاطئة. هذهعوائق عملية،لا ادعاءأنمشروعجديد جاهزبمجرد138.

## 9. النسخ الليلي والحارس المحلي إلى جهاز دائم التشغيل

المراجع: [backup](../../scripts/backup/README.md)،
[off-site](../../scripts/offsite-backup/README.md)،
[monitoring](../../scripts/monitoring/README.md)،
[الاستقرار التشغيلي](OPERATIONAL_STABILITY.md).

- [ ] تجهيز جهاز Windows دائم التشغيل واتصال مستقر وPostgreSQL tools.
  Docker مطلوب للبروفة وn8n، وليس للـnative dump الليلي.
  DPAPI القديم غير قابل للنقل: أعد الإعداد المحمي على الجهاز الجديد،
  ولا تنسخ ciphertext وتفترض إمكانية فكّه.
- [ ] معالجة حراس الوجهة في §8 أولاً، ثم ربط CLI وpooler وconfig المصدر
  بمشروع فرانكفورت. أوامر backup:preflight/setup تتصل فعلياً؛
  **لم تُشغّل في مهمة التوثيق هذه**.
- [ ] إعداد password وpassphrase عبر secure prompts خارج Git.
  أسماء الإعدادات فقط: `SUPABASE_DB_PASSWORD`،
  `NAWASRAH_BACKUP_PASSPHRASE`، `NAWASRAH_BACKUP_OUTPUT`،
  `NAWASRAH_BACKUP_RETENTION`، `NAWASRAH_PROJECT_ROOT`، `NAWASRAH_PG_BIN`.
- [ ] النسخ الليلي الساعة 23:30 تحت SYSTEM، والاحتفاظ بآخر30 نسخة وتدارك
  التشغيل بعد الإقلاع حسب المصدر. restore gate الساعة02:17 ويجري عند90 يوماً.
  شاهد تشغيلاً **مجدولاً**، لا نجاح نسخة يدوية فقط؛ وثّق timezone الجهاز.
  267009 تعني قيد التشغيل، وليست فشلاً قبل تجاوز الحد الموثق.
  267011 تعني لم تعمل بعد، وليست نجاحاً؛ عمر النسخة36 ساعة وفحص التعليق مستقلان.
- [ ] تشغيل backup:verify ثم backup:restore-test بإذن البروفة:
  `ok=true` و`liveSupabaseTouched=false`، مع مطابقة public والصور وchecksums.
  Auth/MFA وكامل مخطط Storage ليست ضمن هذا الأرشيف؛ لا استرجاع كامل تلقائي.
- [ ] إعادة إعداد R2 وDPAPI وربط ERP الجديد بالمسار الموجود
  `nawasrah-offsite-backups`، دون مسح الأرشيفات القديمة أو تغيير أسماء immutable.
  upload الساعة02:10؛ download/verify أسبوعي وrestore كل90 يوماً.
  نسخ n8n الساعة01:30 مسار منفصل.
- [ ] monitoring:setup يجري تحققاً حقيقياً ويرسل Telegram؛ ينفذ بإذن التفعيل فقط.
  مراجعة `backupMachineConfigPath` و`projectRoot` وpooler.
  أسماء التشغيل: `NAWASRAH_PSQL_PATH`، `NAWASRAH_SUPABASE_DATABASE_URL`،
  `SUPABASE_DB_PASSWORD`، `NAWASRAH_PROJECT_ROOT`،
  `NAWASRAH_DEV_TELEGRAM_BOT_TOKEN`، `NAWASRAH_DEV_TELEGRAM_CHAT_ID`،
  `CLOUDFLARE_API_TOKEN`، `CLOUDFLARE_ACCOUNT_ID`؛ لا قيم في المستودع.
- [ ] تفعيل `supabaseDailyChecksEnabled` في config القائم، أو
  `NAWASRAH_SUPABASE_DAILY_CHECKS` في بيئة المشغّل بعد ربط VITE URL/key
  في بيئة الجهاز/checkout الجديد. Cloudflare build env لا ينتقل للجهاز تلقائياً.
  إعادة تهيئة كاش `supabaseDaily` بإجراء معتمد حتى لا يُعتبر checkedAt
  للمشروع القديم دليلاً على الجديد؛ لا تمسح كل incident history أو تسكت الإنذارات.
- [ ] keep-alive يقرأ `get_public_storefront_settings` كل24 ساعة.
  هذا إجراء احترازي، **ليس ضماناً** لعدم إيقاف المشروع؛ سياسة pause الفعلية:
  **يحتاج تأكيد من لوحة Supabase**.
- [ ] حجم DB من `pg_database_size(current_database())` داخل READ ONLY transaction؛
  400,000,000 bytes حد الإنذار، وليس حجم Storage/disk. حد الخطة500MB
  المذكور في توثيق المستودع: **يحتاج تأكيد من لوحة Supabase**.
- [ ] watchdog كل5 دقائق وبعد startup؛ bot المطور منفصل عن Business.
  اختبار فشل وتعافٍ وتسليم Telegram بتفويض وsandbox، دون بيانات مال أو عملاء.
  فحص التوفر المحلي يتطلب HTTP200 والترويسات الأربع على المتجر والإدارة.

**التحقق:** مهمة SYSTEM نجحت، وأحدث archive موثق من فرانكفورت واستُرجع معزولاً،
وR2 download/hash صحيح، وcheckedAt يومي جديد وقياس حجم صحيح.
الخطأ ينبه ثم يتعافى دون تكرار. الجهاز المطفأ لا يستطيع إنشاء نسخة أو keep-alive.

## 10. تحويل GitHub إلى private وتوقيت CI

- [ ] موافقة المالك على تغيير visibility بعد نجاح المراقبة المحلية للتوفر
  وإتاحة الوصول للمشغّل. أي اعتماد وصول خاص لا يُختار أو يُقرأ في هذا التوثيق.
- [ ] ضبط Repository Actions variable `PRIVATE_CI_BUDGET_MODE=true` بعد private؛
  شرطا flag وprivate لازمان، ولا يوجد إعداد Cloudflare مماثل.
- [ ] تعطيل `public-uptime.yml` عند التحويل، **دون حذف الملف**.
  Disable workflow يوقف manual أيضاً. إذا اعتمد المالك إبقاء manual،
  تُعطّل schedule فقط بتعديل مستقل معتمد.
  تحديث قائمة توقعات watchdog وقراءة badges لتوافق المستودع الخاص.
- [ ] `private-weekly-ci.yml` الاثنين02:17UTC يطلب full quality وsecrets.
  نجاح dispatch لا يعني انتهاء الفحص. push الخفيف يحتفظ بالأنواع وlint
  وكل الوحدات والأسرار وspecs المتأثرة؛ light-only ليس بوابة نشر.
- [ ] full manual وsecrets على **نفس SHA** قبل أي release، ثم
  `agent:verify-handoff -- --delivery`. راجع كل jobs والشاردات الثلاثة،
  ولا تثبّت عدد مهام إذا تغير workflow مستقبلاً.
- [ ] إعادة قياس الزمن على عتاد private وميزانية2000 دقيقة.
  تقدير1975 في الخطة مشروط بحجم العمل، وليس ضماناً.
  عند تجاوز الوقت أو الميزانية توقف؛ لا تحذف فحصاً أو ترفع مهلة.

**التحقق:** doc/source pushes تختار التوزيع الصحيح، وweekly full يكتمل،
وfull exact-SHA ناجح، ولا إنذار كاذب بسبب Uptime المعطل.
المرجع: [PRIVATE_CI_BUDGET](PRIVATE_CI_BUDGET.md).

## 11. القبول النهائي وخطة الرجوع

- [ ] موافقة مستقلة قبل تحويل traffic؛ full CI وsecrets لنفس SHA،
  وبروفات reconciliation/Auth/MFA/Storage/Edge/cron/backup/Telegram موثقة.
  جهوزية SQL لا تعني جهوزية الأرصدة وExcel وبيانات بداية التشغيل المؤجلة.
- [ ] التحقق بعد كل بند كما فوق. بعد النشر راقب المصالحة والطلبات والورديات.
  لا بيع أو مرتجع مصطنع في بيانات المحل دون تفويض وخطة تعويض معتمدة.
- [ ] **قبل أول حركة حقيقية:** عند الفشل أوقف استقبال الطلبات بمسار المالك
  القائم، وارجع versions/البيئات/روابط الهدف والتكاملات كحزمة متوافقة بإذن المالك.
  عالج service worker/cache حتى لا يعمل تبويب على وجهة مختلفة.
- [ ] **بعد حركة حقيقية على الجديد:** لا ترجع ببساطة للقاعدة القديمة؛
  ذلك يفقد الحركات بعد cutoff. أوقف الكتابة، واحفظ النسختين، وحدد الفروق
  للمصالحة بإذن، واستعد أولاً إلى هدف معزول، ثم تحقق من المال والمخزون
  والمفاتيح قبل قرار المالك بالتحويل.
- [ ] لا downgrade أو تعديل 001–138 أو db reset للتراجع.
  لا replay مزدوج للدفعات والمرتجعات، ولا حذف المشروع الجديد لإخفاء الفشل.
- [ ] تعطيل الفحص اليومي إن لزم يكون منفصلاً مع بقاء التنبيهات.
  ضبط flag CI إلىfalse يعيد full لكلpush؛ إعادة Uptime قرار منفصل.
  إعادة backup لوجهة سابقة لا تصالح حركات حدثت على الجديدة.
- [ ] public archive ليس استرجاع Auth/MFA، وDPAPI ليس سراً قابلاً للنقل.
  recovery يتطلب نسخاً مستقلة وmapping وcutoff، وفق
  [دليل الصيانة](../MAINTENANCE_GUIDE_AR.md).
- [ ] حذف المشروع القديم وأسراره واشتراكاته يحتاج موافقة نهائية مستقلة
  بعد التحقق ومدة احتفاظ معتمدة. حدود الاحتفاظ في الخدمة:
  **يحتاج تأكيد من لوحة Supabase**، والمدة التشغيلية تحتاج قرار المالك.

**دليل التسليم:** PASS/FAIL لكل قسم، والأوقات والـSHA واسم المشغّل،
والوجهة المتحقق منها دون أسرار، وأسئلة المالك الباقية.
كل خانة غير منفّذة تبقى unchecked.

## ملحق: manifest migrations المرتّب من المصدر

هذهالملفات138 كمافيالأساسالمذكور،بلا139 وبلافجوة. للتنفيذالمستقبلي:
تحققأولاًمنتطابقmanifest والسقفالحالي؛أيmigrationجديدةتحتاجاعتماداًوتحديث
القائمة. **القائمةليستأمراًمجازاًللتطبيقعلىأيSupabase فعليفيهذهالمهمة.**

```text
001  001_initial_schema.sql
002  002_rls_policies.sql
003  003_inventory_functions.sql
004  004_customers_orders.sql
005  005_order_status_transitions.sql
006  006_test_system_rpcs.sql
007  007_dashboard_analytics_rpc.sql
008  008_purchase_orders.sql
009  009_direct_goods_receiving.sql
010  010_warehouse_completion.sql
011  011_supplier_receiving_hardening.sql
012  012_supplier_purchasing_rbac.sql
013  013_public_product_catalog.sql
014  014_simple_inventory_operations.sql
015  015_ramtha_receiving_location.sql
016  016_safe_paid_supplier_receipt_reversal.sql
017  017_orders_customers_accounts.sql
018  018_customer_order_linking.sql
019  019_product_catalog_experience.sql
020  020_product_image_storage.sql
021  021_wholesale_sale_packages.sql
022  022_operational_home_dashboard.sql
023  023_wholesale_order_accounting.sql
024  024_supplier_receiving_wholesale_guard.sql
025  025_product_reference_data_management.sql
026  026_remove_production_test_rpcs.sql
027  027_require_customer_for_debt_sales.sql
028  028_guest_order_submission_safety.sql
029  029_guest_promotions_and_gps.sql
030  030_secure_order_entrypoints.sql
031  031_public_catalog_categories.sql
032  032_require_active_erp_staff.sql
033  033_order_web_push_notifications.sql
034  034_prelaunch_test_data_cleanup.sql
035  035_remove_push_test_controls.sql
036  036_storefront_experience_and_payment.sql
037  037_storefront_management.sql
038  038_storefront_home_sections.sql
039  039_storefront_home_sections_lint.sql
040  040_operational_expenses_and_cash_shifts.sql
041  041_require_open_shift_for_pos_sales.sql
042  042_website_order_payment_settlement.sql
043  043_sales_returns_and_refunds.sql
044  044_daily_shift_closing_report.sql
045  045_secure_delivery_map_links.sql
046  046_cancel_empty_cash_shift.sql
047  047_inventory_opening_setup.sql
048  048_public_storefront_promotion_offers.sql
049  049_active_promotions_are_storefront_offers.sql
050  050_admin_api_security_hardening.sql
051  051_enrolled_staff_mfa_enforcement.sql
052  052_owner_only_tagged_e2e_cleanup.sql
053  053_remove_tagged_e2e_cleanup_rpc.sql
054  054_confirm_google_maps_coordinates.sql
055  055_operational_business_reports.sql
056  056_inventory_movement_reports_and_public_pos_receipts.sql
057  057_secure_n8n_automation_events.sql
058  058_secure_order_delivery_tracking.sql
059  059_delivery_driver_contact.sql
060  060_simplified_order_settlement_and_receivables.sql
061  061_delivery_zone_pricing.sql
062  062_finalize_automation_order_alerts.sql
063  063_category_cover_images.sql
064  064_secure_staff_account_management.sql
065  065_multiple_system_owners.sql
066  066_secure_admin_ai_assistant.sql
067  067_admin_ai_inventory_lookup.sql
068  068_admin_ai_operational_reports.sql
069  069_admin_ai_product_price_lookup.sql
070  070_product_flavor_variants.sql
071  071_atomic_product_family_creation.sql
072  072_manage_product_flavors.sql
073  073_admin_dashboard_performance_indexes.sql
074  074_secure_warehouse_rpcs_and_self_profile.sql
075  075_operational_orders_pagination.sql
076  076_admin_product_listing_read_model.sql
077  077_paginated_inventory_and_crm_read_models.sql
078  078_operational_accounting_integrity.sql
079  079_remove_retired_warehouse_rpcs.sql
080  080_supplier_payment_idempotency.sql
081  081_storefront_catalog_server_pagination.sql
082  082_admin_historical_read_models.sql
083  083_shift_reversal_primitives.sql
084  084_full_cash_shift_reversal.sql
085  085_admin_customer_receivables_and_scalability.sql
086  086_guest_order_abuse_gateway.sql
087  087_guest_order_line_item_limit.sql
088  088_storefront_merchandising_rpc.sql
089  089_customer_order_tracking_receipt.sql
090  090_optional_guest_delivery_details.sql
091  091_expire_stale_new_website_orders.sql
092  092_cleanup_guest_order_gateway_rate_limits.sql
093  093_cash_shift_archive.sql
094  094_immutable_cash_shift_closing_report_snapshot.sql
095  095_remove_unused_transfer_product_name.sql
096  096_harden_automation_delivery_lifecycle.sql
097  097_core_business_alerts.sql
098  098_business_summaries.sql
099  099_advanced_monitoring_and_business_integrity.sql
100  100_fix_cancelled_supplier_receipt_monitoring.sql
101  101_scope_core_business_incident_recovery.sql
102  102_privacy_minimize_business_alert_payload.sql
103  103_flavor_receiving_hardening.sql
104  104_remove_unused_receive_purchase_order_product_id.sql
105  105_harden_business_alert_rules_and_thresholds.sql
106  106_align_monitoring_owner_mfa_policy.sql
107  107_canonical_schema_reconciliation.sql
108  108_harden_product_sku_barcode_integrity.sql
109  109_admin_large_catalog_read_models.sql
110  110_fix_deferred_cash_shift_snapshot_guard_privileges.sql
111  111_harden_pos_sale_idempotency_replays.sql
112  112_configurable_parcel_foundation.sql
113  113_configurable_parcel_receiving_and_exact_wac.sql
114  114_configurable_parcel_sales_contracts_and_safety_primitives.sql
115  115_configurable_parcel_pos_sale_coordinator.sql
116  116_configurable_parcel_customer_reservation_coordinator.sql
117  117_customer_public_configurable_parcel_read_contract.sql
118  118_customer_guest_promotion_preview_v2.sql
119  119_exact_wac_and_commercial_quantity_reporting.sql
120  120_phase4_returns_refunds_foundation.sql
121  121_phase42_atomic_return_coordinator.sql
122  122_phase43_admin_aftercare_integration.sql
123  123_phase5_private_financial_evidence_foundation.sql
124  124_phase5_canonical_collection_reversal_writers.sql
125  125_phase5_collection_lock_lint_correction.sql
126  126_phase5_private_tender_coordinator.sql
127  127_phase5_private_financial_read_model.sql
128  128_phase5_operational_payment_and_shift_refund_fixes.sql
129  129_phase5_block_paid_order_receipt_reversal.sql
130  130_phase5_review_followup_shift_refund_guards.sql
131  131_phase6_operational_report_readers.sql
132  132_package_d_system_unification.sql
133  133_package_e_supplier_po_financial_consistency.sql
134  134_package_e_read_performance.sql
135  135_package_f_pos_customer_inventory_reads.sql
136  136_package_f_customer_debt_aging.sql
137  137_package_f_crm_financial_filters.sql
138  138_package_f_customer_statement.sql
```

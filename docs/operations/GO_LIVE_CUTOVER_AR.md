# خطة يوم التشغيل الرسمي — النواصرة

إضافة حزمة2: راجع [فصل البيئات وإغلاق المعاينات](ENVIRONMENT_SEPARATION_AR.md) قبل تنفيذ أقسام المعاينات أو البناء. السياق production=فرانكفورت، وstaging=سنغافورة بعدT+7. لا نشر أو تعديل Cloudflare ضمن إعداد هذه الحزمة.

**خطة مستقبلية، لم تُنفّذ أي خطوة منها في حزمة التوثيق أو حزمة RESET214.**

تحديث1ب:PR32 دُمج إلى `72966be5` ونجح main FULL47/47. الاستئناف الآمن له PR واعتماد مستقل قبل يوم التشغيل؛راجع [دليل RESET214 والاستئناف](RESET214_OWNER_AR.md). بروفاته محلية فقط،ولم يُنفّذ أي تصفير مستضاف.

تحديث26أكتوبر:دُمجPR31 إلى main `fb240a5f0479824beeb38ed85ea09dd4a3aa8972` ونجح FULL47/47؛حُفظت20 من ملفات المالك و7 إعدادات محلية دون تغيير. الحزمة1 الآن قيد اعتماد مستقل؛لا أمر تصفير للمالك قبل دمجها. الجرد في 26 أكتوبر 2026؛ الأساس `main 3783d2df1be6dcbbc18bc67788b5d92aeaf0877e` حتى migration214، أي 176 ملفاً فعلياً مع الفجوات المعتمدة. التوقيت Asia/Amman؛ الأوقات المنتهية بـ Z هي UTC.

الإنتاج: فرانكفورت `kzevmysfydaslxcerogt`. سنغافورة `acjtabdqqnpwhdvbvnyw` تحفظ دون تغيير أسبوعاً كاملاً بعد أول تشغيل حقيقي؛ لا يبدأ تحويلها تلقائياً.

المالك يعتمد الأرقام والجرد وقرار الإطلاق والتوقف ويدخل الأسرار بنفسه. Claude ينفذ الإجراءات التشغيلية بعد تفويض محدد. Codex يجهز الوثائق والكود والاختبارات محلياً. وجود أمر هنا لا يفوّض الاتصال أو النشر. **لا نشر إلا بعد كلمة المالك «انشر» للـ SHA والهدف المحددين.**

## بوابات تمنع التنفيذ حالياً

| البوابة | الحقيقة من المصدر | المطلوب قبل المرور |
|---|---|---|
| RESET214 | أداة مستقلة `frankfurt-owner-reset214.mjs` مع مرجع214 جديد و176 ملفاً، تحفظ عقد26أكتوبر؛بروفاتها في [دليل RESET214](RESET214_OWNER_AR.md) | اعتماد PR الحزمة1 وFULL CI ودمجه وتحديث المجلد الرئيسي قبل تسليم أمر المالك. ممنوع تشغيل أداة209 أو تبديل اسم المرجع أو تجاوز الحارس |
| حفظ الإعدادات والمستخدمين | العقد الحالي يحفظ المالك المختار و MFA و BR-MAIN/WH-MAIN و Vault؛ يعيد إعدادات public من migrations ويحذف بقية المستخدمين والصور | قرار26أكتوبر:بقاء المالك المختار فقط معMFA/profile/دوره وBR-MAIN/WH-MAIN وقيم المتجر والوحدات والأقسام المخصصة وVault/Auth/Edge؛حذف بقية حسابات التجربة والأعمال والصور. أداةRESET214 في حزمة مستقلة قبل التشغيل |
| عزل preview | fallback الواجهتين و CSP ومولد SEO تشير إلى فرانكفورت | حظر كل preview قديم ثم تجهيز staging مستقلة يشمل runtime و SEO و CSP. متغيرات Pages وحدها لا تكفي |
| تنبيهات الشغل | n8n المحلي النشط ما زال يسحب من سنغافورة؛ قالب توجيه فرانكفورت غير مفعّل | Workflow و credential مستقلان لفرانكفورت ومستلم المالك، واختبار وصول قبل فك الحجز |

هذه بوابات تقنية/تشغيلية، وليست إذناً لتغيير الحسابات أو الكود في حزمة التوثيق.

**معنى «افحص» في هذه الخطة:** لا يوجد زر بهذا الاسم لتشغيل الفحص في الواجهة الحالية؛ لوحة «الإدارة ← مراقبة النظام» للقراءة والتحديث فقط. بعد تفويض الخطوة،ينفذ Claude في **Frankfurt SQL Editor بحساب الإدارة المصرح** `SELECT public.run_advanced_monitoring_checks();` ثم يراجع المالك اللوحة بحساب owner و MFA،ويطابق كشوف المخزون والذمم والدرج مستقلاً. النجاح: فحوص integrity سليمة/issueCount=0،ولا critical أو scan error،مع مراعاة أن المراقبة التقنية قد تعرض unknown لإعداد لم يجهز. أي unknown حرج أوخلل بيانات يوقف القبول. الفحص يسجل snapshot مراقبة وقد ينشئ outbox؛لا يُنفذ من هذه الحزمة،ولا تمنح دالته للواجهة أوتتجاوز حارس دور عند الرفض.

## 1. قبل اليوم — D-1

| خطوة | المنفذ والأمر أو المكان | كيف نتحقق | ما يوقفنا |
|---|---|---|---|
| 1.1 نسخة الإطلاق | Codex/Claude: GitHub Actions و`git rev-parse HEAD` و`git ls-remote origin refs/heads/main` من checkout الإصدار | نفس SHA المقبول، FULL45 جودة + recovery1 + secrets1 دون skip، و Gitleaks0 | SHA مختلف، CI ناقص، أو كود معدل. لا تحذف ملفات docs المحلية لتنظيف الشجرة |
| 1.2 حماية حديثة | المالك/Claude كمسؤول: سلسلة B أدناه من المجلد الرئيسي | Backup و RestoreRemote ناجحان خلال 24 ساعة لنفس الأرشيف، بتطابق البيانات/ACL/176 migration/214 والصور | نسخة قديمة أو مقارنة فاشلة. الأخضر بلا تاريخ حديث لا يكفي |
| 1.3 الحالة | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Status` | كل العمليات ok؛ Watchdog healthy؛ جرد Task Scheduler كمسؤول يثبت 5 مهام فرانكفورت وآخر تشغيل | فشل، مهمة غائبة، أو Docker غير جاهز. لا حاجة إلى Setup أو Register من جديد بلا سبب |
| 1.4 البيانات الحقيقية | المالك: قوالب «الإدارة ← بداية التشغيل» وورقة جرد موقعة بتاريخ القطع | المنتجات/الرموز/الباركود/النكهات/الوحدات وكم حبة بالطرد/طرق البيع/الأسعار وتكلفة الوحدة؛ الموردون وأرصدتهم له/عليه؛ العملاء وذممهم وتواريخها؛ الشيكات إن وجدت؛ نقد الدرج منفصلاً عن CliQ والبنك | كمية أو تكلفة مبهمة، طرف مكرر، أو اختلاف عن العد الفعلي |
| 1.5 قبول التجربة | المالك: [قائمة يوم التجربة](TRIAL_DAY_CHECKLIST_AR.md) على الهاتف والكمبيوتر والطابعة والباركود | وصل مختلط وإعادة طباعته، MFA والصلاحيات، المعلّق والاستبدال، مطابقة الدرج والمخزون والذمم والربح. اختبار تحديث PWA بين إصدارين على Chromium/WebKit وعلى هاتفه | إجراء يومي أو طباعة أو تحديث التطبيق المثبت يفشل؛ CI لا يغني عن الجهاز الحقيقي |
| 1.6 قرار القطع | المالك يحدد ساعة منع الكتابة؛ Claude يحفظ SHA و deployment IDs وتقارير القبول محلياً | ملف إطلاق دون أسرار، ومنفذ لكل خطوة وخطة للعمليات أثناء التوقف | لا وقت قطع أو لا مسؤول واضح |

سلسلة B **مستقبلية**؛ نفذ كل أمر بعد نجاح سابقه فقط:

```powershell
Set-Location C:\Users\TOP\mahdi-admin
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Backup -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode Upload -Apply
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode VerifyRemote -Apply -Force
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/operations/frankfurt-backup-owner.ps1 -Mode RestoreRemote -Apply -Force
```

RestoreRemote يسترجع **محلياً بمعزل عن الشبكة**؛ لا يستبدل فرانكفورت الحية. احفظ أرشيف «قبل التصفير» واسمه وحجمه وبصمته خارج دورة حذف النسخ، ومفتاحه في مدير كلمات المرور ونسخة طوارئ مستقلة؛ DPAPI وحده لا يُنقل لجهاز جديد.

## 2. التصفير — بعد أداة 214 معتمدة فقط

المرجع الحالي هو [RESET214 المعتمد للحزمة1](RESET214_OWNER_AR.md)،ومرجع prompt9/reset التاريخي هو [الدليل القديم](TRIAL_RESET_FRANKFURT_AR.md). الأداة الجديدة مستقلة؛**لا apply للأداة التاريخية المقيدة209 على214**. لا تنفيذ قبل اعتماد PR الحزمة1 ودمجه؛الأوامر النهائية تُسلّم بعد الدمج فقط.

| خطوة | المنفذ والأمر أو المكان | التحقق | التوقف |
|---|---|---|---|
| 2.1 منع الكتابة | المالك/Claude: إغلاق POS والمتجر، استقبال طلبات الموقع off، حظر preview، وإيقاف مستهلك فرانكفورت إن جُهّز. احفظ حالة مهام فرانكفورت ثم عطلها مؤقتاً خلال النافذة فقط | لا وردية أو طلب أو webhook يكتب أثناء القطع؛ القديم لا يتغير | جهاز يبيع أو مستهلك يعمل؛ إغلاق تبويب واحد لا يكفي |
| 2.2 النسخة الفاصلة | المالك/Claude: B **قبل التصفير مباشرة** بعد منع الكتابة، بأوامر يدوية حتى لو عُطلت المهام | النسخة والاسترجاع والرفع والمطابقة ناجحة، ووقت آخر عملية مسجل | أي فشل أو تغير قاعدة أثناء النسخ |
| 2.3 المعاينة | بعد الدمج وتحديث المجلد الرئيسي فقط:المالك يشغّل معاينة RESET214 بخيارات owner-id وreference وworkdir الموثقة | 214 و176 ملفاً ومرجع local-reference-through214-ready.json؛قراءة فقط وأعداد فعلية لكل جدول وحساب وملف | أي فرق تاريخ/ACL/حجز،أو مرجع209؛الخطة المحلية plan لا تثبت أعداداً حية |
| 2.4 عقد الحفظ | المالك يراجع UUID حسابه والمعاينة؛الأداة تثبت بصمات المتجر والوحدات والأقسام وprofile/الدور والموقعين وAuth/MFA/Vault | نفس القيم قبل/بعد؛بقية حسابات التجربة تُحذف | updated_by مرتبط بحساب سيُحذف:يحفظ المالك إعدادات المتجر من حسابه ثم يعيد المعاينة؛لا تغيير صامت للقيم |
| 2.5 التنفيذ | المالك أو Claude بتفويض خاص يشغّل أمر RESET214 الذي يُسلّم بعد الدمج،مع تأكيد المرجع وUUID وكلمة DB مخفية | report.ok وcomplete صحيحان؛176 مطبقة ومسجلة،صفر فرق كتالوج/ACL،عدادات نظيفة وتطابق كل المحفوظ | أول خطأ:تبقى الواجهات مغلقة؛راجع السبب ثم resume بلقطة1ب المحمية وبنفس المالك والمرجع. إذا رُصدت أعمال حقيقية جديدة يتوقف الحذف ويُطلب مسار الأرشيف المعتمد. لا apply أخرى أو حذف العلامة أو db reset --linked أو DROP/TRUNCATE يدوي |
| 2.6 افحص | المالك: إجراء «افحص» الحالي ومراجعة «الإدارة ← مراقبة النظام»؛ Claude يراجع تقرير التصفير | invariants سليمة؛ مبيعات/ذمم/مخزون صفر مع seed والموقعين والمالك المعتمدين فقط | رصيد تجربة، جدول غير مصنف، فشل MFA، أو فرق كتالوج |

| ما يبقى في العقد الحالي | ما يُمسح أو يحتاج إعادة إعداد |
|---|---|
| Auth وهويات وجلسات و MFA المالك المختار و profile/دوره؛ BR-MAIN/WH-MAIN بنفس UUID | بقية مستخدمي Auth؛ كل بيانات الأعمال؛ منتجات وأسعار وذمم وطرود وشيكات ومعلّق وورديات وصور المنتجات التجريبية في product-images |
| Vault وحاوية الصور وإعدادات Auth/Edge خارج public | محتوى صور التجربة؛إعدادات storefront_settings بقيمها المخصصة والوحدات والأقسام الحالية محفوظة بعقدRESET214 الجديد |
| الهوية والشعار والأيقونات الثابتة في ملفات التطبيق | تتحقق الأداة من تطابق قيم المتجر والوحدات والأقسام قبل/بعد ببصمات دون نشر محتواها |

لا توجد معاملة واحدة تجمع Storage و Auth وكل migrations. لا تفتح الواجهات حتى تقرير نهائي ناجح ومراجعة المالك. بروفات RESET214 دليل اختبار،وليست إذناً للتنفيذ المستضاف. فشل التصفير بسبب انقطاع يعني مراجعة السبب ثم resume محروساً من بداية البناء بلقطة حزمة1ب،ولا يعني استرجاع الأرشيف تلقائياً. الاسترجاع من الأرشيف يُطلب فقط إذا ثبتت أعمال حقيقية جديدة بعد بدء القطع،مع حفظها وتوفيقها بإجراء معتمد. لا apply أخرى ولا حذف العلامة يدوياً.

## 3. إدخال البيانات الحقيقية

كل إدخال للمالك بحساب owner و MFA؛ Claude يساعد في القالب والمعاينة؛ Codex لا يدخل مبالغ.

| ترتيب | المكان والعمل | المطابقة | التوقف |
|---|---|---|---|
| 3.1 المواقع والإعدادات | «الإدارة ← المستودعات» تأكيد BR-MAIN/WH-MAIN؛ «بداية التشغيل ← الفرع الرئيسي»؛ تأكيد بقاء الهوية وإعداد المتجر والوحدات والأقسام | موقع مقصود واحد، وإعداد المتجر صحيح، و ordersEnabled=false | مواقع مكررة أو قيمة تجريبية |
| 3.2 المنتجات | «بداية التشغيل ← المنتجات»: القالب الحالي/اليدوي؛ أسعار كل طريقة، تكلفة الوحدة، النكهات، وطرد فقط حسب القالب | dry-run ومعاينة ثم حفظ؛ باركود ورمز غير مكرر ووحدة وحجم طرد واضحان | تكلفة/وحدة ناقصة أو طريقة بيع غير صحيحة |
| 3.3 المخزون | «بداية التشغيل ← البضاعة الموجودة»: الرصيد الفعلي لكل صنف/مستودع بالطرود والحبات | مجموع الوحدة الأساسية وقيمة المخزون، وعدّ3 أصناف مستقلة | فرق عد أو تكلفة. لا تستعمل استلام شراء لإنشاء المخزون القديم فتضيف ذمة جديدة |
| 3.4 الموردون | «أرصدة الموردين الافتتاحية»: صافي له/عليه لكل مورد ومطابقة الهوية | كشف المورد مقابل الورقة، بلا سند شراء وهمي أو حركة درج | ازدواج أو إشارة رصيد معكوسة |
| 3.5 العملاء | «ديون العملاء القديمة»: المبلغ والتاريخ الأصلي ومراجعة إنشاء الطرف الناقص | كشف العميل مقابل الورقة؛ الدين القديم ليس مبيعاً أو ربحاً | تطابق اسم مشكوك أو دين مجهول؛ لا فاتورة وهمية بدلاً من الدين |
| 3.6 الشيكات إن وجدت | «الشيكات ← شيكات البداية» وفق [دليل 196](OPENING_CHEQUES_196_AR.md) | المالك يوقع كشفاً يثبت عدم تكرار قيد الشيك والذمة الافتتاحية | عدم معرفة هل الشيك ضمن الذمة أم مستقل؛ يلزم قرار مالي قبل الإدخال |
| 3.7 القبول والقفل | «افحص»، وكشوف الطرفين والمخزون والعدادات، ثم «إنهاء بداية التشغيل» وعبارة التأكيد | فروق صفر وتوقيع المالك، ثم قفل نهائي بقاعدة البيانات | نقص/فرق؛ لا SQL لفك قفل الإنهاء |
| 3.8 الدرج | قبل أول بيع: المالك يعد الكاش ويفتح وردية بنفس المبلغ | المتوقع أول الوردية = النقد المعدود؛ CliQ والبنك خارج الدرج | وردية تجربة أو مال غير معدود؛ لا تحصيل/مصروف لتكوين الرصيد الافتتاحي |

بعد البيانات وقبل أول بيع: B مرة أخرى، واحفظ «بداية حقيقية قبل أول بيع» منفصلة عن «قبل التصفير». أي فشل حماية يمنع الفتح. نماذج ومحاسبة البداية موثقة في [GO_LIVE_SETUP](../design/package-f/GO_LIVE_SETUP.md).

## 4. فصل البيئة التجريبية والمعاينات

**المنفذ Claude بعد تفويض المالك، والتحقق من المالك على الهاتف والكمبيوتر.** لا تجارب على بيانات فرانكفورت بعد الإطلاق.

1. لكل من **Workers & Pages → nawasrah-admin / nawasrah-store → Settings → Environment variables**، اختر Production أو Preview صراحة (قد تظهر Variables and Secrets). Production: رابط فرانكفورت ومفتاحها العام؛ Preview: البيئة التجريبية فقط بعد تجهيزها. راجع `VITE_SUPABASE_URL` و`VITE_SUPABASE_PUBLISHABLE_KEY` وأزل override متعارضاً من `VITE_SUPABASE_ANON_KEY`. لا service_role في VITE.
2. القيم تُثبت عند **البناء**. النشر الحالي Direct Upload يبني محلياً؛ لا يأخذ env لوحة Pages تلقائياً. يلزم ضبط جلسة البناء أيضاً. `customer-web/scripts/generate-seo-pages.mjs` يقرأ config المصدر بدلاً من VITE URL، و CSP في `_headers` يسمح بفرانكفورت: يجب تسليم تجهيز بيئة منفصل يشمل الثلاثة قبل retarget إلى سنغافورة، دون إزالة CSP أو التحايل بمتغير QA.
3. حتى T+7: المعاينات **مغلقة**، ولا تربطها بسنغافورة المحفوظة للرجوع. Settings → Builds & deployments → Preview branch control = None إن كان المشروع مرتبطاً بـ Git. إن كان Direct Upload، يمنع الفريق رفع فرع staging-frankfurt. لا حاجة إلى حذف فرع Git.
4. هذا لا يعزل الملفات القديمة: Deployments لكل مشروع؛ احصر staging-frankfurt وجميع hash URLs التي بنيت لفرانكفورت. حظر الجميع في Access للمعاينات، حتى allowlist التجربة السابقة. احذف deployments التجريبية غير الحالية، دون مساس بالإنتاج. آخر deployment للفرع لا يُحذف في Pages؛ عند الحاجة ينشر Claude، بإذن نشر منفصل، صفحة صيانة ثابتة بلا JS/Service Worker/اتصال قاعدة على preview نفسه، ثم يحذف السابق. لا تستعمل بناء التطبيق المتصل fallback بفرانكفورت كصيانة.
5. أزل preview origins من Frankfurt Auth Redirect URLs ومن Turnstile/Edge allowed origins حسب إعدادها في [دليل staging](STAGING_FRANKFURT_AR.md)، مع إبقاء الإنتاج. هذه طبقة مساعدة: CORS و RLS وحدهما لا يمنعان عميل SDK ذا جلسة صحيحة من preview؛ حظر Access وإزالة artefacts ضروريان.
6. المالك/Claude يخرجون من حسابات التجربة، يمسحون بيانات وأيقونات PWA لأصل staging فقط ويغلقون تبويباته؛ لا origin الإنتاج. ملف cached لا يتغير بتغيير alias. تراجع جلسات الحسابات عند التصفير وتبقى أجهزة المالك المعتمدة.
7. التحقق: alias و hash URLs لا تقدّم التطبيق المتصل بفرانكفورت حتى للمسموح سابقاً؛ Network و SEO build لا يصدران أي REST/RPC/WSS/Storage لفرانكفورت من preview قابل للوصول. **بقاء أي preview متصل يوقف الإطلاق.**

المراجع العامة: [إعداد متغيرات البناء](https://developers.cloudflare.com/pages/configuration/build-configuration/)، [الفروع](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)، [preview والروابط الثابتة والحذف](https://developers.cloudflare.com/pages/configuration/preview-deployments/). لم تُفتح لوحة حساب أو مشروع في هذا الفحص.

## 5. توجيه التنبيهات

قرار المالك26أكتوبر: **الشغل لصاحب المحل فقط، والتقنية للمطوّر فقط.** لديهTelegram؛يُسجّلChat ID فيcredential مستقل،وPush الطلبات على هاتفه. الملخص اليومي قابل للضبط؛الافتراضي **00:00 Asia/Amman** حتى يؤكد المالك هل الساعة12 المقصودة منتصف الليل أو الظهر. تجهيزworkflow بالحزمة3؛لا تفعيل الآن.

| القناة | أين يضبط المالك/Claude المستلم | التحقق والتوقف |
|---|---|---|
| النسخ،400MB،keep-alive،watchdog | `C:\ProgramData\NawasrahDeveloperMonitoring\config.json` المحمي: Telegram المطوّر الحالي. يشير إليه إعداد Frankfurt. لا يغيّر مستلم المطوّر ولا ينسخ chat للشغل | TestAlert سبق نجاحه؛ Status و Watchdog وآخر مهام SYSTEM. لا تعيد TestAlert المحروس لمرة واحدة بلا إجراء معتمد. أي رسالة تقنية للمحل توقف القبول |
| أعمال Frankfurt عبر n8n | `http://localhost:5678`: Workflow **جديد مستقل وغير نشط** باسم «Frankfurt — تنبيهات صاحب المحل». عقدتا telegram-claim و telegram-complete إلى `https://kzevmysfydaslxcerogt.supabase.co/functions/v1/n8n-alert-feed`؛ telegram-send إلى Chat ID المالك بعد بدء محادثة البوت | Execute Workflow بعد إدخال البيانات، ثم مستلم المالك وحده؛ لا معرف workflow/credential قديم مشترك أو URL سنغافورة |
| اعتماد feed | credential مستقل لـ Frankfurt من نوع Header Auth: `x-nawasrah-automation-secret`؛ القيمة تطابق Frankfurt → Edge Functions → Secrets → `NAWASRAH_AUTOMATION_SECRET`. Telegram Bot credential مستقل؛ يدخل المالك التوكن داخل مخزن n8n المشفر | health ثم claim/complete وفق العقد، بلا سر في history أو JSON أو Git؛401/503 أو غياب credential يوقف التفعيل |
| businessAlertsEnabled | `automation/n8n/frankfurt-go-live-routing.example.json` **قالب توثيق**، ليس زر تشغيل. يسجل قبول الأعمال منفصلاً يوم التشغيل. تبقى `businessAlertsEnabled=false` في config حارس النسخ، لأن validateOwnerConfig يرفض true | التفعيل يثبت من cron/workflow/الرسالة، وليس قلب Boolean فيقالب. لا تعدّل config النسخ إلى true |
| إشعار المتجر Push | المالك: PWA على أصل production → Profile → الإشعارات → «تفعيل إشعارات الطلبات». Frankfurt Edge Secrets: `WEB_PUSH_VAPID_PUBLIC_KEY` و`WEB_PUSH_VAPID_PRIVATE_KEY` و`WEB_PUSH_SUBJECT`؛ المفتاح العام الثابت في `src/services/pushNotifications.service.ts` (ليس متغير VITE افتراضياً) | اشتراك نشط للمالك وحده وطلب متجر يصل إليه مرة واحدة؛اشتراك موظف/مطوّر أوأصل staging يوقف القبول |
| Vault push | Frankfurt → Vault: `order_push_webhook_url` إلى `https://kzevmysfydaslxcerogt.supabase.co/functions/v1/send-order-push`؛ و`order_push_webhook_secret` مطابق للعقد الحالي،لا يُطبع أو يعاد توليده عشوائياً | تحقق ضبط المشروع دون كشف السر، ثم تجربة طلب. URL قديم أو سر غير مطابق يمنع فك التريغر |
| أخطاء النظام و CI | تبقى قناة المطوّر/GitHub و developer monitoring؛لا تدخل Telegram الأعمال | اختبار تقني آمن من المسار المعتمد يوصل للمطوّر وحده؛لا يُحوّل business feed إلى قناة أخطاء عامة |

لا تشغّل `import-workflows.ps1` أو`import-feed-credential.ps1` كما هما لفرانكفورت: القالب يشير لسنغافورة ومعرفات credential ثابتة؛ استبدالها قد يمس القديم. استخدم UI n8n لإضافة معرفات مستقلة. `.env.channels` و`NAWASRAH_TELEGRAM_CHAT_ID` يخصان المسار القديم؛ لا يستبدلان ب chat المالك الآن. لا تفك DPAPI أو credentials لهذا المستند.

أحداث business feed هي الشغل: نقص المخزون والطلبات والورديات والملخصات و`business_integrity_warning` (ملخص تشغيل للمالك،والتفاصيل التقنية للمطوّر). قارئ Push الحالي يسمح أيضاً بأدوار admin/manager/orders؛لا يفرض owner-only تلقائياً. مع عمل المالك وحده يثبت مستلم Push بإدارة الاشتراكات الفعلية وإلغاء غير المقصود بمساره المعتمد،دون تغييرالصلاحيات. قبل توظيف موظف تطبق القرارات المؤجلة في OWNER_DECISIONS.

## 6. تفعيل المؤجل — جرد ثم انتقال محدود

**Claude بتفويض خاص يوم التشغيل،في SQL Editor لفرانكفورت فقط.** قبل التغيير احفظ هذه القراءة محلياً دون أسرار،وطابقها مع `notification-before.json` الحالي بعد التصفير؛jobid يتغير بالتصفير فلا تستخدم أرقاماً قديمة.

```sql
SELECT jobname,schedule,command,active FROM cron.job ORDER BY jobname;
SELECT tgname,tgenabled FROM pg_trigger
 WHERE tgrelid='public.orders'::regclass
 AND tgname='trg_notify_new_website_order_push';
```

| الاسم | الحالة المعروفة | التفعيل المشروط | التحقق/التوقف |
|---|---|---|---|
| cleanup-guest-order-gateway-requests | active في عقد الحجز | لا تغيير | الغياب أو اختلاف command/الحالة يستلزم مراجعة،لا إعادة إنشاء تخمينية |
| run-advanced-monitoring | مؤجل مثبت: internalScanHeld:true في آخر Watchdog | معاملة A أدناه بعد البيانات | «افحص» وآخر scan حديث healthy/0،ثم Watchdog internalScanHeld:false؛critical يمنع الفتح |
| scan-core-business-alerts | inactive حسب عقد الحجز؛تُقرأ حالتها المستضافة D-1 | معاملة B بعد توجيه الأعمال | آخر تشغيل succeeded ووصول للمالك وحده |
| scan-business-summaries | مثل السابق؛الإعدادات الافتراضية تتيح الملخصات | معاملة B | راجع business_alert_settings؛اليومي 08:00 والأسبوعي الاثنين 09:00 بتوقيت Asia/Amman افتراضياً؛اعتماد المالك أو مسار إعداد معتمد |
| expire-stale-new-website-orders | مثل السابق؛يحرر الحجوزات وينشئ outbox | معاملة B | لا طلبات تجربة؛الحجز والعدد صحيحان؛لا تفعيل مبكر أثناء تجربة أحد |
| trg_notify_new_website_order_push | D حسب عقد الحجز،دون إعادة قراءة مستضافة هنا | بعد Vault و Edge واشتراك المالك: `BEGIN; ALTER TABLE public.orders ENABLE TRIGGER trg_notify_new_website_order_push; COMMIT;` | tgenabled=O وطلب واحد يصل؛تعريف trigger مختلف أو مستلم إضافي يوقف التفعيل |

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

بعد التفعيل يراجع Claude آخر نتائج `cron.job_run_details` و outbox وسلامة الداتا،ثم يفعّل Workflow فرانكفورت وحده في n8n. إذا وصلت رسالة أعمال للمطوّر أوقف workflow فرانكفورت وراجع الوجهة؛لا تحرك سجلات المال لعكس رسالة. عند الحاجة لإعادة الحجز،يلزم انتقال معتمد يستعمل اللقطة الجديدة؛لا تعكس ب jobids قديمة.

**Edge ليست cron:** خمس دوال بالمصدر: submit-guest-order و manage-staff-users و admin-ai-assistant و n8n-alert-feed و send-order-push. لا يوجد في الجرد المحلي إثبات حديث لكل نسخها المنشورة؛يوم D-1 يقارن Claude حالة Frankfurt Edge و SHA و Secrets مع النسخة المقبولة. إذا غابت دالة أو كانت قديمة،بعد كلمة «انشر» الخاصة بها فقط،من checkout الإصدار:

```powershell
npx.cmd supabase functions deploy submit-guest-order --project-ref kzevmysfydaslxcerogt --no-verify-jwt
npx.cmd supabase functions deploy manage-staff-users --project-ref kzevmysfydaslxcerogt
npx.cmd supabase functions deploy admin-ai-assistant --project-ref kzevmysfydaslxcerogt
npx.cmd supabase functions deploy n8n-alert-feed --project-ref kzevmysfydaslxcerogt --no-verify-jwt
npx.cmd supabase functions deploy send-order-push --project-ref kzevmysfydaslxcerogt --no-verify-jwt
```

نفذ الدالة المحتاجة فقط،وتوقف عند exit غير صفر. لا تعطّل JWT للدوال الأخرى. تحقق من CORS/Origin و Turnstile والأدوار و MFA،وأن manage-staff-users يرفض غير المخول قبل AuthAdmin. النشر لا يفتح المتجر؛ordersEnabled والتريغر و cron والمستهلك بوابات مستقلة.

قبل فك الحجز شغّل `npm.cmd run frankfurt-owner-upgrade214 -- --verify-only` وفق [دليله](FRANKFURT_OWNER_UPGRADE214_AR.md). بعده تختلف حالة trigger/cron عن مرجع التجربة عمداً؛لا تُعدّل المرجع أو ACL لجعل verifier التجربة أخضر. يسجل انتقال الحجز المسمى في تقرير تشغيل معتمد،ويبقى التحقق الصارم لبقية الداتا والمنح والمالكين. تجهيز أداة انتقال الحجز المحروسة جزء لازم قبل تنفيذ هذه الخطوات؛SQL هنا يبين الأوامر الدقيقة وليس ترخيصاً بتجاوز مقارنة الكتالوج.

## 7. الواتساب والهوية — يوم التشغيل فقط

| خطوة | المنفذ/المكان | التحقق والتوقف |
|---|---|---|
| 7.1 الرقم المحفوظ | المالك: «الإدارة ← إعدادات المتجر ← رقم واتساب»: `962785857700`؛للعرض `+962 7 8585 7700` | حفظ ثم إعادة فتح الإعداد والمتجر،ورسالة تصل لهاتف المحل. بقاء 0772838886 أو 962772838886 في رابط مستخدم يمنع الفتح |
| 7.2 البناء | Claude: `VITE_STORE_WHATSAPP_NUMBER=962785857700` لجلسة Production المحلية ولوحة Pages Production؛Preview منفصل | Checkout و wa.me وروابط header/footer تستعمل الرقم الرسمي حتى fallback؛env لا يصلح إعداداً محفوظاً قديماً وحده |
| 7.3 الهوية | المالك: الاسم «النواصرة لتجارة الجملة والمواد الغذائية» والشعار؛Claude يراجع SEO/JSON-LD/manifest ورأس الوصل وخدماته | الوصل وإعادة طباعته والرابط العام و title/og/schema.org والأيقونة وروابط tel/WhatsApp من الهاتف والكمبيوتر؛رقم مطوّر أو اسم قديم في المخرج العام يوقف النشر |

الافتراض التجريبي ما زال في `customer-web/src/config/store.ts` و StorefrontSettingsModal؛لا تغيّره هذه الحزمة. قبل الإطلاق تراجع fallback paths في حزمة التحويل المعتمدة ويثبت أن كل رابط إنتاج يستعمل الرقم الرسمي المحفوظ/العام. وجود رقم في اختبار تاريخي لا يعني رابطاً خاطئاً؛لا تُحذف الاختبارات لتصفير بحثنصي. الفيديو ورقم التجربة لا يتغيران قبل يوم التشغيل.

## 8. النشر — بعد كلمة «انشر» فقط

| خطوة | المنفذ/الأمر أو المكان | التحقق والتوقف |
|---|---|---|
| 8.1 مصدر نظيف | Claude: clone إصدار مستقل على main،مثلاً `C:\Users\TOP\NawasrahReleases\go-live-approved`؛إذا وُجد لا تكتب فوقه. يمكن `git clone --depth 1 --branch main --single-branch https://github.com/OBITO20011/mahdi-admin.git C:\Users\TOP\NawasrahReleases\go-live-approved` بعد الموافقة | HEAD يطابق قرار المالك و origin/main و CI. لا تحذف docs المعدلة في المجلد الرئيسي لتنظيفه؛ولا تنسخ ملفات env جملةً من بيئة التجربة |
| 8.2 القيم العامة | Claude بمساعدة المالك: جلسة البناء أدناه،Productionbranch=main في Pages للمشروعين؛مراجعة config الذي يقرأه SEO أيضاً | URL/المفتاح العام لفـرانكفورت؛Turnstile للنطاق الرسمي؛لا service_role أو أسرار R2/Telegram في VITE. أي اختلاف يوقف البناء |
| 8.3 النشر | Claude بعد «انشر»: الأوامر أدناه،خطوة بعد نجاح سابقتها؛تسجيل deploymentID و SHA | الإدارة ترفع dist إلى nawasrah-admin،المتجر customer-web/dist إلى nawasrah-store؛الدومينان admin.alnawasreh.com و alnawasreh.com. HTTP200 وحده لا يثبت المسار الوظيفي |
| 8.4 PWA | المالك يحفظ أي بيع جارٍ ثم يفتح المتصفح والأيقونة ويقبل تحديث التطبيق ويغلق ويعيد الفتح | release/build يطابق SHA؛لا اختلاف بين المثبت والمتصفح. لا مسح عشوائي لبيانات الجهاز أثناء بيع |
| 8.5 أول بيع | المالك يفتح ordersEnabled وينفذ بيعاً **حقيقياً** معلوماً،طرد ووحدة حسب المسموح،باركود وطباعة ومشاركة وإعادة طباعة؛وطلب متجر واحد لاختبار push | الدرج=الافتتاحي+الكاش المقبوض−الخروج المعتمد،CliQ خارجه؛ثلاثة أرصدة مخزون والذمم والربح متطابقة،push له وحده. فرق قرش/حبة يوقف المسار |
| 8.6 القبول | المالك/Claude: «افحص»،Status/Watchdog،آخر scan و cron/outbox،ثم نسخة مشفرة بعد القبول | healthy/0 ومطابقات موقعة. لا مبيعات تجريبية في بيانات المحل ولا ادعاء إطلاق قبل هذا القبول |

أوامر المستقبل من clone النظيف،وليست أوامر منفذة هنا. `deploy:admin` يفرض main/clean/remote ويضع releaseId بالـ SHA؛نشرالمتجر لا يفرض هذه الحراسة بنفسه فيجب تحققها قبله:

```powershell
Set-Location C:\Users\TOP\NawasrahReleases\go-live-approved
function Invoke-ReleaseStep { param([scriptblock]$Step)
  & $Step
  if ($LASTEXITCODE -ne 0) { throw 'فشلت خطوة الإصدار؛توقف.' }
}
$env:NAWASRAH_DEPLOYMENT_ENV='production'
$env:VITE_SUPABASE_URL='https://kzevmysfydaslxcerogt.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY=Read-Host 'المفتاح العام المعتمد لفرانكفورت'
Remove-Item Env:VITE_SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
$env:VITE_TURNSTILE_SITE_KEY=Read-Host 'مفتاح Turnstile العام المعتمد'
$env:VITE_STORE_WHATSAPP_NUMBER='962785857700'
$env:VITE_STOREFRONT_PUBLIC_URL='https://alnawasreh.com'
$env:VITE_PUBLIC_SITE_ORIGIN='https://alnawasreh.com'
Remove-Item Env:VITE_BROWSER_QA_ISOLATED -ErrorAction SilentlyContinue
Remove-Item Env:NAWASRAH_SEO_AUDIT_API_URL -ErrorAction SilentlyContinue
Remove-Item Env:NAWASRAH_SEO_AUDIT_API_KEY -ErrorAction SilentlyContinue
Invoke-ReleaseStep { npm.cmd ci }
Invoke-ReleaseStep { npm.cmd --prefix customer-web ci }
# النشر أدناه بعد كلمة المالك انشر فقط.
Invoke-ReleaseStep { npm.cmd run deploy:admin }
Invoke-ReleaseStep { npm.cmd --prefix customer-web run deploy:cloudflare }
```

إذا احتاج التحويل تعديل fallback/CSP/SEO، يُراجع ويُدمج مع CI قبل هذه الأوامر؛لا تعديلات عابرة على checkout أثناء النشر. بعد نجاح القبول تُعاد **مهام فرانكفورت فقط** إلى حالات تمكينها المسجلة في 2.1؛تُثبت 5 مهام SYSTEM وآخر نجاح،ويبقى القديم كما هو.

## 9. خطة الرجوع

| الحالة | المنفذ والعمل | التحقق وما يمنع إعادة الفتح |
|---|---|---|
| قبل أول بيع | المالك يوقف الإطلاق؛Claude يغلق الواجهات ومستهلك فرانكفورت ويعيد حجز الإشعارات بانتقال معتمد من snapshot الجديد | لا كتابة جديدة؛أرشيف ما قبل التصفير محدد بالاسم والحجم و SHA. لا استرجاع فوق القاعدة الحية |
| بعد بيع أو تحصيل | المالك يوقف الرقمي ويستخدم الدفتر؛تحفظ نسخة حادثة جديدة ووقت آخر عملية،ثم كل السندات بين النسخة السليمة والتوقف | حسم الفجوة ومطابقة الدرج؛إذا لم تحسم العمليات فلا إعادة فتح،ولا إسقاط مبيعات حقيقية عند الاسترجاع |
| أرشيف فرانكفورت | Claude يتبع [RUNBOOK الاسترجاع](FRANKFURT_BACKUP_RESTORE_RUNBOOK_AR.md): VerifyRemote/RestoreRemote أو Restore محلي للأرشيف المحدد،ثم خطة DR مستقلة لاستعادة خدمة على هدف موافق عليه | نجاح كامل للصفوف والبصمات والأدوار و ACL والتسلسلات والصور و 17 فحصاً و 176migration حتى 214. عدد الجداول هو العدد الفعلي للنسخة،143 في النسخة المثبتة. أدوات Restore الحالية **لا تقبل targetURL ولا تستعيد مشروعاً حياً**؛لا يوجد هنا أمر آمن جاهز لاستبدال Supabase الحية |
| سنغافورة | محفوظة للرجوع والنسخ دون تغيير أسبوعاً. مراجعة نسختها وإصدار التطبيق المطابق لها بإجراء DR خاص،لا بمجرد تبديل VITE_URL | سقفها وداتاها والصور والأسرار قد تختلف عن فرانكفورت 214؛قد لا تحتوي البيانات الحقيقية الجديدة. الكتابة إليها خلال أسبوع الحفظ ممنوعة؛أي خروج طارئ عن القرار يحتاج موافقة مالك صريحة |

تراجع deployment واجهة يصلح لعيب واجهة متوافق مع نفس القاعدة؛لا يعكس دفعة أو حركة مخزون أو ترقية. لا يرفع dump إلى SQL Editor،ولا يتصل Codex بهدف. **قرار المالك26أكتوبر:** الاستمرارية أول أسبوعين هي الدفتر الورقي بالتوازي والنسخ اليومي المثبت. أداة الاسترجاع إلى مشروع حي تُبنى **بعدT+7** وتُختبر على سنغافورة التجريبية؛**ليست بوابة للإطلاق**. أدواتRestore الحالية محلية فقط؛عند العطل نوقف الكتابة الرقمية ونوثق العمليات بالدفتر حتى استعادة موثقة،ولا نَعِد بتحويل حي فوري.

## 10. بعد أسبوع كامل — سنغافورة بيئة تجريبية دائمة

موعد T+7 أو أكثر،بعد اعتماد استقرار فرانكفورت وتوقيع المالك. يبدأ الأسبوع من أول تشغيل حقيقي موثق،لا من دمج PR أو أول Backup. لا جدولة تلقائية لهذه الخطوات.

| خطوة | المنفذ والمكان أو الأمر | كيف نتحقق وما يوقفنا |
|---|---|---|
| 10.1 أرشيف أخير | المالك/Claude بإعداد القديم فقط: `npm.cmd run backup:run` ثم `backup:verify` و`backup:restore-test` و`offsite:upload` و`offsite:verify` وفق أدلته | نسخة مشفرة واسترجاع ناجح وسجل SHA؛تحقق Storage للقديم منفصلاً،فنجاح فرانكفورت لا يثبت كل صور سنغافورة. إن كان نطاقه ناقصاً يلزم أرشفة صور معتمدة قبل المسح |
| 10.2 إيقاف القديم | Claude يحصر TaskScheduler/Actions التي تستهدف acjtab... و watchdog و n8n و cron قبل تعطيلها. من المعروف Nawasrah ERP Nightly Backup و Nawasrah ERP Quarterly Restore Drill؛يعطّل Workflow القديم وإشعاراته فقط | جدول before/after يثبت استمرار 5 مهام فرانكفورت وحارسها. ممنوع wildcardNawasrah* أو وقف Docker المشترك أو تغيير R2lock. إذا لم يظهر حارس القديم في حسابه،يحصره كمسؤول ولا يفترض توقفه |
| 10.3 إعادة البناء | المالك يعتمد إجراء destructive مستقلاً لسنغافورة؛Codex يجهز أداة محروسة لهويتها وإعادة كل migrations المعتمدة حتى السقف وقتها مع الفجوات المقصودة؛Claude ينفذ بعد PR/CI وموافقة | **لا تستعمل frankfurt-trial-reset أو owner-upgrade214**؛كلاهما يرفض القديم. أداة إعادة سنغافورة المحروسة غير مقدمة بهذه الحزمة،ولا SQL يدوي بديل عنها |
| 10.4 عزل staging | Claude يعطّل إرسال cron/Push/Edge consumers و Telegram و keep-alive للقديم،ويضع أسرار test مستقلة بعد الأرشفة؛بيانات وهمية فقط | لا دين أو اسم أو صورة عميل حقيقية،ولا VAPID أو توكن إنتاج أو ربط R2/Telegram/WhatsApp حي من بيانات الاختبار. cleanup داخلي بلا إرسال مسموح |
| 10.5 ربط previews | بعد تجهيز runtime/SEO/CSP:Preview env URL ومفتاح عام لسنغافورة،والـ fallback أو سياق البناء المعتمد؛Production يبقى فرانكفورت | بناء SEO و Network بحظر أي طلب لفرانكفورت؛اختبار Auth/MFA/Storage/PWA والطلبات على بيانات وهمية. لا يعاد فتح preview فرانكفورت القديم |
| 10.6 دورة التطوير | Codex/Claude:كل تغيير worktree/PR/CI ثم staging وتجربة المالك،ثم موافقة production بـ SHA ثابت | لا اختبار على بيانات المحل. الإيقاف التلقائي المجاني لـ staging مقبول؛لا keep-alive أو حارس لمنعه،ولا يستعاض بفرانكفورت عند توقفه |

لا تحذف النسخ القديمة أو المفتاح من R2 ولا تغيّر lock بسبب وقف المهام؛تغيير الاحتفاظ قرار مستقل. لا تُمس سنغافورة قبل T+7 ولو كان المصدر الحالي جاهزاً.

## 11. أول أسبوعين

| التكرار | المالك | Claude/المطوّر | التوقف والتصعيد |
|---|---|---|---|
| كل عملية | دفتر ورقي بالتوازي برقم الفاتورة وطريقة القبض والمصاريف والسحب؛الوصل ونوع السطر ومصير المعيب والمعلّق | أخطاء النظام ومسار إعادة الطباعة والسجل | فرق مالي أو مخزني:إيقاف المسار المتأثر،حفظ السند والوقت،ولا SQL تصحيح |
| نهاية اليوم | عد الدرج ومقارنته بالمتوقع،عد 3 أصناف متغيرة،ذمة زبون ومورد،ربح اليوم والمقبوض حسب الطريقة؛توقيع الورقة | «افحص» يومي وآخر scan داخلي و cron/outbox و Status وعمر Backup/Upload و RestoreRemote | فرق قرش أو حبة أو critical؛إبلاغ المطوّر وحفظ نسخة قبل أي إصلاح معتمد |
| الصباح وإعادة تشغيل الجهاز | PWA محدث والطابعة والباركود و Push على هاتفه فقط | Docker و SYSTEMtasks وحارس فرانكفورت و keep-alive و 400MB والنسخ R2 | جهاز نائم لا ينفذ مهام Windows؛healthy لا يغني عن حداثة الأوقات |
| D+7 و D+14 | مراجعة الدفتر وقبول الاستقرار | تقرير النسخ والاحتفاظ 90/365 والقفل 30 دون تغيير،الأداء والثغرات و M01 | لا تحويل لسنغافورة قبل توقيع D+7؛السنوي يبقى معالجة مؤجلة بعد التشغيل،لا timeout أكبر كحل |

## ملحق أ — جرد الحالة الحالية وحدود الإثبات

الدليل المنقح [GO_LIVE_CURRENT_STATE_EVIDENCE.json](GO_LIVE_CURRENT_STATE_EVIDENCE.json) يتضمن المصادر والأوقات وبصمات التقارير. لم يُستدع Status أو Watchdog من الوكيل؛قُرئت الملفات المحلية فقط. التقارير لا تثبت الحالة المستضافة بعد وقتها.

| العنصر | الحالة المثبتة | المصدر والحد |
|---|---|---|
| main |3783d2df،FULL47/47 |[PR30](https://github.com/OBITO20011/mahdi-admin/pull/30)،quality40258970622،recovery40258970589،secrets40258970465؛أدلة main-full-scope محلية |
| Backup |2026-10-25T21:55Z تقريباً؛7644213 بايت؛SHA256 `4a1c0f2fa39046bf6196724814970d7763273a393751b24b307199f0c473b6c9` |إفادة المالك وتطابق SHA في offsite-status؛لم يُقرأ الأرشيف |
| Restore محلي |2026-10-26T02:26:02.280Z؛143 جدولاً،17healthy/0،214،3 صور،ACL مطابقة،exceptionsApplied[] |`C:\ProgramData\NawasrahFrankfurtBackup\restore-local.json`؛143 عدد نسخة المالك وليس 141 عدد fixture |
| R2 |Upload13:03:05.095Z،Verify13:03:13.935Z،RestoreRemote13:03:41.787Z بتاريخ 26 أكتوبر،كلها ok |offsite-status و restore-remote و operation-*؛الاسترجاع البعيد 143/17/3 بلا استثناء |
| الاحتفاظ |daily90 و monthly365 تحت erp/frankfurt-kzevmysfydaslxcerogt/؛7 قواعد،5 قديمة كماهي؛erp-lock-30d على erp/ يغطي الجديد |إفادة المالك عن wrangler4.152.0؛لا remove/set للقفل،ولا اتصال بحساب R2 من الوكيل |
| Register |5 مهام Frankfurt SYSTEM؛Backup23:50،Upload02:35،VerifyRemote الأحد 03:10،RestoreRemote03:50 ببوابة 90 يوماً،Watchdog كل 5 دقائق بتوقيت Windows |إفادة المالك أن Register ناجح. جرد حساب الوكيل غير المرتفع أظهر 3 مهام قديمة فقط؛ليس دليلاً على غياب SYSTEM |
| Watchdog |2026-10-26T13:14:03.946Z؛ok/healthy،11/11،recipient=developer،internalScanHeld:true |watchdog-status؛لا يعني فحصاً حياً داخلياً للمحاسبة عند حجز scan؛النسخة فُحصت بالاسترجاع |
| TestAlert و Status |TestAlertok للمطوّر،وكل operation ملف حالي ok:true؛Statusok بإفادة المالك |test-alert و operation-*؛الأوقات بالدليل. config محمي ولم يقرأه الوكيل أو يفك DPAPI |
| cron |scan الداخلي مؤجل برصد Watchdog؛بقية الأسماء والـ Push حسب عقد الحجز بالقسم 6 |لم تُقرأ cron.job المستضافة؛حالتها الفعلية ومعدلاتها تُلتقط D-1 |
| n8n الفعلي |nawasrahTelegramAlerts نشط و claim/complete لسنغافورة؛chat و credential مضبوطان،هوية المستلم غير مثبتة. WhatsApp غير نشط |قراءة SQLite محلية readOnly داخل nawasrah-n8n؛لا HTTP ولا فك credentials؛لا Workflow فرانكفورت مثبت في الجرد |
| الشغل و Push |قالب Frankfurt enabled=false و ownerTelegramChatId=null؛Push مؤجل؛اشتراكه و SecretsEdge لم تُراجع مستضافاً |routing.example والمصدر وعقد الحجز؛لا يوصف المجهول بأنه «مفعّل» |
| preview |fallback و SEO و CSP لفرانكفورت؛آخر إفادة staging-frankfurt في الدليل السابق؛لوحة Pages الحالية لم تُقرأ |config/_headers/SEO؛الثلاثة env المحلية المفحوصة لا VITE_SUPABASE_URL أو VITE_STORE_WHATSAPP_NUMBER فيها. لا يثبت ذلك قيم Pages أو Access |
| H02 |مغلق:Vite6.4.4 بالبيان وال lock والتثبيت،localhost افتراضي،express ليس productiondep؛auditproduction0/0 |fullaudit:3high أدوات إدارة و 5high أدوات متجر؛Vite ليس ضمن المتأثر. لا زعم بزوال كل تنبيهات التطوير |
| H03 و M01 |H03 مغلق بـ 213؛M01 مؤجل بعد التشغيل |migration213 و HANDOVER_SECURITY_Y و OWNER_DECISIONS؛لم تُعد قياسات السنوي ولم تُعدل أعمال المال |

## ملحق ب — قرارات المالك المعتمدة26أكتوبر2026

1. RESET214:يبقى المالك المختار معAuth/MFA وprofile/دوره،وBR-MAIN/WH-MAIN،وstorefront_settings المخصصة والوحدات والأقسام المخصصة،وVault/Auth/Edge. يُحذف كل مستخدم تجربة آخر وكل بيانات الأعمال وصور المنتجات التجريبية. الحزمة1 مستقلة،ثم اعتماد قبل الدمج؛لا تنفيذ الآن.
2. تنبيهات الشغل إلىTelegram صاحب المحل وPush الطلب الجديد إلىهاتفه. الافتراضي00:00 Asia/Amman قابل للضبط،وينتظر فقط تأكيد منتصف الليل أو الظهر. التقنية للمطوّر. تجهيز ذلك في الحزمة3 دون تفعيل.
3. previews مغلقة يوم التشغيل إلىT+7،ثم سنغافورة مستقلة وفق القسم10؛فصلruntime/SEO/CSP بالحزمة2.
4. أول أسبوعين:الدفتر الورقي والنسخ اليومي المثبت. أداة الاسترجاع الحي بعدT+7،تُختبر على سنغافورة التجريبية وليست بوابة للإطلاق. تبقى موافقة «انشر» للـSHA والهدف،وساعة القطع وأرشيف ما قبل التصفير لازمة.

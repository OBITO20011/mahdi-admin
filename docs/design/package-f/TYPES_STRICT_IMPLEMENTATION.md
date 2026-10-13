# تفعيل strict — سجل العائق والإصلاح المستقل

الحالة الحالية: المالك اعتمد استكمال strict بعد تسليم إصلاح الملف الشخصي
وتوثيق فرانكفورت. تصحيح المنتج محلي قيد الفحص:20→0؛تبقى62 في الاختبارات.
strict لم يُفعّل،ولم تُسلّم دفعة المنتج قبل اكتمال CI.
الأقسام الأولى أدناه سجل التشخيص والتوقف السابق؛ نتائج الإصلاح في النهاية.

2026-10-13،الأساسf1743075e68fa93f53d092fbd75dd77b6375e95f.
الترتيب المعتمد:تشخيصاتالمنتج21 أولاً،ثم الاختبارات62،ثمstrict=true؛
commit مستقل لكلدفعة معبواباتمحليةمتعلقة/Gitleaks0/CIكامل ثمcheckpointوتوقف.
ممنوعany/تجاهل/تحويلمزدوج/تعطيلقواعد؛مقارنةASTلاستدعاءاتكلملفمنتجمعدّل.

## القياس الجديد قبل أي تعديل

agent:resume وpreflight ناجحان. measure-types-strict.mjs يثبت83تشخيصاً:
21src +17e2e +45tests؛نفس القياس السابق رغمإصلاحالتركيز. المترجمفعّل
strict فيالذاكرةفقط؛tsconfig ومصادرالمنتجوالاختباراتومigrationsبلامساس.

## عائق سلوكي في تحديث حساب المستخدم

auth.service.ts:184 يستدعيauthUpdateData.user.email.toLocaleLowerCase()
معأنemail اختياري بعقدSDK. الحارس الموجود يثبتuser فقط،لاemail.
فيupdateMyProfileInSupabase،يأتيهذاالاستدعاءبعدauth.updateUser ثمRPC
update_my_erp_profile الناجحين. ProfileModal:354 ينتظرنتيجةالدالةقبل
refreshCurrentUser؛الاستثناءيحوّلالواجهةإلىرسالةخطأبدلاًمنالتحديثرغمالحفظ.

إثبات معزول:تحميلالمصدرالحاليبـTypeScript transpile وvm،واستبدالعميل
Supabase بـstub فيالذاكرةفقط. لاشبكة/DB/Production أوبياناتحقيقية:

| رد updateUser | الاستدعاءات | النتيجة |
|---|---|---|
| user موجود،email غيرموجود | auth.updateUser ثمupdate_my_erp_profile،كلاهماsuccess | Cannot read properties of undefined (reading 'toLocaleLowerCase') |
| user موجود،email مطابق للبريد الجديد | نفس الاستدعاءين | emailConfirmationRequired=false |

أداةالإثبات خارجالمستودع:%TEMP%/nawasrah-strict-profile-diagnosis-20261013.mjs.
هذايثبتقابليةالمسارللفشلبرَدّيسمحبهعقدSDK؛لايثبتحدوثهفيProduction أو
أنSupabase يردكذلكفعلاًلحساباتالمحل. لمتُثبتثغرةصلاحياتأوتغييرفيالأدوار،
لكنإخفاءالسبببـnon-null assertion أوقيمةبديلةليسإصلاحأنواعصحيحاً.

## القرار المطلوب — لا تنفيذ

اقتراح:إذاكانتعمليتاالحفظناجحتينوالبريدغيرموجودفيالرد،تمييز«تمالحفظ،
حالةتأكيدالبريدغيرمعروفة»عنالفشل،وتمكينتحديثعرضالحساب دونالادعاءبإرسال
رسالةتأكيد. يلزمقرارالمالكعلىهذاالسلوكوالرسالة قبلأي تعديلللدالة/الواجهة.
لااعتمادلقيمةبريدتخمينيةولاتغييرمصادقة/صلاحيات/RPC/حمولات.

الدفعةلمتبدأإصلاحالمنتجولميوجدcommit/pushجديد؛باقيالتشخيصاتمؤجلة
لحسمهذاالعائق. نتيجةCIلإصلاحالتركيزf174307 (22/22+الأسرار) ليست بوابة
قبوللstrict؛لاادعاءتسليمإعدادstrict أوانخفاضعددالتشخيصات.

## 2026-10-13 — الإصلاح المعتمد والبوابات المحلية

emailConfirmationRequired صارboolean|null: false عندما لم يتغيرالبريد أو
أعادالخادم البريدالجديد،true عندإعادةبريدمختلف،null عندنجاحالحفظبلامعلومة
بريدتثبتحالته. null ليستفشلاًولاادعاءبإرسالتأكيد. ProfileModal يتابع
refreshCurrentUser الموجود ثم يعرض«تم الحفظ؛ تعذر التحقق من حالة تأكيد البريد.»
حراسةauth/RPC/success:true والرفض الحقيقي وتحديثالصلاحيات بقيت كماكانت.
لا تغييرAuthStore/جلسة/أدوار/RPC/حمولات/DB أوtsconfig.

الحراس الدائمة:

- profile-save-outcome.test.ts:5نجاحات (بريدغائب/فارغ/قديم/جديدبأحرفمختلفة/
  بريدغيرمتغير) و4أخطاءحقيقية؛كلالحمولاتexact. تحميلالمصدرالحقيقيفيvm مع
  عميلذاكرةفقط. أولتوقعاحتاجspread/structuredClone بسببprototype مختلفبين
  vm والمضيف،لا بسببخطأبالقيم؛المعادلةوالحمولاتوالتوقعات بقيتكاملة.
- AST50استدعاءللخدمة و196للواجهة مطابقf174307؛تطبيعفرقينمعتمدينفقط:
  aliasالبريد وشرطرسالةنجاحالحفظ. كلحراسةالكتابةوالحمولاتقبلreturn ثابتة
  ببصمتهاالأصلية. لا تغييرلمقارناتالتحققالماليةأوالصلاحيات.
- package-f-remaining-batch1: بصمةhandleSaveProfile وحدهاحُدّثت للرسالة؛
  كل15استدعاءأعمال و37binding و77خاصيةnative وبقيةالمعالجات ثابتة.
- profile-save-outcome.spec.ts:4حالات فاتح/داكنفيChromium/WebKit للنموذج
  الحقيقي،Authبلاميل،RPCالحفظ،profiles+user_roles بمسارالتحديثالحقيقي،
  الاسم المحدّثظاهر والرسالةمرئية ولاادعاءبإرسالتأكيد،والحمولاتexact.
  harness يضيفAdminToast الموجودفقط لعرضرسالةالتطبيق الحقيقية.

النتائج النهائية:

- focused14/14 (10نتائج/AST+4حراسقديمة)،والواجهةالجديدة4/4.
- typecheck/lint للتطبيقين،966Admin/191Customer units،exit0
  12:26:55.297–12:29:55.724UTC؛التحذيراتالعامةالثلاثةسابقةبلامساس.
- كلspecsالمرتبطةبالمساراتالمنقولةللملفالشخصي:238/238،بالمتصفحين،
  retries0،exit0 بين12:30:09.990–12:54:49.613UTC؛الشجرةمجمدةأثناءها.
- strictفيالذاكرةفقط83→82 (src21→20،tests/e2e62بلامساس)،ولا تشخيص
  جديدفيالاختبارينالجديدين. باقيتفعيلstrict مؤجل،لا ادعاءإكمالدفعةالمنتج.
- عزلالمتصفحناجح وصفرطلباتProduction/خارجية وdiffcheckناجح؛بوابات
  Gitleaks/commit/push/full exactCI لازمةقبلالتسليم ثمcheckpointوتوقف.

## 2026-10-13 — الدفعة الأولى: أنواع المنتج فقط

الأساسf2c37bd0e4ebec9f525b426e66e67df66b36fdbe؛resume/preflight PASS.
قياس جديد82=src20+e2e17+tests45. بعد التعديلات src0+tests/e2e62.

- CustomerDetailView:مرجع const لنتيجة customer بعد الحارس قبل callback،
  دون تغيير صفحة القراءة أو دمج السجل أو شروطه.
- DirectReceivingView:مجموعة أسماء الموردين تقبل undefined الذي يسمح
  به عقد SupplierReceipt؛join كما هو،لا اختراع اسم أو قيمة مالية.
- posV2Cart:baseQuantity مطلوب لعناصر سلة POS. كل منشئ في PosView
  (قطعة/طرد من صنف واحد/طرد مشكل) وكل تحديث كمية يملؤه بالفعل.
  لم تُضف قيمة بديلة ولم يتغير الجمع أو payload.
- ProductFormModal:نتيجة الحفظ بعقد SupabaseRpcResult الموجود،ومعامل
  صورة النكهة يقبل null الذي يمرره المستدعي والحارس يرفضه كما كان.
- CreatePurchaseOrderModal:res بعقد الإنشاء الموجود،الذي يضم الحقول
  الاختيارية ويغطي عقد التحديث أيضاً؛لا إضافة ID لرد الخادم.
- useAppStore:معامل تفضيلات الإشعارات NonNullable؛المستدعي الحالي
  يمرر النموذج الكامل. الدمج والتدقيق والإشعار كما هي،لا افتراض إعدادات.
- الخدمات crm/dashboard/directReceiving/orders/posV2/purchases/
  salesAftercare/stockAlerts:const client=supabase بعد أخذ المرجع وقبل
  حارس الاتصال؛callbacks تستخدم المرجع المثبت،نفس RPC والقنوات والمعاملات.
- adminAssistant:حارس عميل غير مهيأ فقط برسالة فشل التواصل العامة
  الموجودة في الواجهة؛لا تغيير أدوار أو Edge invocation أو body.

strict-product-parity.test.ts يقارن كل عقد AST للـJavaScript المترجم
وكافة الاستدعاءات مع الأساس لكل15ملفاً،لا مجرد قائمة RPC مختارة.
التطبيع محصور في محو الأنواع وconst aliases المثبتة بنفس initializer
وbranch المساعد غير المهيأ المحدد حرفياً؛guards/حمولات/onChange/التأكيدات
والحسابات كاملة محفوظة. مجموع الاستدعاءات2770 بعد محو أنواع JSX.

العقود القديمة المعدلة،بلا إزالة أي assertion:
package-f-home:client.rpc مرة واحدة+إثبات alias؛package-f-customers:
بصمة loadMoreHistory فقط؛remaining-batch2:prefix ProductFormModal لفرق
أنواع result/File|null؛remaining-batch3:بصمتا CreatePurchaseOrderModal
وDirectReceivingView لفرق الأنواع فقط. بقية بصمات الحمولات/المعالجـات ثابتة.
الفحص المركّز36/36،ومن قبله18/18 POS recovery/capacity PASS.
لا تعديل DB/RPC/صلاحيات/auth أو001–138/tsconfig. بوابات الدفعة مستمرة.

جولة الوحدات الأولى981حالة:973PASS/8 توقعات قديمة لم تعد تطابق نص
الأنواع/aliases. customer-statement-ui،dashboard-home،auth-assistant،
phone-polish،receiving-unit-pricing إضافة إلى الأربعة أعلاه حُدّثت
بلا حذف تأكيدات. strict-product-legacy-source يستعيد فقط التهجئة السابقة
للأنواع وaliases لهذه البصمات التاريخية،مع بقاء حارس AST الكامل مستقلاً
على الملفات الحقيقية. لا normalization لمعادلة مالية أو مقدار أو صلاحية.

البوابات النهائية للمنتج:981/981 Admin و191/191 Customer،typecheck/lint
للتطبيقين وبناء الإدارة وعزل الشبكة PASS. تشغيل المتصفح الكامل المحافظ
(useAppStore مشترك وخريطة الاعتمادات ترجع unmapped-change)907PASS+59
تخطيات شرطية قديمة،retries0،بالمتصفحين ومشروع Chromium للهاتف. انتهى
السجل المستقل14:57:11.099–16:22:41.708UTC،exit0 وunchanged=true لكل
الملفات المتتبعة والحارسين الجديدين. لا إعادة أو رفع مهلات أو أي تعديل
متتبّع أثناء البوابات. ملفات DB/حمولات الخدمات لم تتغير؛اختبارات SQL
لا تعتمد على تعديلات الأنواع،والـCI الكامل يظل بوابة runtime الإلزامية.
Gitleaks/commit/push/full exactCI لازمة قبل تسليم دفعة المنتج.

تم تسليم دفعة المنتجd7e0e8ceb07b20473cd798339e62753ad1c5346f؛
Gitleaks staged exit0،quality38430511595 كامل22/22،secrets38430511631
PASS على نفسpush/main SHA. HEAD=remote،وحارس اكتمال كل المهام الرسمي
PASS عبر metadata عامة بلا قراءة اعتماد GitHub. checkpoint ACTIVE للدفعة
المعتمدة التالية:62تشخيص اختبارات؛tsconfig لم يتغير بعد.

## الدفعة الثانية —62تشخيص اختبارات/e2e

القياس في الذاكرة صار0(src0+tests/e2e0)،tsconfig ما زال دونstrict.
لا تعديل لأي ملفsrc أوcustomer-web أوDB أوworkflow في هذه الدفعة.
التصحيحات:annotations للـcallbacks/results/cleanup وDTO السباق الموجود؛
capture object للردود التي تُملأ داخل callbacks بدل narrowing إلىnever؛
حراس حضور إضافية للـproof/optimizer/range/state،وتوقيعfetch الصحيح.
رسالةassert.throws تستعمل overload(fn,message) المكافئ لـ(fn,undefined,message).
حالات SEO نفسها وenv نفسها،بـfixtures typed record بدلاًمن مفتاح مكرر
في inference. لا تغيير ساعات/مهلات/retries/كمية حالات/بيانات fixture.

12harness:URLغيرمهيأ يبقى Invalid URL عبر''،بلاfallback لشبكة حقيقية؛
NonNullable في type query لردAuth فقط،لا تغيير في المصادقة أوfake user.
أربع أدواتJS تحتاجJSDoc لتعريف حدودها الصحيحة بدلاًمنdefault=null فقط:
scheduled-task-status،supabase-daily-health،isolated-db-port-guard،
private-ci-scope. هذه تعليقات أنواع فقط؛أجسامها runtime مطابقة حرفياً بالـAST.

الحارسstrict-test-contracts32/32 PASS:أجسام12harness+أربع أدوات+DBsuite
متطابقة بعد محو الأنواع وتطبيع URL الفاشل فقط؛كل تأكيد أصلي في14ملف
باقٍ بنفس الترتيب والمعاملات والتوقعات،والحراس المضافة تزيد الفحص فقط.
اختبار مستقل يثبت رفض env المفقود والفارغ وغيرloopback. أدواتSQL/ملفات
001–138 غيرمعدلة؛بوابةCIالكاملة للـDB لازمة قبل تسليم الدفعة. البوابات
المحلية type/lint/all units وكل specs المتأثرة بالمتصفحين ما زالت مطلوبة.

بوابات الدفعة الثانية مكتملة:Admin1013/1013 وCustomer191/191،typecheck/
lint للتطبيقين وعزل الشبكة PASS. تشغيل32ملف متصفح مرتبط محافظاً،بالمتصفحين
ومشروع الهاتف المشروط:671PASS+52تخطيات شرطية معروفة=723،retries0.
السجل المستقل17:00:04.922–18:14:14.105UTC،exit0 وunchanged=true؛لا إعادة
أو تعديل متتبّع أثناء التشغيل. لا حذف assertion أو حالة أو تخفيف انتظار.

DB بالتتابع18:14:59.003–18:32:55.431UTC:Phase3 مع ceiling131 التاريخي
ثم وضع132 الحالي PASS؛أعيدت كل توقعات completionExpiryEvidence الأصلية
على JSON الحقيقي:9/9 لكل وضع،نفسwinner/oneTerminalEffect/immutableReplay.
daily-health على001–138:REST حقيقي+حجم DB،إعادة استخدام cache،إعدادات
بلا كتابة،تنبيه/تعافي وهميان PASS. runtime exit0 وunchanged=true؛كل
حاويات الفحص أُغلقت،لم تُمس حاويةn8n غير التابعة للمهمة. لا Supabase حقيقي.
Gitleaks/commit/push/full exactCI التالية قبل تسليم هذه الدفعة؛strict
في tsconfig لم يُفعّل بعد.

تم تسليم الاختباراتbf0ef2b27f2385eb33b1aacf2f9026335b69eb23 بعدGitleaks
staged exit0:quality38447970858 كامل22/22 وsecrets38447970805 PASS.
HEAD=remote؛checkpoint ACTIVE للدفعة الثالثة المعتمدة.

## الدفعة الثالثة —تفعيلstrict فقط

tsconfig الجذر:strict=true،لا تغيير في أي خيار أو نطاقinclude/exclude.
هذا يغطّي الإدارة واختبارات/e2e الجذر؛customer-web كانstrict=true أصلاً،
وEdge Functions خارجtsconfig الجذر كما كانت،لا ادعاء تغيير مترجمDeno.
حارس دائمstrict-configuration:strict وكل العائلة غيرمعطلة،مترجم حقيقي
يرفض implicit-any(7006) وnull→string(2322)،وباقيJSON مطابقة لـbf0ef2b.
حارسPageHeader المطلوب الحقيقي يبقى يفشل بـ2741 عند حذفtitle.
لا ملفاتمنتج/SQL/RPC/حمولات/صلاحيات معدلة في دفعةالإعدادات. لذلك لاspec
متصفح أوDBruntime جديد متأثر محلياً؛إثبات البوابات المتصلة منbf0ef2b
مكتمل،وCIالكامل يعيد الجميع علىSHAالتفعيل قبل التسليم. المحلي النهائي:
type/lint/all units للتطبيقين،build الإدارة وstrict measurement وحراس
الأنواع السلبية؛Gitleaks/commit/push/full exactCI لازمة،لم تُسلّم بعد.

توقف الدفعة الثالثة قبلcommit:السجل18:54:58.458–18:59:11.825UTC انتهى
exit1 وunchanged=true. typecheck الحقيقي معstrict وESLint PASS(الثلاث
warnings القديمة فقط)،حارسstrict3/3PASS،الوحدات1015PASS/1FAIL من1016.
الفشل القديم فيisolated-vite-cache.test.ts:48،حالةtwo real shared-cache
servers reproduce HTTP504:خادمB لم يُظهر optimized['lucide-react'] ضمن
حدuntil الأصلي15s،فشلReal optimizer state must become ready؛مدةالحالة
23.339s،قبلassert HTTP504. حالة الكاش المعزول الصحيحة نجحت. نفس ملف
الاختبار نجح محلياً وعلىCI لـbf0ef2b؛سبب هذا التشغيل لم يُثبت،لا ادعاء
أنهstrict أوضغط ذاكرة. لقطة بعدالفشل18:58:38UTC:3254MB حرة،9عملياتnode
على الجهاز،ليست قياساً لحظةالفشل نفسها. لا إعادة/مهلة/assertion تعديل.
بقيةبواباتcustomer/build/measurement لم تعمل بسببالخروج المبكر؛لا استنتاج
نجاحها. لا config commit/push/CI،كل العمليات التابعةانتهت،checkpoint
PAUSED بانتظارمراجعةالمالك للتشخيص المنفصل. المنتج والاختبارات مسلّمان
وأخضران؛strict=true محلي فقط حتىنجاحبوابةالإعدادات.

## بوابةالموافقة النهائية —2026-10-14

المالك وافق علىتسجيلفشلVite فقط وإعادةبوابةstrict مرةواحدة. التسجيل
يسبقإعادةرمي نفسخطأassert الأصلي،بنفس15s/10ms؛warn/error الأصلية تُمرر
كماكانت. snapshots تعرضمعرّفاتالتبعيات/المنافذ/حالةscan/رسائل محدودة
والذاكرةفقط،بلاenv أوoptions/credentials. لا إصلاحمنتج أوport/مهلة/retry.
حارساندائمان:strict-configuration3،vite-readiness-diagnostics3؛الحارس
الأخيريثبتصمتالنجاحونفسخطأالفشل والمهلة. معحارسالمطابقة32:35/35PASS.

بوابةالموافقة21:21:09.879–21:24:29.508UTC في2026-10-13(ليلة14عمّان)
نجحت exit0 وunchanged=true:Admin1019/1019،Customer191/191،type/lint
للتطبيقين،build الإدارة،عزلشبكةالمتصفح وstrict measurement total0.
اختبار504 الأصلي اجتازضمنالوحدات الكاملة في2.832s؛الكاشالمعزولPASS.
لم يحدثفشلجاهزية لذا لم يظهرتشخيصفعلي جديد؛لا ادعاءمعرفة أوإصلاحسبب
الفشل السابق. مصدرالمنتج/SQL/CI لم يتغير. لاspec متصفح أوDBruntime جديد
يتأثرمنالتسجيل داخلunit؛بوابةCIالكاملة علىSHAالتسليم إلزامية.
Gitleaks/commit/push/full exactCI التالية قبلإعلانالتسليم.

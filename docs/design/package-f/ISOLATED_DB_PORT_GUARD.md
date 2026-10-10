# حارس منافذ الفحص —2026-10-10

## تصحيح مصدر المنافذ المؤقتة — معتمد2026-10-10

4717e2e وصلGitHub؛الجودة العامة599s ومتصفحاتF453s والأسرار PASS،لكن
المورد التاريخي توقفقبلSQL بـPORT_STILL_BOUND54322 بعد60001ms و242probe.
ss-ltnp لا يبحث عناتصالاتصادرة؛هويتها التاريخية لم تُجمع،وليست مثبتة.

إثبات منفصل فيLinux Docker بلاشبكة خارجية:قراءة/proc الفعلية32768–60999؛
اتصالloopback صادر أخذ34032 تلقائياً،بـESTABLISHED(01) بلاLISTEN(0A)،
وفشلbind0.0.0.0 بـEADDRINUSE،و25432 بقيحراً. هذايثبتآليةالتعارض،لاهوية
الحوادثالثلاثة الماضية. محاولةsourceport يدوية سابقة سمحتbind ولم تثبتها؛
حالةالاختيارالتلقائي هيالإثبات،لا افتراضأنكلsocket لهسلوكreuseواحد.
Windows netsh الفعلي:49152+16384=49152–65535. اختباردائم لاتصالصادرتلقائي
نجحأيضاًعلىWindows وLinux؛لاقتلصاحبالـsocket ولا اتصال خارجي.

describePortHolders يقرأss-tanp بكلالحالات،ويطابقعمودLOCAL فقط،لاpeer؛
يحتفظبالحالةوالعملية ويضيفنطاق/proc الفعلي. يشملIPv6/TIME-WAIT؛تعذر
الأداةمعلن. الإعدادالمعزوليرفضإذاكانأيمنفذجديدداخلنطاقLinux الفعلي.
الحارسDB/shadow وحد60s و250ms وstart/reset والـretries والـworkflow بلا تغيير.

| الخدمة المحلية | المنفذ المعزول |
| --- | ---: |
| DB / shadow | 25432 /25430 |
| API / Studio | 25431 /25433 |
| Mail UI | 25434 |
| SMTP /POP3 إنكانا مفعّلين أصلاً | 25435 /25436 |
| Analytics /Edge inspector /Pooler | 25437 /25438 /25439 |

جميعهافريدةوأقل32768؛لاSMTP/POP3 جديدولاخدمةمفعلةبالإصلاح.
supabase/config.toml الأصليلايتغير؛التحويلفقطفيملفtempالذيينشئهbootstrap.
كلHTTPcaller يأخذAPI_URL منCLIstatusلذاتلكالنسخة؛DBداخلالحاويةيظل5432.
بحثrg لم يجدendpoint قديم54321/54322 فيأيrunner؛البقايافقطافتراضات
الـCLIفيparser واختباراتmock/رفضإعدادSEO ناقصلايجريأيfetch.
اختباردائم يمنعendpoint قديمثابتفيrunners. وحداتالمنافذ12/12 Windows/Linux،
22/22 معmigration/continuity،Admin804/804،TypeScript وESLint strict PASS.
الموردالتاريخي001–131 فعلياًنجح(idempotency/direct-write/POS/transfer/lint)
علىالمنافذالجديدة؛CLIstatus أعطىAPI25431 وStudio25433 وMail25434 بالفعل.
POS browser وexact-SHA CI ستُسجلبعدالنجاحلااستباقاً.

### بوابة المتصفح الحالية — لم تُسلّم بعد

تشغيل80576 على المنافذ الجديدة:7/8 PASS،Chromium carton test135 توقف
عند145؛قراءةaftercare رجعت200 وsupported=true ثم حدث document navigation
إضافي وصارت الصفحة فارغة. لا crash أو رفض مالي مثبت؛سبب الملاحة غير مثبت.
تشغيل تشخيص مركّز81146 للحالة نفسها:2/2 PASS علىChromium/WebKit دون
أي تعديل أوretry. التقاط Vite كان في الذاكرة فقط،لا تعديلrunner أوassertion.

التحقق الكامل70399:7/8 PASS وفشل مختلف فيChromium test80 عندmount21:
Failed to fetch dynamically imported module: /node_modules/.vite/deps/react.js.
Trace يثبت200 عند00:32:26.849Z ثم504 عند00:32:26.998Z،وتغيّرملفmetadata
المشترك عند00:32:27UTC. لا يُستنتج ERR_OUTDATED_OPTIMIZED_DEP تحديداً
من504 فقط. Vite سجل page reload playwright-report/index.html بنهاية التشغيل؛
ذلك لا يثبت وحده سبب الملاحة الأولى. أدوات4173 و4183 تستخدمانroot واحداً
وبلاcacheDir مستقل؛الاشتباه تضارب optimizer cache،ويحتاج إثباتاً بإصلاح
معزول لأداة الفحص لا للمنتج. لا زيادة مهلة أوretry أوتخفيف assertion.

المنافذ في81146/70399 كانتحرة منprobe1،32/28ms،releaseWait0. كلDB/HTTP
الفحص أُغلقت؛n8n لم يُمس. لاcommit/push/CI جديد ولاCustomers قبل حسم
بوابة المتصفح. الفشل الأصلي والمركّز الناجح والفشل المختلف محفوظة كلها؛
لا يُحسب تكرار الفحص كنجاح نهائي أوإثبات إغلاق السبب.

136المُسلّم: p95 عميل33.464ms،الكل1645.011ms (<3s)،معمقارنة10000/10000
عميلبالمصدرقبل/بعد. لاتغيير136أومنطقمنتج/صلاحيات/بيئةProduction.

## سجل4717e2e السابق — تاريخي،قبلنقلالمنافذ

Commit136 `1288db70c9d7462d86aed0534d61be8bc5615525` سُلّم:
quality38004164449 جميع19 مهمة،secrets38004164451،والتحقق الرسمي PASS.

## ما ثبت وما لم يثبت

سجل supplier-ledger113993757143 فشل في `before bootstrap` قبل أي SQL،
على0.0.0.0:54322؛لذلك سببه لا يُثبت فرضية الانتقالbefore→after وحدها.
الهوية التي كانت تحجز المنفذ لم تُجمع في ذلك السجل،ولا يمكن اختراعها الآن.
الكود كان يتحقق من حالة حاويات الاختبار فقط،لا من socket على المضيف.
هذه فجوة إقلاع/تشخيص،لا finding في المال. إعادة التشغيل السابقة الوحيدة نجحت.

## التصحيح المحدود

- قبلsupabase start:bind فعلي لمنافذDB وshadow من[db] أو الافتراضين54322/54320.
- IPv4/IPv6،العنوان العام وloopback. أثبت الاختبار أنWindows يسمح أحياناً
  بـwildcard bind معlistener علىloopback؛الحارس يفحص كليهما،لا يعدّهfree.
- إعادة الفحص شرطية كل250ms حتى60s كحد أقصى،ولا انتظار عندما تكون المنافذ حرة.
- استمرار الحجز:PORT_STILL_BOUND مع المنافذ والمدة وdocker ps publish وss-ltnp
  إن توفر. تعذرprobe غير متوقع يفشل مغلقاً؛لا قتلprocess أوcontainer لحل الحجز.
- حارس مالك الحاويات الحالي باقي،ومهلstart/reset والـworkflow وretries بلا تغيير.
- JSON bootstrap يضيفdbPortGuard فقط؛supplier before/after وPOS يطبعان هذه
  القياسات الآمنة في السجل،دونبياناتcredentials/env أوحمولاتمالية.

اختبارات دائمة:socket محجوز،release حقيقي،IPv6،كل المنافذ،حد الانتظار،خطأ
probe،هويةdocker/ss،ترتيب الحارس قبلstart،وثبات حدود/حارس الملكية.8/8 PASS.
Runtime الموردين قبل22/بعد42 وDB lint PASS. الكاشير الفعلي8/8 علىChromium
وWebKit،4سيناريوهات،retries0،Production requests0. جميع800 اختباراتAdmin
وTypeScript وESLint strict و18 اختباراتguard/continuity/migration PASS.

| الإقلاع | probes | زمن الفحص ms | انتظار تحرر ms |
| --- | ---: | ---: | ---: |
| supplier before | 1 | 22 | 0 |
| supplier after | 1 | 54 | 0 |
| POS fullstack | 1 | 28 | 0 |

المنافذ كانت حرة في هذه التشغيلات؛اختبارsocket الدائم أثبتrelease حقيقياً
بعد فحص مشروط،لا ندّعي وقوع انتظار فيruntime أوCI قبل رؤيته. أُغلقت كل
حاوياتالفحص التابعة؛حاويةn8n المملوكة للمستخدم لم تُمس. exact-SHA CI بوابة
التسليم التالية،لا نجاح مسبقاً.
001–136 والمنتج والـworkflow بلا تغيير.لاProduction/deploy أوPhase7.

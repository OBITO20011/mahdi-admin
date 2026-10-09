# حارس منافذ الفحص —2026-10-10

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

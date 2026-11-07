# نواصرة — مدخل الوثائق العربية

للتعريف بالمشروع ومعماريته وخريطة المجلدات: [README الإنجليزي](../README.md). وثائق التشغيل والصيانة بالعربية؛ ابدأ من [دليل المطوّر](MAINTAINER_GUIDE_AR.md)، ثم [AGENTS](../AGENTS.md) و[قواعد العمل](agent/OPERATING_RULES.md) و[نظرة المشروع](agent/PROJECT_OVERVIEW.md).

## قواعد العمل والتشغيل

- PostgreSQL ودوال RPC المحمية مصدر الحقيقة للمال والمخزون والمرتجعات وحالات العمليات؛ لا حساب مالي بديل في الواجهة.
- لا `service_role` ولا كلمة مرور قاعدة البيانات داخل الواجهات، ولا أسرار أو معرفات محادثات في Git أو السجلات.
- لا تعديل migrations تاريخية أو تطبيق SQL يدوي على الإنتاج، ولا `supabase db reset` على الإنتاج. أي تغيير سقف يحتاج قراراً وأدواته ومرجعه في الحزمة نفسها.
- لا تستخدم Factory Reset لـDocker أو حذف volumes كحل أول؛ تحقّق من مالك الحاوية والمسار، ولا تحذف عبر junction.
- الاتصال المستضاف والنشر والتصفير والاسترجاع الحي وتفعيل التنبيهات تتطلب تفويض المالك؛ مراجعة PR لا تمنح هذه الصلاحيات.

## تشغيل وفحص محلي

استخدم Node24 وملفات القفل. ثبّت `npm.cmd ci` و`npm.cmd --prefix customer-web ci` في نسخة مخصصة، ولا تنسخ ملفات المالك `.env*.local`. بعد إعداد سياق محلي معتمد: `npm.cmd run dev` للإدارة و`npm.cmd --prefix customer-web run dev` للمتجر، كل منهما في طرفية منفصلة. أدوات QA في [README](../README.md) تربط التطبيقين وAPI الوهمي بـloopback فقط؛ لا تثبت عمل مسار مالي حقيقي.

الفحوص المعتادة: `npm.cmd run lint`، `npm.cmd run lint:eslint:strict`، `npm.cmd test`، ثم `npm.cmd --prefix customer-web run lint` و`npm.cmd --prefix customer-web test` واختبارات المتصفح. أمر `npm.cmd run quality` يجمع الفحوص ويتطلب سياق العزل الصريح الموصوف في [دليل المطوّر](MAINTAINER_GUIDE_AR.md). البناء العام بلا سياق مرفوض؛ بناء SEO للمتجر قد يقرأ القاعدة المهيأة، لذا استخدم `node scripts/testing/run-customer-isolated-build.mjs` و`node scripts/testing/run-environment-builds.mjs` للفحص المحلي بلا اتصال مستضاف.

## أدلة الإجراءات

- [دليل صاحب المحل](handover/دليل-صاحب-المحل.md) و[ورقة يوم التشغيل](handover/ورقة-يوم-التشغيل.md).
- [خطة القطع](operations/GO_LIVE_CUTOVER_AR.md): الترتيب وبوابات القرار والتحقق والنشر.
- [النسخ والاسترجاع](../scripts/backup/README.md) و[المراقبة](operations/MONITORING_RUNBOOKS.md).
- [قرارات المالك](agent/OWNER_DECISIONS.md) و[خريطة الخصوصية](operations/PRIVACY_DATA_MAP.md).

السقف الحالي يؤخذ من `agent/project-state.json`، وليس من فقرة قديمة. `HANDOFF.md` سياق تاريخي فقط. لا تنشر من شجرة عمل متسخة؛ يلزم CI أخضر على الرأس المعتمد والتحقق من مخرجات البناء بالسياق الصحيح، ويظل قرار النشر للمالك.

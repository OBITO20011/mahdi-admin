# فك إطار Sentry محلياً

لا رفع إلى Sentry، ولا Auth Token، ولا نشر للخرائط. `production` و`prelaunch-trial` للتطبيقين يولدان خرائط `hidden`؛ تزال أصول `.map` من حزمة Rollup **قبل كتابة dist**. `staging` وisolated لا يولدانها. أوامر البناء والنشر القائمة لا تتغير، و`verify-dist` يرفض أي `.map` (بما فيها المضغوطة) أو تعليق `sourceMappingURL` خارجي/inline.

يحفظ كل بناء ناجح أرشيفاً مستقلاً؛ لا يستبدل بناءً آخر له SHA نفسه. يظهر مسار `manifest.json` في سجل البناء، بلا مصدر أو إعداد سري. المسار الافتراضي على Windows:

`%LOCALAPPDATA%\NawasrahPrivateSourceMaps\admin|customer\<release SHA>\production|prelaunch-trial\build-...\manifest.json`

على Linux: `~/.local/share/NawasrahPrivateSourceMaps/...`. مجلد كل بناء محمي بلا وراثة للمستخدم الحالي وAdministrators فقط على Windows، وبـ700/600 على Linux. فشل الحماية يفشل البناء. يمكن تغيير الجذر بمتغير بناء محلي `NAWASRAH_PRIVATE_SOURCE_MAPS_DIR`؛ يُرفض داخل Git أو dist أو عبر رابط/junction أو مسار UNC. لا تضعه في مجلد نشر أو مشاركة أو artifact عام. الخرائط تحتوي المصدر الأصلي، فلا تلصق محتواها في محادثة أو تقرير عام. احتفظ بها محلياً مع SHA لكل إصدار منشور.

1. من الحدث المنقّح خذ `release` الكامل، و`filename` و`lineno` و`colno` لإطار `/assets/*.js`. لا تحتاج رسالة الخطأ أو أي بيانات زبون.
2. اختر أرشيف التطبيق والبيئة وSHA نفسه، وتحقق أن اسم ملف البناء موجود في `entries` بالـmanifest. قد توجد عدة بناءات، فلا تختَر بالوقت وحده. لا تستخدم خرائط HEAD الحالي لحدث إصدار قديم.
3. من المستودع نفّذ، باستبدال المواضع فقط:

```powershell
node scripts/monitoring/symbolicate-local.mjs --manifest "<المسار المحلي إلى manifest.json>" --release "<SHA الكامل من الحدث>" --filename "https://admin.alnawasreh.com/assets/<اسم الملف>.js" --line 1 --column 12345
```

للمتجر استعمل `filename` الفعلي من الحدث. الأرقام كما يعرضها Sentry؛ الأداة تحولها إلى إزاحات SourceMap داخلياً. تتحقق من SHA الإصدار واسم ملف البناء وبصمة الخريطة؛ ترفض الاستعلام/hash أو خريطة معدلة أو ملفاً غير موجود، ولا تجلب أي URL. الناتج مسار المصدر والسطر والعمود واسم اختياري فقط، دون محتوى السطر. لا يمكن ضمان اسم الدالة الأصلي في كل خريطة؛ موضع المصدر هو الدليل الأساسي.

الإطارات المنقّحة الحالية كافية: لا نضيف `vars` أو `context_line` أو بيانات مستخدم، ولا نغير تنقية Sentry. ملفات static مثل `sw.js` لا تمر بخرائط Rollup؛ افحص مصدرها في SHA الحدث. عند فقد الأرشيف يمكن إعادة البناء من **نفس SHA والإعدادات** في worktree معزول، لكن لا تعتمد الخريطة حتى يطابق اسم/بصمة ملف JavaScript المنشور؛ اختلاف الاعتماديات/الإعدادات قد يغير المواضع. لا تنشر إعادة البناء التشخيصية.

التحقق: `node --import tsx --test tests/private-source-maps.test.ts`. يبني ملفاً وهمياً، يثبت غياب الخرائط/تعليقاتها من dist، يفك إطاراً مرّ بتنقية Sentry الحالية عبر CLI المحلي، ويرفض SHA خاطئاً وخريطة معدلة. بناءا التطبيقين لكل سياق وverify-dist هما بوابة النشر المعتادة.

مراجع: [Vite sourcemap](https://v6.vite.dev/config/build-options#build-sourcemap)، [Node SourceMap](https://nodejs.org/api/module.html#class-modulesourcemap). لا اتصال بالخدمات مطلوب للفك المحلي.

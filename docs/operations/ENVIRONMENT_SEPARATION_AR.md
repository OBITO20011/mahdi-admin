# فصل بيئة التشغيل عن بيئة التجربة

استثناء المالك المؤقت قبل التشغيل: [prelaunch-trial المحروس](PRELAUNCH_TRIAL_AR.md) لفرانكفورت عبر معاينة Access فقط. لا يغيّر production/staging؛يُغلق قبل التصفير ويُزال بعد القطع.

هذه تعليمات المالك بعد اعتماد الحزمة ودمجها. لم يتصل Codex بأي مشروع ولم ينشر أو يغيّر إعداد Cloudflare. التحقق المحلي يستخدم بيانات وهمية وطلبات SEO على loopback فقط.

## اختيار البيئة

| السياق الصريح | قاعدة Supabase | رابط المتجر لبناء الروابط وSEO |
|---|---|---|
| `production` | فرانكفورت `kzevmysfydaslxcerogt` | `https://alnawasreh.com` |
| `staging` | سنغافورة `acjtabdqqnpwhdvbvnyw` | `https://staging-frankfurt.nawasrah-store.pages.dev` |

اسم فرع المعاينة التاريخي لا يختار قاعدة البيانات. staging مخصص لسنغافورة **بعد** أرشفتها وإعادة بنائها ببيانات وهمية في T+7. يبقى مغلقاً حتى ذلك الحين.

كل من إعداد العميل، وCSP، ومولّد SEO يأخذ البيئة المختارة نفسها. لا يوجد fallback مستضاف عند غياب السياق. يُرفض URL أو مفتاح عام أو رابط متجر مخالف للبيئة المختارة. المفاتيح المضمّنة مفاتيح publishable عامة فقط؛ لا تدخل DB أو service_role أو Telegram أو R2 في VITE.

من مجلد مصدر نظيف ومحدّث، للبناء فقط. إذا كانت جلسة PowerShell تحمل متغيرات عامة للبيئة الأخرى،امسحها من الجلسة أو اضبطها وفق الجدول؛لن تغير الأوامر ملفات env المحفوظة:

```powershell
Remove-Item Env:VITE_SUPABASE_URL,Env:VITE_SUPABASE_PUBLISHABLE_KEY,Env:VITE_SUPABASE_ANON_KEY,Env:VITE_PUBLIC_SITE_ORIGIN,Env:VITE_STOREFRONT_PUBLIC_URL -ErrorAction SilentlyContinue
```

```powershell
# production — لا ينشر
npm.cmd run build:production
npm.cmd --prefix customer-web run build:production
node scripts/environments/verify-dist.mjs admin production dist
node scripts/environments/verify-dist.mjs customer production customer-web/dist

# staging — بعد تجهيز سنغافورة في T+7؛ لا ينشر
npm.cmd run build:staging
npm.cmd --prefix customer-web run build:staging
node scripts/environments/verify-dist.mjs admin staging dist
node scripts/environments/verify-dist.mjs customer staging customer-web/dist
```

بناء المتجر العادي يولّد SEO بقراءة عامة من مشروع البيئة المختارة؛ ينفذه المالك فقط ضمن تفويضه. اختبار Codex وCI يستعمل بدلاً منه `node scripts/testing/run-environment-builds.mjs`: أربعة أبنية فعلية مع API محلي، وفحص كل ملفات dist، واختبارات سلبية للعنوان المخالف وCSP. ملف التعريف يوسم SEO الاصطناعي، ويرفضه أمر فحص النشر؛ لا ترفع ناتج هذا الاختبار.

`npm run build` دون سياق صريح يفشل. يمكن ضبط `NAWASRAH_DEPLOYMENT_ENV` صراحة عند استعماله مباشرة. خوادم QA المعزولة تستخدم عنوان HTTP loopback فقط، وناتجها غير قابل للنشر. ملفات `_headers` في المصدر قوالب؛ افحص النسخة المعالجة داخل dist، ولا ترفع public أو القالب نفسه.

## متغيرات Cloudflare Pages

المالك/Claude: لكل من `nawasrah-admin` و`nawasrah-store`، افتح **Workers & Pages → المشروع → Settings → Variables and Secrets**، واختر Production وPreview كلّاً على حدة:

| المتغير | Production | Preview بعد T+7 |
|---|---|---|
| `NAWASRAH_DEPLOYMENT_ENV` | `production` | `staging` |
| `VITE_SUPABASE_URL` إن استعملته | عنوان فرانكفورت أعلاه | عنوان سنغافورة أعلاه |
| `VITE_SUPABASE_PUBLISHABLE_KEY` إن استعملته | المفتاح العام المطابق لفرانكفورت | المفتاح العام المطابق لسنغافورة |
| `VITE_PUBLIC_SITE_ORIGIN` للمتجر | `https://alnawasreh.com` | رابط المعاينة في الجدول أعلاه |
| `VITE_STOREFRONT_PUBLIC_URL` للإدارة | `https://alnawasreh.com` | رابط المعاينة في الجدول أعلاه |

احذف `VITE_SUPABASE_ANON_KEY` القديم إذا كان مختلفاً، أو اجعله المفتاح العام نفسه؛ تُرفض القيم المتعارضة. Turnstile مفتاح عام ملائم للنطاق المختار. لا تغيّر توكنات أو أسرار في هذا المستند.

في Git integration تكون build command للإدارة `npm run build:production` في Production و`npm run build:staging` في Preview؛ وللمتجر الأمر المناظر من customer-web. إذا كانت اللوحة تتيح أمراً واحداً مشتركاً، استعمل `npm run build` مع متغير السياق المفصول أعلاه. تحقّق من السياق في `dist/nawasrah-environment.json` قبل الرفع.

**Direct Upload يحسم القيم محلياً عند البناء.** إعدادات لوحة Pages لا تعيد كتابة JavaScript مرفوعاً من الجهاز. يلزم بناء جديد؛ تغيير متغير Preview لا يصلح deployment قديماً ولا يغيّر Production. الإنتاج يبقى من main وبعد كلمة المالك «انشر»؛ لا تنفّذ نشر الحزمة ضمن هذه التعليمات.

## إغلاق المعاينات من يوم التشغيل حتى T+7

1. المالك/Claude: في المشروعين، **Settings → General → Enable access policy**. افتح تطبيق المعاينات المقابل في **Zero Trust → Access → Applications**. اجعل السياسة **Block / Everyone**، وأزل أي Allow أو Bypass أو Service Auth يسمح بالدخول، وألغ جلسات السماح القائمة. طبّق الحظر على رابط `staging-frankfurt` وروابط hash القديمة. نطاق custom مربوط بمعاينة يحتاج حماية Access مستقلة؛ لا تحظر النطاق الرسمي للإنتاج.
2. إن كان Git integration مفعّلاً: **Settings → Builds & deployments → Branch deployment controls → Preview deployments → None**. هذا يوقف builds الجديدة فقط. لا ترفع Direct Upload جديداً أثناء الإغلاق.
3. اجرد deployments من جلسة المالك المصرّح بها:

   ```powershell
   npx.cmd wrangler pages deployment list --project-name=nawasrah-admin
   npx.cmd wrangler pages deployment list --project-name=nawasrah-store
   ```

   احفظ IDs والفروع، وحدد القديمة التي هي Preview فعلاً. لحذف ID معيّن اختاره المالك فقط:

   ```powershell
   npx.cmd wrangler pages deployment delete DEPLOYMENT_ID --project-name=PROJECT_NAME
   ```

   لا تحذف Production ولا المشروع ولا الفرع. لا تستخدم `--force` كتنظيف عام. أحدث deployment لكل فرع لا يمكن حذفه مباشرة حسب عقد Pages؛ يبقى محظوراً عبر Access. إذا تقرر إزالة ملفاته أيضاً، يلزم تفويض نشر منفصل لاستبداله بمعاينة صيانة ثابتة ثم حذف القديم.
4. التحقق: افتح incognito بلا تسجيل دخول Cloudflare، ومن هاتف خارج شبكة المطوّر. اختبر رابط الفرع وhash لكل معاينة باقية وأي custom preview alias، وكذلك طلب ملف JS مباشرة. المتوقع رفض Access وعدم وصول ملفات التطبيق. **أي معاينة تصل للتطبيق توقف القطع قبل التصفير.** تحقّق أن Production الرسمي لم يتأثر.
5. أوقف جلسات التجربة وPWA القديمة وسجّل خروجها. حظر URL لا يمحو JavaScript سبق تنزيله في جهاز. التصفير يحذف حسابات التجربة، والمالك لا يستخدم حسابه على معاينة بعد القطع. تحقق من Network في جلسة جديدة: لا طلبات تجربة لفرانكفورت. المفتاح publishable عام؛ حذف رابط المعاينة وحده ليس حارس صلاحيات للقاعدة.

## بعد T+7

اتبع القسم 10 من [خطة التشغيل](GO_LIVE_CUTOVER_AR.md): أرشيف سنغافورة الأخير، ثم إعادة بناء جميع migrations، وإيقاف أتمتتها القديمة، وإدخال بيانات وهمية فقط. اضبط Preview=staging، وابن وافحص dist، وارفع بتفويض المالك تحت Access أولاً. فتح المعاينات مجدداً قرار المالك بعد إثبات أنها تستعمل سنغافورة فقط. بعدها كل تغيير staging أولاً ثم production.

## مرجع RESET214

تغيّر المصدر العام للواجهتين، لذلك تُعاد أدلة قراءة 214 وبناء مرجع `local-reference-through214-ready.json` بنفس السقف و176 ملفاً. المرجع المحلي المحدث: `C:\Users\TOP\NawasrahFrankfurt\environment-separation-preparation-20261026\local-reference-through214-ready.json`،ويُستخدم من main بعد دمج حزمة2 فقط. [دليل التحقق المحلي](ENVIRONMENT_SEPARATION_LOCAL_EVIDENCE.json). لا إعادة تسمية مرجع209 ولا تخفيف حارس البصمة. لا تبدّل كود الأداة أو المرجع أثناء وجود `RESET214_IN_PROGRESS.json`؛ استأنف بأداة ومرجع المحاولة الأصليين ثم حدّث بعد نجاحها.

## المراجع العامة

راجعت التعليمات في 26 أكتوبر 2026 من وثائق Cloudflare الرسمية، دون دخول الحساب:

- [إعداد البناء](https://developers.cloudflare.com/pages/configuration/build-configuration/).
- [التحكم في بناء الفروع](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).
- [حماية المعاينات وحذف deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/).
- [سياسات Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/).

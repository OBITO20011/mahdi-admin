# معاينة التجربة النهائية — prelaunch-trial

قرار المالك31أكتوبر: T+2/3 موعد مشروط بسلامة أول يومين حقيقيين على فرانكفورت (المتجر والطلبات والتنبيهات) وموافقته، ثم الأرشفة وإعادة بناء سنغافورة. تبقى المعاينات مغلقة إذا لم تتحقق الشروط. لا تُمس سنغافورة قبل «انشر» لأنها تخدم alnawasreh.com الحالي. الحماية الفعلية هي الدفتر الورقي + نسخ فرانكفورت اليومية؛ سنغافورة لا تحوي بيانات المحل الحقيقية.

سياق مؤقت بقرار المالك قبل يوم التشغيل. يربط فرانكفورت بمعاينة `staging-frankfurt` المحمية بـAccess، حتى يمكن نشر إصلاحات التجربة النهائية بتفويض المالك الدائم لـClaude. إعداد الحزمة واختبارها لا ينفّذان نشراً أو اتصالاً بأي مشروع.

| السياق | قاعدة البيانات | رابط المتجر | وجهة النشر المحروسة |
|---|---|---|---|
| `prelaunch-trial` | فرانكفورت | `https://staging-frankfurt.nawasrah-store.pages.dev` | فرع `staging-frankfurt` فقط |
| `staging` | سنغافورة | رابط المعاينة نفسه بعدT+2/3 | لا يستخدم قبل إعادة بناء سنغافورة |
| `production` | فرانكفورت | `https://alnawasreh.com` | main فقط وبعد تفويض الإنتاج |

التجربة لا تغيّر قاعدة بيانات staging. `CSP connect-src` للتجربة يحوي HTTPS/WSS لفرانكفورت فقط مع مصادر السياسة الأخرى كما هي. SEO يقرأ فرانكفورت في النشر الحقيقي؛ اختبار Codex وCI يقرأ fixture على loopback فقط. صفحات التجربة تحمل noindex وrobots يحجب الفهرسة.

## قبل الرفع — المالك أو Claude المفوّض

1. بعد اعتماد الحزمة ودمجها، استعمل main المحدث وCI الأخضر. لا تستعمل كوداً قديماً بعد إغلاق السياق يوم التشغيل.
2. في Cloudflare للمشروعين `nawasrah-admin` و`nawasrah-store` تأكد من Access: رابط الفرع وروابط hash وأي custom preview domain مقيدة بقائمة تجربة المالك،ولا Bypass عام. اختبر incognito وحساباً غير مسموح له؛يجب ألا تصل ملفات HTML/JS. الاختبار من لوحة المالك فقط،وليس إجراء نفذه Codex.
3. لا ترفع إلى main،ولا تغير Production في Pages،ولا تربط التجربة بسنغافورة القديمة. مفاتيح Turnstile العامة وredirect origins للمعاينة تبقى الإعدادات المعتمدة الحالية. لا تطبع توكن Cloudflare أو أي سر.

## الأوامر الدقيقة — للناشر المفوّض فقط

من PowerShell داخل `C:\Users\TOP\mahdi-admin` بعد الدمج. البناء الحقيقي للمتجر يتصل بقراءات فرانكفورت العامة لتوليد SEO؛ لذلك ينفّذه المالك/Claude المفوّض فقط. الأوامر التالية لم ينفذها Codex على مشروع مستضاف:

```powershell
Set-Location C:\Users\TOP\mahdi-admin
function Invoke-TrialStep {
  param([scriptblock]$Step)
  & $Step
  if ($LASTEXITCODE -ne 0) { throw 'توقف: فشلت خطوة التجربة؛ لا ترفع أي ملف.' }
}

$env:NAWASRAH_DEPLOYMENT_ENV='prelaunch-trial'
# امسح التعارض من الجلسة فقط؛ لا تعديل لملفات المالك المحفوظة.
Remove-Item Env:VITE_SUPABASE_URL,Env:VITE_SUPABASE_PUBLISHABLE_KEY,Env:VITE_SUPABASE_ANON_KEY,Env:VITE_PUBLIC_SITE_ORIGIN,Env:VITE_STOREFRONT_PUBLIC_URL,Env:VITE_BROWSER_QA_ISOLATED -ErrorAction SilentlyContinue
Remove-Item Env:NAWASRAH_ADMIN_RELEASE_ID,Env:NAWASRAH_SEO_AUDIT_API_URL,Env:NAWASRAH_SEO_AUDIT_API_KEY -ErrorAction SilentlyContinue

# الإدارة: بناء ثم تحقق محلي ثم رفع محروس إلى staging-frankfurt فقط
Invoke-TrialStep { npm.cmd run build:prelaunch-trial }
Invoke-TrialStep { node scripts/environments/verify-dist.mjs admin prelaunch-trial dist }
Invoke-TrialStep { npm.cmd run deploy:prelaunch-trial -- --check }
# بعد التحقق من Access في الخطوة السابقة:
Invoke-TrialStep { npm.cmd run deploy:prelaunch-trial }

# المتجر: بناء SEO من فرانكفورت ثم تحقق ثم رفع إلى فرع المعاينة نفسه
Invoke-TrialStep { npm.cmd --prefix customer-web run build:prelaunch-trial }
Invoke-TrialStep { node scripts/environments/verify-dist.mjs customer prelaunch-trial customer-web/dist }
Invoke-TrialStep { npm.cmd --prefix customer-web run deploy:prelaunch-trial -- --check }
Invoke-TrialStep { npm.cmd --prefix customer-web run deploy:prelaunch-trial }

Remove-Item Env:NAWASRAH_DEPLOYMENT_ENV -ErrorAction SilentlyContinue
```

بناء إدارة prelaunch-trial يضبط معرّف إصدار PWA تلقائياً على SHA الكامل لـHEAD المحلي؛إذا كانت جلسة الناشر تحمل NAWASRAH_ADMIN_RELEASE_ID قديماً يرفض البناء حتى إزالة التعارض. لا يُستعمل local-dev للمعاينة،حتى يلتقط الهاتف الإصدار الجديد.

أمر الرفع يستدعي Wrangler داخلياً بالمشروع الموافق للتطبيق و`--branch=staging-frankfurt` ثابتاً. لا يقبل `--branch` أو `--project-name` أو `--dir` من المستدعي،ولا تستبدله بأمر Wrangler حر. `--check` لا يرفع ولا يتصل بمشروع؛يفحص الملفات محلياً فقط. بيانات الاعتماد تبقى في آلية Wrangler المحلية الحالية ولا تدخل المستند أو Git.

إن كان هناك Git integration للمعاينة،يضبط الناشر Preview على `NAWASRAH_DEPLOYMENT_ENV=prelaunch-trial` أثناء نافذة التجربة فقط؛Production يبقى production. Direct Upload يعتمد القيم المحلية عند البناء،ولا يعيد كتابة الملفات من متغيرات لوحة Pages. الدليل الافتراضي الموصى به هنا هو الرفع المحروس أعلاه،ولا تفعل builds تلقائية غير مطلوبة.

## المتوقع قبل الرفع وبعده

- `dist/nawasrah-environment.json` ونسخة المتجر تعرضان `environment:prelaunch-trial` و`prelaunchTrial:true` و`allowedPreviewBranch:staging-frankfurt` و`productionDeployAllowed:false`،مع رابط فرانكفورت ورابط متجر المعاينة.
- فحص dist ينجح فقط إذا خلا كل ملف من مرجع سنغافورة ومفتاحها،وكان CSP مطابقاً للسياق. إذا كان SEO اصطناعياً فالرفع مرفوض حتى يعاد البناء الحقيقي بيد الناشر.
- أوامر إنتاج الإدارة والمتجر ترفض جلسة `prelaunch-trial` قبل البناء أو الشبكة،وفحص artifact كإنتاج يرفضه أيضاً. لا تغيّر manifest يدوياً.
- بعد الرفع المفوض: راجع Access مجدداً،ثم افتح رابط الإدارة `https://staging-frankfurt.nawasrah-admin.pages.dev` والمتجر أعلاه بحساب المالك المسموح. في Network يجب أن تكون REST/RPC/WSS/Storage لفرانكفورت؛لا سنغافورة. جرّب تحديث PWA من معاينة الإصدار السابق. أي وصول غير مسموح أو عنوان مخالف يوقف التجربة.

## إغلاق يوم التشغيل وإزالة السياق

المفتاح الوحيد في المصدر هو `PRELAUNCH_TRIAL_OPEN` في `scripts/environments/prelaunch-trial-control.mjs`. لا يقبل override من process.env. حزمة القطع تغيّره إلى `false` في commit معتمد،وتبني CI وتحدّث جهاز الناشر **قبل التصفير**؛بعدها يجب أن يفشل build والتحقق والرفع المحروس برسالة `PRELAUNCH_TRIAL_CLOSED`،حتى للملفات المبنية سابقاً. لا تعاود فتحه لتجاوز العطل.

ثم يُغلق Access للجميع على المعاينات وتُزال deployments القديمة وفق [القسم4 من خطة التشغيل](GO_LIVE_CUTOVER_AR.md). إغلاق المفتاح لا يسحب JavaScript منشوراً أو مخزناً في PWA؛الحظر وحذف الملفات والخروج من الجلسات خطوات لازمة مستقلة. لا تعتمد على مفتاح المصدر لإغلاق رابط منشور وحده.

بعد نجاح القطع،أزل السياق وأوامره ومسار رفعه المؤقت من الكود في PR تنظيف مستقل مع CI،وأبقِ production/staging فقط. فيT+2/3 بعد أرشفة وإعادة بناء سنغافورة ببيانات وهمية،تستعمل المعاينة `staging` كما في [دليل فصل البيئات](ENVIRONMENT_SEPARATION_AR.md). يبقى آخر مرجع RESET214 المستخدم بمحاولة قائمة ثابتاً؛هذه الحزمة لا تغيّر الواجهتين أو migrations أو مرجع214.

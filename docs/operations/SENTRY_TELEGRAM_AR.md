# تنبيهات Sentry إلى Telegram المطوّر

وسيط تقني مستقل، لا يقرأ ERP أو Supabase ولا يرسل لصاحب المحل. يبقى مطفأً حتى يضبطه المالك. المشروعان الحاليان للإدارة والمتجر يكفيان؛ لا تنشئ مشروعين جديدين. الأوامر التالية للمالك أو Claude بتفويضه، ولم ينفذها الوكيل.

## ما يُرسل وما يُرفض

- POST إلى `/sentry` فقط، وJSON حتى128KiB، وتوقيع HMAC-SHA256 على **بايتات الجسم الأصلية** عبر `Sentry-Hook-Signature`. نقبل `event_alert` مع `action=triggered` ومشروعين محددين فقط.
- توقيع Sentry لا يغطي هيدر الوقت. لذلك نفحص `Sentry-Hook-Timestamp` ووقت الاستلام `data.event.received` داخل الجسم الموقّع معاً: عمر≤15دقيقة، ومستقبل≤دقيقة. لا نعتمد ساعة هاتف المستخدم. الوقت المفقود مرفوض؛ لا توسع النافذة لاختبار حدث تاريخي.
- منع التكرار دائم ومتزامن في SQLite داخل Durable Object، بمعرّف المشروع وevent_id، وليس Request-ID أو ذاكرة Worker. يحتفظ بالحجز24ساعة، ثم يمنع الوقت الموقّع إعادة الحدث القديم. حد5000سجل، والامتلاء يفشل مغلقاً. قسم `migrations` فيwrangler يخص تخزين Worker، وليس قاعدةERP.
- الرد202 بعد الحجز وجدولةalarm؛ الإرسال لا يؤخر ردSentry. دفعة≤5، ومحاولةTelegram واحدة بمهلة5ثوانٍ. نجاح الإرسال يتطلب `ok:true` ورقم رسالة موجباً و`chat.id` مطابقاً للمطوّر. لا إعادة لحالة غامضة بعد انقطاع/تعطل؛ قد تضيع رسالة بدلاً من إرسالها مرتين. أبقِ بريدSentry للمطوّر احتياطياً.202 يعني قبول الحجز، وليس وصولTelegram.
- فشل التخزين503؛ التكرار200؛ توقيع/وقت401؛ صيغة400/415/422؛ حجم413؛ طريقة405. فشلTelegram فيalarm يسجّل رمزاً ثابتاً فقط ويحفظ حالةفشل؛ لا يعيد Sentry الطلب بسبب نتيجةTelegram.
- الرسالة: إدارة/متجر، بيئة من قائمة ثابتة،SHA مختصر،screen وerror_code من قوائم سماح، عدد إن وجد، ورابطissue مبني من إعداد المنظمة ومعرّف رقمي. لا عنوانخطأ خام أوstack أوuser أوrequest أوURLصفحة. تُمسح حقول الرسالة من المخزن بعد المحاولة.
- **عدد الأحداث «غير متاح»** إن لم يصل `data.issue.count`؛ عقدevent_alert لا يضمنه. لا نستدعيSentry لجلبه ولا نخترع رقماً. الحقول النصية الأخرى مستبعدة، حتى إن كانت عربية أو تبدو مفيدة.

## خطوات المالك

1. افتح **Sentry → Settings → Developer Settings → New Internal Integration** في المنظمة الحالية. سمّه `Developer Telegram relay`. فعّل **Alert Rule Action**. أقل صلاحية: **Issue & Event: Read**؛ بقية الفئات **No Access**. لاWrite/Admin ولاAPI token للوسيط. لا تشترك فيwebhooks العامة `issue` أو`error` كيلا تصل إشعارات مكررة؛ نستهلك issue alerts فقط. إذا طلبت الواجهة صلاحية إضافية، توقف للمراجعة.
2. اضبط في `workers/sentry-telegram-relay/wrangler.toml` المعرفين الرقميين من **Project Settings**: `SENTRY_ADMIN_PROJECT_ID` و`SENTRY_STORE_PROJECT_ID`، واسم المنظمة `SENTRY_ORG_SLUG`. هذه إعدادات وليست أسراراً؛ القيم الفارغة تفشل مغلقاً. لا تخمّن أسماء/معرفات المشاريع.
3. اختر بوت وقناة **المطوّر التقني** من الآلية الآمنة الحالية، لا بوت أوChat صاحب المحل. الأسرار الثلاثة تعيش فيWorker secrets فقط. لا قيم فيGit أوالأوامر أوالصور أوالمحادثة. لا نحتاجSentry API token. أدخل **Client Secret** الخاص بالـInternal Integration، وليسDSN.
4. بعد اعتمادPR، ومن نسخة نظيفة للإصدار المعتمد، راجع الإعداد ونفذ الأوامر. اترك `RELAY_ENABLED="false"` للنشر الأول. الإصدار المثبت للأداة4.152.0؛ `deploy --dry-run` تجميع محلي، و`deploy` نشر يملكه المالك فقط.

```powershell
cd C:\Users\TOP\mahdi-admin\workers\sentry-telegram-relay
$env:WRANGLER_SEND_METRICS = 'false'
npx.cmd --yes wrangler@4.152.0 deploy --dry-run --outdir "$env:TEMP\nawasrah-relay-build"
npx.cmd --yes wrangler@4.152.0 login
npx.cmd --yes wrangler@4.152.0 deploy
npx.cmd --yes wrangler@4.152.0 secret put SENTRY_CLIENT_SECRET
npx.cmd --yes wrangler@4.152.0 secret put DEV_TELEGRAM_BOT_TOKEN
npx.cmd --yes wrangler@4.152.0 secret put DEV_TELEGRAM_CHAT_ID
```

5. يُدخل كل سر في مطالبةwrangler التفاعلية؛ لا تستخدمecho أو قيمة على سطرالأمر. ضع **Webhook URL** فيSentry: `https://<worker-name>.<account-subdomain>.workers.dev/sentry`. بعد مطابقةClient Secret والمعرفات، غيّر `RELAY_ENABLED` إلى`true` في نسخةالإعداد المحلية المفوضة وانشرها. لا تنشر هذه القيم السرية داخلwrangler أوGit. observability مطفأ؛ عند التشخيص يستخدم المالك `wrangler tail` لمراجعة رمزعام فقط، دون حفظ حمولة أوهيدرات حقيقية.
6. في **كل مشروع**: **Alerts → Create Alert → Issues**. الشروط: `A new issue is created` **أو** `An issue changes state from resolved to unresolved`، والإجراء `Send a notification via an integration` ثم هذاInternal Integration. لاMetricAlert ولا قاعدتان متطابقتان. اضبطproduction، وللاختبار مؤقتاًprelaunch-trial. أبقِ البريد التقني للمطوّر احتياطياً؛ لا تغيير لتنبيهات الشغل.
7. **اختبار واحد فقط بتفويض المالك:** من المعاينة المحمية استخدم خطأSentry التجريبي المنقّح القائم؛ راجعSENTRY_OWNER_AR.md. المتوقع رسالةواحدة للمطوّر فيها المشروع/البيئة/release/screen/error_code الصحيحة ورابطissue، بلا اسم أوهاتف أو مبلغ أوURLصفحة. راجع202 في سجلIntegration؛ الرسالة نفسها تثبت الوصول. زرtestwebhook قد يرسل حدثاً تاريخياً أو بلاreceived، فيرفض401؛ لا تضعف الحارس، بل ولّد حدثاً جديداً من المعاينة.
8. عند رفض `SIGNED_EVENT_EXPIRED` افحص أولاً وجود `data.event.received` داخل الجسم الموقّع وأنه وقت استلام Sentry بالثواني ضمن15دقيقة (والمستقبل≤دقيقة). لا يكفي تجديد هيدر الوقت ولا وقت هاتف المستخدم. هذا أول تحقق حي مطلوب من المالك؛ لا تحفظ أو تشارك الحمولة الحقيقية، ولا توسع النافذة أو تُعطّل التوقيع.
9. إن لم تصل، تحقق من التفعيل والمعرفات وتطابقClient Secret ووقتحدثجديد وChat المطوّر. لا تولّد أحداثاً حقيقية بكثرة. بعد إصلاح السبب اطلب اختباراً جديداً واحداً؛ لا إعادة تلقائية. للإيقاف ضعfalse وانشر؛ الحجز المعلق لا يرسل بعد الإيقاف. عند التدوير: غيّرWorker secret ثم المطابق فيSentry عنداللّزوم؛ يُرفض التوقيع أثناء عدم التطابق. توكنTelegram يُدوّر منBotFather ثمWorker secret، دون لمس أسرار تنبيهات الشغل.

## المجاني والاختبارات وحدود الإثبات

SQLite Durable Objects متاحة فيWorkers Free. حجم أعطال محل واحد المتوقع منخفض، لكن المجانية مقيدة بالحصة الحالية وليست ضماناً مفتوحاً؛ تجاوزها يفشل ولا يلغي البريد الاحتياطي. لاKV بتناسق متأخر، ولا خدمة مدفوعة مطلوبة. لا اتصال بـSupabase أوR2 أوn8n.

اختبارات المستودع محلية ببيانات وهمية: التوقيع والجسم، انتهاء الوقت الموقّع، التكرار والتزامن وإعادة البدء،SQLite، الخصوصية وفشلTelegram والإيقاف. نجاحها لا يثبت إعداد الحسابات الحقيقية، ولم ينفذ الوكيل أي اتصال بها.

مصادر رسمية: [Webhooks والتوقيع](https://docs.sentry.io/integrations/integration-platform/webhooks/)، [حمولةIssue alerts](https://docs.sentry.io/integrations/integration-platform/webhooks/issue-alerts/)، [مثالAlert action](https://github.com/getsentry/integration-platform-example/blob/main/docs/webhooks/alert-webhooks.md)، [الصلاحيات](https://docs.sentry.io/api/permissions/)، [تسعيرSQLite Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/). أي عقد جديد غير معروف يُرفض بدلاً من تمرير نصوصه.

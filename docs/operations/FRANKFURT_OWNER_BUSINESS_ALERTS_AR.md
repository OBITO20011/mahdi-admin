# تنبيهات صاحب المحل من Supabase — تجهيز217

**لم ينشر Codex الدالة ولم يتصل بأي مشروع ولم يرسل رسالة ولم يفعّل مهمة.** التنفيذ التالي للمالك أو Claude بتفويضه، بعد اعتماد PR حزمة217 ودمجه وتحديث main والمرجع. لا تعتمد على جهاز المطوّر لإرسال تنبيهات الشغل بعد هذه الحزمة.

## الوجهات والحواجز

| المسار | المستلم | الإعداد |
|---|---|---|
| الملخص، نقص المخزون، الطلب المتأخر وبقية أحداث الشغل المعتمدة | صاحب المحل فقط | Edge `owner-telegram-dispatch`؛ Bot وChat ID مستقلان |
| Push للطلب الجديد | هاتف صاحب المحل فقط | المسار الحالي `send-order-push` دون تغيير |
| النسخ،400MB،keep-alive،الحارس،أخطاء النظام وCI | المطوّر فقط | القناة التقنية الحالية دون تغيير |

القالب `automation/n8n/workflows/frankfurt-owner-business-alerts.json` **مهجور وغير نشط**. اترك `businessAlertsEnabled=false` و`testConsent=false` فيه؛لا تستورده أو تفعّله أو تشغّل عقدة Claim.217 تمنع claim وcomplete لقناة Telegram عبر `n8n-alert-feed` بكود `OWNER_TELEGRAM_EDGE_CONSUMER_REQUIRED` حتى مع قالب قديم. WhatsApp القديم والقالب المتصل بسنغافورة لا تتغير عقودهما؛سنغافورة لا تُرقّى ولا تُعدّل في هذه الخطوة.

لا يُرسل `business_integrity_warning` أو استعادته أو حدث تقني/غير معروف لصاحب المحل. يسجل النوع المرفوض `OWNER_BUSINESS_EVENT_NOT_ALLOWED`،والفشل `OWNER_TELEGRAM_DELIVERY_FAILED`،في نفس صندوق الأحداث وعقد المحاولات العشر والتراجع الزمني وdead-letter. لا تغيير لحسابات الملخص أو payload أو المال.

كل دفعة3 أحداث كحد أقصى،وحجز تشغيل90 ثانية وحجز الحدث120 ثانية،مع إعادة فحص الحجز قبل الإرسال. لا يستطيع مستهلك ثانٍ أو حامل منتهي تأكيد دفعة أخرى. الضمان الحالي «محاولة أو أكثر»؛إذا قبل Telegram الرسالة ثم انقطع تأكيد القاعدة قد تتكرر بعد إعادة المحاولة. لا تعتبر التنبيه قيداً محاسبياً.

## 1 — الترقية قبل الإعداد

اتبع [ترقية217](FRANKFURT_OWNER_UPGRADE217_AR.md) في PowerShell **Administrator**: main الصحيح،Plan،Backup،dry-run ثمapply ثمverify-only،ثمBackup وRestore و«افحص».216 مطبقة حسب إفادة المالك؛لا تكرر ترقيتها. المهمة `owner-telegram-dispatch` تُنشأ كل دقيقة **غير نشطة**،والصف الوحيد `owner_telegram_dispatch_settings.enabled=false`.

قبل التفعيل تبقى مهام الأعمال الخمس وتريغر Push وفق حجز خطة القطع.217 لا تفك أي حجز. تحقق من وجود مهمة واحدة فقط باسم `owner-telegram-dispatch` وبالأمر `SELECT public.enqueue_owner_telegram_dispatch_v1();` والجدولة `* * * * *` وحالتها غير نشطة. لا تخزن أي مفتاح خدمة في cron أو SQL.

## 2 — إنشاء البوت وإدخال الأسرار — المالك فقط

1. أنشئ بوت صاحب المحل عبر حساب Telegram الرسمي **@BotFather**،ثم يبدأ صاحب المحل محادثته من هاتفه. اختر Chat ID الخاص بحسابه الفردي؛لا username ولا مجموعة ولا قناة المطوّر. لا تنسخ التوكن أو المعرف إلى المحادثة أو Git أو التقرير.
2. في **Supabase Dashboard → مشروع فرانكفورت kzevmysfydaslxcerogt → Edge Functions → Secrets**،أدخل بنفسك:

| الاسم | القيمة التي يدخلها المالك بأمان |
|---|---|
| `OWNER_TELEGRAM_BOT_TOKEN` | توكن البوت المستقل لصاحب المحل |
| `OWNER_TELEGRAM_CHAT_ID` | Chat ID الفردي لصاحب المحل؛رقم موجب مختلف عن الوجهة التقنية |
| `OWNER_TELEGRAM_DEVELOPER_CHAT_ID_FOR_COMPARISON` | معرف الوجهة التقنية للمقارنة فقط؛مثل حراسة القالب القديم،لا يُرسل إليه شيء ولا تتغير إعداداته |
| `OWNER_TELEGRAM_DISPATCH_SECRET` | سر عشوائي مستقل،32 محرفاً على الأقل؛ليس مفتاح anon أو service_role ولا كلمة DB |
| `OWNER_TELEGRAM_ENABLED` | `false` الآن |
| `OWNER_TELEGRAM_TEST_ENABLED` | `false` الآن |

3. في **Database → Vault → Secrets** أدخل من واجهة الأسرار،لا من SQL Editor أو ملف SQL،قيمتين:

| الاسم | القيمة |
|---|---|
| `owner_telegram_dispatch_secret` | نفس السر الداخلي أعلاه؛قيمة واحدة بهذا الاسم |
| `owner_telegram_dispatch_url` | `https://kzevmysfydaslxcerogt.supabase.co/functions/v1/owner-telegram-dispatch` |

لا تنشئ قيماً مكررة بالأسماء نفسها. لا يُخزّن توكن Telegram أو Chat ID في SQL/Vault. إعدادات Supabase الافتراضية لخادم Edge توفر `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` داخلياً؛لا تُنقل إلى cron أو الجهاز أو القالب.

مثل نمط Push القائم،يقرأ pg_net السر الداخلي من Vault وقت الطلب فقط. يبقى في طابور النقل الداخلي حتى الإرسال؛إدارته متاحة لمسؤولي القاعدة. لا تلتقط الطابور/الرؤوس في سجلات أو تقارير،ولا تمنح العميل قراءة net أو Vault.

## 3 — نشر الدالة — بعد تفويض المالك فقط

من المجلد الرئيسي المحدّث،ينفذ المالك/Claude المفوض الأمر التالي وحده بعد التحقق من SHA المعتمد. لا نشر لبقية Edge ولا للواجهتين:

```powershell
cd C:\Users\TOP\mahdi-admin
node .\node_modules\supabase\dist\supabase.js functions deploy owner-telegram-dispatch --project-ref kzevmysfydaslxcerogt
```

الإعداد `verify_jwt=false` مقصود للمهمة الداخلية؛الدالة ترفض كل طلب بلا السر الصحيح قبل إنشاء عميل الخدمة. إبقاء مفتاح Edge=false وصف DB=false يجعل النشر وحده غير مفعّل.

## 4 — اختبار رسالة واحدة دون حجز أحداث

1. اترك cron غير نشط وDB.enabled=false و`OWNER_TELEGRAM_ENABLED=false`. تأكد أن n8n غير نشط. اجعل `OWNER_TELEGRAM_TEST_ENABLED=true` مؤقتاً في Edge Secrets فقط.
2. من C:\Users\TOP\mahdi-admin يشغّل المالك `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\operations\owner-telegram217-test.ps1 -Apply` مرة واحدة. يكتب مرجع فرانكفورت ثم السر الداخلي بإدخال مخفي،ويؤكد إرسال **رسالة واحدة**. لا يطلب توكن Telegram أو Chat ID ولا يقرأ قاعدة أو يحجز حدثاً.
3. يجب أن تصل: **✅ تم ربط تنبيهات النواصرة لتجارة الجملة والمواد الغذائية بهاتفك**. النجاح يتطلب Telegram `ok:true` ورقم رسالة ومطابقة chat.id؛التقرير الآمن `OWNER_TELEGRAM_TEST_DELIVERED` وtestDelivered=true. لا يعرض التوكن أو المعرف أو رد الخطأ الخام.
4. أعد `OWNER_TELEGRAM_TEST_ENABLED=false` فوراً. سجّل وقت الاختبار ونجاحه بلا أسرار. فشل الاختبار أو وصوله لغير صاحب المحل يوقف التفعيل.

## 5 — الساعة بعد RESET217

الافتراضي المعتمد **00:00 Asia/Amman** إلى أن يؤكد المالك الظهر أو منتصف الليل. الساعة في `business_alert_settings`؛المستهلك يفحص فقط ولا يحسب ملخصاً. بعد التصفير تعود قيمة migration التاريخية08:00،لذلك ينفذ المالك التعديل المحدود التالي مع cron الملخص محجوزاً:

```sql
BEGIN;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.business_alert_settings)<>1
   OR NOT EXISTS(SELECT 1 FROM public.business_alert_settings WHERE id=true)
 THEN RAISE EXCEPTION 'BUSINESS_SETTINGS_SINGLETON_REQUIRED';END IF;
 IF (SELECT count(*) FROM cron.job WHERE jobname='scan-business-summaries')<>1
   OR EXISTS(SELECT 1 FROM cron.job WHERE jobname='scan-business-summaries' AND active)
 THEN RAISE EXCEPTION 'SUMMARY_CRON_MUST_REMAIN_HELD';END IF;
END $$;
UPDATE public.business_alert_settings SET business_timezone='Asia/Amman',
 daily_summary_local_time=TIME '00:00',updated_at=now() WHERE id=true;
SELECT business_timezone,daily_summary_local_time,weekly_summary_local_time
 FROM public.business_alert_settings WHERE id=true;
COMMIT;
```

المتوقع Asia/Amman و00:00؛الأسبوعي يبقى الاثنين09:00 وفق العقد القائم. لا تغيّر `summaries_activated_at` أو سجلات الملخص أو مفاتيح التكرار،ولا تُنشئ ملخصاً قديماً يدوياً.

## 6 — التفعيل يوم التشغيل بعد البيانات و«افحص»

الترتيب:تجهيز واختبار صحيحان،التصفير والبيانات الحقيقية والساعة،ثم تفويض التفعيل. لا ترسل صندوق التجربة المتبقي؛RESET217 يمسحه.

1. اترك `OWNER_TELEGRAM_TEST_ENABLED=false` واجعل `OWNER_TELEGRAM_ENABLED=true` في Edge Secrets. تبقى DB=false وcron غير نشط حتى الخطوة التالية.
2. ينفذ المالك [معاملة التفعيل المحروسة](OWNER_TELEGRAM217_ENABLE.sql)،التي تتحقق من singleton واسم المهمة وأمرها وحجزها ووجود قيمتي Vault وصحة URL وطول السر دون عرضه،ثم DB.enabled=true وcron.active=true معاً. إذا ظهرت حالة مختلفة تتوقف؛لا UPDATE أو cron.schedule بديل يدوي.
3. فك حجز منتجي أحداث الشغل وPush وفق §6 في خطة القطع فقط. n8n و`businessAlertsEnabled` في الحارس يظلانfalse؛المسار التقني لا يتغير.
4. تحقق من حدث عمل حقيقي مضبوط يصل لصاحب المحل،وتصبح محاولته delivered بعد تأكيد Telegram. راقب التراكم/فشل النقل/dead-letter عبر مسار المطوّر الحالي،ولا تعلّم صفاً delivered يدوياً.
5. للإيقاف:Edge enabled=false،ثم [معاملة توقف DB/cron المحروسة](OWNER_TELEGRAM217_DISABLE.sql). اترك n8n مهجوراً؛لا تحويل تلقائي إلى جهاز المطوّر. راجع السبب ثم اختبار وتفويض جديدان.

دليل API الرسمي:[Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage)،[جدولة Edge عبر pg_cron/pg_net وVault](https://supabase.com/docs/guides/functions/schedule-functions). المنسق لا يزيد حقول payload،ونصوصه وأزراره مطابقة لرسائل PR37 المعتمدة.

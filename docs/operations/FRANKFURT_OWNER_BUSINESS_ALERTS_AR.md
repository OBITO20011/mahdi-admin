# تنبيهات شغل فرانكفورت لصاحب المحل

هذه حزمة إعداد محلي وقالب استيراد فقط. لم يُستورد القالب إلى n8n المالك، ولم تُضف اعتمادات أو تُرسل رسالة أو تُفعّل cron. التنفيذ المستضاف يبقى للمالك أو Claude بتفويض يوم التشغيل.

## ما الذي أُعدّ

القالب: `automation/n8n/workflows/frankfurt-owner-business-alerts.json`، باسم **Frankfurt — تنبيهات صاحب المحل**. Workflow واحد غير نشط، ومعرفاته وعقده واعتماداته مستقلة عن `nawasrah-alerts.json` القديم. يستعمل قارئ/صندوق أحداث فرانكفورت القائم `n8n-alert-feed` وعقد `claim/complete` دون تعديل Edge أو RPC أو حسابات أو صلاحيات.

| المسار | المستلم | موضع الإعداد |
|---|---|---|
| نقص المخزون والطلبات المتأخرة وملخص اليوم وبقية أحداث الشغل المعروفة | صاحب المحل وحده | Workflow الجديد واعتماد Telegram مستقل |
| إشعار Push لطلب المتجر | هاتف صاحب المحل وحده | الاشتراك القائم على هاتفه وتفعيل trigger وفق خطة التشغيل؛ليس عقدة في هذا القالب |
| النسخ و400MB وkeep-alive والحارس وأخطاء النظام وCI | المطوّر وحده | القناة التقنية الحالية؛لا تعديل هنا |

أي نوع غير معروف، و`business_integrity_warning` واستعادته، لا يُرسل لصاحب المحل. تُسجّل محاولة فاشلة بكود ثابت عبر العقد الحالي؛تبقى قابلة لإعادة المحاولة/dead-letter ولا تُعلّم «مُسلّمة». التنبيه التقني يستمر في مسار الحارس الحالي. لا تشغّل مستهلك Telegram ثانياً على فرانكفورت بالتوازي،فالقناة قائمة على حجز الأحداث وليست بثاً لكل workflow.

## الاستيراد — المالك، قبل التفعيل

1. افتح `http://localhost:5678` على جهاز المالك. لا تستعمل `import-workflows.ps1` أو `refresh-live-alert-workflows.ps1` لهذا القالب؛هما يخصان المعرفات القديمة.
2. اختر **Import from File** وحدد الملف الجديد فقط. يجب أن يظهر الاسم أعلاه،وحالته غير نشطة/غير منشورة. إن وُجد بنفس الاسم/المعرف من استيراد سابق،افتحه وراجعه بدلاً من إنشاء مستهلك مكرر. لا تحذف القديم أو تعدّل اعتماده.
3. أنشئ credential جديداً من نوع **Header Auth** باسم `Frankfurt owner business feed — NEW`. اسم الرأس: `x-nawasrah-automation-secret`. أدخل قيمته بنفسك من آلية الأسرار الآمنة المعتمدة لفرانكفورت والمطابقة لـ`NAWASRAH_AUTOMATION_SECRET` في Edge. لا تستعمل service_role أو anon key أو كلمة DB،ولا تنسخ السر إلى عقدة Set أو المستند أو Git أو المحادثة. إذا غاب السر،توقف وأعد إعداد السر عبر مسار المالك الآمن؛لا تقرأ ملفات Singapore لإعادة استخدامها.
4. اربط credential الجديد بكل عقدة HTTP الأربع: Claim Frankfurt Events وAcknowledge Owner Delivery وRecord Owner Delivery Failure وRecord Unsupported Event. مرجع القالب ليس اعتماداً جاهزاً؛اختيار credential من القائمة داخل n8n هو الذي يربطه بمعرف n8n الحقيقي.
5. أنشئ credential **Telegram** مستقلاً باسم `Frankfurt shop owner Telegram — NEW`. أدخل Bot Access Token داخل شاشة credential فقط،واترك Base URL الرسمي `https://api.telegram.org`. اربطه بعقدتي Send One Owner Test وSend Owner Business Message. لا تعدّل اعتماد المطوّر أو القديم.
6. صاحب المحل يبدأ محادثة البوت من حسابه على هاتفه. يدخل المالك Chat ID الخاص به في عقدة **Owner Routing → ownerTelegramChatId**. لا تستخدم username أو معرف مجموعة أو قناة عامة. أدخل معرف المستلم التقني الحالي في **developerTelegramChatIdForComparison** للمقارنة المحلية فقط؛لا تُرسل إليه هذه العقدة. يجب أن يختلفا. لا تضع المعرفات الحقيقية في نسخة المستودع أو تصدير Git.
7. اترك **businessAlertsEnabled=false** و**testConsent=false**. المنطقة الزمنية للـworkflow هي `Asia/Amman`. تحقق أن كل HTTP URL يشير إلى `https://kzevmysfydaslxcerogt.supabase.co/functions/v1/n8n-alert-feed`،ولا Singapore. لا تختبر عقدة Claim منفردة أثناء التجهيز.

توثيق n8n الرسمي: [استيراد workflow](https://docs.n8n.io/workflows/export-import/)، [اعتماد Telegram](https://docs.n8n.io/integrations/builtin/credentials/telegram/). لا يتضمن القالب بيانات credential سرية أو بيانات أحداث محفوظة.

## اختبار وصول رسالة واحدة — المالك فقط

1. أبقِ workflow غير نشط وbusinessAlertsEnabled=false. راجع المستلم من هاتف صاحب المحل،ثم اجعل **testConsent=true** مؤقتاً.
2. اختر **Owner One Message Test** كنقطة البداية وشغّل الاختبار اليدوي **مرة واحدة**. لا تشغّل Schedule أو Claim منفرداً. مسار الاختبار يرسل نصاً ثابتاً فقط ولا يحجز أو يؤكد أي حدث في قاعدة البيانات.
3. يجب أن تصل رسالة الاختبار إلى هاتف صاحب المحل وحده،وأن تُظهر Test Delivery Result القيمة **testDelivered=true**. إن كانت false أو لم تصل،توقف وراجع credential/chat ID؛لا تُفعّل الجدولة ولا تعتبر تشغيل workflow وحده إثبات وصول.
4. أعد testConsent=false واحفظه،واترك businessAlertsEnabled=false وحالة workflow غير نشطة حتى يوم التشغيل. دوّن وقت الاختبار ونتيجته بلا توكن أو Chat ID. هذا الاختبار مُجهّز هنا ولم ينفّذه Codex.

## موعد الملخص — إعداد المصدر المحاسبي القائم

**الافتراضي المعتمد ليوم التشغيل: 00:00 Asia/Amman** إلى أن يؤكد المالك منتصف الليل أو الظهر. الموعد الحقيقي في `public.business_alert_settings.daily_summary_local_time` و`business_timezone`،وليس Schedule n8n. n8n يفحص صندوق الأحداث كل دقيقة فقط،ولا يحسب الملخص أو يعيد إنشاءه. `scan_business_summaries` هو الذي ينشئ الملخص من الحسابات المعتمدة وبمفتاح منع التكرار القائم.

RESET214 يعيد القيمة التاريخية الافتراضية **08:00**؛لذلك يضبط المالك/Claude المفوّض الساعة **بعد التصفير وقبل تفعيل scan-business-summaries**. في SQL Editor لمشروع فرانكفورت المحدد،مع cron الملخصات ما زال مؤجلاً،ينفّذ المالك هذا التغيير المحدود فقط عند تفعيل التشغيل. لا ينفّذه Codex،ولا يغيّر قيمة مالية أو تاريخ التفعيل أو مفتاح التكرار:

```sql
BEGIN;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.business_alert_settings) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.business_alert_settings WHERE id=true)
 THEN RAISE EXCEPTION 'BUSINESS_SETTINGS_SINGLETON_REQUIRED'; END IF;
 IF (SELECT count(*) FROM cron.job WHERE jobname='scan-business-summaries') <> 1
    OR EXISTS (SELECT 1 FROM cron.job WHERE jobname='scan-business-summaries' AND active)
 THEN RAISE EXCEPTION 'SUMMARY_CRON_MUST_REMAIN_HELD'; END IF;
END $$;
UPDATE public.business_alert_settings
 SET business_timezone='Asia/Amman',
     daily_summary_local_time=TIME '00:00',
     updated_at=now()
 WHERE id=true;
SELECT business_timezone,daily_summary_local_time,daily_summary_enabled,
       weekly_summary_iso_day,weekly_summary_local_time,weekly_summary_enabled
 FROM public.business_alert_settings WHERE id=true;
COMMIT;
```

المتوقع صف واحد: Asia/Amman و00:00. إن أكد المالك الظهر،يستبدل `TIME '00:00'` بـ`TIME '12:00'` في نفس الخطوة قبل التفعيل،ويوثّق القرار. الأسبوعي يبقى على سياسته الحالية،الاثنين 09:00،ولا يتغير في هذه الحزمة. لا تعدّل `summaries_activated_at` أو business_summary_runs،ولا تعِد إرسال ملخص قديم يدوياً. إعداد الساعة ليس تفعيل cron أو workflow.

## التفعيل يوم التشغيل — بعد تفويضه فقط

1. بعد البيانات الحقيقية و«افحص»،تحقق من اكتمال خطوات القسمين5 و6 في GO_LIVE_CUTOVER_AR.md،والاعتمادات والمستلم واختبار الوصول والساعة الصحيحة. تأكد من عدم وجود workflow آخر نشط على قناة Telegram لفرانكفورت.
2. اجعل testConsent=false وbusinessAlertsEnabled=true في Owner Routing،ثم احفظ وانشر/فعّل **هذا workflow وحده**. لا تغيّر إعداد حارس النسخ `businessAlertsEnabled=false`،ولا القناة التقنية أو workflow Singapore.
3. فعّل cron الأعمال وPush فقط بالمعاملات المحروسة القائمة في خطة التشغيل وبعد مراجعة جرد فرانكفورت الفعلي. استلام n8n للأحداث لا ينشئ cron،ولا يتجاوز حجز push.
4. أنشئ حدث عمل حقيقياً مضبوطاً ضمن تجربة التشغيل،وتحقق من وصوله لصاحب المحل ومن إتمام التسليم في العقد الحالي. Telegram يُؤكد ناجحاً فقط بعد `ok:true` ورقم رسالة وردّ يحمل Chat ID المالك. فشل النقل أو رد غير مطابق يسجل كوداً ثابتاً دون إعادة إرسال نص الخطأ الخام.
5. عند خطأ مستلم أو نوع غير معروف أو تراكم فشل/dead-letter،أوقف workflow الجديد وbusinessAlertsEnabled،وراجع السبب مع المطوّر. لا تعِد توجيه الأعمال لقناة المطوّر كحل مؤقت،ولا تعدّل صفوف التسليم يدوياً.

التسليم يتبع ضمان العقد الحالي «محاولة واحدة أو أكثر»:إذا قبل Telegram الرسالة ثم انقطع تأكيد القاعدة،قد تتكرر الرسالة عند إعادة المحاولة. لا يعد هذا القالب بضمان إرسال مرة واحدة عبر النظامين. يُراجع المالك الملخص من التقرير المعتمد،ولا تُستعمل الرسالة كقيد مالي.

## دليل التحقق المحلي

اختبارات التعبيرات والبوابات في `tests/frankfurt-owner-alerts.test.ts` تعمل بلا شبكة. الاستيراد التجريبي يستعمل حاوية n8n جديدة `--network none` واعتمادات اصطناعية فقط؛لم يُفتح مثيل `nawasrah-n8n` القائم. كل اختبارات CI العامة تبقى مطلوبة قبل الدمج. اختبار الوصول الحقيقي والتفعيل مؤجلان للمالك؛لا يستبدلهما نجاح الاستيراد المحلي.

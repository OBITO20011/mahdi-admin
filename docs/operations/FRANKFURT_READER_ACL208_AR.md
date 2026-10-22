# إصلاح ACL قارئ الطلبات القديم — تجهيز للمالك فقط

لم يتصل الوكيل بفرانكفورت ولم ينفذ SQL أو أوامر الترقية. لا تغيير على التطبيق أو RPC أو migrations أو تاريخها. المرجع الحالي وأمر التحقق يظلان208.

## النتيجة ومصدر الفرق

المنحة `service_role=X/postgres` على `get_operational_orders_page(integer,integer,text,text,text)` قديمة؛ تظهر في `acl-alignment-2026-10-15T06-54-58-324Z/source-catalog.json` المحفوظ، وفي `upgrade199-2026-10-19T14-53-12-547Z/preflight-prefix/catalog-observed.json`، ثم في فحص ما قبل200 وفي الكتالوج النهائي للترقية الفاشلة. المسارات كلها تحت `C:\Users\TOP\NawasrahFrankfurt\nawasrah-fra-001-138`.

لقطة15أكتوبر تُظهر أيضاً أن default privileges لدوال `postgres` في `public` تمنح EXECUTE إلى `service_role`. migration075 ينشئ القارئ القديم ويسحب من PUBLIC وanon فقط؛ فيحتفظ بمنحة service_role التي يفسرها إعداد فرانكفورت الافتراضي. migration204 يسحب service_role صراحة من قارئ سجل المبيعات الجديد. المرجع المحلي208 يمنح القارئين postgres وauthenticated فقط. لذلك فالسبب المرجح المدعوم باللقطات هو إعداد الصلاحيات الافتراضي القديم على فرانكفورت، وليس إضافة من migrations200–208. لا تتضمن اللقطات سجل GRANT تاريخياً يثبت لحظة المنح أو يستبعد منحة يدوية سابقة.

لماذا `catalogUnexpectedDifferenceCount:0` مع الخطأ؟ سياسة المقارنة العامة في `managed-catalog-policy.mjs` تستثني service_role، ومخطط المواءمة يحافظ عليه؛ أما `assertReady204Catalog` فيقارن ACL القارئين حرفياً ويستدعى ضمن جاهزية208. قيمة stage بقيت repair-208 بعد تسجيل208؛ ليست دليلاً على فشل التسجيل. التقرير يثبت applied وrecorded كاملتين200–208.

## الفرقان الإضافيان اللذان أخفاهما أول فشل

المحاكاة على الكتالوج المحفوظ تثبت أن إزالة منحة الطلبات وحدها تعالج شرط204، ثم يكشف شرط205 الخطأ `RECEIVING205_SAME_RECEIPT_READER_ACL` بسبب المنحة القديمة نفسها على `get_supplier_receipts_page(integer,integer,text,uuid,uuid,text,boolean)`. إزالة تلك أيضاً تكشف شرط206 `CASH206_SAME_REPORT_ACL` بسبب `get_cash_shift_closing_report(uuid)`، الذي يُقارن به قارئا التصحيح207 أيضاً. المرجع208 لا يمنح service_role لأي من القارئين القديمين. هذه ليست صلاحيات جديدة نحتاج منحها للدوال الجديدة.

لهذا جُهز ملفان منفصلان: ملف `FRANKFURT_READER_ACL208_OWNER.sql` يقتصر على طلب204 حرفياً، وملف `FRANKFURT_LEGACY_READERS208_OWNER.sql` يعالج المنح الثلاث المحددة القديمة معاً حتى يمر فحص الجاهزية208 على الكتالوج المتوقع. لم ينفذ الوكيل أياً منهما؛ الملف الكامل هو الموصى به لإغلاق فشل الترقية208 كله، بدلاً من إظهار خطأ جديد بعد كل سحب.

## أمر المالك الموصى به لإكمال208

افتح SQL Editor لمشروع فرانكفورت `kzevmysfydaslxcerogt` بدور postgres، ثم انسخ وشغّل ملف `FRANKFURT_LEGACY_READERS208_OWNER.sql` كاملاً. يسحب EXECUTE من service_role على القارئات الثلاثة القديمة فقط. يتأكد قبل أول سحب من هوية ومالك وACL تسع دوال محددة (ثلاث قديمة وست دوال جديدة للمقارنة). يقبل المنح القديمة المعروفة أو كون الإصلاح مطبقاً بالفعل؛ أي اختلاف آخر يوقف المعاملة. يعيد فحص التسع قبل COMMIT. المتوقع: اكتمال COMMIT وظهور تسعة صفوف ACL لكل منها postgres وauthenticated فقط. لا GRANT ولا CASCADE ولا تغيير default privileges أو بيانات أو أجسام دوال أو تاريخ migrations. شغّل بعدها verify-only أدناه. لا حاجة لتشغيل الملف المحدود204 أولاً.

## البديل المحدود204 فقط

افتح SQL Editor لمشروع فرانكفورت `kzevmysfydaslxcerogt` بدور postgres، ثم انسخ وشغّل ملف `FRANKFURT_READER_ACL208_OWNER.sql` كاملاً. نواة الإصلاح الوحيدة:

```sql
REVOKE EXECUTE ON FUNCTION public.get_operational_orders_page(integer,integer,text,text,text)
FROM service_role RESTRICT;
```

الملف الكامل يضعها في معاملة مع فحص الهوية والمالك وACL قبل التغيير وبعده، ويمنع التزامن مع الترقية بالمفتاح نفسه. يقبل الحالة المعروفة أو كون الإصلاح مطبقاً بالفعل فقط؛ أي اختلاف آخر يوقف المعاملة. لا CASCADE ولا تغيير default privileges ولا منح للدالة الجديدة. المتوقع: اكتمال COMMIT وظهور صفين ACL لكل منهما postgres وauthenticated فقط. إذا ظهر خطأ فلا تتابع؛ احتفظ بنصه. الأمر لا يعيد migrations ولا يغير بيانات العمل أو أجسام الدوال.

## التحقق بعده

في PowerShell:

```powershell
Set-Location C:\Users\TOP\mahdi-admin
npm.cmd run frankfurt-owner-upgrade208 -- --verify-only
```

يطلب الأمر تأكيد معرّف المشروع وكلمة المرور المخفية؛ المتوقع `ok:true` و`remoteWriteAttempted:false`، وتاريخ170migration ينتهي208 ومقارنة كتالوج بلا فروق غير متوقعة وحفظ تقرير جديد مع سلامة Realtime وإيقاف الإشعارات. وضع verify-only الحالي يستعمل المقارنة العامة؛ لذلك إثبات مساواة ACL الحرفية هو فحص المعاملة وصفوف SELECT في الملف الكامل (تسعة صفوف)، ولا تكفي نتيجة verify-only وحدها لإثبات إزالة service_role. عند اختيار البديل204 وحده، لا تعني نتيجة verify-only أن شرطي205/206 الحرفيين صارا سليمين.

لا حاجة لإعادة --apply أو migration repair أو تعديل migration204/208 لهذه الحالة. لا تستعمل --include-all. المرجع208 المحفوظ لا يتغير.

التحقق الذي أُجري للتجهيز: مقارنة محلية للكتالوج المحفوظ قبل/بعد إسقاط ذرات ACL الثلاث المحددة في الذاكرة، وإعادة إنتاج أخطاء204 ثم205 ثم206، ونجاح فحص الجاهزية208 على النسخة المتوقعة بعد الثلاث. الملف المحدود ينجح عند شرط204 فقط. لم يُنفّذ SQL حتى على قاعدة محلية؛ لا ادعاء باختبار حي أو نجاح الإصلاح على فرانكفورت. الدليل المحفوظ FRANKFURT_READER_ACL208_PREPARED.json.

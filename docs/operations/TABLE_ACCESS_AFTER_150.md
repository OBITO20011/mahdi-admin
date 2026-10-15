# الوصول المباشر بعد150 وتصحيحFK

**PASS محلياً للوصول المباشر؛ليس إذناً بالمواءمة أو قبولstaging. لا اتصال مُدار.**

قاعدة جديدة001–139+150،دون140–149. 50 موضعاً،142 سلسلةSDK فعلية: 142 نجاح،صفر42501 وصفرPGRST2xx وصفرأخطاءأخرى. تغطية كل الأدوار والمتغيرات كاملة بلا تكرار.

الوقت:2026-10-15T12:05:27.070Z إلى2026-10-15T12:09:23.824Z. أسماءmigrationsالمطبقة:140 ملفاً،وأعلىرقم150. منح/RLS/أعمدة/صفوفكلدورفيJSON؛منحأعمدةbusiness_operations بقيتضيقة،وفحصcount(*)المرفوض لايُلغي نجاحقراءةالأعمدةالمسموحة الأصلية.

## الاستعلامات الأربعة

| المصدر | النتائج الفعلية |
|---|---|
| orders.service.ts:569 | owner/original-chain:success؛ admin/original-chain:success؛ cashier/original-chain:success |
| purchases.service.ts:381 | owner/original-chain:success؛ admin/original-chain:success؛ cashier/original-chain:success |
| purchases.service.ts:979 | owner/original-chain:success؛ owner/with-query-extensions:success؛ admin/original-chain:success؛ admin/with-query-extensions:success؛ cashier/original-chain:success؛ cashier/with-query-extensions:success |
| directReceiving.service.ts:209 | owner/original-chain:success؛ admin/original-chain:success؛ cashier/original-chain:success |

اختير product_id للصنف الفعلي،وreceived_by لاسم الموظف المستلم. purchase_receipt_items ترتبطبالسند بمفتاحpurchase_receipt_id في موضعين (تفاصيلPO وقائمةالسندات)،لاoperation_chain الذييسقطlegacyNULLoperation_id. لاaliasغيرمستهلك أوعمودإضافي. خمس hints لأربعسلاسل،وبقيةASTلكلملفمطابقةلبصمة204f1ed قبلالتصحيح.

المقارنةقبلالمنحعلى138 محفوظة فيTABLE_ACCESS_DIAGNOSTIC.json؛يبقى اختبار42501 السلبي قائماً. العقد الجديد لايُعدّيأخطاءSQLأوPostgREST،ولاينقصتغطيةالأدوار/الصفحات. --require-access يبني150 ولايصللمشروعحقيقي. المصادقةوStorageوRealtimeوالإعداداليدويمازالتبواباتstaging منفصلة.


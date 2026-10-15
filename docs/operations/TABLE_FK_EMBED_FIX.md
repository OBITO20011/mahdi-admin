# تصحيح علاقات PostgREST الصريحة —2026-10-15

اعتماد المالك لأربعة استعلامات معPGRST201. التغيير الوحيد فيالمنتج خمس
hints لأسماءFK ضمنselect القائمة؛لاRPC/حمولاتكتابة/أعمدة/فلترة/ترتيب/
حساب/تحقق/تأكيد/صلاحية أوmigration إضافية.

| الملف/الاستعلام | FK المحددة | المعنى |
|---|---|---|
| orders.service.ts:569 | order_items_product_id_fkey | الصنف الفعلي للسطر،لاfamily_product_id |
| purchases.service.ts:381 | purchase_order_items_product_id_fkey | الصنف الفعلي لسطرPO |
| purchases.service.ts:381 ضمنpurchase_receipts | purchase_receipt_items_purchase_receipt_id_fkey | كل بنود السند |
| purchases.service.ts:979 | purchase_receipt_items_purchase_receipt_id_fkey | كل بنود السند فيالقائمةأيضاً |
| directReceiving.service.ts:209 | supplier_receipts_received_by_fkey | موظف الاستلام،لاphase2_cancelled_by |

الفحص الأول بعدأربعhints:139نجاحاً+3PGRST201،صفر42501. كشفنفساستعلام381
التباساًمتداخلاًأُخفي خلفالتباسالصنفالأول؛حددناFKالسند فيهمرةثانية.
المفتاحالبسيط يربطpurchase_receipt_id فقط كماكانتدلالةالقارئ؛المركب
operation_chain يُسقطالصفوفالقديمةذاتoperation_id=NULL. هذهحجةكاتالوج
ومعنىالشاشة،لاادعاءإنشاءسندV1جديد. لاإضافةfamily/cancelledBy alias لعدم
وجوداستهلاكلهمافيالمحولالحالي.

## AST والفحص الحقيقي

بوابةstrict القديمة رصدتالـhints المعتمدةكفروقفيالملفاتالثلاثة. عُدّلت
لتطبيع أسماءFKالمسمّاةفيتلكالملفاتفقط؛كلassertionsالاستدعاءوالجسمكماهي،
معnegativecontrolلتغييرحقل/مبلغ/حارس/علاقةأخرى.19اختباراًمتعلقاًPASS.
لميتغيركودالمنتجبسببفشلالتوقعالقديم،ولاالبصماتالمستقلةلأساس204f1ed.

عقد receiving-unit-pricing القديم يقارنالخدماتكاملةًبنفسالهدف؛رصدنفسhints
أيضاً. تطبيعهاأسماءمحددةلكلملففقطمعإبقاءمقارنةالمصدرالكامل،لااستثناء
RPCأوحذفassertion. لااختبارمتصفحأُعيدبسببه،إذالبوابةتوقفتقبله.

اختبار `table-embed-fk-parity.test.ts` يقارنAST الملفاتالثلاثة كاملةً ببصمات
مأخوذةمن204f1ed **قبلالتعديل**،بعدإزالةأسماءFK المعتمدةفقط. الثلاثةPASS؛
يشملالنداءاتوالحمولاتوالفلاتروكلالمعالجات،لابحثاًعنRPCوحدها. صُحح مساعد
المقارنةليحافظعلىتهجئةstring/quoteالأصلية،دونتغييرالبصماتالثابتة.

دليلDB معزول `nawasrah-table-access-2WNBGu/diagnostic.json` بعد150:
142/142SDK PASS،صفر42501/PGRST2xx/أخطاءأخرى،كل50موضعاًوالأدوارومتغيرات
الصفحاتمغطاةبلا نقص أوتكرار.31جدولاًفيACL/RLS و186فحصSQLأدوارإضافي.
النتيجةفيTABLE_ACCESS_AFTER_150.json/md. شرطتغطيةمفقودةأومكررةأومستبدلة
له اختباراترفضمستقلة،لاعدّأدنىمتسامح.

الدليل السلبي الحالي على138 `nawasrah-table-access-aBTtdp/diagnostic.json`:
15نجاحاً+127رفض42501 وصفرأخطاءعلاقات. يبقىحارسالرفضالقديم،ولاتُحوّل
نتيجةجمعالأدلةإلىقبولتطبيق. TableInventoryوRPCinventoryأُعيدتوليدهما
لبصماتالمصدرالحالي،لا تحديثبصماتأدلةدونتشغيلحقيقي.

RPC `nawasrah-service-access-IeYULP/diagnostic.json`:372dispatchحقيقياً
على138،صفر42501؛الحمولاتالمحايدةوأخطاءتحققجسمالدوالليسنجاحاًوظيفياً.
منحEXECUTE/الأدوارلمتتغيرفي150(مقارنةكاتالوجكاملة)،و139غيرتجسمenqueue
الداخليمعإبقاءACL. لاأسرارأوقيمRPCمحفوظة،كلنجاحبـrollback. شروطStorage/
Realtimeمذكورةكماهي؛صفوفbucket/عضويةpublication البعيدةلايثبتهالكتالوج
المحفوظ. أُضيفAuth signupOFF وSiteURL/redirectsنهائيةإلزامياًللقائمةاليدوية.

البوابة المحلية النهائية نجحت 12:46:41–12:56:02 UTC، والملفات ثابتة حرفياً
طوالها: typecheck/lint، كل1072 وحدة إدارة و191 وحدة متجر، و60/60 اختبار
Orders/Purchasing على Chromium وWebKit (401.060s للمتصفح). السجل الخارجي
`nw-fk-gates-20261015-final`؛لا retries أو تخطي أو زيادة مهلات.
Gitleaks وCI الكامل على commit التسليم بوابتان إلزاميتان لاحقتان.
لا تطبيق مواءمة أو139/150 على فرانكفورت
منالوكيل،ولاتفعيلStorage/Realtime/Auth/Functions أوProductionأونشر.

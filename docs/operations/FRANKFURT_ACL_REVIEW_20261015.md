# مراجعة كتالوج فرانكفورت المحفوظ — توقف صلاحيات،2026-10-15

قراءة ملفات محلية فقط؛ لا اتصال CLI/SQL بمشروع مُدار ولا قراءة كلمة سر.
التحليل أدناه لا يطبق سياسة تجاهل، ولا يغيّر DB أو migration أو ACL.

## مصدر الدليل

مجلد المالك الخارجي `C:/Users/TOP/NawasrahFrankfurt/nawasrah-fra-001-138`:
`catalog-differences.json` و`catalog-observed.json` و`local-reference.json`.
ملف الفروق518 سطراً منطقياً/كائناً،normalizationError=null،SHA256:
`eabbc698abb70aec09af73e8f4ac257f36897c2eb1ccb7ce2887975fbbbfe831`.
لا تعديل لهذه الملفات أو للتقارير الأصلية أثناء التحليل.

## ما ثبت

- كل34 دالة public ذات اختلاف definition متطابقة **حرفياً** بعد CRLF→LF؛
  لا تطبيع لمسافات أخرى أو SQL أو أسماء. assert34 ومساواة النصوص نجحا.
- pg_net ليست إضافة غائبة محلياً: النسخة0.20.4 نفسها مسجلة تحتextensions
  محلياً وpublic بعيداً، والمالكsupabase_admin في كليهما. فرق namespace
  يجعل المقارنة الحالية تظهر إزالة وإضافة. لا تغيير منصة نُفّذ.
- `net.http_post(url text, body jsonb, params jsonb, headers jsonb,
  timeout_milliseconds integer)` موجود في الكتالوجين،RETURNS bigint؛
  ثبت ذلك بـassert من الملفات. تعريفه وأمانه الداخلي ليسا متطابقين بين
  المنصتين؛ وجود التوقيع ليس إثبات تنفيذ أو صلاحية تشغيل عن بُعد.
- بعد حذف عناصر ACL التي grantee فيها service_role فقط، وترتيب بقية
  عناصرACL للمقارنة، بقي48 فرقاً فيpublic تخص أدواراً أخرى. لا يمكن
  إثبات صفر فروق غير متوقعة وفق اعتماد المالك الحالي.

##48 فرق ACL خام خارج service_role

| القسم | العدد |
|---|---:|
| جداول أعمال/إدارة |31|
| Sequences،ممثلة ضمن قسمtables من الكتالوج |7|
| دوالpublic |7|
| Default privileges للمخططpublic،المالكpostgres |3|

الجداول31: audit_logs،branches،brands،categories،customer_addresses،
customer_payments،customers،inventory_balances،inventory_movements،order_items،
order_status_history،orders،product_images،products،profiles،promotion_codes،
promotion_redemptions،purchase_order_items،purchase_orders،purchase_receipt_items،
purchase_receipts،roles،stock_alert_reads،stock_alerts،supplier_payments،
supplier_receipt_items،supplier_receipts،suppliers،units،user_roles،warehouses.

Sequences7: admin_ai_assistant_usage_events_id_seq،cash_shift_number_seq،
customer_payment_number_seq،operational_expense_number_seq،pos_sale_number_seq،
sales_return_number_seq،supplier_receipt_seq.

الدوال7: authorize_admin_ai_assistant_request()،enforce_customer_for_debt_order()،
enforce_product_flavor_inheritance()،guard_cash_shift_closing_report_snapshot()،
set_website_new_order_reservation_expiry()،sync_order_payment_state()،
sync_product_flavor_commercial_settings().

### أمثلة مثبتة بلا تعميم خطر غير مفحوص

- audit_logs وorders وproducts وcustomers: محلياً
  `anon=Dxtm/postgres` و`authenticated=Dxtm/postgres`؛ بعيداً لكل منهما
  `arwdDxtm/postgres`. أضيفتINSERT/SELECT/UPDATE/DELETE. أعلامRLS للجداول
  المصنفةkind=r أعلاه مفعلة في الكتالوج البعيد؛ هذا **لا** يثبت أن كل
  الإضافات قابلة للاستغلال، ولا يجعل ACL متطابقة.
- authorize_admin_ai_assistant_request(): محلياًpostgres وauthenticated
  لهماX؛ بعيداً أضيفanon=X أيضاً، إلى جانبservice_role. ليس الفرقservice_role
  وحده. لم يُختبر سلوك الدالة بحسابanon على أي مشروع حقيقي.
- الدوال الست الأخرى لهاacl=null محلياً، وبعيداً PUBLIC/postgres/anon/
  authenticated/service_role معX. null يستلزم تفسيرacldefault،وPUBLIC قد
  يمنح التنفيذ أصلاً؛ لا نساوي عدد الفروق الخام بعدد ثغرات أو توسعات فعالة.
  حسب شرط مقارنة ACL الصارمة،هذه ليست فروقservice_role فقط.

### Default privileges الثلاثة

كلها فيschema=public،role=postgres،وتتغيرanon وauthenticated معاً:

| النوع | محلي لكل منanon/authenticated | بعيد لكل منهما |
|---|---|---|
| S:sequences |w|rwU|
| f:functions |لا عنصرACL|X|
| r:relations |Dxtm|arwdDxtm|

لم يُفترض سبب تلقائي منauto-expose أو أي إعداد؛ الدليل الحالي يثبت الفرق
فقط. يلزم تحليل مصدر المنح/الأثر قبل اعتماد أي مواءمة.

## قرار التوقف والخطوة المقترحة

شرط المالك: أي فرقanon/authenticated/PUBLIC أو دور آخر يفشل،والاستثناء
service_role فقط. لذلك لا استثناء أوسع ولا إعلان نجاح صفر ولا إصلاحDB.
لم يبدأ تعديل المقارن أو تخفيفبوابته،ولم يُشغّل--verify-only المتصل.

المطلوب مراجعة48 فرقاً وتحديد مواءمة صلاحيات صريحة منفصلة إن لزم،بعد قياس
الأثر معRLS وحراسالدوال؛ ليست الموافقة المطلوبة «تجاهل أدوار أخرى».
بعد اعتماد المسار،يمكن تنفيذ تطبيع الأسطر وتصنيف المنصة المسمّى واختبارات
المقارن،مع إبقاء اختباراتanon السلبية والمالك/definer/search_path صارمة.

اختبار القراءة المحلي الحتمي أكد:34/34 تعريفاً متطابقةLF،48 فرقACL خام
غيرمستثنى،وتوقيعhttp_post موجود. **قبول الكتالوج:HOLD وليسPASS**.
139 السابقة ما زالت غيرمسلمة؛لم تُضم إلى commit ضمن هذا التشخيص.
أفاد المالك أنه سيغيّر كلمة سر فرانكفورت؛ لم تُقرأ أو تُحفظ كلمة سر هنا،
ولا يعتمد السكربت على قيمة محفوظة منها.

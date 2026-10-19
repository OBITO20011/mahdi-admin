# الدوال المكشوفة بلا واجهة وتصحيح الأخطاء — تقرير المرحلة ب

19 أكتوبر2026. قراءة مرجع199 المحلي ومصدر`6841256` فقط؛ لا اتصال مستضاف،
ولا كتابة أو منح أو سحب EXECUTE أو تنفيذ مالي. المقترحات تنتظر الاعتماد.

## العدد والمنهج

513دالة public إجمالاً؛ **192توقيعاً** تملك anon أو authenticated أو PUBLIC
عليها EXECUTE، منها6دوال trigger ليست RPC عادية. الجرد الحالي فيه163اسم
RPC مستدعى؛158توقيعاً مكشوفاً تطابق أسماءه، و**34بلا RPC مباشر من الواجهة**.
الاسم غير التوقيع عند overloads. الرقم القديم204/42 لا يصف المرجع الحالي.

27من34 بلا أي ذكر حرفي لاسمها في مصدر الإدارة/المتجر/Edge، و7 تظهر في
تعليق أو اسم أطول أو معرّف إجراء، وليس في استدعاء. ملحق
`UNEXPOSED_RPC_REVIEW_EVIDENCE.json` يسجل التوقيع والمنح والتعريف ومواقع
الذكر ودوال DB والسياسات والتريغرات المرشحة لاستدعائه. تحليل callgraph
ساكن ولا يثبت وحده سلامة سحب المنحة؛ يُستكمل باختبار دور حقيقي بعد الاعتماد.

acl=NULL تُفسّر بالمنح الضمنية ومنها PUBLIC، لا تُهمل. لا تُعد كل دالة
بلا زر قدرة ناقصة، ولا تُسحب منحة دالة حماية لمجرد غياب اسمها في React.

## جرد الدوال34 كاملاً

أ: قدرة تصحيح ناقصة، ب: مسار واجهة أحدث، ج: اعتماد DB/RLS/trigger،
د: قديم أو مرشح سحب مباشر بعد إثبات. كل صف توقيع واحد؛ التواقيع كاملة فيJSON.

|الدالة|الدور المكشوف|التصنيف والدليل/البديل|التوصية، لا التنفيذ|
|---|---|---|---|
|cancel_purchase_receipt_v2|authenticated|أ؛ لا زر إلغاء استلام PO؛ المباشر له مسار مستقل|⋯ داخل سند PO، مع معاينة أهلية/WAC/دفعات؛ لا استعمال إلغاء المباشر بدلاً منه|
|create_customer_order|authenticated|ج؛ submit_guest_customer_order_core يستدعيه؛ الواجهة Gateway/v2|مرشح حصر الدعوة المباشرة بعد إثبات الاستدعاء الداخلي؛ لا حذف|
|create_direct_supplier_receipt|authenticated|ب/د؛ الجسم يرفض بـRECEIVING_V1_READ_ONLY؛ الحاليv2|سحب منحة المسار الموقوف بعد الاعتماد|
|create_product_with_opening_stock|authenticated|ج/د؛ أساس سلسلةv4←v3←v2|لا زر؛ مرشح سحب المباشر مع إبقاء السلسلة الداخلية|
|create_product_with_opening_stock_v2|authenticated|ج/د؛ v3 يستدعيه|نفسه، مع اختبار v4 الحقيقي|
|create_product_with_opening_stock_v3|authenticated|ج/د؛ v4 يستدعيه|نفسه؛ لا خلط مع update_v3 المسحوب171|
|create_purchase_order_v2|authenticated|ب/د؛ الواجهة create_purchase_order الحالي|مراجعة التكافؤ والتبعيات ثم سحب مباشر مقترح؛ لا زر ثانٍ|
|enforce_customer_for_debt_order|PUBLIC|ج؛ trigger orders.trg_require_customer_for_debt_order|لا واجهة؛ مراجعة حصر المنحة بعد إثبات بقاء trigger|
|enforce_product_flavor_inheritance|PUBLIC|ج؛ trigger products.trg_products_flavor_inheritance|نفسه|
|get_admin_product_listing|authenticated|ب؛ get_admin_product_page وsearch_admin_products|مرشح سحب legacy بعد تأكيد عدم دعم عميل قديم|
|get_cash_shift_display_summary|authenticated|ج؛ get_expense_shift_center والأرشيف يستدعيانه|لا حذف؛ حصر المباشر فقط بعد اختبارات القراء|
|get_cash_shift_summary|authenticated|ج؛ فتح/إغلاق/سحوبات وقراء يعتمدونه|ليس «بلا استخدام»؛ لا واجهة مستقلة جديدة|
|get_configurable_parcel_feature_state|anon/authenticated|ج؛ حراس إنشاء وpreview/context؛ الإعداد له واجهة|لا زر؛ سحب anon قرار صلاحيات يحتاج مراجعة منفصلة|
|get_dashboard_analytics|authenticated|ب/د؛ الحالي get_home_dashboard197|مرشح سحب القديم؛ لا عرض رقم قديم بجوار القانوني|
|get_public_product_catalog|anon/authenticated|ج/ب؛ get_public_storefront_catalog يستدعيه|اختبار page/SEO/Gateway قبل حصر المباشر|
|get_public_storefront_catalog|anon/authenticated|ب/د؛ المتجر يستدعي catalog_page لا هذا التوقيع|مرشح سحب مباشر بعد فحص SEO/Edge؛ الذكر النصي اسم النسخة الأطول|
|guard_cash_shift_closing_report_snapshot|PUBLIC|ج؛ trigger حماية snapshot|لا واجهة؛ أي حصر منحة يثبت استمرار trigger|
|has_erp_role|authenticated|ج؛ RLS Storage ودوال الربح والطرود|لا يسحب لغياب واجهة؛ قد يكسر رفع الصور|
|is_active_erp_staff|authenticated|ج؛ سياسات RLS كثيرة|لا يصنف legacy؛ إبقاء حماية الأدوار|
|is_authenticated|authenticated|د؛ لا مرجع current في RLS/callgraph|مرشح سحب بعد اختبار Auth والمنح|
|is_mfa_policy_satisfied|authenticated|ج؛ assert_erp_role/has_erp_role/is_active_erp_staff|اعتماد MFA/RLS، لا واجهة جديدة|
|receive_inventory|authenticated|ب/د؛ الاستلام الحاليv2؛ ذكر QuickActions معرّف إجراء|مرشح سحب؛ لا زر يولد مخزوناً بلا سند وتكلفة وذمة|
|receive_purchase_order|authenticated|ب/د؛ الحالي receive_purchase_order_v2|سحب مباشر legacy مقترح بعد فحص التبعيات|
|record_customer_order_payment|authenticated|ج/ب؛ _once ومنسق163/198 هما الحاليان|لا واجهة ثالثة؛ لا كسر once أو النداء الداخلي|
|reverse_customer_order_payment|authenticated|أ/ج؛ reverse_customer_collection_v1 يستدعيه؛ دفعة الطلب القديمة بلا زر|⋯ لدفعة طلب مفردة فقط؛ لا جزء من تحصيل موحد ولا شيك|
|reverse_pos_sale|authenticated|أ/ج؛ عكس الوردية الكاملة يستدعيه|⋯ فاتورة POS؛ الكاتب owner فقط، سبب3–500، وردية مفتوحة، بلا دفعات/مرتجعات تابعة|
|reverse_supplier_payment|authenticated|أ/ج؛ عكس الوردية يستدعيه؛ لا زر دفعة عادية|⋯ سند الدفعة؛ owner وحارس الوردية؛ لا توسيع عكس شيك أصلي أو قيد195|
|set_product_primary_image|authenticated|ج؛ حفظ المنتج والنكهة يستدعيه؛ الصورة في نموذج المنتج|ليست فجوة مالية؛ لا زر يعيد مسار حفظ قديم|
|set_website_new_order_reservation_expiry|PUBLIC|ج؛ trigger orders|لا واجهة؛ مراجعة حصر EXECUTE بعد اختبار trigger|
|settle_sales_return_v1|authenticated|ج/ب؛ settle_admin_sales_return_v1 غلاف الواجهة الحالي|لا واجهة legacy ثانية؛ مرشح حصر المباشر بعد اختبار الغلاف|
|sync_order_payment_state|PUBLIC|ج؛ trigger orders|لا واجهة؛ حصر منحة لا يكسر التشغيل الداخلي|
|sync_product_flavor_commercial_settings|PUBLIC|ج؛ trigger products|نفسه|
|update_product_master|authenticated|د؛ الحالي v4 مع حراس170/171؛ القديم يكتب cost_price مباشرة|أولوية مراجعة أمان؛ مقترح نزع EXECUTE المباشر بعد الاعتماد|
|update_product_master_v2|authenticated|د؛ ينادي القديم ثم wholesale؛ المرور لا يسبق بـv3|نفس أولوية المراجعة؛ لا تغيير صامت لحماية التكلفة|

## الدوال المسماة في الطلب وخارج34

- `send_test_push_notification` **غير موجودة حالياً**:033 أنشأتها و035 حذفتها.
  لا يعاد زرها برابط قديم؛ إثبات إشعار staging حقيقي بوابة نشر منفصلة.
- `build_business_summary` موجودة بلا EXECUTE للأدوار العميلة؛ قدرة Automation
  وليست شاشة ناقصة. `save_storefront_settings` القديمة بلا منحة؛ الحاليv3.
- `update_product_master_v3` و`update_product_flavor_v1` بقيتا بلا منحة
  authenticated بعد171؛ الواجهةv4/optimistic. لا يتغيران بهذا التقرير.

## ملاحظة أمان تستلزم قراراً: نسختا تحديث المنتج القديمتان

الدليل **من التعريف الحالي**: update_product_master يمنح authenticated
EXECUTE، يفحص assert_erp_role ثم يكتب products.cost_price_in_minor_units
من المعامل مباشرة، دون حارس171. v2 يناديه. لا مستدعي واجهة لأي منهما.
لم أرسل حمولة تعديل تكلفة ولم أغير المنح أو المنتج في هذه المرحلة.

هذا سطح قديم محتمل لتجاوز حماية الواجهة الحالية؛ أوصي بإثبات runtime
مركّز ثم سحب التنفيذ المباشر للتوقيعين قبل يوم التجربة، دون حذف الدالتين
أو كسر أغلفتهما الداخلية. **ينتظر موافقة؛ لا يُصلح خلسة ضمن عرض المستودعات**.

## واجهة تصحيح الأخطاء المقترحة

|مكان ⋯|الإجراء الناقص|معاينة قبل التأكيد|ما يبقى محمياً|
|---|---|---|---|
|فاتورة POS|عكس بيع خاطئ|المخزون والتحصيل والوردية وحالة الفاتورة|owner، وردية مفتوحة، سبب، key، منع التبعيات؛ المرتجع ليس عكساً|
|دفعة طلب في ملف العميل|عكس دفعة مفردة قديمة|الطريقة والمبلغ والدين والوردية|لا cashier؛ التحصيل الموحد يعكس كله؛ الشيك بالتعويض فقط|
|سند دفعة المورد|عكس دفعة عادية|الذمة والدرج والمرجع|owner، حراس النقد، لا مساس بحماية دفعة الشيك الأصلية|
|سند استلام PO|إلغاء السند|الكميات وWAC والدفعات وأسباب الرفض|لا بديل cancel_direct؛ قارئ المعاينة إن غاب يحتاج عقداً معتمداً|

الكاتب قد يسمح بأدوار إضافية اليوم؛ إخفاء زر لا يسحب صلاحية، وإظهاره لا
يوسعها. طلب واجهة owner/manager لا يجيز منح manager لكاتب owner. أي تغيير
دور أو قيد وردية أو تحقق مالي يحتاج قراراً؛ لا تُحذف تأكيدات لتقليل النقرات.

## بوابة تنظيف المنح لاحقاً

Migration مستقلة بتواقيع صريحة، لا حذف دوال ولا سحب شامل. بعد اعتماد القائمة:
اختبارات حقيقية للأدوار وRLS/Storage/trigger وcallgraph، ومنع مباشر42501 للقديم
مع نجاح الحديث والنداء الداخلي. التصحيحات: معاينة read-only، إعادة فحص تحت
الأقفال، سبب، key، rollback/replay، shift مفتوحة/مغلقة، شيكات وتبعيات.

القرار المطلوب: هل نعتمد إثبات وسحب منح نسختي التكلفة أولاً، ثم القدرات الأربع
داخل شاشاتها بنفس الأدوار الحالية؟ هذا تقرير لا migration ولا إذن تنفيذ.

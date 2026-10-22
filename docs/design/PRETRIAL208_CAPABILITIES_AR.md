# قدرات قاعدة البيانات ومراجعة ما قبل التجربة — 208

المصدر main `b79a9e7bc5e4ff9551c8dab111edb6c04fc17dd3`. مقارنة كتالوج المرجع المحلي المحفوظ حتى 208 مع جرد خدمات المصدر الحالي؛ لا وصول مستضاف ولا تغيير منح.

العدد الحالي 200 دالة عامة ممنوحة لأحد PUBLIC/anon/authenticated.32 اسماً ليست في قائمة أسماء RPC المباشرة للخدمات؛ هذا لا يعني 32 قدرة ناقصة: توجد دوال تناديها دوال أحدث، ومداخل trigger ، ومساعدات RLS ، وقراءات SDK. الملحق `../operations/PRETRIAL208_RPC_REVIEW.json` يحفظ الهوية والأدوار وكل مستدعي DB/policy/trigger ومواضع المصدر.

|القدرة/العائلة|المسار الحالي أو التصنيف|نتيجة المراجعة|
|---|---|---|
|reverse_pos_sale / reverse_customer_order_payment / reverse_supplier_payment / cancel_purchase_receipt_v2|معاينة 207 ثم execute_document_correction_once من المستند؛ الأخير يستدعي الكاتب الحالي|واجهة موجودة؛ لا إنشاء كاتب بديل أو منح جديد|
|set_product_primary_image|يُستدعى داخل تحديث المنتج/النكهة؛ الواجهة عبر update_product_master_v4 و update_product_flavor_v2|لا زر RPC مستقل مطلوب؛ الحفاظ على التحديث الذري|
|settle_sales_return_v1|settle_admin_sales_return_v1 من AdminAftercarePanel ؛ وربط 208 «للمورد» بالمنسق الذري|قدرة ممثلة في الواجهة؛ لا استدعاء مباشر قديم|
|send_test_push_notification|لا توجد بهذا الاسم في الكتالوج 208 ؛ الواجهة الحالية تفعيل/إيقاف إشعارات الجهاز|لا يُخترع RPC أو زر يتصل بقدرة غير موجودة؛ الإرسال التجريبي قدرة مستقلة تحتاج عقداً إن طُلبت|
|build_business_summary / save_storefront_settings / update_product_master_v3 / update_product_flavor_v1|موجودة بلا منح عميل في المرجع؛ إعداد المتجر عبر save_storefront_settings_v3 وتحديث المنتج/النكهة v4/v2|ليست وظائف UI ضائعة؛ لا إعادة منح النسخ القديمة|
|create_product_with_opening_stock / v2 / v3|سلسلةداخلية تنتهي بمسار v4 الحالي|مقارنة المنح القديمة بمستدعيها قبل أي تقاعد لاحق؛ لا إزالة ضمن تقرير|
|create_direct_supplier_receipt / receive_purchase_order|الخدمات الحالية create_direct_supplier_receipt_v2 و receive_purchase_order_v2 ؛ الإشارات القديمة تعليقات لا استدعاءات حية|نسخ قديمة مرشحة لمراجعة تضييق منح منفصلة بعد إثبات كل استدعاء وحارس|
|create_purchase_order_v2|الخدمة الحاليةتستدعي create_purchase_order ؛ لا مصدر RPC مباشر v2|لا نفترض أن الرقم الأعلى هو الأحدث المعتمد؛ مراجعة الفروق قبل أي سحب|
|get_admin_product_listing / get_dashboard_analytics|واجهة المنتج get_admin_product_page/search_admin_products ؛ الرئيسية get_home_dashboard|قارئان قديمان بلا نداء مباشر في الجرد؛ لا إضافة بطاقة تعتمد عليهما|
|receive_inventory|الإشارة في QuickActions اسم فعل تنقل؛ الاستلام الفعلي بسند المورد/PO|لا استدعاء قديم من الاختصار؛ صلاحية RPC القديمة تحتاج مراجعة منفصلة|
|get_public_product_catalog / get_public_storefront_catalog|الأول يناديه الثاني؛ خدمة المتجر الحالية تستدعي get_public_storefront_catalog_page|الكتالوج ممثل بقارئ صفحات أحدث؛ إشارة الاسم القديم في المصدر قد تكون بادئة اسم _page فقط، فلا تُحسب نداءً مباشراً|
|get_cash_shift_display_summary / get_cash_shift_summary|مستدعيات DB من الوردية والأرشيف والتقرير والكتّاب الحالية|دوال خدمة داخلية لمسارات قائمة؛ لا شاشة مالية جديدة|
|get_configurable_parcel_feature_state|تستدعيه قارئات/حراس إعداد الطرود ومكوناتها|قدرة إعداد قائمة؛ غير مرتبطة بتنفيذ «بيتباع بالطرد بس»|
|has_erp_role / is_active_erp_staff / is_mfa_policy_satisfied|سياسات RLS وحراس RPC ومخزنالصور|مساعداتأمنية؛ لا أزرار UI لها ولا سحبمنح دون اختبار السياسات|
|is_authenticated|لا مستدعٍ مطابق في المرجع/جرد المصدر|مرشح لتدقيق قديم منفصل؛ غياب مستدعٍ ليس إثبات أمان إسقاطه|
|enforce_customer_for_debt_order / enforce_product_flavor_inheritance / guard_cash_shift_closing_report_snapshot / set_website_new_order_reservation_expiry / sync_order_payment_state / sync_product_flavor_commercial_settings|مداخل triggers فعلية موثقة بالملحق|لا واجهات مفقودة؛ لا callableaction يدوي جديد|
|create_customer_order|يستدعيه submit_guest_customer_order_core ؛ بوابةالمتجر submit_guest_customer_order_v2|الحفظ قبل واتساب قائم؛ لا استدعاء قديم من الإدارة|
|record_customer_order_payment|record_customer_order_payment_once وكتّابإكمالالمتجر|الدفعة ممثلةضمنالمساراتالحالية والتحصيلالموحد؛لا بديل يضاعف المقبوض|

التوصية: لا إضافة واجهات لكل دالة ممنوحة، ولا سحب جماعي للمنح بالمطابقة النصية. تُراجع النسخ القديمة غير المستخدمة في مهمة أمنية محددة باختباراتأدوار/استدعاءوسلسلة DB كاملة وترحيل جديد معتمد. تقرير 208 لا يغيّر أياًمنها.

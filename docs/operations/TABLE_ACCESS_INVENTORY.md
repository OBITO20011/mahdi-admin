# جرد الوصول المباشر للجداول — المرحلة أ،2026-10-15

**قرار مانع: لا تشغّل `frankfurt-align-acl.mjs --apply`. هذا تحقيق وليس إصلاحاً للصلاحيات. لا migration150 ولا اتصال بفرانكفورت/Production.139 منفصلة وغير مسلّمة بهذا العمل؛140–149 محجوزة.**

## النتيجة والنطاق

- 50 موضع استعلام: 43 authenticated في الإدارة،7 service_role في send-order-push،0 anon. المتجر لا يقرأ الجداول مباشرة؛RPC/Gateway خارج جرد الجداول.
- 30 جدولاً مع الموارد المضمّنة؛20 اشتراك Realtime موثّق منفصلاً. Storage وArray.from مستبعدان بأسباب صريحة فيJSON.
- قاعدة جديدة001–138،138 سجلاً رسمياً. 142 إعادة تشغيل فعلية لسلاسل SDK الأصلية عبر PostgREST16.1/PostgreSQL17.6: 15 نجاح،112 رفض42501 في37 موضعاً،0 نتيجة صفرية،15 أخطاء أخرى.
- جاهزية وصول التطبيق: **غير مقبول — المنح الحالية تعطل الوصول المباشر**. نجاح أداة التشخيص يعني جمع الأدلة فقط،لا قبول المنتج.
- زمن الفحص:250.085ث؛2026-10-15T08:52:23.080Z إلى2026-10-15T08:56:33.165Z.

## طريقة الإثبات وحدودها

الجرد يستخدم TypeScript AST،لا grep وحده:كل from ذات جدول حرفي تتبعها سلسلة العمليات،والثوابت النصية للـselect،ومعدلات query اللاحقة،والـembeds. الاسم الديناميكي/عملية غير معروفة يفشلان الجرد بدلاً من إسقاطهما. JSON يحفظ source/الأعمدة/الفلاتر/الحمولات ومصدر الدور/المستدعين والأسطر وبصمات المصدر.

أُعيدت نفس طرق SDK والأعمدة والفلاتر والـsingle/maybeSingle والترتيب/الصفحات بمتغيرات fixture مصطنعة معلنة فيJSON،لا SELECT1 بديل. محوّل محلي يزيل mount /rest/v1 فقط مثل بوابة Supabase؛لا ردود وهمية. retries معطلة. JWT محلي للاختبار فقط فيRAM. كل قراءة إدارية أُجريت للمالك/admin/cashier؛هذا قياس وصول DB وليس ادعاء أن كل شاشة تسمح للأدوار الثلاثة. Edge بدورservice_role كما في createClient الفعلي؛لم تُشغّل Edge أو أي إرسال خارجي.

فحص RLS الإضافي نفّذ SET LOCAL ROLE وrequest.jwt.claims فعلياً داخل READ ONLY/ROLLBACK لكل جدول ولدورanon ومستخدم بلا دور ERP. لم تُضف أي منحة لتجاوز الرفض. عند42501 لا يمكن قياس إخفاء RLS؛نذكر الحجب لا نفترض صفراً. عند صفر مع عدم وجود صفوف fixture نذكر fixture_empty لا حجبRLS. سياسة موجودة في الكتالوج ليست إثباتاً بأنها تسمح لكل صف/فرع.

بيانات الفحص:مالك/admin/cashier ومستخدم بلا دور،أصناف/وحدات/فرع/مستودع/عملاء،استلامV2 مباشر،PO واستلام جزئي،بيعV2 بوحدة وطرد مشكّل بمكوّناته،اشتراك دفع وهمي بلا إرسال. إنشاء أدلة البيع/التكلفة عبرRPC الحالية؛لا نسخ بيانات حقيقية. عُطّل تريغر الإرسال وcron محلياً فقط قبل إدخال البيانات ثم حُذفت القاعدة. Realtime هنا جرد + شرط SELECT/RLS فقط،لا ادعاء اختبار قناة WebSocket من طرف لطرف.

## كل موضع ومصيره الحقيقي

الأثر التشغيلي الأوضح:fetchUserProfileAndRole يُرفض عندprofiles/user_roles،فيتعذر اعتماد ملف موظف صالح بعد تسجيل الدخول. قوائم الوحدات والمستودعات والأقسام والموردين وقراءاتالطلبات لا تعمل تحتالمرجع. createProductWithOpeningStockInSupabase ينفّذRPC ثم يقرأproducts للتحقق؛القراءةقد تفشل بعد نجاحالكتابة،فيعرضفشلاً كاذباً للمستخدم. لم نغيّر هذاالمسار. وفيEdge،كتاباتpush_dispatches/push_subscriptions مسموحة،لكنقراءةorders مرفوضة؛نجاحالكتابةوحده لايثبتنجاحالإشعار.

| الجدول/العملية | الملف:السطر والدالة | الدور/المسار/المستدعون | النتيجة (كل الأدوار/المتغيرات) |
|---|---|---|---|
| orders / select | src/features/pos/PosView.tsx:477 / executeSale | authenticated; pos; has-source-consumer | owner:42501؛ admin:42501؛ cashier:42501 |
| orders / select | src/services/supabase/adminCustomerV2Lifecycle.ts:221 / isCustomerV2Order | authenticated; adminCustomerV2Lifecycle.ts; src/services/supabase/orders.service.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| business_operations / select | src/services/supabase/adminCustomerV2Lifecycle.ts:227 / isCustomerV2Order | authenticated; adminCustomerV2Lifecycle.ts; src/services/supabase/orders.service.ts | owner:success؛ admin:success؛ cashier:success |
| profiles / select | src/services/supabase/auth.service.ts:222 / fetchUserProfileAndRole | authenticated; shared-store/auth-bootstrap; src/stores/useAuthStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| user_roles / select؛ embeds:roles | src/services/supabase/auth.service.ts:252 / fetchUserProfileAndRole | authenticated; shared-store/auth-bootstrap; src/stores/useAuthStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| supplier_receipts / select؛ embeds:branches,products,profiles,supplier_payments,supplier_receipt_items,suppliers,warehouses | src/services/supabase/directReceiving.service.ts:209 / fetchSupplierReceiptByIdFromSupabase | authenticated; directReceiving; src/features/directReceiving/DirectReceivingView.tsx | owner:PGRST201؛ admin:PGRST201؛ cashier:PGRST201 |
| suppliers / select | src/services/supabase/directReceiving.service.ts:533 / fetchSuppliersForReceivingFromSupabase | authenticated; directReceiving; src/features/directReceiving/CreateDirectReceiptModal.tsx,src/features/directReceiving/DirectReceivingView.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/directReceiving.service.ts:606 / fetchUnitsForReceivingFromSupabase | authenticated; directReceiving; src/features/directReceiving/CreateDirectReceiptModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| warehouses / select | src/services/supabase/directReceiving.service.ts:621 / fetchWarehousesForReceivingFromSupabase | authenticated; directReceiving; src/features/directReceiving/CreateDirectReceiptModal.tsx,src/features/directReceiving/DirectReceivingView.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| branches / select | src/services/supabase/directReceiving.service.ts:641 / fetchBranchesForReceivingFromSupabase | authenticated; directReceiving; src/features/directReceiving/CreateDirectReceiptModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| inventory_balances / select؛ embeds:products,warehouses | src/services/supabase/inventory.service.ts:150 / fetchInventoryBalancesFromSupabase | authenticated; inventory; no-static-consumer-found | owner:42501؛ admin:42501؛ cashier:42501 |
| orders / select؛ embeds:customer_addresses,customers,order_items | src/services/supabase/orders.service.ts:274 / fetchOperationalOrderListRows | authenticated; orders; no-static-consumer-found | owner:42501؛ admin:42501؛ cashier:42501 |
| order_items / select | src/services/supabase/orders.service.ts:278 / fetchOperationalOrderListRows | authenticated; orders; no-static-consumer-found | owner:42501؛ admin:42501؛ cashier:42501 |
| orders / select؛ embeds:customer_addresses,customers,order_items,order_status_history,product_images,products,sales_returns,units | src/services/supabase/orders.service.ts:569 / fetchOrderByIdFromSupabase | authenticated; orders; src/features/orders/OrdersCenterView.tsx | owner:PGRST201؛ admin:PGRST201؛ cashier:PGRST201 |
| order_parcel_instances / select | src/services/supabase/orders.service.ts:590 / fetchOrderByIdFromSupabase | authenticated; orders; src/features/orders/OrdersCenterView.tsx | owner:success؛ admin:success؛ cashier:success |
| order_parcel_components / select | src/services/supabase/orders.service.ts:596 / fetchOrderByIdFromSupabase | authenticated; orders; src/features/orders/OrdersCenterView.tsx | owner:success؛ admin:success؛ cashier:success |
| warehouses / select | src/services/supabase/products.service.ts:553 / createProductWithOpeningStockInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| categories / select | src/services/supabase/products.service.ts:561 / createProductWithOpeningStockInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:569 / createProductWithOpeningStockInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:578 / createProductWithOpeningStockInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:591 / createProductWithOpeningStockInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| products / select | src/services/supabase/products.service.ts:671 / createProductWithOpeningStockInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| warehouses / select | src/services/supabase/products.service.ts:766 / createProductFamilyWithFlavorsInSupabase | authenticated; products; src/features/products/ProductFormModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| categories / select | src/services/supabase/products.service.ts:778 / createProductFamilyWithFlavorsInSupabase | authenticated; products; src/features/products/ProductFormModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:790 / createProductFamilyWithFlavorsInSupabase | authenticated; products; src/features/products/ProductFormModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:797 / createProductFamilyWithFlavorsInSupabase | authenticated; products; src/features/products/ProductFormModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:804 / createProductFamilyWithFlavorsInSupabase | authenticated; products; src/features/products/ProductFormModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:815 / createProductFamilyWithFlavorsInSupabase | authenticated; products; src/features/products/ProductFormModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:983 / updateProductInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:994 / updateProductInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:1006 / updateProductInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| suppliers / select | src/services/supabase/purchases.service.ts:62 / fetchSuppliersFromSupabase | authenticated; purchases; src/features/purchases/CreatePurchaseOrderModal.tsx,src/features/purchases/PurchasesView.tsx,src/features/purchases/SupplierPaymentModal.tsx | owner:42501؛ owner:42501/extended؛ admin:42501؛ admin:42501/extended؛ cashier:42501؛ cashier:42501/extended |
| purchase_orders / select؛ embeds:branches,products,purchase_order_items,purchase_receipt_items,purchase_receipts,supplier_payments,suppliers,units,warehouses | src/services/supabase/purchases.service.ts:381 / fetchPurchaseOrderByIdFromSupabase | authenticated; purchases; src/features/purchases/PurchaseOrderDetailView.tsx | owner:PGRST201؛ admin:PGRST201؛ cashier:PGRST201 |
| purchase_receipts / select؛ embeds:products,purchase_orders,purchase_receipt_items,suppliers,warehouses | src/services/supabase/purchases.service.ts:979 / fetchGoodsReceiptsFromSupabase | authenticated; purchases; src/features/purchases/PurchasesView.tsx | owner:PGRST201؛ owner:PGRST201/extended؛ admin:PGRST201؛ admin:PGRST201/extended؛ cashier:PGRST201؛ cashier:PGRST201/extended |
| purchase_orders / select | src/services/supabase/purchases.service.ts:1061 / fetchSupplierPurchaseSummaryFromSupabase | authenticated; purchases; no-static-consumer-found | owner:42501؛ admin:42501؛ cashier:42501 |
| categories / select | src/services/supabase/reference-data.service.ts:49 / fetchCategoriesFromSupabase | authenticated; shared-store/auth-bootstrap; src/stores/referenceData.storeSlice.ts,src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| products / select | src/services/supabase/reference-data.service.ts:53 / fetchCategoriesFromSupabase | authenticated; shared-store/auth-bootstrap; src/stores/referenceData.storeSlice.ts,src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| brands / select | src/services/supabase/reference-data.service.ts:184 / fetchBrandsFromSupabase | authenticated; shared-store/auth-bootstrap; src/stores/referenceData.storeSlice.ts,src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| products / select | src/services/supabase/reference-data.service.ts:188 / fetchBrandsFromSupabase | authenticated; shared-store/auth-bootstrap; src/stores/referenceData.storeSlice.ts,src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/reference-data.service.ts:309 / fetchUnitsFromSupabase | authenticated; shared-store/auth-bootstrap; src/stores/referenceData.storeSlice.ts,src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| products / select | src/services/supabase/reference-data.service.ts:313 / fetchUnitsFromSupabase | authenticated; shared-store/auth-bootstrap; src/stores/referenceData.storeSlice.ts,src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| branches / select | src/services/supabase/reference-data.service.ts:450 / fetchBranchesFromSupabase | authenticated; purchases,shared-store/auth-bootstrap; src/features/purchases/CreatePurchaseOrderModal.tsx,src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| warehouses / select | src/services/supabase/reference-data.service.ts:480 / fetchWarehousesFromSupabase | authenticated; purchases,shared-store/auth-bootstrap; src/features/purchases/CreatePurchaseOrderModal.tsx,src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| push_dispatches / insert | supabase/functions/send-order-push/index.ts:87 / <module> | service_role; Edge send-order-push; has-source-consumer | service_role:success |
| orders / select | supabase/functions/send-order-push/index.ts:103 / <module> | service_role; Edge send-order-push; has-source-consumer | service_role:42501 |
| push_dispatches / update | supabase/functions/send-order-push/index.ts:113 / <module> | service_role; Edge send-order-push; has-source-consumer | service_role:success |
| push_dispatches / update | supabase/functions/send-order-push/index.ts:136 / <module> | service_role; Edge send-order-push; has-source-consumer | service_role:success |
| push_subscriptions / update | supabase/functions/send-order-push/index.ts:173 / <module> | service_role; Edge send-order-push; has-source-consumer | service_role:success |
| push_subscriptions / update | supabase/functions/send-order-push/index.ts:188 / <module> | service_role; Edge send-order-push; has-source-consumer | service_role:success |
| push_dispatches / update | supabase/functions/send-order-push/index.ts:208 / <module> | service_role; Edge send-order-push; has-source-consumer | service_role:success |

عدم وجود مستدعي ثابت لا يعني حذف الدالة:الجرد يذكرها ولا يختلق شاشة. منحة مقترحة لدالة غير مستخدمة تحتاج مراجعة قبل اعتماد150. أسماء المسارات هنا مفاتيح شاشات الإدارة (?screen=...) ومستهلكو الوحدات فيsrc،لا تخمين لمسار HTTP مستقل.

## عائق إضافي: علاقات مضمّنة ملتبسة (بلا إصلاح)

خطأ PostgREST201 يحدث أثناء تحليل select قبل الوصول لفحص بعض المنح. لا نُحوّله إلى42501 ولا نفترض أنGRANT سيصلحه. لم يتغير أي استعلام منتج. تكراره على الأدوار الثلاثة لا يدل على اختلافصلاحياتها. تفاصيلdetails/hint الأصلية محفوظة فيJSON:

| المصدر | الخطأ | العلاقات التي يعرضها PostgREST |
|---|---|---|
| src/services/supabase/directReceiving.service.ts:209 | PGRST201: Could not embed because more than one relationship was found for 'supplier_receipts' and 'profiles' | [{"cardinality":"many-to-one","embedding":"supplier_receipts with profiles","relationship":"supplier_receipts_phase2_cancelled_by_fkey using supplier_receipts(phase2_cancelled_by) and profiles(id)"},{"cardinality":"many-to-one","embedding":"supplier_receipts with profiles","relationship":"supplier_receipts_received_by_fkey using supplier_receipts(received_by) and profiles(id)"}]; Try changing 'profiles' to one of the following: 'profiles!supplier_receipts_phase2_cancelled_by_fkey', 'profiles!supplier_receipts_received_by_fkey'. Find the desired relationship in the 'details' key. |
| src/services/supabase/orders.service.ts:569 | PGRST201: Could not embed because more than one relationship was found for 'order_items' and 'products' | [{"cardinality":"many-to-one","embedding":"order_items with products","relationship":"order_items_family_product_id_fkey using order_items(family_product_id) and products(id)"},{"cardinality":"many-to-one","embedding":"order_items with products","relationship":"order_items_product_id_fkey using order_items(product_id) and products(id)"}]; Try changing 'products' to one of the following: 'products!order_items_family_product_id_fkey', 'products!order_items_product_id_fkey'. Find the desired relationship in the 'details' key. |
| src/services/supabase/purchases.service.ts:381 | PGRST201: Could not embed because more than one relationship was found for 'purchase_order_items' and 'products' | [{"cardinality":"many-to-one","embedding":"purchase_order_items with products","relationship":"purchase_order_items_family_product_id_fkey using purchase_order_items(family_product_id) and products(id)"},{"cardinality":"many-to-one","embedding":"purchase_order_items with products","relationship":"purchase_order_items_product_id_fkey using purchase_order_items(product_id) and products(id)"}]; Try changing 'products' to one of the following: 'products!purchase_order_items_family_product_id_fkey', 'products!purchase_order_items_product_id_fkey'. Find the desired relationship in the 'details' key. |
| src/services/supabase/purchases.service.ts:979 | PGRST201: Could not embed because more than one relationship was found for 'purchase_receipts' and 'purchase_receipt_items' | [{"cardinality":"one-to-many","embedding":"purchase_receipts with purchase_receipt_items","relationship":"purchase_receipt_items_operation_chain_fk using purchase_receipts(id, operation_id) and purchase_receipt_items(purchase_receipt_id, operation_id)"},{"cardinality":"one-to-many","embedding":"purchase_receipts with purchase_receipt_items","relationship":"purchase_receipt_items_purchase_receipt_id_fkey using purchase_receipts(id) and purchase_receipt_items(purchase_receipt_id)"}]; Try changing 'purchase_receipt_items' to one of the following: 'purchase_receipt_items!purchase_receipt_items_operation_chain_fk', 'purchase_receipt_items!purchase_receipt_items_purchase_receipt_id_fkey'. Find the desired relationship in the 'details' key. |

هذا يحتاج اعتماد تصحيح مستقل لاختيار FK الصحيح فيعرضالتفاصيل،خارجتحقيقACL الحالي. وحتىاعتماد150 واجتياز42501 لن يعني قبولاً للشاشات قبل إغلاقهذاالعائق. فحصSQLالجدولي المنفصل يثبت نقصالمنح حتى عندما يسبقهاPGRST201 فيالاستعلامالمضمّن.

## RLS والمنح الدنيا المقترحة150 — للمراجعة فقط

المقترح:26 منحة جدول/عملية/دور جديدة. 0 علامة حمراء:منحة يحتاجها التطبيق على جدول بلا RLS (service_role لديهBYPASSRLS بطبيعته،مذكور ولا يُفترض أنه يحميهRLS). لا منح anon مقترحة. لا INSERT/UPDATE/DELETE من المتصفح:تظل الكتابات عبرRPC. لا نوسّع منح الأعمدة الحالية فيbusiness_operations إلىSELECT كامل.

| الجدول | الدور/العملية | المطلوب | RLS | السياسات |
|---|---|---|---|---|
| branches | authenticated/SELECT | اقتراح GRANT SELECT ON public.branches TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to read branches [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| brands | authenticated/SELECT | اقتراح GRANT SELECT ON public.brands TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to read brands [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| business_operations | authenticated/SELECT | إبقاء منح الأعمدة القائمة فقط | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Active ERP staff can read parcel foundation [r/authenticated] |
| categories | authenticated/SELECT | اقتراح GRANT SELECT ON public.categories TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to read categories [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| customer_addresses | authenticated/SELECT | اقتراح GRANT SELECT ON public.customer_addresses TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated staff to read customer addresses [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| customers | authenticated/SELECT | اقتراح GRANT SELECT ON public.customers TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated staff to read customers [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| inventory_balances | authenticated/SELECT | اقتراح GRANT SELECT ON public.inventory_balances TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to view inventory balances [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| inventory_movements | authenticated/SELECT | اقتراح GRANT SELECT ON public.inventory_movements TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to view inventory movements [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| order_items | authenticated/SELECT | اقتراح GRANT SELECT ON public.order_items TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated staff to read order items [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| order_parcel_components | authenticated/SELECT | إبقاء المنحة القائمة | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Active ERP staff can read parcel foundation [r/authenticated] |
| order_parcel_instances | authenticated/SELECT | إبقاء المنحة القائمة | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Active ERP staff can read parcel foundation [r/authenticated] |
| order_status_history | authenticated/SELECT | اقتراح GRANT SELECT ON public.order_status_history TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated staff to read order status history [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| orders | authenticated/SELECT | اقتراح GRANT SELECT ON public.orders TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated staff to read orders [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| product_images | authenticated/SELECT | اقتراح GRANT SELECT ON public.product_images TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to read product images [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| products | authenticated/SELECT | اقتراح GRANT SELECT ON public.products TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to read products [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| profiles | authenticated/SELECT | اقتراح GRANT SELECT ON public.profiles TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow users to read all profiles [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| purchase_order_items | authenticated/SELECT | اقتراح GRANT SELECT ON public.purchase_order_items TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated staff to read purchase order items [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| purchase_orders | authenticated/SELECT | اقتراح GRANT SELECT ON public.purchase_orders TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated staff to read purchase orders [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| purchase_receipt_items | authenticated/SELECT | اقتراح GRANT SELECT ON public.purchase_receipt_items TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated staff to read purchase receipt items [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| purchase_receipts | authenticated/SELECT | اقتراح GRANT SELECT ON public.purchase_receipts TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated staff to read purchase receipts [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| roles | authenticated/SELECT | اقتراح GRANT SELECT ON public.roles TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to read roles [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| sales_returns | authenticated/SELECT | إبقاء المنحة القائمة | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Active ERP staff can read sales returns [r/authenticated] |
| supplier_payments | authenticated/SELECT | اقتراح GRANT SELECT ON public.supplier_payments TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated staff to read supplier payments [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| supplier_receipt_items | authenticated/SELECT | اقتراح GRANT SELECT ON public.supplier_receipt_items TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to select supplier receipt items [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| supplier_receipts | authenticated/SELECT | اقتراح GRANT SELECT ON public.supplier_receipts TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to select supplier receipts [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| suppliers | authenticated/SELECT | اقتراح GRANT SELECT ON public.suppliers TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated staff to read suppliers [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| units | authenticated/SELECT | اقتراح GRANT SELECT ON public.units TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to read units [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| user_roles | authenticated/SELECT | اقتراح GRANT SELECT ON public.user_roles TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to read user roles [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| warehouses | authenticated/SELECT | اقتراح GRANT SELECT ON public.warehouses TO authenticated | مفعّل | PERMISSIVE_AND_APPLICABLE_RESTRICTIONS; Allow authenticated users to read warehouses [r/authenticated]؛ Require active ERP staff membership [*/authenticated] |
| orders | service_role/SELECT | اقتراح GRANT SELECT ON public.orders TO service_role | مفعّل | BYPASSRLS;  |
| push_dispatches | service_role/INSERT | إبقاء المنحة القائمة | مفعّل | BYPASSRLS;  |
| push_dispatches | service_role/UPDATE | إبقاء المنحة القائمة | مفعّل | BYPASSRLS;  |
| push_subscriptions | service_role/UPDATE | إبقاء المنحة القائمة | مفعّل | BYPASSRLS;  |

السياسات التعبيرية كاملة (USING/WITH CHECK وpermissive/restrictive والأدوار)،وقيم الصلاحيات بما فيها الأعمدة ونتائج كل دور في TABLE_ACCESS_DIAGNOSTIC.json. سياسات الجداول القديمة تجمع سماح القراءة مع Require active ERP staff membership (032):جميع الموظفين الفعّالين المدرجين فيhelper،وليس المالك فقط؛المنحة إلىauthenticated تعتمد على ذلك. لا تعديل سياسات مقترح/منفّذ هنا.

المقترح أدنى عمليات على مستوى (جدول،عملية،دور)،لا منحALL ولا منحكتابةللمتصفح. منحSELECTعلىجدول ليستحارسأعمدة:مثلاًقارئتفاصيلالطلب يطلبcost_price_in_minor_units ضمنproducts بالفعل،وسياسةالموظفالنشط لا تميّز الكاشير عنالمالك. يجباعتمادهذاالمدىصراحةً مع150؛إذااقتُرح تقليصه لمنحأعمدة محددة يلزمفحصأعمدةالربط/الفلاتروRealtime أيضاً،ولا نغيّرحدودالتكلفةصمتاً هنا.

### العلامات الحمراء

لا جدول عميل يحتاج منحة وRLS عليه مطفأ ضمن الجرد. هذا لا يثبت كفاية كل سياسة؛الحجب بسببACL يمنع تجربة الصفوف على تلك الجداول حتى تُعتمد منحة محددة.

### منح زائدة غير لازمة للوصول المباشر — اقتراح REVOKE فقط

وجدنا200 زوج (جدول،دور،صلاحية) ضمن جداول الجرد لا يحتاجه أي وصول مباشر في الواجهتين. خصوصاً TRUNCATE لا تحميه سياسات الصفوف؛لا تعتبر Dxtm بديلاً آمناً عنCRUD. لم نُنفّذTRUNCATE أو REVOKE. هذه قائمة مقترحة محدودة بالجداول التي جرى فحصها،وليست إذناً بمسح جميعACL أوEXECUTE/sequences أوservice_role. تُراجع آثارRPC/التبعيات قبل150.

| الجدول | الدور | اقتراح سحب |
|---|---|---|
| branches | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| branches | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| brands | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| brands | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| categories | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| categories | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| customer_addresses | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| customer_addresses | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| customers | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| customers | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| inventory_balances | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| inventory_balances | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| inventory_movements | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| inventory_movements | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| order_items | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| order_items | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| order_status_history | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| order_status_history | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| orders | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| orders | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| product_images | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| product_images | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| products | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| products | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| profiles | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| profiles | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| purchase_order_items | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| purchase_order_items | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| purchase_orders | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| purchase_orders | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| purchase_receipt_items | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| purchase_receipt_items | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| purchase_receipts | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| purchase_receipts | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| roles | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| roles | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| supplier_payments | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| supplier_payments | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| supplier_receipt_items | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| supplier_receipt_items | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| supplier_receipts | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| supplier_receipts | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| suppliers | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| suppliers | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| units | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| units | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| user_roles | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| user_roles | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| warehouses | anon | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |
| warehouses | authenticated | TRIGGER, MAINTAIN, TRUNCATE, REFERENCES |

تُراجع كذلكdefault privileges لـpostgres فيpublic:سحبDxtm التلقائية للأدوارالعميلة عنداعتماد150 يمنع تكرارهاللجداولالجديدة. لا يُمنحSELECT افتراضياً لكل جدولجديد؛كلمنحةصريحةمعRLS واختبارها. service_role وEXECUTE وsequences خارجاقتراحالسحب الجدوليالحالي؛لا إعادةتطبيقخطة279REVOKE القديمة.

مصدر المقترح هو001–138 المحلية فقط. المنح الإضافية في فرانكفورت لم تُقرأ أو تُسحب؛خطة REVOKE للبعيد لا تصبح نهائية إلا بعد اعتماد150 ومرجعها الجديد،ومعاينة محلية للكتالوج المحفوظ/لقطة جديدة يلتقطها المالك. لا تأكيد أن فرنكفورت تتعطل الآن؛المثبت أن المواءمة للمرجع الحالي ستفقد وصولاً يحتاجه التطبيق.

## الاشتراكات الحية (شروط قراءة،لا CRUD)

| الجدول | المصدر | الحدث |
|---|---|---|
| orders | src/services/supabase/crm.service.ts:518 | * |
| customer_addresses | src/services/supabase/crm.service.ts:518 | * |
| customers | src/services/supabase/crm.service.ts:518 | * |
| suppliers | src/services/supabase/dashboard.service.ts:210 | * |
| customers | src/services/supabase/dashboard.service.ts:210 | * |
| products | src/services/supabase/dashboard.service.ts:210 | * |
| inventory_balances | src/services/supabase/dashboard.service.ts:210 | * |
| orders | src/services/supabase/dashboard.service.ts:210 | * |
| supplier_payments | src/services/supabase/directReceiving.service.ts:673 | * |
| supplier_receipt_items | src/services/supabase/directReceiving.service.ts:673 | * |
| supplier_receipts | src/services/supabase/directReceiving.service.ts:673 | * |
| orders | src/services/supabase/orders.service.ts:1217 | * |
| inventory_movements | src/services/supabase/purchases.service.ts:1124 | * |
| inventory_balances | src/services/supabase/purchases.service.ts:1124 | * |
| supplier_payments | src/services/supabase/purchases.service.ts:1124 | * |
| purchase_receipts | src/services/supabase/purchases.service.ts:1124 | * |
| purchase_order_items | src/services/supabase/purchases.service.ts:1124 | * |
| purchase_orders | src/services/supabase/purchases.service.ts:1124 | * |
| products | src/services/supabase/stockAlerts.service.ts:131 | UPDATE |
| inventory_movements | src/services/supabase/stockAlerts.service.ts:131 | * |

## اختبار الانحدار المقترح وخطة المواءمة الجديدة

1. بعد موافقة150 فقط:يُوسّع حدبناءسكربتالتشخيص المعتمد حالياً138 إلى150. يبني CI قاعدة حقيقية001–150 (مع140–149 بعد دمج فرعها،لا placeholders)،ويزرع fixture عبر المسارات المعتمدة. يكتشف الجرد منالمصدر ويتطلب تغطية كل سلسلة وembed ودور. run-table-access-diagnostic.mjs --require-access يفشل عند42501 أو خطأ غير متوقع،لا mocks ولا retries. حالياًهذا الوضع يجب أن يفشل؛لا ندعي أنبوابة وصول التطبيق خضراء.
2. اختباراتمنفصلة لسياسات الرفض:anon/مستخدم بلادور/موظفمتوقف لا يحصلونعلى صفوفغيرمصـرحبها؛واختبار منعكتابةالمتصفح المباشرة معنجاحRPC الصحيحة. أدوارممثلةحسبكلشاشة معprobe لأعمدةالربط والفلاتروكلصفحاتالاستعلام؛Realtime يحتاجاختبارقناةحقيقي لاحقاً وليسSELECTبديل.
3. بعد اجتيازها،يُولّد local-reference جديد ببصمةسلسلةmigrations المعتمدة ونتيجةجرد/وصول. هدف frankfurt-acl-plan يصبحهذاالمرجع،لاlocal-reference138 الحالي. يرفضالمرجعالقديم أوتقريروصولغيرناجح/قديم قبلحسابREVOKE. service_role لايتغيربهذهالمواءمة،ولااستثناء لanon/authenticated/PUBLIC. إن احتاجEdge منحةناقصة فهيقرار150 صريح،لااستثناءعام.
4. المالك وحده يطبّقmigrationالمعتمدة علىفرانكفورت لاحقاً ثميلتقطكتالوجاًجديداً،وتُعرضمعاينةالفرققبلأيتطبيق. --apply يبقىموقوفاًحتىقرارصريحجديد. لا تشغيلمحليبالصلاحياتالموسّعة لإخفاءالرفضالحالي.

## إعادة الإنتاج

```powershell
node scripts/audit/table-access-inventory.mjs
node scripts/audit/run-table-access-diagnostic.mjs
node scripts/audit/table-access-report.mjs <مسار-diagnostic.json-المطبوع>
```

الأمرالثاني يشغّل قاعدةDocker محلية جديدة001–138 وخادمPostgREST على127.0.0.1:25421،ويغلقملكَه فيالنهاية. لايعرفعنوانفرانكفورت أوكلمةسرها،ولايفتحملفاتenv. تقريرJSON الخارجي يحفظكتالوجالفحص فقط؛نسخةالمستودع تحذفكتالوجالدوالغيرالمتعلق وتبقيأدلةالوصول. سكربتالجرد يولّدJSON وMarkdown؛سكربتالتقرير يضيفنتيجةالقياس الحقيقية بعدانتهائها.

**القرار المطلوب:** اعتماد نطاق150 بعد مراجعة قائمةGRANT/REVOKE وشروطRLS أعلاه. توقف؛لا تطبيق ولاmigrationفيهذهالمرحلة.

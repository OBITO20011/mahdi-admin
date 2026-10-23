# الحالة الحالية للحزمة و —23 أكتوبر2026

الجرد الحالي الكامل في TABLE_ACCESS_INVENTORY.json وSERVICE_ACCESS_INVENTORY.json. أُعيد فحص328 ملف مصدر و148 طلب جداول فعلياً بلا أخطاء على قاعدة محلية حتى211، و534 فحص RPC مع8 حالات رفض متوقعة فقط. لا تغيير SQL أو RPC أو صلاحيات ولا اتصال بفرانكفورت.

القسم التالي محفوظ من مرجع e96efc1 بسياقه وتواريخه؛الدليل الحالي للمصدر هو الملفات المذكورة أعلاه،وليس تشخيص138 التاريخي.

---

# تحديث هوية المحل هـ —23أكتوبر2026

أُعيد التحقق الفعلي محلياً بعد تحديث الاسم والأصول:327مصدر،148استعلاماً ناجحاً،534فحصRPC مع8رفض42501 متوقعة للمالك فقط. السقف211 والـSQL والمنح لم تتغير؛هذه أدلة المصدر الحالي وليست اتصالاً بفرانكفورت. السجلات السابقة أدناه محفوظة بتاريخها.

---

# تحديث التحقق المحلي211 —23أكتوبر2026

**الحالة الحالية:**327 ملف مصدر، و148 استدعاء جداول فعلياً بلا خطأ، و534 فحص RPC؛حالات42501 الثماني متوقعة لوظائف المالك فقط. لا اتصال مستضاف.

الدليل الحالي:TABLE_ACCESS_AFTER_211.json وSERVICE_ACCESS_DIAGNOSTIC.json؛الأقسام الأقدم أدناه تاريخية بتواريخها،وليست وصفاً لفرانكفورت الآن. إعداد CSP_CONNECT_SRC وStorage وعضوية publication في المستضاف يحتاج تحقق المالك عند التحويل؛لم ينفّذه الوكيل.

---

# الحالة الحالية C7 — السقف207

142 فحص SDK ناجح بلا خطأ أو رفض، مطابق للمصدر الحالي في TABLE_ACCESS_AFTER_207.json.
513 فحوص RPC بلا رفض EXECUTE في SERVICE_ACCESS_DIAGNOSTIC.json؛هذه بروفات dispatch،
واختبار سير التصحيحات الفعلي منفصل في DOCUMENT_CORRECTIONS_207_RUNTIME.json.
أدلة206 وC6 التاريخية ومراجع المالك ثابتة عبر العكس الدقيق؛لا وصول مستضاف.

## أرشيف المصدر السابق وحدوده

# الحالة الحاليةC6 — السقف206 والمصدر الحالي

142فحصSDK أصلي ناجح،بلا رفض أو خطأ،في TABLE_ACCESS_AFTER_STOREFRONT_C6.json،
مطابق لبصمات المصدر الحالي كاملاً. 507فحوصRPC بلا42501 في SERVICE_ACCESS_DIAGNOSTIC.json.
TABLE_ACCESS_AFTER_206.json ومرجع المالك206 ثابتان لمصدر C5 عبر العكس الدقيق.
لا ترحيل جديد ولا وصول مستضاف؛الملاحظات التالية أرشيف أدلة ما قبل C6.

## أرشيف المصدر السابق وحدوده المسجلة

# الحالة الحالية206 — وصول محلي مثبت

142سلسلةSDK أصلية ناجحة بلا رفض أو خطأ؛الدليل TABLE_ACCESS_AFTER_206.json
يطابق بصمات المصدر الحالي كاملة. 507فحوصRPC بلا42501 في SERVICE_ACCESS_DIAGNOSTIC.json،
مع مراجعةEXECUTE السباعية محفوظة. المرجع المحلي520دالة؛لا وصول مستضاف أو قبولstaging.
الأدلة والملاحظات التاريخية أدناه تبقى لنطاقها المسجل،ولا تحل محل دليل206.

---

# 20Oct — current205 source readiness

Current205 manual519 functions;SDK142/142 and RPC504 dispatches with zero42501
verified on current296 sourcefiles. Historical reports below retain their own
baselines;see TABLE_ACCESS_AFTER_205.json and PRODUCT_RECEIVING_205_INITIAL_QA.json.
No hostedaccess or apply.

# جرد الوصول الحالي204 — سجل المبيعات

TABLE_ACCESS_AFTER_204.json:142/142فحصSDK ناجح؛RPC498بلا42501.
204قارئ فواتيرواحدبنفسأدوارالطلبات؛لا كتّابأومنحجداول.
الدليل517دالةو166ملفاً؛المرجعوالترقيةوالتصفيرالفعلية تليالجودة.
النص التالي يحفظ تقارير203وماقبله كماهي.

# جرد الوصول الحالي203 — دفعات الفواتير القديمة

TABLE_ACCESS_AFTER_203.json:142/142فحصSDK ناجح وRPC495بلا42501.
203تعدل قراءة واحدة فقط؛لا منح جديدة. المرجع165ملفاً و516دالة و13Realtime
وبناءجديد=ترقية بلااختلاف. أمرالمالك فيALL_COLLECTIONS_203_AR.md.
النص التالي يحفظ أدلة202وماقبله كما هي؛ليس وصفاً للحالة الحالية.

# جرد الوصول الحالي202 —المقبوض الشامل

الدليل TABLE_ACCESS_AFTER_202.json:142/142سلسلةSDK فعلية بلا42501/PGRST2xx،
والتغطية والبصمات تطابق المصدر الحالي. RPC495بلا42501 في SERVICE_ACCESS_DIAGNOSTIC.json.
لا منح جديدة في202؛تغيرت دالتا قراءة فقط.لا اتصال مستضاف ولا إذنapplyمنالوكيل.
المرجع164ملف/516دالة/13Realtime وبناءجديد=ترقية0اختلاف.
راجع ALL_COLLECTIONS_202_AR.md للأمر الحالي وSERVICE_ACCESS_AUDIT.md للإضافة الحالية.

## سياق تاريخي محفوظ

النص التالي يحفظ أدلة138السلبية والتحديثات199وماقبله؛ليس وصفاً لحالة202.

# جرد الوصول الحالي199 —إدارة المستودعات

19Oct:أُعيد الجرد على المصدر النهائي؛الدليل `TABLE_ACCESS_AFTER_199.json`
142/142 سلسلةSDK فعلية بلا42501/PGRST2xx،والتغطية مطابقة للمصدر.
دليل198 الحالي `TABLE_ACCESS_STAGING_198.json` أُعيد أيضاً142/142.
شاشة المستودعات تضيفRPC فقط ولا تضيف كتابة مباشرة أومنح جداول.
المنح التاريخية وأدلة138السلبية محفوظة،ولا اتصال مستضاف في هذا القياس.

## الحالة السابقة198 —إعداد فرانكفورت العام

CSP_CONNECT_SRC:أُغلق HTTPS/WSS للقديم؛لاAPP_FALLBACK/CSPقديمة في الجردالحالي.
الدليل الحالي TABLE_ACCESS_STAGING_198.json:142/142؛باقيالأدلةتاريخيةمحفوظةببصماتها. انظر FRANKFURT_STAGING_PREPARATION_198_AR.md.

# جرد الوصول — الحالة بعد150

**الوصول المباشر المحلي ناجح: 142 سلسلةفعلية،صفر42501/PGRST2xx،والتغطيةكاملة.** [الدليل الإيجابي](TABLE_ACCESS_AFTER_150.md). --apply موقوف؛Auth/Storage/Realtime والإعداداتبواباتمنفصلة،لاادعاءقبولstaging. أدناهدليل138السلبي للمقارنة،لاهدفالمواءمة.

---

# دليل المرجع138 قبل المنح — تاريخي،2026-10-15

**هذه نتائج138 السلبية،وليست حالة الشجرة بعد150. اعتُمدت150 لاحقاً؛راجع TABLE_ACCESS_AFTER_150.md للإثبات الحالي. لا تشغّل `frankfurt-align-acl.mjs --apply`؛لا اتصال بفرانكفورت/Production و140–149 محجوزة.**

## النتيجة والنطاق

- 50 موضع استعلام: 43 authenticated في الإدارة،7 service_role في send-order-push،0 anon. المتجر لا يقرأ الجداول مباشرة؛RPC/Gateway خارج جرد الجداول.
- 30 جدولاً مع الموارد المضمّنة؛20 اشتراك Realtime موثّق منفصلاً. Storage وArray.from مستبعدان بأسباب صريحة فيJSON.
- قاعدة جديدة001–138،138 سجلاً رسمياً. 142 إعادة تشغيل فعلية لسلاسل SDK الأصلية عبر PostgREST16.1/PostgreSQL17.6: 15 نجاح،127 رفض42501 في41 موضعاً،0 نتيجة صفرية،0 أخطاء أخرى.
- جاهزية وصول التطبيق: **غير مقبول — المنح الحالية تعطل الوصول المباشر**. نجاح أداة التشخيص يعني جمع الأدلة فقط،لا قبول المنتج.
- زمن الفحص:196.491ث؛2026-10-17T10:49:32.148Z إلى2026-10-17T10:52:48.639Z.

## طريقة الإثبات وحدودها

الجرد يستخدم TypeScript AST،لا grep وحده:كل from ذات جدول حرفي تتبعها سلسلة العمليات،والثوابت النصية للـselect،ومعدلات query اللاحقة،والـembeds. الاسم الديناميكي/عملية غير معروفة يفشلان الجرد بدلاً من إسقاطهما. JSON يحفظ source/الأعمدة/الفلاتر/الحمولات ومصدر الدور/المستدعين والأسطر وبصمات المصدر.

أُعيدت نفس طرق SDK والأعمدة والفلاتر والـsingle/maybeSingle والترتيب/الصفحات بمتغيرات fixture مصطنعة معلنة فيJSON،لا SELECT1 بديل. محوّل محلي يزيل mount /rest/v1 فقط مثل بوابة Supabase؛لا ردود وهمية. retries معطلة. JWT محلي للاختبار فقط فيRAM. كل قراءة إدارية أُجريت للمالك/admin/cashier؛هذا قياس وصول DB وليس ادعاء أن كل شاشة تسمح للأدوار الثلاثة. Edge بدورservice_role كما في createClient الفعلي؛لم تُشغّل Edge أو أي إرسال خارجي.

فحص RLS الإضافي نفّذ SET LOCAL ROLE وrequest.jwt.claims فعلياً داخل READ ONLY/ROLLBACK لكل جدول ولدورanon ومستخدم بلا دور ERP. لم تُضف أي منحة لتجاوز الرفض. عند42501 لا يمكن قياس إخفاء RLS؛نذكر الحجب لا نفترض صفراً. عند صفر مع عدم وجود صفوف fixture نذكر fixture_empty لا حجبRLS. سياسة موجودة في الكتالوج ليست إثباتاً بأنها تسمح لكل صف/فرع.

بيانات الفحص:مالك/admin/cashier ومستخدم بلا دور،أصناف/وحدات/فرع/مستودع/عملاء،استلامV2 مباشر،PO واستلام جزئي،بيعV2 بوحدة وطرد مشكّل بمكوّناته،اشتراك دفع وهمي بلا إرسال. إنشاء أدلة البيع/التكلفة عبرRPC الحالية؛لا نسخ بيانات حقيقية. عُطّل تريغر الإرسال وcron محلياً فقط قبل إدخال البيانات ثم حُذفت القاعدة. Realtime هنا جرد + شرط SELECT/RLS فقط،لا ادعاء اختبار قناة WebSocket من طرف لطرف.

## كل موضع ومصيره الحقيقي

الأثر التشغيلي الأوضح:fetchUserProfileAndRole يُرفض عندprofiles/user_roles،فيتعذر اعتماد ملف موظف صالح بعد تسجيل الدخول. قوائم الوحدات والمستودعات والأقسام والموردين وقراءاتالطلبات لا تعمل تحتالمرجع. createProductWithOpeningStockInSupabase ينفّذRPC ثم يقرأproducts للتحقق؛القراءةقد تفشل بعد نجاحالكتابة،فيعرضفشلاً كاذباً للمستخدم. لم نغيّر هذاالمسار. وفيEdge،كتاباتpush_dispatches/push_subscriptions مسموحة،لكنقراءةorders مرفوضة؛نجاحالكتابةوحده لايثبتنجاحالإشعار.

| الجدول/العملية | الملف:السطر والدالة | الدور/المسار/المستدعون | النتيجة (كل الأدوار/المتغيرات) |
|---|---|---|---|
| orders / select | src/features/pos/PosView.tsx:482 / executeSale | authenticated; pos; has-source-consumer | owner:42501؛ admin:42501؛ cashier:42501 |
| orders / select | src/services/supabase/adminCustomerV2Lifecycle.ts:221 / isCustomerV2Order | authenticated; adminCustomerV2Lifecycle.ts; src/services/supabase/orders.service.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| business_operations / select | src/services/supabase/adminCustomerV2Lifecycle.ts:227 / isCustomerV2Order | authenticated; adminCustomerV2Lifecycle.ts; src/services/supabase/orders.service.ts | owner:success؛ admin:success؛ cashier:success |
| profiles / select | src/services/supabase/auth.service.ts:222 / fetchUserProfileAndRole | authenticated; shared-store/auth-bootstrap; src/stores/useAuthStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| user_roles / select؛ embeds:roles | src/services/supabase/auth.service.ts:252 / fetchUserProfileAndRole | authenticated; shared-store/auth-bootstrap; src/stores/useAuthStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| supplier_receipts / select؛ embeds:branches,products,profiles,supplier_payments,supplier_receipt_items,suppliers,warehouses | src/services/supabase/directReceiving.service.ts:209 / fetchSupplierReceiptByIdFromSupabase | authenticated; directReceiving; src/features/directReceiving/DirectReceivingView.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| suppliers / select | src/services/supabase/directReceiving.service.ts:533 / fetchSuppliersForReceivingFromSupabase | authenticated; directReceiving; src/features/directReceiving/CreateDirectReceiptModal.tsx,src/features/directReceiving/DirectReceivingView.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/directReceiving.service.ts:606 / fetchUnitsForReceivingFromSupabase | authenticated; directReceiving; src/features/directReceiving/CreateDirectReceiptModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| warehouses / select | src/services/supabase/directReceiving.service.ts:621 / fetchWarehousesForReceivingFromSupabase | authenticated; directReceiving; src/features/directReceiving/CreateDirectReceiptModal.tsx,src/features/directReceiving/DirectReceivingView.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| branches / select | src/services/supabase/directReceiving.service.ts:641 / fetchBranchesForReceivingFromSupabase | authenticated; directReceiving; src/features/directReceiving/CreateDirectReceiptModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| inventory_balances / select؛ embeds:products,warehouses | src/services/supabase/inventory.service.ts:150 / fetchInventoryBalancesFromSupabase | authenticated; inventory; no-static-consumer-found | owner:42501؛ admin:42501؛ cashier:42501 |
| orders / select؛ embeds:customer_addresses,customers,order_items | src/services/supabase/orders.service.ts:274 / fetchOperationalOrderListRows | authenticated; orders; no-static-consumer-found | owner:42501؛ admin:42501؛ cashier:42501 |
| order_items / select | src/services/supabase/orders.service.ts:278 / fetchOperationalOrderListRows | authenticated; orders; no-static-consumer-found | owner:42501؛ admin:42501؛ cashier:42501 |
| orders / select؛ embeds:customer_addresses,customers,order_items,order_status_history,product_images,products,sales_returns,units | src/services/supabase/orders.service.ts:569 / fetchOrderByIdFromSupabase | authenticated; orders; src/features/orders/OrdersCenterView.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| order_parcel_instances / select | src/services/supabase/orders.service.ts:590 / fetchOrderByIdFromSupabase | authenticated; orders; src/features/orders/OrdersCenterView.tsx | owner:success؛ admin:success؛ cashier:success |
| order_parcel_components / select | src/services/supabase/orders.service.ts:596 / fetchOrderByIdFromSupabase | authenticated; orders; src/features/orders/OrdersCenterView.tsx | owner:success؛ admin:success؛ cashier:success |
| warehouses / select | src/services/supabase/products.service.ts:581 / createProductWithOpeningStockInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| categories / select | src/services/supabase/products.service.ts:589 / createProductWithOpeningStockInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:597 / createProductWithOpeningStockInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:606 / createProductWithOpeningStockInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:619 / createProductWithOpeningStockInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| products / select | src/services/supabase/products.service.ts:699 / createProductWithOpeningStockInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| warehouses / select | src/services/supabase/products.service.ts:794 / createProductFamilyWithFlavorsInSupabase | authenticated; products; src/features/products/ProductFormModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| categories / select | src/services/supabase/products.service.ts:806 / createProductFamilyWithFlavorsInSupabase | authenticated; products; src/features/products/ProductFormModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:818 / createProductFamilyWithFlavorsInSupabase | authenticated; products; src/features/products/ProductFormModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:825 / createProductFamilyWithFlavorsInSupabase | authenticated; products; src/features/products/ProductFormModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:832 / createProductFamilyWithFlavorsInSupabase | authenticated; products; src/features/products/ProductFormModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:843 / createProductFamilyWithFlavorsInSupabase | authenticated; products; src/features/products/ProductFormModal.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:1013 / updateProductInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:1024 / updateProductInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| units / select | src/services/supabase/products.service.ts:1036 / updateProductInSupabase | authenticated; shared-store/auth-bootstrap; src/stores/useAppStore.ts | owner:42501؛ admin:42501؛ cashier:42501 |
| suppliers / select | src/services/supabase/purchases.service.ts:62 / fetchSuppliersFromSupabase | authenticated; cheques,purchases; src/features/cheques/ChequesView.tsx,src/features/purchases/CreatePurchaseOrderModal.tsx,src/features/purchases/PurchasesView.tsx,src/features/purchases/SupplierPaymentModal.tsx,src/services/supabase/goLive.service.ts | owner:42501؛ owner:42501/extended؛ admin:42501؛ admin:42501/extended؛ cashier:42501؛ cashier:42501/extended |
| purchase_orders / select؛ embeds:branches,products,purchase_order_items,purchase_receipt_items,purchase_receipts,supplier_payments,suppliers,units,warehouses | src/services/supabase/purchases.service.ts:381 / fetchPurchaseOrderByIdFromSupabase | authenticated; purchases; src/features/purchases/PurchaseOrderDetailView.tsx | owner:42501؛ admin:42501؛ cashier:42501 |
| purchase_receipts / select؛ embeds:products,purchase_orders,purchase_receipt_items,suppliers,warehouses | src/services/supabase/purchases.service.ts:979 / fetchGoodsReceiptsFromSupabase | authenticated; purchases; src/features/purchases/PurchasesView.tsx | owner:42501؛ owner:42501/extended؛ admin:42501؛ admin:42501/extended؛ cashier:42501؛ cashier:42501/extended |
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

## فحص العلاقات المضمّنة في المرجع138

بعد تصحيحFK المعتمد،لاPGRST201 فيمصدرالاستعلاماتالحالي حتىعلى138؛لكن42501 تبقىدون150. الإثباتالإيجابيبعد150 فيTABLE_ACCESS_AFTER_150.md. لمتتغيرحقول أوإجراءات المنتج،فقطخمسةhints لأربعسلاسل.

| المصدر | الخطأ | العلاقات التي يعرضها PostgREST |
|---|---|---|

اختبارAST المثبت يقارن ملفات الخدمات الثلاثة كاملةً بالأساس بعد إزالةأسماءFK المعتمدة فقط. رفض127سلسلةعلى138مقابلنجاح142على150 يحفظ الفحص السلبي ولايخفي نقصACL أوالتباس العلاقة.

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
| suppliers | src/services/supabase/dashboard.service.ts:218 | * |
| customers | src/services/supabase/dashboard.service.ts:218 | * |
| products | src/services/supabase/dashboard.service.ts:218 | * |
| inventory_balances | src/services/supabase/dashboard.service.ts:218 | * |
| orders | src/services/supabase/dashboard.service.ts:218 | * |
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

**سجل تاريخي:** هذه القائمة أساس اعتماد150 في OWNER_DECISIONS.md؛لا تستخدم مرجع138 لمواءمةACL الآن. إثبات ما بعد الإصلاح منفصل،وتطبيق فرانكفورت يبقى أمراً لاحقاً للمالك.

---

## إضافة التحقيق: RPC وStorage وRealtime والإعدادات خارج migrations

**لا تطبيق ACL ولا إعداد خدمات ولا نشر. هذا قياس محلي وقراءة ملفات محفوظة فقط؛الفجوة التشغيلية غير مغلقة.**

### أ. RPC — EXECUTE الفعلي،لا افتراض نجاح من mock

167 موضعSDK .rpc و4 موضعRESTGateway،161 اسم دالة. أسماءالأغلفةالديناميكية موثقةبالاستدعاءالذييوردها؛أيرابطغيرمحسوميفشلالجرد. ثلاثمصارفديناميكية تشملPOSV2 وإعدادالطرود،والبوابةتحوّلrpcName إلىsubmit_guest_customer_order_v2.

قاعدة198 محلية جديدة: 489 dispatch حقيقي إلىتواقيعالدوالالمستدعاة/overloads بأدوارهاالحقيقية؛0 رفض42501،118 نجاحمعrollback،371 رفض/خطأداخلجسمالدالة. has_function_privilege موثق لكلتوقيع/دور. **فحصالصلاحيةلايعنيقبولكلدورحسبقواعدالعمل**؛المالك/admin/cashier منفصلون.

حدالقياسصريح:أُرسلتقيممحليةمحايدةمُنمّطةحسبتوقيعSQL(معرفعميل/فرع/مستودعfixtureحيثيوجد،NULL/JSONفارغلغيره)،وليستجميعحمولاتالتدفّقاتالصحيحةمنواجهةالتطبيق. النصالأصليلكلاستدعاءومعاملاتهفيSERVICE_ACCESS_INVENTORY.json؛قيمةكلprobeوأثرهفيSERVICE_ACCESS_DIAGNOSTIC.json. لا نسمّي274خطأتحققنجاحاًوظيفياً ولا42501. كلنجاحوكلخطأداخلsubtransactionأُرجع؛لاأثرماليأومخزنيباقٍ. اختباراتالمساراتالمتكاملةالقائمةتبقىمطلوبة؛هذهالإضافةتثبتEXECUTE/dispatchوليسإتمامكلسيناريو.

| الدالة/مصدر الاستدعاء | الدور | EXECUTE محلي / نتائج dispatch |
|---|---|---|
| get_pos_configurable_parcel_options_v1؛src/features/pos/PosView.tsx:166 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| report_admin_runtime_incident؛src/lib/errorMonitoring.ts:33 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_push_subscription_status؛src/services/pushNotifications.service.ts:48 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| save_push_subscription؛src/services/pushNotifications.service.ts:107 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| disable_push_subscription؛src/services/pushNotifications.service.ts:145 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| cancel_customer_order_v2؛src/services/supabase/adminCustomerV2Lifecycle.ts:320 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| complete_website_order_with_settlement_v2؛src/services/supabase/adminCustomerV2Lifecycle.ts:322 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_my_erp_profile؛src/services/supabase/auth.service.ts:160 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| receive_customer_cheque_v1؛src/services/supabase/cheques.service.ts:55 | authenticated | owner:23502؛ admin:23502؛ cashier:23502 |
| issue_supplier_cheque_v1؛src/services/supabase/cheques.service.ts:57 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| preview_customer_cheque_v1؛src/services/supabase/cheques.service.ts:61 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| preview_supplier_cheque_v1؛src/services/supabase/cheques.service.ts:70 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_deferred_cheques_page؛src/services/supabase/cheques.service.ts:75 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_deferred_cheque_detail؛src/services/supabase/cheques.service.ts:85 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| clear_deferred_cheque_v1؛src/services/supabase/cheques.service.ts:94 | authenticated | owner:P0002؛ admin:P0001؛ cashier:P0001 |
| return_deferred_cheque_v1؛src/services/supabase/cheques.service.ts:96 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| cancel_deferred_cheque_v1؛src/services/supabase/cheques.service.ts:98 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| endorse_customer_cheque_v1؛src/services/supabase/cheques.service.ts:100 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| pay_supplier_cheque_claim_v1؛src/services/supabase/cheques.service.ts:103 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| reverse_supplier_cheque_claim_payment_v1؛src/services/supabase/cheques.service.ts:106 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_deferred_cheque_home_alerts؛src/services/supabase/cheques.service.ts:108 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| get_crm_customer_page؛src/services/supabase/crm.service.ts:160 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| get_crm_customer_detail_page؛src/services/supabase/crm.service.ts:212 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| save_customer؛src/services/supabase/crm.service.ts:365 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_customer_status؛src/services/supabase/crm.service.ts:408 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| add_customer_address؛src/services/supabase/crm.service.ts:457 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_customer_outstanding_orders_page؛src/services/supabase/customerAccounts.service.ts:49 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| record_customer_order_payment_once؛src/services/supabase/customerAccounts.service.ts:135 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_customer_debt_aging؛src/services/supabase/customerDebtAging.service.ts:8 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_customer_statement؛src/services/supabase/customerStatement.service.ts:7 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_home_dashboard؛src/services/supabase/dashboard.service.ts:120 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| preview_supplier_receipt_cancellation؛src/services/supabase/directReceiving.service.ts:21 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_supplier_receipts_page؛src/services/supabase/directReceiving.service.ts:154 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| resolve_legacy_supplier_receipt_replay_v1؛src/services/supabase/directReceiving.service.ts:260 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| create_direct_supplier_receipt_v2؛src/services/supabase/directReceiving.service.ts:370 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| record_supplier_receipt_payment؛src/services/supabase/directReceiving.service.ts:431 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| archive_supplier_receipt؛src/services/supabase/directReceiving.service.ts:462 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| cancel_supplier_receipt؛src/services/supabase/directReceiving.service.ts:495 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| preview_cash_shift_full_reversal؛src/services/supabase/expenses-shifts.service.ts:207 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| reverse_cash_shift_with_operations؛src/services/supabase/expenses-shifts.service.ts:275 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_cash_shift_closing_report؛src/services/supabase/expenses-shifts.service.ts:304 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_expense_shift_center؛src/services/supabase/expenses-shifts.service.ts:476 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_cash_shift_archive_page؛src/services/supabase/expenses-shifts.service.ts:504 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| open_cash_shift؛src/services/supabase/expenses-shifts.service.ts:543 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| create_operational_expense؛src/services/supabase/expenses-shifts.service.ts:561 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| reverse_operational_expense؛src/services/supabase/expenses-shifts.service.ts:586 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| close_cash_shift؛src/services/supabase/expenses-shifts.service.ts:608 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| cancel_empty_cash_shift؛src/services/supabase/expenses-shifts.service.ts:628 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_go_live_setup_status_v1؛src/services/supabase/goLive.service.ts:99 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| get_go_live_customer_openings_v1؛src/services/supabase/goLive.service.ts:102 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| get_go_live_supplier_openings_v1؛src/services/supabase/goLive.service.ts:112 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| import_go_live_products_v1؛src/services/supabase/goLive.service.ts:126 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| record_customer_opening_balances_v1؛src/services/supabase/goLive.service.ts:127 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| record_supplier_opening_balances_v1؛src/services/supabase/goLive.service.ts:128 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| reverse_customer_opening_balance_v1؛src/services/supabase/goLive.service.ts:149 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| reverse_supplier_opening_balance_v1؛src/services/supabase/goLive.service.ts:150 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| finish_go_live_setup_v1؛src/services/supabase/goLive.service.ts:155 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_crm_customer_page؛src/services/supabase/goLive.service.ts:162 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| preview_customer_collection_v1؛src/services/supabase/goLive.service.ts:230 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| collect_customer_balance_v1؛src/services/supabase/goLive.service.ts:241 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| reverse_customer_collection_v1؛src/services/supabase/goLive.service.ts:248 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_customer_collections_v1؛src/services/supabase/goLive.service.ts:252 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| get_supplier_opening_payable_v1؛src/services/supabase/goLive.service.ts:258 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| pay_supplier_opening_balance_v1؛src/services/supabase/goLive.service.ts:264 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_go_live_main_branch_v1؛src/services/supabase/goLive.service.ts:271 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| get_inventory_opening_setup؛src/services/supabase/inventory-opening.service.ts:128 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| apply_inventory_opening_setup؛src/services/supabase/inventory-opening.service.ts:165 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_admin_inventory_product_page؛src/services/supabase/inventory.service.ts:99 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| transfer_inventory_between_warehouses؛src/services/supabase/inventory.service.ts:224 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| get_inventory_movement_page؛src/services/supabase/inventory.service.ts:319 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| adjust_inventory_stock؛src/services/supabase/inventory.service.ts:385 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_aftercare_integrity_status؛src/services/supabase/monitoring.service.ts:6 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_advanced_monitoring_dashboard؛src/services/supabase/monitoring.service.ts:28 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| preview_go_live_cheques_v1؛src/services/supabase/openingCheques.service.ts:18 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| record_go_live_cheques_v1؛src/services/supabase/openingCheques.service.ts:23 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_go_live_cheques_v1؛src/services/supabase/openingCheques.service.ts:28 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| accept_order_for_preparation؛src/services/supabase/orders.service.ts:618 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| complete_website_order_with_payment؛src/services/supabase/orders.service.ts:652 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_order_status؛src/services/supabase/orders.service.ts:697 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_operational_orders_page؛src/services/supabase/orders.service.ts:740 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| get_operational_orders_page؛src/services/supabase/orders.service.ts:852 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| complete_website_order_with_settlement؛src/services/supabase/orders.service.ts:933 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| return_completed_website_order؛src/services/supabase/orders.service.ts:984 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_order_status؛src/services/supabase/orders.service.ts:1029 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| start_or_update_order_delivery؛src/services/supabase/orders.service.ts:1080 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_order_delivery_address؛src/services/supabase/orders.service.ts:1138 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_owner_cash_withdrawal_v1؛src/services/supabase/ownerWithdrawals.service.ts:77 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| reverse_owner_cash_withdrawal_v1؛src/services/supabase/ownerWithdrawals.service.ts:87 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_shift_owner_withdrawals_v1؛src/services/supabase/ownerWithdrawals.service.ts:96 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| get_owner_withdrawals_report؛src/services/supabase/ownerWithdrawals.service.ts:121 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| get_admin_parcel_configuration_context_v1؛src/services/supabase/parcelConfiguration.service.ts:56 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| save_product_parcel_configuration_v1؛src/services/supabase/parcelConfiguration.service.ts:56 | authenticated | owner:22023؛ admin:P0001؛ cashier:P0001 |
| set_configurable_parcel_feature_state_v1؛src/services/supabase/parcelConfiguration.service.ts:56 | authenticated | owner:23502؛ admin:P0001؛ cashier:P0001 |
| get_pos_customer_page؛src/services/supabase/pos.service.ts:82 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| get_open_pos_shift؛src/services/supabase/pos.service.ts:124 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| create_pos_sale؛src/services/supabase/pos.service.ts:152 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_or_create_pos_receipt_token؛src/services/supabase/pos.service.ts:236 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_pos_sale_v2؛src/services/supabase/posV2.service.ts:220 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_pos_sale_attempt_state_v1؛src/services/supabase/posV2Recovery.ts:89 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| cancel_uncommitted_pos_sale_attempt_v1؛src/services/supabase/posV2Recovery.ts:96 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_pos_sale_v2؛src/services/supabase/posV2Recovery.ts:145 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_product_cost_state_v1؛src/services/supabase/productCost.service.ts:51 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| correct_product_cost_v1؛src/services/supabase/productCost.service.ts:70 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_admin_product_page؛src/services/supabase/products.service.ts:378 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| search_admin_products؛src/services/supabase/products.service.ts:419 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| search_admin_products؛src/services/supabase/products.service.ts:475 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| create_product_with_opening_stock_v4؛src/services/supabase/products.service.ts:671 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_product_flavor_v1؛src/services/supabase/products.service.ts:741 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_product_family_with_flavors_v1؛src/services/supabase/products.service.ts:851 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_product_flavor_v2؛src/services/supabase/products.service.ts:926 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| reorder_product_flavors_v1؛src/services/supabase/products.service.ts:961 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_product_master_v4؛src/services/supabase/products.service.ts:1046 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_promotion_codes؛src/services/supabase/promotions.service.ts:80 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| upsert_promotion_code؛src/services/supabase/promotions.service.ts:102 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_promotion_code_active؛src/services/supabase/promotions.service.ts:145 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| save_supplier؛src/services/supabase/purchases.service.ts:112 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| save_supplier؛src/services/supabase/purchases.service.ts:158 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_supplier_active؛src/services/supabase/purchases.service.ts:199 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_purchase_orders_page؛src/services/supabase/purchases.service.ts:262 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| create_purchase_order؛src/services/supabase/purchases.service.ts:580 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_purchase_order؛src/services/supabase/purchases.service.ts:645 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| delete_draft_purchase_order؛src/services/supabase/purchases.service.ts:683 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_purchase_order_status؛src/services/supabase/purchases.service.ts:713 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_purchase_order_status؛src/services/supabase/purchases.service.ts:738 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| receive_purchase_order_v2؛src/services/supabase/purchases.service.ts:763 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| cancel_purchase_order؛src/services/supabase/purchases.service.ts:805 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| record_supplier_payment؛src/services/supabase/purchases.service.ts:835 | authenticated | owner:22004؛ admin:22004؛ cashier:P0001 |
| get_supplier_payments_page؛src/services/supabase/purchases.service.ts:896 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| save_product_category؛src/services/supabase/reference-data.service.ts:107 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_product_category_active؛src/services/supabase/reference-data.service.ts:145 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| save_product_brand؛src/services/supabase/reference-data.service.ts:240 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_product_brand_active؛src/services/supabase/reference-data.service.ts:273 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| save_product_unit؛src/services/supabase/reference-data.service.ts:380 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_product_unit_active؛src/services/supabase/reference-data.service.ts:416 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_operational_business_report؛src/services/supabase/reports.service.ts:41 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_admin_sales_aftercare_context_v1؛src/services/supabase/salesAftercare.service.ts:131 | authenticated | owner:23503؛ admin:23503؛ cashier:P0001 |
| settle_sales_replacement_v1؛src/services/supabase/salesAftercare.service.ts:166 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| settle_admin_sales_return_v1؛src/services/supabase/salesAftercare.service.ts:204 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| settle_sales_replacement_v1؛src/services/supabase/salesAftercare.service.ts:245 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| settle_admin_sales_return_v1؛src/services/supabase/salesAftercare.service.ts:255 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| get_stock_alert_notifications؛src/services/supabase/stockAlerts.service.ts:72 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| mark_stock_alert_read؛src/services/supabase/stockAlerts.service.ts:95 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| mark_all_stock_alerts_read؛src/services/supabase/stockAlerts.service.ts:112 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_public_storefront_settings؛src/services/supabase/storefront-settings.service.ts:50 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| save_storefront_settings_v3؛src/services/supabase/storefront-settings.service.ts:60 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_public_configurable_parcel_options؛customer-web/src/services/catalog.service.ts:165 | anon | anon:P0001 |
| get_public_storefront_catalog_page؛customer-web/src/services/catalog.service.ts:388 | anon | anon:success/rollback |
| get_public_storefront_merchandising؛customer-web/src/services/catalog.service.ts:446 | anon | anon:success/rollback |
| get_public_storefront_offers؛customer-web/src/services/offers.service.ts:55 | anon | anon:success/rollback |
| preview_guest_promotion_v2؛customer-web/src/services/orders.service.ts:131 | anon | anon:P0001 |
| preview_guest_promotion؛customer-web/src/services/orders.service.ts:152 | anon | anon:P0001 |
| track_guest_order؛customer-web/src/services/orders.service.ts:262 | anon | anon:success/rollback |
| track_guest_order_by_token؛customer-web/src/services/orders.service.ts:277 | anon | anon:success/rollback |
| get_public_pos_receipt؛customer-web/src/services/receipts.service.ts:27 | anon | anon:success/rollback |
| get_public_storefront_settings؛customer-web/src/services/storefront-settings.service.ts:70 | anon | anon:success/rollback |
| authorize_admin_ai_assistant_request؛supabase/functions/admin-ai-assistant/index.ts:1017 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_admin_ai_inventory_snapshot؛supabase/functions/admin-ai-assistant/index.ts:1074 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_home_dashboard؛supabase/functions/admin-ai-assistant/index.ts:1123 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_admin_ai_monthly_report؛supabase/functions/admin-ai-assistant/index.ts:1165 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_erp_staff_accounts؛supabase/functions/manage-staff-users/index.ts:145 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| get_erp_staff_account_audit_logs؛supabase/functions/manage-staff-users/index.ts:198 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| create_erp_staff_account_record؛supabase/functions/manage-staff-users/index.ts:237 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_erp_staff_account_record؛supabase/functions/manage-staff-users/index.ts:266 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_erp_staff_account_active؛supabase/functions/manage-staff-users/index.ts:300 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| record_erp_staff_password_reset؛supabase/functions/manage-staff-users/index.ts:327 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| claim_automation_deliveries؛supabase/functions/n8n-alert-feed/index.ts:85 | service_role | service_role:P0001 |
| complete_automation_delivery؛supabase/functions/n8n-alert-feed/index.ts:102 | service_role | service_role:P0001 |
| get_push_webhook_secret؛supabase/functions/send-order-push/index.ts:58 | service_role | service_role:success/rollback |
| get_active_order_push_targets؛supabase/functions/send-order-push/index.ts:129 | service_role | service_role:success/rollback |
| authorize_guest_order_gateway؛supabase/functions/submit-guest-order/index.ts:260 | service_role | service_role:P0001 |
| submit_guest_customer_order_v2؛supabase/functions/submit-guest-order/index.ts:329 | service_role | service_role:P0001 |
| finalize_guest_order_gateway؛supabase/functions/submit-guest-order/index.ts:340 | service_role | service_role:P0001 |
| finalize_guest_order_gateway؛supabase/functions/submit-guest-order/index.ts:357 | service_role | service_role:P0001 |

#### الدوال السبع في خطة المواءمة القديمة

الخطةتسحبمنحاًصريحة،ولايعنيذلكدائماًزوالEXECUTEالفعلي:PUBLICقديبقيموجوداً. الاختباراستخدمhas_function_privilegeلاقراءةحروفACLفقط. لا تنفيذلخطةالمواءمة.

| الدالة | هل يستدعيها التطبيق؟ | ما يُسحب صراحةً / الفعلي فيالمرجع |
|---|---|---|
| authorize_admin_ai_assistant_request() | supabase/functions/admin-ai-assistant/index.ts:1017 (authenticated) | anon:EXECUTE؛الفعلي:anon=false, authenticated=true, service_role=false |
| enforce_customer_for_debt_order() | لا؛trigger function وليستRPCواجهة | anon:EXECUTE, authenticated:EXECUTE؛الفعلي:anon=true, authenticated=true, service_role=true |
| enforce_product_flavor_inheritance() | لا؛trigger function وليستRPCواجهة | anon:EXECUTE, authenticated:EXECUTE؛الفعلي:anon=true, authenticated=true, service_role=true |
| guard_cash_shift_closing_report_snapshot() | لا؛trigger function وليستRPCواجهة | anon:EXECUTE, authenticated:EXECUTE؛الفعلي:anon=true, authenticated=true, service_role=true |
| set_website_new_order_reservation_expiry() | لا؛trigger function وليستRPCواجهة | anon:EXECUTE, authenticated:EXECUTE؛الفعلي:anon=true, authenticated=true, service_role=true |
| sync_order_payment_state() | لا؛trigger function وليستRPCواجهة | anon:EXECUTE, authenticated:EXECUTE؛الفعلي:anon=true, authenticated=true, service_role=true |
| sync_product_flavor_commercial_settings() | لا؛trigger function وليستRPCواجهة | anon:EXECUTE, authenticated:EXECUTE؛الفعلي:anon=true, authenticated=true, service_role=true |

authorize_admin_ai_assistant_request تستدعيهاEdge بالمستخدمauthenticated (JWTالمستخدم،لاservice_role). منحةauthenticatedموجودةفيالمرجع؛السحبالقديميخصanonغيرمستخدمهنا. الدوالالستالأخرىtrigger-only:لااستدعاءRPCمنالتطبيق،والمنحالصريحةالزائدةتكرّرPUBLICEXECUTEالقائم. لايجوزتجربتهامباشرةبـSELECTوادعاءأنهاعمليةتريغرحقيقية؛إطلاقهامنوظائفهاداخلDDL/DMLهوالمسارالصحيح.

### ب. Storage — حاوية صور المنتجات وسياسات المستخدم

| المصدر | bucket / العملية | الدور |
|---|---|---|
| src/services/supabase/product-images.service.ts:67 | product-images / upload | authenticated |
| src/services/supabase/product-images.service.ts:83 | product-images / getPublicUrl | محلي لبناءURL؛لاطلبAPI |
| src/services/supabase/product-images.service.ts:88 | product-images / remove | authenticated |
| src/services/supabase/product-images.service.ts:125 | product-images / remove | authenticated |

PRODUCT_IMAGE_BUCKET=product-images فيproduct-images.service.ts؛الصوروالأقسامتستخدمالحاويةنفسها. 020_product_image_storage.sql:8–31 ينشئstorage.buckets صراحةً(public=true،5MiB،JPEG/PNG/WebP)،والسياسات:publicread؛upload/update/deleteلـowner/admin/manager/warehouse_keeper وفيfolderauth.uid(). ليسإعداداًيدوياًمفقوداًمنmigrations. getPublicUrl يبنيالرابطمحلياًولايختبرإمكانيةGET. تحققالرفعوالحذفوالـbytesبخدمةStorageنفسها خارجقياسSQLهنا؛لمنشغّلهذاالتكامل.

المحلي: [{"id":"product-images","name":"product-images","public":true,"file_size_limit":5242880,"allowed_mime_types":["image/jpeg","image/png","image/webp"]}]. في catalog-observed توجد 4 سياسات الصور الأربع. **صف bucket في فرانكفورت: غير قابل للتأكيد من اللقطة؛لا صفوف buckets في كتالوج البنية**. وجود جدول storage.buckets أو سياساته لا يثبت وجود صف product-images؛المطلوب فحص Dashboard/لقطة قراءة لاحقة من المالك فقط. لا اتصال من الوكيل.

### ج. Realtime — channels وpublication

6 channel و20 postgres_changes فيالجرد. publicationالمحلية:{"exists":true,"tables":[{"table":"customer_addresses","schema":"public"},{"table":"customers","schema":"public"},{"table":"inventory_balances","schema":"public"},{"table":"inventory_movements","schema":"public"},{"table":"orders","schema":"public"},{"table":"products","schema":"public"},{"table":"purchase_order_items","schema":"public"},{"table":"purchase_orders","schema":"public"},{"table":"purchase_receipts","schema":"public"},{"table":"supplier_payments","schema":"public"},{"table":"supplier_receipt_items","schema":"public"},{"table":"supplier_receipts","schema":"public"},{"table":"suppliers","schema":"public"}],"allTables":false}. **موجودةبلامشاركةجداول؛allTables=false**. بحثmigrations001–138لايجدإضافةALTER PUBLICATION supabase_realtime ADD TABLE. إصلاحSELECTوحدهلايعيدالتحديثاتالحية. هذااقتراحإعداد/تغييرمستقللاينفّذهالتحقيق.

| الجدول المطلوب | العضويةالمحلية | فرانكفورتمناللقطة |
|---|---|---|
| customer_addresses | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |
| customers | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |
| inventory_balances | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |
| inventory_movements | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |
| orders | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |
| products | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |
| purchase_order_items | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |
| purchase_orders | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |
| purchase_receipts | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |
| supplier_payments | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |
| supplier_receipt_items | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |
| supplier_receipts | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |
| suppliers | ضمنpublication | غيرمتاح فيcatalog-observed؛يحتاجلقطةقراءةمنالمالك |

publications/pg_publication_tables لايلتقطهماschema-catalogالحالي. لااستنتاجلعضويةفرانكفورت مننجاحالبناءأووجودrealtime schema؛ولا منوجودالجدولفيpublic. جدولالتفاصيلالأول يحفظكلchannel/اسمحدثومصدره.

### د. مرجع المشروع القديم والإعدادات

بحثGitلجميعالملفاتالمتتبعة+غيرالمتجاهلةخارجmigrationsالتاريخية(دونملفاتenv/القيمالسرية):26 ملفاً،القائمةأدناه. ملفاSERVICE_ACCESSالمولدانوكودأداةالبحثنفسهاواختبارهايُستثنيانمنالعدلتجنّبالتغذيةالراجعة؛المخرجاتتحفظأرقامأسطروتصنيفاًفقط. النصالعامللفرانكفورتلايُغيّرمنهذاالبحث.

| الملف | الأسطر | التصنيف/الأثر |
|---|---|---|
| automation/n8n/workflows/nawasrah-alerts.json | 32, 89, 175, 228 | EXTERNAL_CONSUMER |
| docs/agent/HANDOFF_HISTORY.md | 445 | HISTORICAL_DOCUMENTATION |
| docs/agent/OWNER_DECISIONS.md | 477 | HISTORICAL_DOCUMENTATION |
| docs/operations/FRANKFURT_OWNER_BUILD_AR.md | 100 | HISTORICAL_DOCUMENTATION |
| docs/operations/STAGING_FRANKFURT_AR.md | 224 | HISTORICAL_DOCUMENTATION |
| scripts/backup/README.md | 28 | PRESERVE_OLD_BACKUP_LINK |
| scripts/backup/backup-public-config.mjs | 3, 5 | PRESERVE_OLD_BACKUP_LINK |
| scripts/backup/create-backup.mjs | 430 | PRESERVE_OLD_BACKUP_LINK |
| scripts/backup/preflight.mjs | 14 | PRESERVE_OLD_BACKUP_LINK |
| scripts/operations/build-cron-report.mjs | 29 | BUILD_GUARD_OR_AUDIT |
| scripts/operations/frankfurt-owner-build.mjs | 18 | BUILD_GUARD_OR_AUDIT |
| scripts/testing/run-order-push-url-runtime.mjs | 56 | BUILD_GUARD_OR_AUDIT |
| supabase/.temp/linked-project.json | 1 | PRESERVE_OLD_BACKUP_LINK |
| supabase/.temp/pooler-url | 1 | PRESERVE_OLD_BACKUP_LINK |
| supabase/.temp/project-ref | 1 | PRESERVE_OLD_BACKUP_LINK |
| supabase/config.toml | 1 | PRESERVE_OLD_BACKUP_LINK |
| tests/backup-project-isolation.test.ts | 14, 25 | TEST_CONTRACT |
| tests/backup-runner.test.ts | 189 | TEST_CONTRACT |
| tests/build-cron-report.test.ts | 11, 19 | TEST_CONTRACT |
| tests/fixtures/enqueue-order-push-before139.sql | 23 | TEST_CONTRACT |
| tests/frankfurt-preparation.test.ts | 23, 55 | TEST_CONTRACT |
| tests/frankfurt-public-config.test.ts | 17 | TEST_CONTRACT |
| tests/frankfurt-reference150.test.ts | 75 | TEST_CONTRACT |
| tests/frankfurt-staging-csp.test.ts | 5 | TEST_CONTRACT |
| tests/order-push-url139.test.ts | 15 | TEST_CONTRACT |
| tests/phase3-harness-stability.test.ts | 88 | TEST_CONTRACT |

كلتعريفاتpublicالحاليةعلى138:المرجعالقديمفي فقط. 139المعتمدةلهاعملمنفصلغيرمضمّن؛لاتدّعهذهالمرحلةإصلاحالرابط. ملفDB_FUNCTIONSفيشجرةالعملقديعكسمسودة139؛الحجةهناكتالوج138الحقيقي.

الأثر:تغييرVITE_SUPABASE_URLللوحدهلايكفي؛CSP connect-srcفيpublic/_headers وcustomer-web/public/_headers يثبتHTTP/WSSللمشروعالقديم. n8nworkflowلهأربعةروابطn8n-alert-feedقديمة. fallbackالمصدرفيالواجهتينقديم،وتجاوزenvيحسمruntimeفقط. رابطالنسخالاحتياطيوقفلpreflightوالـCLIالجذريقديمةعنقصد؛لايُغيّرهاالوكيلولاينقلالنسخالليليضمنالتحقيق.

#### cron وروابط Edge

| المهمة المنشأةبالتاريخ | ما تستدعيه | النقل |
|---|---|---|
| expire-stale-new-website-orders (091) | public.expire_stale_new_website_orders(100) | قاعدة/outbox؛المستهلكn8nخارجها |
| cleanup-guest-order-gateway-requests (092) | public.cleanup_guest_order_gateway_requests(500) | قاعدةفقط |
| scan-core-business-alerts (097) | public.scan_core_business_alerts(NOW(), 100) | قاعدة/outbox؛المستهلكn8nخارجها |
| scan-business-summaries (098) | public.scan_business_summaries(NOW()) | قاعدة/outbox؛المستهلكn8nخارجها |
| run-advanced-monitoring (099) | public.run_advanced_monitoring_checks() | قاعدة/outbox؛المستهلكn8nخارجها |

لاتوجدHTTPURLفيأوامرcronالخمسة؛المستهلكيطلبn8n-alert-feed. fixtureالتشخيصأوقفتالجدولةمحلياًوحذفتrun-advanced-monitoringكمايفعلgoldenfixture،فأربعةصفوفactive=falseفيتقريرالتشخيصليستادعاءًبحالةالمشروعالبعيد. حالةتعليقفرانكفورتلأربعمهاموالتريغرDمعلومةتقريرالمالكالسابقفقط،ولمتُقرأالآن. تريغر033ورسالةاختبارpushيصلانإلىenqueueذيالرابطالقديم؛لااختبارpushأورفعالتعليققبلتسليم139وإعدادوجهتهاالمعتمد.

#### أسماء إعدادات Edge منالمصدر (بلا قيم)

| Edge | أسماءيقرأهاالكود |
|---|---|
| admin-ai-assistant | GEMINI_API_KEY, GEMINI_MODEL, SUPABASE_ANON_KEY, SUPABASE_URL |
| manage-staff-users | SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL |
| n8n-alert-feed | NAWASRAH_AUTOMATION_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL |
| send-order-push | SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, WEB_PUSH_SUBJECT, WEB_PUSH_VAPID_PRIVATE_KEY, WEB_PUSH_VAPID_PUBLIC_KEY |
| submit-guest-order | GUEST_ORDER_HASH_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, TURNSTILE_ALLOWED_HOSTNAMES, TURNSTILE_SECRET_KEY, TURNSTILE_TEST_MODE |

SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY أسماؤهافقط؛توفّرهاونوعالمفاتيحفيEdgeيحتاجلوحةSupabase. GEMINI_API_KEY **لايُضبطبقرارالمالك**؛الردودالحتميةتعملوالمسارالذييحتاجالنموذجيعيد503. لاوضعservice_roleفيواجهة. Vaultorder_push_webhook_secret تُنشئه033تلقائياً؛لاقراءةلقيمته. VAPIDالعامثابتفيpushNotifications.service.ts ويجبمطابقتهلزوجEdge؛تغييرهقديستلزمإعادةاشتراكالأجهزة. Turnstileلهadmin_login فيالإدارةوguest-order فيالمتجر؛أسماءSecretsAuth TURNSTILE_SECRET مقابلEdge TURNSTILE_SECRET_KEY مختلفة.

### ما يجب إعداده يدوياً في فرانكفورت قبل staging

1. إبقاء `--apply` موقوفاً؛اعتماد 150 ونطاق الأعمدة/العمليات وRLS،وحل العلاقات الأربع `PGRST201` أولاً. بعدها مرجع جديد وفحص وصول حقيقي؛لا تطبيق لخطة 279 REVOKE القديمة.
2. تأكيد أن Data API مفعّلة وأن Automatically expose new tables مطفأة ومحفوظة بعد إعادة التحميل. هذا قرار المالك الحالي،ولا يسحب المنح القديمة. لا تفعيل عشوائي لـautomatic RLS يغيّر العقود.
3. Auth إلزامياً: أطفئ **Allow new users to sign up** واحفظ ثمأعدتحميلاللوحةللتحقق؛التسجيلالذاتي ممنوع والموظفونينشئهمالمالك فقط. اضبط **Site URL وredirect URLs** للنطاقات النهائية **admin.alnawasreh.com وalnawasreh.com** وبالمساراتالمعتمدةمنالكود،لاlocalhost أوروابطpreview عامة. config المحلي يضعlocalhost:3000 وredirects فارغة؛ليسإثباتاًللإعدادالبعيد. تأكيدemail/password والمزودين وقوالبالبريد وSMTP والمرسل والاستعادة والتأكيد ومهلJWT/refresh وrate limits يحتاجلوحةSupabase؛لامزودOAuthمفترض ولاوصولمنالوكيل.
4. تأسيس المالك الأول وprofile/role/branch بإجراء مدعوم ومعتمد؛اختبار موظف نشط ومتوقف وبلا دور،وTOTP/AAL2 والبصمة على المجالات المعتمدة. لا نقل جلسات أو عوامل قديمة،ولا تنفيذ أدوات أرصدة البداية المؤجلة.
5. نشر Edge Functions الخمس عند إذن النشر المنفصل،ومطابقة verify_jwt في config وإعداد الأسماء المذكورة أعلاه خارج Git. `admin-ai-assistant` دون `GEMINI_API_KEY` بقرار المالك. اختبار CORS وJWT والأدوار،وليس نجاح النشر فقط.
6. Turnstile: مطابقة site keys وsecrets ومجالات الإدارة والمتجر لكل مسار. ضبط TURNSTILE_ALLOWED_HOSTNAMES،وإطفاء test-mode،ورفض hostname/action الخاطئين. لا قيم اختبار في staging المعتمد.
7. Storage: إثبات المالك وجود bucket `product-images` ومحدداته وسياساته الأربع كما في 020؛لا إعادة إنشاء يدوية بلا سبب. اختبار رفع وقراءة عامة وحذف ورفض دور غير مخوّل. فحص روابط الصور القديمة وbytes وموافقة نقلها قبل حذف القديم.
8. Realtime: يلتقط المالك عضوية pg_publication_tables في الجديد؛تُعتمد قائمة الجداول أعلاه قبل أي ALTER PUBLICATION. اختبار قناتين حقيقيتين مع RLS ودور غير مخوّل؛وجود publication وحده لا يكفي.
9. تسليم 139 واعتماد تطبيقها كخطوة مستقلة،ثم إعداد Vault `order_push_webhook_url` لفرانكفورت عند التفعيل فقط. إبقاء التريغر D والـcron المعلّقة حتى قرار رفع التعليق. `send_test_push_notification` لا يحميه تعطيل التريغر؛لا إرسال خارجي قبل الإذن.
10. Push/n8n: مطابقة زوج VAPID وWEB_PUSH_SUBJECT وسر webhook داخل المسار المعتمد،ومراجعة إعادة اشتراك الأجهزة. تحديث روابط n8n-alert-feed الأربعة وNAWASRAH_AUTOMATION_SECRET عند الإذن،لا الآن. مهام outbox لا ترسل Telegram دون مستهلك معدّ.
11. الواجهتان/Cloudflare: ضبط VITE_SUPABASE_URL وVITE_SUPABASE_PUBLISHABLE_KEY (أو VITE_SUPABASE_ANON_KEY المعتمد) للجديد في staging،وتحديث CSP HTTP/WSS قبل التجربة. مطابقة VITE_STOREFRONT_PUBLIC_URL للإدارة وVITE_PUBLIC_SITE_ORIGIN للمتجر،وVITE_TURNSTILE_SITE_KEY للمتجر ومفتاح الإدارة من config،وVITE_STORE_WHATSAPP_NUMBER وVITE_SENTRY_DSN إن كان مفعّلاً. لا preview عامة على بيانات التشغيل؛اختبار CORS وتحديث service worker/cache والروابط المطبوعة على الهاتف.
12. النسخ والحارس: إعادة توجيه النسخ الليلي وkeep-alive وقياس 400MB وتنبيهات Telegram عند تفويض النقل فقط،بإجراء لا يكسر ربط الجذر القديم. النقل لجهاز المحل الدائم خطوة لاحقة معتمدة؛لا أسرار أو مهام مراقبة تُنشأ بهذا التحقيق.
13. عند تحويل GitHub إلى private بقرار التسليم: تعطيل جدول public-uptime وقتها فقط وتفعيل PRIVATE_CI_BUDGET_MODE بالإعداد الواحد الموثق،مع full CI قبل أي نشر. لم يُفعّل ذلك الآن.
14. بوابة staging: full CI والأسرار على نفس SHA،وتجربة واجهة حقيقية بلا mocks للجداول وRPC وStorage وRealtime وAuth وEdge،ثم golden day ومطابقة الأرصدة والمراقبة والنسخ. كل بند غير مثبت من اللوحة يبقى «يحتاج تأكيد المالك من لوحة Supabase»،لا نجاحاً افتراضياً.

### إعادة إنتاج الإضافة

```powershell
node scripts/audit/service-access-inventory.mjs
node scripts/audit/run-service-access-diagnostic.mjs
node scripts/audit/service-access-report.mjs <diagnostic.json> <local-reference.json> <catalog-observed.json>
```

لاconnectionstringأومفتاحخدمةبعيدفيهذهالأوامر. الأمرالأخيرقراءةملفاتمحفوظةفقط؛لاقيملأسرارفيالمخرجات. قياسEXECUTE على198 ومصدرالاستدعاءاتالحالي؛150 لاتغيرEXECUTE بدليل مقارنةالكتالوجالكاملة،و139تغيّر جسمenqueueغيرالمستدعىمنالواجهةمعإبقاءACL.139سُلّمتمنفصلة3a3893b،وقياسهاالحقيقيأثبتصفرمرجعقديمفيتعريفاتpublic بعدالتطبيقالمحلي؛لايعنيهذاأنهاتطبقتعلىفرانكفورت.

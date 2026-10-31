# دليل المطوّر للصيانة الآمنة

مدخل العمل الحالي، مستخرج من `main@4f3c3304`؛ السقف المعتمد **217 / 179 ملف migration**. لا يثبت حالة خدمة مستضافة الآن ولا يمنح إذناً بالاتصال أو النشر. ابدأ هنا بدل قراءة أرشيف الأدلة؛ الدليل الأقدم `MAINTENANCE_GUIDE_AR.md` و`HANDOFF.md` سياق تاريخي، وليسا تعليمات تشغيل حالية. عند العودة لاحقاً: الكود و[السقف الواحد](agent/project-state.json) وقرار المالك الأحدث يتقدمان على هذا الوصف.

## 1. المعمارية في دقيقة

- الإدارة: Vite/React/TypeScript في `src/`، والتنقل بـ`activeTab` في `src/App.tsx`. **ليست Zustand حالياً**: `src/stores/useAppStore.ts` يستخدم `StoreEngine` و`useSyncExternalStore`؛ المصادقة في `useAuthStore.ts`. الحالة المحلية للعرض والتعافي، وليست دفتر المال.
- المتجر: تطبيق Vite/React مستقل في `customer-web/`؛ مساراته في `customer-web/src/utils/publicRoutes.ts`. لكل واجهة build وPWA وإعدادات مستقلة.
- Supabase/PostgreSQL صاحب حقيقة المال والمخزون والذمم والحالة. `src/services/supabase/` و`customer-web/src/services/` واجهتا النقل؛ الكاتب المحمي في SQL هو الذي يثبت القرار داخل المعاملة. JWT/RLS لا يغنيان عن حراسة الدور والنشاط وMFA داخل الدوال.
- Edge في `supabase/functions/`: `submit-guest-order`، `manage-staff-users`، `send-order-push`، `admin-ai-assistant`، `owner-telegram-dispatch`؛ `n8n-alert-feed` مسار أتمتة أقدم. الاعتمادات مثبتة في `deno.json`/`deno.lock` لكل دالة.
- `pg_cron` ينتج الفحوص والأحداث؛ `pg_net` ينقل طلبات Edge بأسرار Vault. Cloudflare Pages يستضيف التطبيقين؛ CSP وSEO وmanifest البيئة تتولد وقت البناء، لا عند فتح الصفحة.
- النسخ الحالي من Windows Task Scheduler: أرشيف `.nwb` مشفّر + Storage + R2 + استرجاع Docker معزول ومقارنة صارمة. النسخ السحابي وmigration 218 **مؤجلان**؛ عند إطفاء الجهاز لا تفترض وجود نسخة ليلية جديدة.

```text
Checkout المتجر → orders.service → submit-guest-order (Turnstile + HMAC + gateway)
 → submit_guest_customer_order_v2 → معاملة: طلب + حجز مخزون + دليل idempotency
 → الإدارة تقبل/تجهز → complete_website_order_with_settlement_v2
 → خصم المخزون وتكلفة محفوظة + تسوية → وصل/تقارير/تنبيه من نفس السجل
```

## 2. خريطة العمليات الحالية

الاختصارات لمسارات فعلية: `F/` = `src/features/`، `S/` = `src/services/supabase/`، `T/` = `scripts/testing/`، `U/` = `tests/`. اقرأ خدمة الصف ثم جسم RPC ثم مساعديها والتريغرات، لا تبحث في كل التاريخ. أسماء migrations أدناه هي **آخر تعريف للمدخل نفسه**؛ تغيير helper/ACL لاحق لا يجعل تعريف المدخل أحدث. مثلاً كلفة POS تتأثر بـ214 حتى لو كان الغلاف في216.

الجداول المذكورة نقاط الأثر الرئيسية، مباشرة أو عبر المساعدين، وليست كل closure للنداءات. كتاب العمليات يضيفون أيضاً `audit_logs`/`business_operations` حيث ينطبق؛ أدلة `phase42_*` و`phase43_*` وحراسها جزء من التسوية، لا تُحذف عند التبسيط. لا تفترض أن كل بيع يعدّل صف `cash_shifts`: النقد المتوقع يُشتق من مصادره، ولقطة الإغلاق تُثبّت عند الإغلاق.

<!-- operations:start -->
| العملية | الشاشة | الخدمة (عبر stores/hooks عند الحاجة) | RPC الحالية (آخر CREATE؛ لا آخر GRANT) | جداول الأثر الرئيسية | اختبارات الحماية |
|---|---|---|---|---|---|
| POS: كاش / CliQ / دين؛ طرد وباكيت ومشكّل | `F/pos/PosView.tsx` | `S/posV2.service.ts` | `create_pos_sale_v2` ([216_pos_partial_payments.sql][m216]) | `orders`، `order_items`، `order_parcel_instances`، `order_parcel_components`، `inventory_balances`، `inventory_movements`، `business_operations` | `T/run-phase3-basic-current-runtime.mjs`<br>`T/run-phase3-configurable-parcel-contracts-runtime.mjs` |
| POS: دفعة جزئية (كاش/CliQ والباقي دين) | `F/pos/PosView.tsx` | `S/posV2.service.ts` | `create_pos_sale_with_initial_payment_v1` ([216_pos_partial_payments.sql][m216]) | `orders`، `customer_payments`، `pos216_initial_payments`، `inventory_balances`، `inventory_movements` | `T/run-partial216-runtime.mjs`<br>`T/run-partial216-fullstack.mjs` |
| عميل جديد، ومنه الزبون السريع | `F/pos/PosView.tsx` | `S/crm.service.ts` | `save_customer` ([018_customer_order_linking.sql][m018]) | `customers` | `U/partial-payment216.test.ts` |
| إعادة طباعة/رابط الوصل؛ لا بيع أو دفعة جديدة | `F/salesHistory/SalesHistoryView.tsx` | `S/pos.service.ts` | `get_or_create_pos_receipt_token` ([056_inventory_movement_reports_and_public_pos_receipts.sql][m056]) | `orders` | `U/trial-sale-receipts.test.ts` |
| قراءة الوصل العام | `customer-web/src/components/PublicPosReceiptPage.tsx` | `customer-web/src/services/receipts.service.ts` | `get_public_pos_receipt` ([216_pos_partial_payments.sql][m216]) | قراءة؛ لا كتابة أعمال | `U/partial-payment216.test.ts` |
| تحصيل موحّد: افتتاحي + طلبات + تعويض شيك | `F/crm/CustomerCollectionModal.tsx` | `S/goLive.service.ts` | `collect_customer_balance_v1` ([198_cashier_customer_collection_access.sql][m198])<br>`reverse_customer_collection_v1` ([214_handover_z_corrections.sql][m214]) | `customer_collection_operations`، `customer_collection_opening_allocations`، `customer_collection_cheque_allocations`، `customer_collection_order_payments`، `customer_payments` | `T/run-all-collections203-runtime.mjs`<br>`T/run-go-live-integration164-runtime.mjs` |
| دفعة فاتورة مفردة؛ العكس من تصحيح المستند207، لا من تعديل صف الدفعة | `F/accounts/RecordCustomerPaymentModal.tsx` | `S/customerAccounts.service.ts` | `record_customer_order_payment_once` ([191_cheque_unified_customer_collection.sql][m191]) | `orders`، `customer_payments` | `T/run-deferred-cheques-runtime.mjs` |
| إرجاع واسترداد: خفض ذمة / كاش / CliQ | `F/orders/AftercareWizard215.tsx` | `S/aftercare215.service.ts`<br>`S/aftercare215Rpc.ts` | `preview_admin_sales_return_v2` ([215_inspected_aftercare_and_supplier_credit.sql][m215])<br>`settle_admin_sales_return_v2` ([215_inspected_aftercare_and_supplier_credit.sql][m215]) | `sales_return_events`، `sales_return_items`، `sales_return_component_inspections`، `sales_aftercare_consumptions`، `phase42_return_settlement_evidence`، `aftercare215_return_results`، `inventory_balances`، `products` | `T/aftercare215-return-v2-runtime.mjs`<br>`T/aftercare215-exact-cost-runtime.mjs` |
| استبدال مع فحص السليم/المعيب | `F/orders/AftercareWizard215.tsx` | `S/aftercare215.service.ts`<br>`S/aftercare215Rpc.ts` | `preview_inspected_sales_replacement_v2` ([215_inspected_aftercare_and_supplier_credit.sql][m215])<br>`settle_inspected_sales_replacement_v2` ([215_inspected_aftercare_and_supplier_credit.sql][m215]) | `sales_replacement_events`، `sales_replacement_items`، `aftercare215_inspections`، `aftercare215_inspection_items`، `supplier_replacement_cases`، `inventory_balances`، `products` | `T/aftercare215-inspected-runtime.mjs`<br>`T/aftercare215-race.mjs` |
| تبديل بصنف آخر وفرق سعر | `F/orders/AftercareWizard215.tsx` | `S/aftercare215.service.ts`<br>`S/aftercare215Rpc.ts` | `preview_sales_exchange_v1` ([215_inspected_aftercare_and_supplier_credit.sql][m215])<br>`settle_sales_exchange_v1` ([215_inspected_aftercare_and_supplier_credit.sql][m215]) | `aftercare215_exchanges`، `aftercare215_exchange_results`، `orders`، `sales_return_events`، `inventory_balances` | `T/aftercare215-exchange-runtime.mjs`<br>`T/aftercare215-exchange-boundary-runtime.mjs` |
| تالف محل / مورد: إرسال، فوري، جزئي، رفض، عكس | `F/inventory/SupplierReplacementPanel.tsx` | `S/supplierReplacement.service.ts` | `execute_supplier_replacement_v1` ([215_inspected_aftercare_and_supplier_credit.sql][m215]) | `inventory_damage_events`، `supplier_replacement_cases`، `supplier_replacement_events`، `supplier_replacement_inventory_effects`، `inventory_balances`، `inventory_movements`، `products` | `T/run-supplier-replacement208-runtime.mjs`<br>`T/aftercare215-damage-runtime.mjs` |
| مصير معيب الزبون / تحويل تالف لاحقاً للمورد | `F/orders/AdminAftercarePanel.tsx` | `S/supplierReplacement.service.ts` | `execute_aftercare_supplier_v1` ([211_aftercare_supplier_disposition.sql][m211]) | `aftercare_supplier_links`، `supplier_replacement_cases`، `supplier_replacement_events`، `sales_replacement_items`، `inventory_balances`، `products` | `T/run-aftercare211-runtime.mjs` |
| خصم من حساب المورد / عكس الخصم | `F/inventory/SupplierCredit215Panel.tsx` | `S/supplierCredit215.service.ts`<br>`S/supplierReplacement.service.ts` | `preview_supplier_replacement_credit_v1` ([215_inspected_aftercare_and_supplier_credit.sql][m215])<br>`settle_supplier_replacement_credit_v1` ([215_inspected_aftercare_and_supplier_credit.sql][m215]) | `supplier215_credits`، `suppliers`، `supplier_replacement_events`، `inventory_movements` | `T/aftercare215-credit-runtime.mjs` |
| استلام بضاعة مباشر، طرد/باكيت وتغيّر تكلفة | `F/directReceiving/CreateDirectReceiptModal.tsx` | `S/directReceiving.service.ts` | `create_direct_supplier_receipt_v2` ([113_configurable_parcel_receiving_and_exact_wac.sql][m113]) | `supplier_receipts`، `supplier_receipt_items`، `supplier_receipt_commercial_lines`، `supplier_payments`، `suppliers`، `inventory_balances`، `inventory_movements`، `products` | `T/run-phase2-configurable-receiving-runtime.mjs`<br>`T/run-receiving-unit-runtime.mjs` |
| أمر شراء: إنشاء ثم استلام — ملغى في الواجهة بقرار المالك؛ `App.tsx` يوجّه `purchases` إلى `DirectReceivingView`، والكود باقٍ للتوافق | `F/purchases/ReceiveGoodsModal.tsx` | `S/purchases.service.ts` | `create_purchase_order` ([050_admin_api_security_hardening.sql][m050])<br>`receive_purchase_order_v2` ([133_package_e_supplier_po_financial_consistency.sql][m133]) | `purchase_orders`، `purchase_order_items`، `purchase_receipts`، `purchase_receipt_items`، `purchase_receipt_commercial_lines`، `supplier_payments`، `suppliers`، `inventory_balances`، `products` | `T/run-package-e-supplier-runtime.mjs` |
| دفعة مورد: سند مباشر أو أمر شراء؛ دفعة أمر الشراء: purchases.service.ts → record_supplier_payment | `F/directReceiving/RecordSupplierPaymentModal.tsx` | `S/directReceiving.service.ts` | `record_supplier_receipt_payment` ([080_supplier_payment_idempotency.sql][m080]) | `supplier_receipts`، `supplier_payments`، `suppliers` | `T/run-package-e-supplier-runtime.mjs` |
| دفعة أمر شراء | `F/purchases/SupplierPaymentModal.tsx` | `S/purchases.service.ts` | `record_supplier_payment` ([193_deferred_cheque_lifecycle.sql][m193]) | `supplier_payments`، `suppliers` | `T/run-deferred-cheques-runtime.mjs` |
| دفعة رصيد مورد افتتاحي | `F/goLive/GoLiveSetupView.tsx` | `S/goLive.service.ts` | `pay_supplier_opening_balance_v1` ([163_go_live_unified_collection_and_supplier_opening_payment.sql][m163]) | `supplier_opening_payments` | `T/run-go-live-integration164-runtime.mjs` |
| إلغاء وعكس سند استلام مورد؛ هذا المسار الفعلي؛ ليس مرتجع مورد جزئياً عاماً. المعيب الجزئي في مسار المورد أعلاه | `F/directReceiving/SupplierReceiptDetailView.tsx` | `S/directReceiving.service.ts` | `cancel_supplier_receipt` ([120_phase4_returns_refunds_foundation.sql][m120]) | `supplier_receipts`، `supplier_payments`، `suppliers`، `inventory_balances`، `inventory_movements`، `products` | `T/run-package-e-supplier-runtime.mjs` |
| مصروف / عكس مصروف | `F/expenses/ExpenseFormModal.tsx` | `S/expenses-shifts.service.ts` | `create_operational_expense` ([040_operational_expenses_and_cash_shifts.sql][m040])<br>`reverse_operational_expense` ([120_phase4_returns_refunds_foundation.sql][m120]) | `operational_expenses` | `T/run-package-e-golden-day-runtime.mjs` |
| سحب مالك / إرجاعه | `F/shifts/OwnerWithdrawalsPanel.tsx` | `S/ownerWithdrawals.service.ts` | `create_owner_cash_withdrawal_v1` ([180_owner_cash_withdrawals.sql][m180])<br>`reverse_owner_cash_withdrawal_v1` ([180_owner_cash_withdrawals.sql][m180]) | `owner_cash_withdrawals` | `T/run-owner-withdrawals-runtime.mjs` |
| شيك وارد / صادر / تظهير | `F/cheques/ChequesView.tsx` | `S/cheques.service.ts` | `receive_customer_cheque_v1` ([193_deferred_cheque_lifecycle.sql][m193])<br>`issue_supplier_cheque_v1` ([193_deferred_cheque_lifecycle.sql][m193])<br>`endorse_customer_cheque_v1` ([193_deferred_cheque_lifecycle.sql][m193]) | `deferred_cheques`، `deferred_cheque_allocations`، `deferred_cheque_events`، `customer_payments`، `supplier_payments` | `T/run-deferred-cheques-runtime.mjs` |
| شيك: صرف / راجع / إلغاء وتعويض | `F/cheques/ChequesView.tsx` | `S/cheques.service.ts` | `clear_deferred_cheque_v1` ([193_deferred_cheque_lifecycle.sql][m193])<br>`return_deferred_cheque_v1` ([193_deferred_cheque_lifecycle.sql][m193])<br>`cancel_deferred_cheque_v1` ([193_deferred_cheque_lifecycle.sql][m193])<br>`pay_supplier_cheque_claim_v1` ([193_deferred_cheque_lifecycle.sql][m193])<br>`reverse_supplier_cheque_claim_payment_v1` ([193_deferred_cheque_lifecycle.sql][m193]) | `deferred_cheques`، `deferred_cheque_events`، `cheque_compensation_claims`، `supplier_payments` | `T/run-deferred-cheques-runtime.mjs`<br>`T/cheque-shift-reversal-runtime.mjs` |
| فتح / إغلاق وردية | `F/shifts/ShiftsView.tsx` | `S/expenses-shifts.service.ts` | `open_cash_shift` ([040_operational_expenses_and_cash_shifts.sql][m040])<br>`close_cash_shift` ([194_cheque_shift_and_integrity.sql][m194])<br>`cancel_empty_cash_shift` ([194_cheque_shift_and_integrity.sql][m194]) | `cash_shifts` | `T/run-package-e-closing-runtime.mjs`<br>`T/run-partial216-runtime.mjs` |
| تصحيح مستند من ⋯ / عكس وردية مدعوم؛ موجّه يستدعي الكاتب/العكس الأصلي؛ الجداول التابعة حسب نوع المستند | `F/shifts/ShiftClosingReportModal.tsx` | `S/documentCorrections.service.ts`<br>`S/expenses-shifts.service.ts` | `get_document_correction_preview` ([207_document_correction_preview_and_once.sql][m207])<br>`execute_document_correction_once` ([207_document_correction_preview_and_once.sql][m207])<br>`preview_cash_shift_full_reversal` ([194_cheque_shift_and_integrity.sql][m194])<br>`reverse_cash_shift_with_operations` ([194_cheque_shift_and_integrity.sql][m194]) | `business_operations`، `audit_logs`، `cash_shifts` | `T/run-document-corrections207-runtime.mjs` |
| متجر: إرسال وحجز ذري عبر Edge | `customer-web/src/components/CheckoutModal.tsx` | `supabase/functions/submit-guest-order/index.ts` | `authorize_guest_order_gateway` ([086_guest_order_abuse_gateway.sql][m086])<br>`submit_guest_customer_order_v2` ([209_product_sale_methods.sql][m209])<br>`finalize_guest_order_gateway` ([086_guest_order_abuse_gateway.sql][m086]) | `guest_order_gateway_requests`، `customers`، `orders`، `order_items`، `order_inventory_reservations`، `inventory_balances`، `promotion_redemptions` | `T/run-guest-order-edge-http.mjs`<br>`T/run-phase3-configurable-parcel-contracts-runtime.mjs` |
| طلب متجر: قبول/تجهيز/بدء توصيل | `F/orders/OrderDetailModal.tsx` | `S/orders.service.ts` | `accept_order_for_preparation` ([060_simplified_order_settlement_and_receivables.sql][m060])<br>`update_order_status` ([030_secure_order_entrypoints.sql][m030])<br>`start_or_update_order_delivery` ([060_simplified_order_settlement_and_receivables.sql][m060]) | `orders`، `order_status_history`، `order_inventory_reservations`، `inventory_balances` | `T/run-phase3-configurable-parcel-contracts-runtime.mjs` |
| تسليم وتسوية / إلغاء طلب حديث | `F/orders/OrderDetailModal.tsx` | `S/adminCustomerV2Lifecycle.ts` | `complete_website_order_with_settlement_v2` ([120_phase4_returns_refunds_foundation.sql][m120])<br>`cancel_customer_order_v2` ([116_configurable_parcel_customer_reservation_coordinator.sql][m116]) | `orders`، `customer_payments`، `inventory_balances`، `inventory_movements`، `order_inventory_reservations`، `business_operations` | `T/run-phase3-configurable-parcel-contracts-runtime.mjs`<br>`T/run-customer-checkout-browser-e2e.mjs` |
| استيراد منتجات / تعديل المنتج والسعر والنكهات؛ نموذج المنتج يستعمل products.service.ts وكتاب209؛ تعديل السعر لا يعيد تكلفة البيع القديم | `F/goLive/GoLiveSetupView.tsx` | `S/goLive.service.ts` | `import_go_live_products_v1` ([209_product_sale_methods.sql][m209]) | `go_live_import_batches`، `products`، `inventory_balances` | `T/run-go-live-setup-runtime.mjs`<br>`U/parcel209.test.ts` |
| بداية التشغيل: مخزون موجود فقط | `F/goLive/GoLiveSetupView.tsx` | `S/inventory-opening.service.ts` | `apply_inventory_opening_setup` ([047_inventory_opening_setup.sql][m047]) | `inventory_opening_sessions`، `inventory_opening_items`، `inventory_balances`، `inventory_movements` | `U/inventory-opening-setup.test.ts` |
| بداية التشغيل: ذمم عملاء / موردين | `F/goLive/GoLiveSetupView.tsx` | `S/goLive.service.ts` | `record_customer_opening_balances_v1` ([161_go_live_customer_opening_balances.sql][m161])<br>`record_supplier_opening_balances_v1` ([162_go_live_supplier_opening_balances.sql][m162]) | `customer_opening_balances`، `supplier_opening_balances`، `go_live_import_batches` | `T/run-go-live-setup-runtime.mjs` |
| بداية التشغيل: شيكات ثم إنهاء الإعداد | `F/goLive/GoLiveSetupView.tsx` | `S/openingCheques.service.ts`<br>`S/goLive.service.ts` | `record_go_live_cheques_v1` ([196_go_live_opening_cheques.sql][m196])<br>`finish_go_live_setup_v1` ([160_go_live_setup_foundation.sql][m160]) | `deferred_cheques`، `deferred_cheque_allocations`، `go_live_import_batches`، `go_live_setup_state` | `T/run-opening-cheques-runtime.mjs` |
| جرد / تلف من الجرد / نقل مستودع | `F/inventory/InventoryView.tsx` | `S/inventory.service.ts` | `adjust_inventory_stock` ([201_home_collections_and_damage_losses.sql][m201])<br>`transfer_inventory_between_warehouses` ([113_configurable_parcel_receiving_and_exact_wac.sql][m113]) | `inventory_balances`، `inventory_movements`، `inventory_damage_events`، `products` | `T/run-home-damage201-runtime.mjs`<br>`T/run-phase2-configurable-receiving-runtime.mjs` |
| تقارير اليوم/الفترة | `F/reports/ReportsCenterView.tsx` | `S/reports.service.ts` | `get_operational_business_report` ([181_owner_withdrawal_readers.sql][m181]) | قراءة؛ لا كتابة أعمال | `T/run-all-collections203-runtime.mjs`<br>`T/aftercare215-exchange-readers-runtime.mjs` |
| الرئيسية / سجل المبيعات / خسائر التالف؛ الرئيسية: dashboard.service.ts؛ سجل الخسائر: damageLedger215.service.ts؛ القراءات مفصولة عن الكتابة | `F/salesHistory/SalesHistoryView.tsx` | `S/salesHistory.service.ts` | `get_sales_history_page` ([204_sales_history_read_model.sql][m204]) | قراءة؛ لا كتابة أعمال | `T/run-sales-history204-runtime.mjs` |
| منتج/نكهة وسعر؛ تصحيح تكلفة مستقل للمالك؛ تغيير السعر ليس إعادة تقييم مبيعات تاريخية | `F/products/ProductFormModal.tsx` | `S/products.service.ts`<br>`S/productCost.service.ts` | `create_product_with_opening_stock_v5` ([209_product_sale_methods.sql][m209])<br>`create_product_family_with_flavors_v2` ([209_product_sale_methods.sql][m209])<br>`update_product_master_v5` ([209_product_sale_methods.sql][m209])<br>`correct_product_cost_v1` ([171_product_cost_preserved_on_edit.sql][m171]) | `products`، `product_cost_corrections`، `inventory_balances`، `inventory_movements` | `U/parcel209.test.ts`<br>`T/run-product-cost-integrity-runtime.mjs` |
| مشكّل: إعداد وتفعيل الطرد؛ المالك فقط؛ single_sku تاريخي للقراءة ولا يُعاد عرضه كطريقة ثانية | `F/more/ParcelConfigurationModal.tsx` | `S/parcelConfiguration.service.ts` | `save_product_parcel_configuration_v1` ([209_product_sale_methods.sql][m209])<br>`set_configurable_parcel_feature_state_v1` ([113_configurable_parcel_receiving_and_exact_wac.sql][m113]) | `product_parcel_configurations`، `product_parcel_allowed_components`، `configurable_parcel_feature_settings` | `T/run-configurable-parcel-foundation-runtime.mjs` |
| الرئيسية وملخص الصندوق وتفصيل الحركات؛ قراءة؛ داخلياً get_cash_shift_display_summary حراسته محدثة214 | `F/dashboard/DashboardView.tsx` | `S/dashboard.service.ts`<br>`S/cashShiftMovements.service.ts`<br>`S/expenses-shifts.service.ts` | `get_home_dashboard` ([195_deferred_cheque_readers_and_alerts.sql][m195])<br>`get_cash_shift_movement_page` ([215_inspected_aftercare_and_supplier_credit.sql][m215])<br>`get_expense_shift_center` ([084_full_cash_shift_reversal.sql][m084]) | قراءة؛ لا كتابة أعمال | `T/run-all-collections203-runtime.mjs`<br>`T/run-navigation-cash206-runtime.mjs` |
| سجل التالف وقيم الخسارة؛ القيم حسب DTO المالك؛ حالة المورد لا تُستنتج من الكمية وحدها | `F/more/DamageHistoryPanel.tsx` | `S/damageLedger215.service.ts` | `get_damage_ledger_page_v2` ([215_inspected_aftercare_and_supplier_credit.sql][m215]) | قراءة؛ لا كتابة أعمال | `T/aftercare215-damage-runtime.mjs` |
<!-- operations:end -->

[m018]: ../supabase/migrations/018_customer_order_linking.sql
[m030]: ../supabase/migrations/030_secure_order_entrypoints.sql
[m040]: ../supabase/migrations/040_operational_expenses_and_cash_shifts.sql
[m047]: ../supabase/migrations/047_inventory_opening_setup.sql
[m050]: ../supabase/migrations/050_admin_api_security_hardening.sql
[m056]: ../supabase/migrations/056_inventory_movement_reports_and_public_pos_receipts.sql
[m060]: ../supabase/migrations/060_simplified_order_settlement_and_receivables.sql
[m080]: ../supabase/migrations/080_supplier_payment_idempotency.sql
[m084]: ../supabase/migrations/084_full_cash_shift_reversal.sql
[m086]: ../supabase/migrations/086_guest_order_abuse_gateway.sql
[m113]: ../supabase/migrations/113_configurable_parcel_receiving_and_exact_wac.sql
[m116]: ../supabase/migrations/116_configurable_parcel_customer_reservation_coordinator.sql
[m120]: ../supabase/migrations/120_phase4_returns_refunds_foundation.sql
[m133]: ../supabase/migrations/133_package_e_supplier_po_financial_consistency.sql
[m160]: ../supabase/migrations/160_go_live_setup_foundation.sql
[m161]: ../supabase/migrations/161_go_live_customer_opening_balances.sql
[m162]: ../supabase/migrations/162_go_live_supplier_opening_balances.sql
[m163]: ../supabase/migrations/163_go_live_unified_collection_and_supplier_opening_payment.sql
[m171]: ../supabase/migrations/171_product_cost_preserved_on_edit.sql
[m180]: ../supabase/migrations/180_owner_cash_withdrawals.sql
[m181]: ../supabase/migrations/181_owner_withdrawal_readers.sql
[m191]: ../supabase/migrations/191_cheque_unified_customer_collection.sql
[m193]: ../supabase/migrations/193_deferred_cheque_lifecycle.sql
[m194]: ../supabase/migrations/194_cheque_shift_and_integrity.sql
[m195]: ../supabase/migrations/195_deferred_cheque_readers_and_alerts.sql
[m196]: ../supabase/migrations/196_go_live_opening_cheques.sql
[m198]: ../supabase/migrations/198_cashier_customer_collection_access.sql
[m201]: ../supabase/migrations/201_home_collections_and_damage_losses.sql
[m204]: ../supabase/migrations/204_sales_history_read_model.sql
[m207]: ../supabase/migrations/207_document_correction_preview_and_once.sql
[m209]: ../supabase/migrations/209_product_sale_methods.sql
[m211]: ../supabase/migrations/211_aftercare_supplier_disposition.sql
[m214]: ../supabase/migrations/214_handover_z_corrections.sql
[m215]: ../supabase/migrations/215_inspected_aftercare_and_supplier_credit.sql
[m216]: ../supabase/migrations/216_pos_partial_payments.sql


**حدود مهمة:** لا يوجد مسار عام موثق هنا لمرتجع مورد جزئي بمبلغ حر؛ الموجود عكس سند الاستلام، أو قضية المعيب/البديل/الخصم. لا تنفّذ هذه الفكرة باستلام سالب أو تعديل رصيد. المخزون الافتتاحي ليس استلام شراء، والدين القديم ليس بيعاً. إدخال الدرج الافتتاحي يتم عند فتح الوردية، لا بسند تحصيل وهمي.

### الدوال القديمة: لماذا تبقى؟

| العائلة | وضعها وسبب الاحتفاظ |
|---|---|
| `create_pos_sale`، `create_customer_order`، `submit_guest_customer_order` | توافق مع العقود/السجلات القديمة؛ الواجهة الحديثة تستعمل V2. حراس209 تمنع التحايل على «طرد فقط»؛ لا تُضف مستدعياً جديداً لـV1. |
| `settle_admin_sales_return_v1`، `settle_sales_replacement_v1`، `settle_operational_sales_return_v1` | ما زالت أغلفة215 أو مسارات التعافي القديمة تعتمد عليها وعلى lineage وأدلة121/122/132؛ اختفاء زر قديم لا يعني موت RPC. |
| `tc216_create_pos_sale_v2_internal`، `tc216_get_public_pos_receipt_internal`، `tb215_*_before215_internal`، `_before_*` | أوراق قديمة وراء أغلفة مصرح بها؛ صلاحيات الاستدعاء المباشر مسحوبة حيث نصت migration. الحذف قد يكسر نداء DEFINER أو قراءة تاريخية. لا تُنشئ طبقة جديدة من هذا النمط دون قرار صريح. |
| `receive_inventory` و`create_product_with_opening_stock`/`_v2`/`_v3` | مدخلات قديمة أُغلقت في213 لكل أدوار API؛ بقيت الأجسام لسلاسل داخلية. **لا تُعِد المنح** لتسهيل إصلاح. |

قبل حذف أي دالة/عمود: `rg` للمستدعين في الواجهتين وEdge وSQL والسكربتات، ثم فحص التبعيات وACL محلياً واختبار تاريخي فعلي. راجع [مراجعة المسارات غير المستخدمة](operations/UNEXPOSED_RPC_REVIEW_AR.md)؛ التقرير القديم ليس إثباتاً تلقائياً أن المسار ما زال مكشوفاً اليوم.

## 3. دورة التغيير والفحوص

1. اقرأ [AGENTS](../AGENTS.md)، [قواعد العمل](agent/OPERATING_RULES.md)، `PHASE_STATUS.md` و`ACTIVE_TASK.json` ثم `agent:resume` و`agent:preflight`. ثبّت HEAD و`git status` واعتماد النطاق. metadata قديمة في checkout آخر لا تُزامَن تخميناً. كاتب واحد لكل worktree؛ لا تلمس ملفات المالك المحلية.
2. أنشئ worktree من main المعتمد. Node24 وlockfiles هما مرجع التبعيات؛ ثبّت `npm.cmd ci` و`npm.cmd --prefix customer-web ci` في نسخة لا تخدم اختباراً جارياً. لا تنسخ `.env*.local` من جهاز/مشروع آخر.
3. ميزة واجهة: ابدأ من `src/features/` أو `customer-web/src/`، أعد استعمال UI kit وخدمة قائمة. لا تنشئ حسابات مال/رصيد أو سياسة بديلة في React. افصل العرض عن تحويل DTO؛ النتيجة المجهولة ليست فشلاً مؤكداً. احتفظ بنفس المفتاح/الطلب وافحص الحالة قبل أي إعادة إرسال.
4. فحوص حلقة العمل: اختبار محدد يثبت السلوك الجديد والسلبية، ثم types وlint. focused يكفي أثناء إصلاح محدود معروف الأثر، **لا يكفي لتسليم PR**. عند لمس عقد مشترك وسّع إلى جميع مستدعِيه والمتصفح؛ وعند writer معتمد أضف DB فعلية للأدوار/replay/rollback/جلستين، وفحوص «افحص» وأرقام اليوم الذهبي.

```powershell
# من worktree؛ لا تحتاج هذه الأوامر أسرار إنتاج
npm.cmd run agent:resume
npm.cmd run agent:preflight
npx.cmd tsx --test tests/maintainer-guide.test.ts
npm.cmd run typecheck
npm.cmd run lint:eslint:strict
npm.cmd test
npm.cmd --prefix customer-web run lint
npm.cmd --prefix customer-web test
git diff --check
```

اختبارات DB المحلية تبدأ من `scripts/testing/bootstrap-isolated-supabase.mjs` وعقد المهمة المقابلة في الجدول؛ لا تشغّل CLI reset عشوائياً. إذا القاعدة مشغولة، حدّد مالك الحاوية أولاً؛ لا توقف فحص غيرك ولا تتجاوز الحارس. استخدم مشروعاً/منافذ معزولة مستقلة معتمدة إن لزم. خوادم QA تمنع أي شبكة خارج loopback؛ المتجر الحقيقي يولّد SEO بقراءة القاعدة، لذلك البناء المحلي الآمن يستخدم `scripts/testing/run-customer-isolated-build.mjs`.

قبل الدفع: stage محدد، Gitleaks يشمل diff وكل ملف جديد، ثم commit/push مفوضان. بعده CI كامل على **نفس SHA النهائي**: `.github/workflows/quality.yml` و`secrets.yml` و`backup-recovery.yml`. الجودة على main وPR، والأسرار على دفعات الفروع المعتمدة أيضاً. Package F موزع على **10 shards** من `package-f-ci-shards.mjs`؛ `verify-browser-ci-partition.mjs` يثبت عدم فقد/تكرار الحالات، و`verifyFullDeliveryJobs` يرفض أي مهمة مفقودة أو skipped. لا تثبّت عدد المهام كشرط؛ العدد يتغير مع إضافة suites. إلغاء القديم يخص PR فقط، لا main.

عند CI أحمر: افتح أول job/step فاشل، قارن عتاده/وقتَه مع المحلي، أصلح السبب وأعد تحقق المتأثر. لا retries أو skips أو زيادة مهلات لإخفاء فشل. إعادة بيئية واحدة فقط بدليل ضمن التفويض القائم، وليست بديلاً عن معالجة عيب كود. بعد الدمج يلزم FULL والأسرار على SHA **main** أيضاً؛ `agent:verify-handoff -- --delivery` يثبت ذلك عندما HEAD المحلي هو main نفسه. سجّل أرقام التشغيل وcheckpoint، ثم توقف عند بوابة الاعتماد.

### migration جديدة — بعد قرار المالك فقط

لا تعدّل migration تاريخية أو تسقط صفراً داخل الفجوات. المصدر الواحد `docs/agent/project-state.json`: `migrationCeiling` و`operationalSchema.manifestSha256` والأوامر/اسم المرجع. `scripts/operations/operational-schema.mjs` يربطها بالmanifest الحقيقي؛ لا يكفي رفع الرقم وحده.

في **نفس PR**: SQL الجديدة الصريحة + بصمتها/السقف + مرجع جديد باسمه الصحيح + ترقية المالك dry-run/apply/verify-only صارم + دعم النسخ/الحارس/الاسترجاع/التصفير والاستئناف للسقف الجديد. احتفظ بقراءة الأرشيفات القديمة v2، ولا تعِد تسمية مرجع قديم. أدلة المصدر/القراءة تؤخذ من الاختبار المحلي الفعلي، لا بتغيير checksums لتجاوز الحارس. تثبيت PUBLIC/owner/search_path/grants جزء من العقد؛ `CREATE OR REPLACE` لا يمحو منحة قديمة تلقائياً. راجع [ترقية217](operations/FRANKFURT_OWNER_UPGRADE217_AR.md) و[بوابات التحقق](agent/VERIFICATION_GATES.md). لا تضف استثناءً عاماً إلى `maintenance-db-contract.mjs` أو محولات `source-before-*`.

### البناء والنشر والنسخ والتصفير

| المهمة | كيف/من يقرر؟ |
|---|---|
| `build:production` / `build:staging` / `build:prelaunch-trial` | الأوامر موجودة في package.json للتطبيقين؛ `environment.mjs` و`vite-environment.mjs` يحسمان القاعدة/CSP/SEO/release. production=فرانكفورت والنطاق الرسمي؛ staging=سنغافورة بعد إعادة بنائها؛ prelaunch-trial=فرانكفورت ومعاينة مقيدة قبل القطع فقط. |
| `verify-dist` | `node scripts/environments/verify-dist.mjs admin production dist`؛ وللمتجر: `node scripts/environments/verify-dist.mjs customer production customer-web/dist`. استبدل السياق صراحة للتجربة؛ افحص manifest وCSP والمعرّفات المعاكسة، لا ترفع قوالب public. `dist` مع SEO اصطناعي غير قابل للنشر. |
| اختبار كل السياقات بلا اتصال | `node scripts/testing/run-environment-builds.mjs`؛ و`run-prelaunch-trial-builds.mjs` للتجربة المؤقتة؛ المتجر من fixture فقط. لا تشغّل build متجر فعلياً نحو القاعدة من مهمة «محلي فقط». |
| معاينة | Claude بتفويض المعاينات الحالي، أو المالك؛ الأوامر المحروسة والتحقق من Access في [PRELAUNCH_TRIAL_AR](operations/PRELAUNCH_TRIAL_AR.md). `PRELAUNCH_TRIAL_OPEN` في المصدر يغلق السياق يوم القطع؛ لا يُقبل في production. |
| إنتاج | كلمة المالك «انشر» فقط، main نظيف ومحدث وCI أخضر؛ `deploy:admin` و`customer-web` → `deploy:cloudflare`. لا تتجاوز حارس النظافة بـstash تلقائي لملفات المالك؛ استعمل نسخة نشر نظيفة مفوضة. تفاصيل [خطة القطع](operations/GO_LIVE_CUTOVER_AR.md) و[فصل البيئات](operations/ENVIRONMENT_SEPARATION_AR.md). |
| نسخ/استرجاع | المالك، PowerShell Administrator: `scripts/operations/frankfurt-backup-owner.ps1` أوضاع `Plan` ثم `Backup`/`Upload`/`VerifyRemote`/`RestoreRemote`/`Status` وفق [RUNBOOK](operations/FRANKFURT_BACKUP_RESTORE_RUNBOOK_AR.md). Plan محلي؛ أوضاع التنفيذ تتصل ولا يملك الوكيل تشغيلها ضمن مهمة بلا اتصال. Restore عزل محلي، لا استرجاعاً حياً. لا تعتبر نجاح Backup وحده إثبات تعافٍ. |
| تصفير يوم التشغيل | قرار قطع مستقل؛ Backup فاصل، وقف الكتابات والمعاينات والإشعارات، ثم `frankfurt-owner-reset217` وفق [RESET217](operations/RESET217_OWNER_AR.md). يحفظ المالك/MFA/إعدادات المتجر والوحدات والأقسام، ويمسح أعمال وصور التجربة. الفشل بعد البدء: افحص السبب ثم `--resume` بنفس المرجع واللقطة؛ وجود كتابات حقيقية جديدة يوقفه ويستلزم مسار استرجاع معتمد. |

## 4. الأسرار والإعدادات: أسماء فقط

المالك يحفظ الأصول في مدير كلمات مرور ونسخة طوارئ منفصلة؛ المطوّر يستعمل ما يفوَّض به فقط. لا قيم في Git أو argv أو screenshots/logs أو تذاكر Sentry. Public/publishable وDSN مفاتيح عامة تقنياً، لكنها ليست تصريحاً لكشف بيانات أو لخلط البيئات. **لا تضف أي سر نسخ إلى GitHub العام**؛ قرار runner السحابي مؤجل.

| الاسم/العائلة | مكانه والمالك | التدوير وما يتعطل |
|---|---|---|
| `SUPABASE_DB_PASSWORD`، `NAWASRAH_FF_DB_PASSWORD` | المالك في Supabase؛ CLI إدخال مخفي بالذاكرة، والنسخ Windows DPAPI في ProgramData | تغيير DB ثم تحديث الإعداد المحلي المحروس والمهام؛ إن نُسي تتوقف Backup/Watchdog/upgrade. لا تمرره في command line. |
| `SUPABASE_URL`، `SUPABASE_SERVICE_ROLE_KEY`، `SUPABASE_ANON_KEY` | Edge Secrets/إعداد Supabase، يديرها المالك؛ service_role لخادم موثوق فقط | راجع كل Edge بعد التدوير؛ تتعطل Gateway/Push/الأتمتة/إدارة الحسابات. لا يوضع service_role في VITE أو SQL cron مكشوف. |
| `VITE_SUPABASE_URL`، `VITE_SUPABASE_PUBLISHABLE_KEY`، `VITE_SUPABASE_ANON_KEY` | سياق البناء المسموح، env محلي أو Variables في Pages | key مطابق لنفس المشروع؛ يلزم rebuild للواجهتين. القيم المتعارضة تُرفض. Direct Upload لا يعيد تطبيق Variables بعد البناء. |
| JWT signing keys، Auth sessions، MFA/TOTP recovery | لوحة Auth وأجهزة/استرداد المالك، لا ملفات المشروع | rotation قد يبطل جلسات؛ تحقق AAL2/refresh وEdge. فقد MFA يعالج باسترداد حساب محروس، لا بتعطيل الحارس. |
| `TURNSTILE_SECRET_KEY`، `TURNSTILE_ALLOWED_HOSTNAMES`؛ `VITE_TURNSTILE_SITE_KEY` | الخاص في Edge، العام وقت البناء؛ المالك في Cloudflare | بدّل الزوج ونطاقاته، اختبر Gateway؛ الخطأ يمنع تسجيل الدخول/طلب المتجر حسب إعداد كل مسار. `TURNSTILE_TEST_MODE` للفحص المعزول فقط. |
| `GUEST_ORDER_HASH_SECRET` | Edge Secret، المالك | HMAC لهوية Gateway؛ لا تبدله أثناء محاولات مجهولة النتيجة دون خطة، فقد تتغير هوية replay/rate-limit. |
| `WEB_PUSH_VAPID_PRIVATE_KEY`، `WEB_PUSH_VAPID_PUBLIC_KEY`، `WEB_PUSH_SUBJECT` | Edge؛ المفتاح العام الموافق في `src/services/pushNotifications.service.ts`؛ المالك | تدوير زوج متطابق وإعادة اشتراك هاتف صاحب المحل؛ تتوقف Push إذا اختلف الزوج أو انتهى الاشتراك. |
| `order_push_webhook_secret`، `order_push_webhook_url` | Vault، المالك؛ Edge يتحقق بـ`get_push_webhook_secret` | غيّر النقل والتحقق معاً؛ URL لمشروعه الصحيح. يتعطل استدعاء Push، ولا يبرر كشف Vault أو إعادة منح قراءته. |
| `OWNER_TELEGRAM_BOT_TOKEN`، `OWNER_TELEGRAM_CHAT_ID`، `OWNER_TELEGRAM_DEVELOPER_CHAT_ID_FOR_COMPARISON` | Edge Secrets، المالك؛ قناة صاحب المحل مستقلة | توكن جديد من BotFather وتحقق test لوجهة المالك وحده؛ التوكن/المستلم الخاطئ يمنع complete ناجحاً. لا تخلط قناة المطوّر به. |
| `OWNER_TELEGRAM_DISPATCH_SECRET`؛ `owner_telegram_dispatch_secret` و`owner_telegram_dispatch_url` | الأول Edge، الآخران Vault، يديرها المالك | نفس سر النقل على الجانبين؛ أوقف المستهلك/cron أثناء تبديله ثم اختبار. `OWNER_TELEGRAM_ENABLED` و`OWNER_TELEGRAM_TEST_ENABLED` مفاتيح تفعيل وليست أسراراً. |
| `NAWASRAH_AUTOMATION_SECRET` | Edge `n8n-alert-feed` وcredential n8n القديم | يخص المستهلك القديم؛ workflow أعمال فرانكفورت يبقى مهجوراً وغير نشط. لا تفعّله بجانب Edge217. |
| `DEV_TELEGRAM_BOT_TOKEN`/`DEV_TELEGRAM_CHAT_ID`؛ `NAWASRAH_DEV_TELEGRAM_BOT_TOKEN`/`NAWASRAH_DEV_TELEGRAM_CHAT_ID` | GitHub Actions لقواعد CI، وDPAPI/جلسة watchdog المحلية؛ المطوّر بتفويض المالك | بدّل إعداد كل مصدر واختبر تنبيه مطوّر واحد؛ فشل التنبيه لا يعني أن الخدمة أو النسخ سليمة. |
| `NAWASRAH_R2_ACCESS_KEY_ID`، `NAWASRAH_R2_SECRET_ACCESS_KEY`؛ `NAWASRAH_R2_ACCOUNT_ID`، `NAWASRAH_R2_BUCKET`، `NAWASRAH_R2_JURISDICTION` | DPAPI/إعداد offsite على Windows؛ المالك في Cloudflare | المفاتيح الخاصة تُدوّر دون مسح الأرشيف أو سياسات retention/lock. اختبر Upload ثم VerifyRemote/RestoreRemote؛ انتهاء المفتاح يمنع النسخة الخارجية. |
| `NAWASRAH_BACKUP_PASSPHRASE`، `NAWASRAH_FF_PASSPHRASE` | أصل مستقل في مدير كلمات مرور + نسخة DPAPI محلية؛ المالك | فقد الأصل يفقد فك الأرشيف؛ لا تغيّر المفتاح وتُسقط القديم. DPAPI لا يُنقل لجهاز آخر. الاسترجاع الحي يحتاج أيضاً أسرار البيئة خارج الأرشيف. |
| `VITE_SENTRY_DSN_PRODUCTION`، `VITE_SENTRY_DSN_PRELAUNCH_TRIAL`، `VITE_SENTRY_DSN_STAGING` | env محلي متجاهل مستقل لكل واجهة/سياق أو Variables بناء؛ مشروع الإدارة ومشروع المتجر EU/de موجودان لدى المالك | Client Key جديد للبيئة، rebuild وCSP المطابق. `VITE_SENTRY_DSN` القديم وحده يرفض البناء؛ غياب DSN يعطل الإرسال بأمان. لا تعِد إنشاء مشروعيه ولا تعدّل ملفاته تلقائياً. [الدليل](operations/SENTRY_OWNER_AR.md). |
| `CLOUDFLARE_API_TOKEN`، `CLOUDFLARE_ACCOUNT_ID`؛ `GITHUB_TOKEN` | اعتماد Wrangler/جلسة الناشر والـwatchdog؛ GitHub token في اعتماد النظام/Actions المؤقت | أعد التفويض بأقل صلاحية؛ يتوقف النشر/قراءة النشر أو متابعة CI. لا تطبع ناتج credential helpers ولا تحفظ توكن API في تقرير. |
| `GEMINI_API_KEY`، `GEMINI_MODEL` | Edge `admin-ai-assistant`، المالك | مفتاح/نموذج صالحان وإعادة فحص؛ يتعطل المساعد فقط، ولا يصبح جوابه مصدراً للأرقام المالية. |

## 5. المراقبة وأول 15 دقيقة عند العطل

Sentry للتشخيص التقني: environment + release SHA + activeTab/نمط مسار + نوع خطأ وإطارات آمنة؛ لا رسالة خام/سلة/هاتف/مبلغ، Replay/Tracing مطفآن. غياب DSN يعني غياب الرصد، لا غياب الأعطال. `src/lib/errorMonitoring.ts` ونسخة المتجر و`monitoringPrivacy.ts` هما موضع الفحص، و`AppErrorBoundary`/`StoreErrorBoundary` واجهة التعافي. خطأ chunk قد يحتاج تحديث PWA، لكن **لا تمسح محاولات بيع مجهولة** من storage.

من داخل الإدارة «افحص» يستخدم لوحة `get_advanced_monitoring_dashboard`؛ الفحص الخادمي `run_advanced_monitoring_checks`، مع أدلة aftercare وأرصدة المخزون. تنبيهات الأعطال وCI والنسخ و400MB وkeep-alive للمطوّر فقط. تنبيهات الشغل وPush للطلب لصاحب المحل فقط. كود217 يترك `owner_telegram_dispatch_settings.enabled=false` وcron `owner-telegram-dispatch` inactive وEdge مغلقاً حتى تفعيل المالك. `run-advanced-monitoring` و`scan-core-business-alerts` و`scan-business-summaries` و`expire-stale-new-website-orders` لها حجز/تفعيل يوم القطع؛ لا تستنتج حالتها الحية من Git. راجع §5–6 من [GO_LIVE](operations/GO_LIVE_CUTOVER_AR.md) و[قواعد الأعمال](operations/FRANKFURT_OWNER_BUSINESS_ALERTS_AR.md).

1. **0–3 دقائق:** حدّد العرض/الشاشة والوقت، release SHA والبيئة وآخر تغيير؛ اطلب من صاحب المحل إيقاف المسار المتأثر وتسجيل العمليات في الدفتر. لا تنفذ بيعاً/تحصيلاً تجريبياً على بياناته.
2. **3–7 دقائق:** راجع Sentry وكود الرفض/حالة الشبكة، آخر CI، وStatus/Watchdog/آخر Backup ناجح من جلسة مفوضة. قارن هل العطل UI أم Auth/MFA أم DB أم وظيفة Edge؛ لا تجمع بيانات زبائن في logs.
3. **7–12 دقيقة:** إن انقطع الرد بعد كتابة، افحص نتيجة المحاولة بنفس المفتاح وعقد التعافي؛ لا تستخدم مفتاحاً جديداً ولا SQL تعديل يدوي. أعد الإنتاج محلياً بfixture ومسارات حقيقية؛ قارن بالسلوك قبل التغيير.
4. **12–15 دقيقة:** أعطِ المالك السبب المثبت/ما لم يثبت والخيار الأقل خطراً. إصلاح وPR وفحوص واعتماد؛ التراجع عن واجهة إلى نشر سابق يحتاج إذنه والتحقق من توافقها مع DB الحالية. لا تعكس migration تلقائياً.

خطة الاستمرارية المعتمدة: الدفتر الورقي + نسخ فرانكفورت اليومية المثبتة. سنغافورة لا تحوي بيانات المحل الحقيقية؛ لا تصلح بديلاً لاستعادة أعماله، ولا تُمس قبل «انشر». تحويلها إلى تجربة في T+2/3 **مشروط** بسلامة أول يومين وموافقة المالك. Restore/RestoreRemote الحاليان تمرين معزول، وليسا أداة استرجاع إلى مشروع حي؛ تلك مهمة لاحقة مستقلة بعد تجهيز التجريبية. [خطة الرجوع §9–11](operations/GO_LIVE_CUTOVER_AR.md)، [تشخيص الأعطال](operations/MONITORING_RUNBOOKS.md).

## 6. المزالق التي يجب تذكرها

| المطب | القاعدة العملية |
|---|---|
| يوم عمّان مقابل UTC | timestamps في النقل/DB لا تُحوّل بجمع ساعات يدوياً. استعمل `Asia/Amman` وحدود الفترة في SQL، وتحقق من منتصف الليل ونطاق تاريخ يوم واحد. بعد reset اضبط ملخص اليوم00:00 حتى يحسم المالك معنى الساعة12. |
| الفلس والتقريب | 1000 فلس = دينار؛ حدود المالية integers، والكلفة/WAC الدقيقة NUMERIC. لا تستعمل float/Number لقيمة تتجاوز safe integer، ولا تقسّم إجمالي طرد إلى كلفة مقربة ثم تعيد ضربها. اقرأ `receivingCalculations.ts` و`aftercare215Money.ts` وعقد214. |
| WAC والمرتجع | السليم يرجع بتكلفة مصدره التاريخية، لا WAC اليوم؛ snapshots القديمة لا يُعمل لها backfill. فرق تكلفة البديل عن القطعة يبقى وفق قرار المالك، والتعليق للمورد يؤجل قيمة المعيب فقط. لا خسارة مرتين عند الرفض/العكس. |
| الغلاف وalias قديم | فتش كل سلسلة النداءات؛ آخر CREATE للمدخل قديم بينما helper حديث. لا تسحب طبقة قبل معرفة replay/lineage/evidence التي تعتمد عليها. |
| ACL وservice_role | REPLACE يحتفظ بمنح قديمة. `verify-only` الحالي يقارن الدوال والجداول والمالك والإعدادات؛ لا تمنح service_role للجديد لمساواة خطأ قديم. صلّح بالملف/الأمر المحروس المعتمد، بلا استثناء عام. RLS لا يحمي TRUNCATE. |
| سقف وأرشيف وreset | أي migration جديدة ترفع الأدوات والمراجع في PR نفسه، قبل تطبيقها حياً؛ وإلا تتعطل الحماية الليلية والتصفير. لا تتجاوز الحارس أو تبدل اسم مرجع209 إلى رقم أحدث. |
| junction في Windows | `node_modules` في worktree/نسخة فحص قد يكون junction إلى تثبيت مشترك؛ افحص `LinkType`/`Target`. لا npm ci عبره أثناء اختبار آخر، ولا recursive delete/move قبل التحقق من المسار الفعلي. احذف الرابط وحده عند تنظيف نسخة مؤقتة، لا هدفه. |
| TLS وpooler وDPAPI | النسخ يحتاج PostgreSQL17 وsession pooler5432 عند الحاجة وverify-full مع CA المثبتة؛ لا تخفّض TLS أو تستعمل transaction pooler6543 لـdump. الاستثناءات المبكرة والقفل اليتيم لها CleanupLock محروس؛ لا تحذف قفلاً لعملية حية. |
| فروق بيئة الاسترجاع | 141/152 أو أي عدد جداول تاريخي ليس معياراً ثابتاً؛ manifest النسخة والمقارنة الصارمة هما المعيار. pg_cron/pg_init_privs قد يغيّران ACL التسلسلات في IMAGE؛ الحل الحالي يطابق المصدر، لا يتجاهل ACL. راجع `restore-platform.mjs` وتشخيص المقارنة المنقّح. |
| حدود Supabase | pagination خادمية لا تصفية أول صفحة؛ مهلات/حصص الخطة ووقف المجاني تحتاج مراجعة لوحة المالك وقت التشغيل. حد400MB إنذار تقني محلي، ليس ادعاء سعة الخطة. سنغافورة التجريبية يمكن أن تتوقف مجاناً؛ لا تربط preview بالإنتاج لتعويضها. |
| M01 / توظيف موظف | التقرير السنوي M01 مؤجل: قِس locally وEXPLAIN قبل أي تحسين. **قراءة الموظفين للتكلفة/WAC/الربح مؤجلة إلزامياً قبل التوظيف**؛ DTO سجل التالف المنقح لا يجعل كل SELECT آمناً. لا تعتبر الصلاحيات العامة مغلقة بلا اختبار الأدوار. |
| أرشيف الأدلة | لا تقرأ ملفات JSON الضخمة/كل migrations لفهم زر. ابدأ بالجدول والخدمة والتعريف والمساعدين، ثم افتح الدليل التفصيلي عند حاجة محددة. `source-before-*` مناظر تاريخية للاختبارات فقط؛ discovery والقياس الحاليان لا يُسقطان التغييرات. |
| تحديث PWA / cache | SHA مختلف لكل إصدار، واختبار automatic/waiting-worker في Chromium وWebKit. لا تجعل محو cache/storage العلاج الافتراضي؛ احتفظ بمحاولات idempotency غير المحسومة. |

## 7. ما لا يقرره المطوّر أو الوكيل وحده

سياسة رد المال/فرق السعر/الخصم/الذمم/توقيت إثبات الخسارة/WAC، الأدوار والمنح وMFA وكشف التكلفة، تغيير بيانات تاريخية أو سقف DB، الاتصال بالإنتاج/الأسرار، تصفير/استرجاع حي، تفعيل cron/التنبيهات، فتح previews أو النشر، كلها تحتاج قرار المالك الصريح المناسب. اعتماد PR لا يفوّض نشره. لا تُرسل رسالة أو تنبيهاً اختبارياً فعلياً دون تفويضه. راجع [OWNER_DECISIONS](agent/OWNER_DECISIONS.md) للسياسة؛ هذا الدليل خريطة صيانة وليس قراراً مالياً جديداً.

عند تعديل عملية في الجدول، حدّث صفها واختبار `tests/maintainer-guide.test.ts` في PR نفسه. الاختبار يتحقق من وجود الملفات والمستدعين وآخر تعريف SQL الفعلي، ويتتبع rename/drop ويرفض الإحالة الوهمية أو القديمة؛ **ليس بديلاً عن فحص DB/ACL/runtime** عند تغيير السلوك. قبل التسليم: checkpoint بالإجراء التالي المحدد ثم verify-handoff، والتوقف عند بوابة الاعتماد.

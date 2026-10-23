# الحزمة و — تحقق محلي بعد تعديلات الواجهة و5+

328 ملف مصدر، و148 طلب جداول ناجحاً بلا أخطاء، و534 فحص dispatch حقيقياً مع 8 رفض صلاحية متوقعة لوظائف المالك فقط. تعريفات الدوال مطابقة تماماً للدليل السابق. السقف211 بلا تغيير SQL أو RPC أو منح؛ لا اتصال بفرانكفورت. فحوص dispatch ذات قيم محايدة واختبارات rollback، وليست ادعاء نجاح كل حمولة مالية. بيانات الكتالوج المحفوظة والأقسام الأقدم أدناه سياق تاريخي بتواريخه.

---

# تحديث هوية المحل هـ —23أكتوبر2026

أُعيد التحقق الفعلي محلياً بعد تحديث الاسم والأصول:327مصدر،148استعلاماً ناجحاً،534فحصRPC مع8رفض42501 متوقعة للمالك فقط. السقف211 والـSQL والمنح لم تتغير؛هذه أدلة المصدر الحالي وليست اتصالاً بفرانكفورت. السجلات السابقة أدناه محفوظة بتاريخها.

---

# تحديث التحقق المحلي211 —23أكتوبر2026

**الحالة الحالية:**327 ملف مصدر، و148 استدعاء جداول فعلياً بلا خطأ، و534 فحص RPC؛حالات42501 الثماني متوقعة لوظائف المالك فقط. لا اتصال مستضاف.

الدليل الحالي:TABLE_ACCESS_AFTER_211.json وSERVICE_ACCESS_DIAGNOSTIC.json؛الأقسام الأقدم أدناه تاريخية بتواريخها،وليست وصفاً لفرانكفورت الآن. إعداد CSP_CONNECT_SRC وStorage وعضوية publication في المستضاف يحتاج تحقق المالك عند التحويل؛لم ينفّذه الوكيل.

---

# إضافة جرد الخدمات والإعدادات —2026-10-15

## إضافة التحقيق: RPC وStorage وRealtime والإعدادات خارج migrations

**لا تطبيق ACL ولا إعداد خدمات ولا نشر. هذا قياس محلي وقراءة ملفات محفوظة فقط؛الفجوة التشغيلية غير مغلقة.**

### أ. RPC — EXECUTE الفعلي،لا افتراض نجاح من mock

179 موضعSDK .rpc و4 موضعRESTGateway،173 اسم دالة. أسماءالأغلفةالديناميكية موثقةبالاستدعاءالذييوردها؛أيرابطغيرمحسوميفشلالجرد. ثلاثمصارفديناميكية تشملPOSV2 وإعدادالطرود،والبوابةتحوّلrpcName إلىsubmit_guest_customer_order_v2.

قاعدة208 محلية جديدة: 525 dispatch حقيقي إلىتواقيعالدوالالمستدعاة/overloads بأدوارهاالحقيقية؛2 رفض42501،119 نجاحمعrollback،404 رفض/خطأداخلجسمالدالة. has_function_privilege موثق لكلتوقيع/دور. **فحصالصلاحيةلايعنيقبولكلدورحسبقواعدالعمل**؛المالك/admin/cashier منفصلون.

حدالقياسصريح:أُرسلتقيممحليةمحايدةمُنمّطةحسبتوقيعSQL(معرفعميل/فرع/مستودعfixtureحيثيوجد،NULL/JSONفارغلغيره)،وليستجميعحمولاتالتدفّقاتالصحيحةمنواجهةالتطبيق. النصالأصليلكلاستدعاءومعاملاتهفيSERVICE_ACCESS_INVENTORY.json؛قيمةكلprobeوأثرهفيSERVICE_ACCESS_DIAGNOSTIC.json. لا نسمّي274خطأتحققنجاحاًوظيفياً ولا42501. كلنجاحوكلخطأداخلsubtransactionأُرجع؛لاأثرماليأومخزنيباقٍ. اختباراتالمساراتالمتكاملةالقائمةتبقىمطلوبة؛هذهالإضافةتثبتEXECUTE/dispatchوليسإتمامكلسيناريو.

| الدالة/مصدر الاستدعاء | الدور | EXECUTE محلي / نتائج dispatch |
|---|---|---|
| get_pos_configurable_parcel_options_v1؛src/features/pos/PosView.tsx:167 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| report_admin_runtime_incident؛src/lib/errorMonitoring.ts:33 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_push_subscription_status؛src/services/pushNotifications.service.ts:48 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| save_push_subscription؛src/services/pushNotifications.service.ts:107 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| disable_push_subscription؛src/services/pushNotifications.service.ts:145 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| cancel_customer_order_v2؛src/services/supabase/adminCustomerV2Lifecycle.ts:320 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| complete_website_order_with_settlement_v2؛src/services/supabase/adminCustomerV2Lifecycle.ts:322 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_my_erp_profile؛src/services/supabase/auth.service.ts:160 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_cash_shift_movement_page؛src/services/supabase/cashShiftMovements.service.ts:34 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
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
| get_home_dashboard؛src/services/supabase/dashboard.service.ts:128 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| preview_supplier_receipt_cancellation؛src/services/supabase/directReceiving.service.ts:23 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_supplier_receipts_page؛src/services/supabase/directReceiving.service.ts:156 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| resolve_legacy_supplier_receipt_replay_v1؛src/services/supabase/directReceiving.service.ts:265 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| create_direct_supplier_receipt_v2؛src/services/supabase/directReceiving.service.ts:375 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| record_supplier_receipt_payment؛src/services/supabase/directReceiving.service.ts:436 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| archive_supplier_receipt؛src/services/supabase/directReceiving.service.ts:467 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| cancel_supplier_receipt؛src/services/supabase/directReceiving.service.ts:500 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_document_correction_preview؛src/services/supabase/documentCorrections.service.ts:20 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| execute_document_correction_once؛src/services/supabase/documentCorrections.service.ts:60 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
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
| accept_order_for_preparation؛src/services/supabase/orders.service.ts:621 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| complete_website_order_with_payment؛src/services/supabase/orders.service.ts:655 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_order_status؛src/services/supabase/orders.service.ts:700 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_operational_orders_page؛src/services/supabase/orders.service.ts:743 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| get_operational_orders_page؛src/services/supabase/orders.service.ts:855 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| complete_website_order_with_settlement؛src/services/supabase/orders.service.ts:936 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| return_completed_website_order؛src/services/supabase/orders.service.ts:987 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_order_status؛src/services/supabase/orders.service.ts:1032 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| start_or_update_order_delivery؛src/services/supabase/orders.service.ts:1083 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_order_delivery_address؛src/services/supabase/orders.service.ts:1141 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
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
| get_receiving_purchase_context؛src/services/supabase/receivingPurchaseContext.service.ts:8 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_supplier_receipt_display_context؛src/services/supabase/receivingPurchaseContext.service.ts:15 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| save_product_category؛src/services/supabase/reference-data.service.ts:107 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_product_category_active؛src/services/supabase/reference-data.service.ts:145 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| save_product_brand؛src/services/supabase/reference-data.service.ts:240 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_product_brand_active؛src/services/supabase/reference-data.service.ts:273 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| save_product_unit؛src/services/supabase/reference-data.service.ts:380 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_product_unit_active؛src/services/supabase/reference-data.service.ts:416 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_operational_business_report؛src/services/supabase/reports.service.ts:42 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_admin_sales_aftercare_context_v1؛src/services/supabase/salesAftercare.service.ts:131 | authenticated | owner:23503؛ admin:23503؛ cashier:P0001 |
| settle_sales_replacement_v1؛src/services/supabase/salesAftercare.service.ts:166 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| settle_admin_sales_return_v1؛src/services/supabase/salesAftercare.service.ts:204 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| settle_sales_replacement_v1؛src/services/supabase/salesAftercare.service.ts:245 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| settle_admin_sales_return_v1؛src/services/supabase/salesAftercare.service.ts:255 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| get_sales_history_page؛src/services/supabase/salesHistory.service.ts:10 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_stock_alert_notifications؛src/services/supabase/stockAlerts.service.ts:72 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| mark_stock_alert_read؛src/services/supabase/stockAlerts.service.ts:95 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| mark_all_stock_alerts_read؛src/services/supabase/stockAlerts.service.ts:112 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_public_storefront_settings؛src/services/supabase/storefront-settings.service.ts:50 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| save_storefront_settings_v3؛src/services/supabase/storefront-settings.service.ts:60 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_supplier_replacements_page_v1؛src/services/supabase/supplierReplacement.service.ts:23 | authenticated | owner:P0001؛ admin:42501؛ cashier:42501 |
| get_supplier_replacement_options_v1؛src/services/supabase/supplierReplacement.service.ts:32 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| preview_supplier_replacement_v1؛src/services/supabase/supplierReplacement.service.ts:42 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| execute_supplier_replacement_v1؛src/services/supabase/supplierReplacement.service.ts:57 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_owner_warehouses_v1؛src/services/supabase/warehouses.service.ts:28 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| save_owner_warehouse_v1؛src/services/supabase/warehouses.service.ts:38 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
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
| docs/agent/OWNER_DECISIONS.md | 674 | HISTORICAL_DOCUMENTATION |
| docs/operations/FRANKFURT_OWNER_BUILD_AR.md | 100 | HISTORICAL_DOCUMENTATION |
| docs/operations/STAGING_FRANKFURT_AR.md | 247 | HISTORICAL_DOCUMENTATION |
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
| tests/frankfurt-public-config.test.ts | 18 | TEST_CONTRACT |
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

لاconnectionstringأومفتاحخدمةبعيدفيهذهالأوامر. الأمرالأخيرقراءةملفاتمحفوظةفقط؛لاقيملأسرارفيالمخرجات. قياسEXECUTE على208 ومصدرالاستدعاءاتالحالي؛150 لاتغيرEXECUTE بدليل مقارنةالكتالوجالكاملة،و139تغيّر جسمenqueueغيرالمستدعىمنالواجهةمعإبقاءACL.139سُلّمتمنفصلة3a3893b،وقياسهاالحقيقيأثبتصفرمرجعقديمفيتعريفاتpublic بعدالتطبيقالمحلي؛لايعنيهذاأنهاتطبقتعلىفرانكفورت.

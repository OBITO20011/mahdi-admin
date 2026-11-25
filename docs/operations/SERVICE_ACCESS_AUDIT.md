# وصول الخدمات — دليل 226 محلي

## إضافة التحقيق: RPC وStorage وRealtime والإعدادات خارج migrations

**لا تطبيق ACL ولا إعداد خدمات ولا نشر. هذا قياس محلي وقراءة ملفات محفوظة فقط؛الفجوة التشغيلية غير مغلقة.**

### أ. RPC — EXECUTE الفعلي،لا افتراض نجاح من mock

249 موضعSDK .rpc و5 موضعRESTGateway،249 اسم دالة. أسماءالأغلفةالديناميكية موثقةبالاستدعاءالذييوردها؛أيرابطغيرمحسوميفشلالجرد. ثلاثمصارفديناميكية تشملPOSV2 وإعدادالطرود،والبوابةتحوّلrpcName إلىsubmit_guest_customer_order_v2.

قاعدة226 محلية جديدة: 768 dispatch حقيقي إلىتواقيعالدوالالمستدعاة/overloads بأدوارهاالحقيقية؛18 رفض42501،165 نجاحمعrollback،585 رفض/خطأداخلجسمالدالة. has_function_privilege موثق لكلتوقيع/دور. **فحصالصلاحيةلايعنيقبولكلدورحسبقواعدالعمل**؛المالك/admin/cashier منفصلون.

حدالقياسصريح:أُرسلتقيممحليةمحايدةمُنمّطةحسبتوقيعSQL(معرفعميل/فرع/مستودعfixtureحيثيوجد،NULL/JSONفارغلغيره)،وليستجميعحمولاتالتدفّقاتالصحيحةمنواجهةالتطبيق. النصالأصليلكلاستدعاءومعاملاتهفيSERVICE_ACCESS_INVENTORY.json؛قيمةكلprobeوأثرهفيSERVICE_ACCESS_DIAGNOSTIC.json. لا نسمّي274خطأتحققنجاحاًوظيفياً ولا42501. كلنجاحوكلخطأداخلsubtransactionأُرجع؛لاأثرماليأومخزنيباقٍ. اختباراتالمساراتالمتكاملةالقائمةتبقىمطلوبة؛هذهالإضافةتثبتEXECUTE/dispatchوليسإتمامكلسيناريو.

| الدالة/مصدر الاستدعاء | الدور | EXECUTE محلي / نتائج dispatch |
|---|---|---|
| lite1_pos_options2؛src/features/pos/PosView.tsx:193 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_pos_parcel_options225؛src/features/pos/PosView.tsx:194 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_pos_configurable_parcel_options_v1؛src/features/pos/PosView.tsx:196 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| report_admin_runtime_incident؛src/lib/errorMonitoring.ts:33 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_push_subscription_status؛src/services/pushNotifications.service.ts:48 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| save_push_subscription؛src/services/pushNotifications.service.ts:107 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| disable_push_subscription؛src/services/pushNotifications.service.ts:145 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| lite1_cancel_guest2؛src/services/supabase/adminCustomerV2Lifecycle.ts:326 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_complete2؛src/services/supabase/adminCustomerV2Lifecycle.ts:327 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| cancel_customer_order_v2؛src/services/supabase/adminCustomerV2Lifecycle.ts:331 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| complete_website_order_with_settlement_v2؛src/services/supabase/adminCustomerV2Lifecycle.ts:333 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_preview_return2؛src/services/supabase/aftercare215.service.ts:14 | authenticated | owner:22023؛ admin:P0001؛ cashier:P0001 |
| preview_admin_sales_return_v2؛src/services/supabase/aftercare215.service.ts:15 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| preview_inspected_sales_replacement_v2؛src/services/supabase/aftercare215.service.ts:16 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| preview_sales_exchange_v1؛src/services/supabase/aftercare215.service.ts:17 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_settle_return2؛src/services/supabase/aftercare215Rpc.ts:26 | authenticated | owner:22023؛ admin:P0001؛ cashier:P0001 |
| settle_admin_sales_return_v2؛src/services/supabase/aftercare215Rpc.ts:28 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| settle_inspected_sales_replacement_v2؛src/services/supabase/aftercare215Rpc.ts:29 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| settle_sales_exchange_v1؛src/services/supabase/aftercare215Rpc.ts:30 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
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
| lite1_crm_page2؛src/services/supabase/crm.service.ts:162 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| get_crm_customer_page؛src/services/supabase/crm.service.ts:162 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| get_crm_customer_detail_page؛src/services/supabase/crm.service.ts:214 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| save_customer؛src/services/supabase/crm.service.ts:367 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_customer_status؛src/services/supabase/crm.service.ts:410 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| add_customer_address؛src/services/supabase/crm.service.ts:459 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_customer_outstanding_orders_page؛src/services/supabase/customerAccounts.service.ts:49 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| record_customer_order_payment_once؛src/services/supabase/customerAccounts.service.ts:135 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_debt_aging2؛src/services/supabase/customerDebtAging.service.ts:9 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_customer_debt_aging؛src/services/supabase/customerDebtAging.service.ts:9 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| lite1_statement_dispatch2؛src/services/supabase/customerStatement.service.ts:17 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_customer_statement؛src/services/supabase/customerStatement.service.ts:17 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_damage_history_page_v1؛src/services/supabase/damageHistory.service.ts:37 | authenticated | owner:22023؛ admin:42501؛ cashier:42501 |
| get_damage_ledger_page_v2؛src/services/supabase/damageLedger215.service.ts:6 | authenticated | owner:P0001؛ admin:42501؛ cashier:42501 |
| get_home_dashboard؛src/services/supabase/dashboard.service.ts:128 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| preview_supplier_receipt_cancellation؛src/services/supabase/directReceiving.service.ts:24 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_supplier_receipts_page؛src/services/supabase/directReceiving.service.ts:161 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| resolve_legacy_supplier_receipt_replay_v1؛src/services/supabase/directReceiving.service.ts:283 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| create_direct_supplier_receipt_v2؛src/services/supabase/directReceiving.service.ts:393 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| record_supplier_receipt_payment؛src/services/supabase/directReceiving.service.ts:454 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| archive_supplier_receipt؛src/services/supabase/directReceiving.service.ts:485 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| cancel_supplier_receipt؛src/services/supabase/directReceiving.service.ts:518 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_document_correction_preview؛src/services/supabase/documentCorrections.service.ts:20 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| execute_document_correction_once؛src/services/supabase/documentCorrections.service.ts:60 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| reverse_cash_shift_with_operations؛src/services/supabase/expenses-shifts.service.ts:281 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_expense_shift_center؛src/services/supabase/expenses-shifts.service.ts:487 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_cash_shift_archive_page؛src/services/supabase/expenses-shifts.service.ts:515 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| open_cash_shift؛src/services/supabase/expenses-shifts.service.ts:554 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| create_operational_expense؛src/services/supabase/expenses-shifts.service.ts:572 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| reverse_operational_expense؛src/services/supabase/expenses-shifts.service.ts:597 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| close_cash_shift؛src/services/supabase/expenses-shifts.service.ts:619 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| cancel_empty_cash_shift؛src/services/supabase/expenses-shifts.service.ts:639 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
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
| lite3_counters224؛src/services/supabase/inventory224.service.ts:10 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_product_availability2؛src/services/supabase/manualAvailability.service.ts:45 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_set_available2؛src/services/supabase/manualAvailability.service.ts:49 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_aftercare_integrity_status؛src/services/supabase/monitoring.service.ts:6 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_advanced_monitoring_dashboard؛src/services/supabase/monitoring.service.ts:28 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| get_product_pricing_context225؛src/services/supabase/onPrices225.service.ts:17 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_product_pricing_context225؛src/services/supabase/onPrices225.service.ts:77 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_receipt_pricing_warnings225؛src/services/supabase/onPrices225.service.ts:131 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| preview_go_live_cheques_v1؛src/services/supabase/openingCheques.service.ts:18 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| record_go_live_cheques_v1؛src/services/supabase/openingCheques.service.ts:23 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_go_live_cheques_v1؛src/services/supabase/openingCheques.service.ts:28 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| lite1_epoch_catalog2؛src/services/supabase/openingEpoch.service.ts:27 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_preview_epoch2؛src/services/supabase/openingEpoch.service.ts:29 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_activate_epoch2؛src/services/supabase/openingEpoch.service.ts:47 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_operating_mode؛src/services/supabase/operatingMode.service.ts:26 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| lite1_set_mode2؛src/services/supabase/operatingModeCommand.ts:16 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| lite1_operational_orders_page2؛src/services/supabase/operatingOrdersPage.ts:5 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| get_operational_orders_page؛src/services/supabase/operatingOrdersPage.ts:5 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| lite1_shift_movements2؛src/services/supabase/operatingShiftMovements.ts:12 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| get_cash_shift_movement_page؛src/services/supabase/operatingShiftMovements.ts:12 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| lite1_shift_closing2؛src/services/supabase/operatingShiftReport.ts:10 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_cash_shift_closing_report؛src/services/supabase/operatingShiftReport.ts:10 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_preview_shift_reversal2؛src/services/supabase/operatingShiftReversal.ts:11 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| preview_cash_shift_full_reversal؛src/services/supabase/operatingShiftReversal.ts:11 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite3_counter_context223؛src/services/supabase/optionalQuantity.service.ts:95 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite3_set_counter223؛src/services/supabase/optionalQuantity.service.ts:96 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite3_pos_quantity_check223؛src/services/supabase/optionalQuantity.service.ts:97 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite3_low_counters223؛src/services/supabase/optionalQuantity.service.ts:98 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_order_details2؛src/services/supabase/orders.service.ts:609 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_order_exchange_details_v1؛src/services/supabase/orders.service.ts:630 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| accept_order_for_preparation؛src/services/supabase/orders.service.ts:652 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| complete_website_order_with_payment؛src/services/supabase/orders.service.ts:686 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_order_status؛src/services/supabase/orders.service.ts:732 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| complete_website_order_with_settlement؛src/services/supabase/orders.service.ts:971 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| return_completed_website_order؛src/services/supabase/orders.service.ts:1022 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_order_status؛src/services/supabase/orders.service.ts:1070 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| start_or_update_order_delivery؛src/services/supabase/orders.service.ts:1122 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_order_delivery_address؛src/services/supabase/orders.service.ts:1180 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
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
| lite1_pos2؛src/services/supabase/posV2.service.ts:272 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_pos_sale_with_initial_payment_v1؛src/services/supabase/posV2.service.ts:272 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_pos_sale_v2؛src/services/supabase/posV2.service.ts:272 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_pos2_attempt_state؛src/services/supabase/posV2Recovery.ts:93 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_pos_sale_attempt_state_v1؛src/services/supabase/posV2Recovery.ts:94 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_cancel_pos2_attempt؛src/services/supabase/posV2Recovery.ts:102 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| cancel_uncommitted_pos_sale_attempt_v1؛src/services/supabase/posV2Recovery.ts:103 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_pos2؛src/services/supabase/posV2Recovery.ts:152 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_pos_sale_with_initial_payment_v1؛src/services/supabase/posV2Recovery.ts:152 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_pos_sale_v2؛src/services/supabase/posV2Recovery.ts:152 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_product_primary_image؛src/services/supabase/product-images.service.ts:147 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_product_cost_state_v1؛src/services/supabase/productCost.service.ts:51 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| correct_product_cost_v1؛src/services/supabase/productCost.service.ts:70 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_product_flavor_v2؛src/services/supabase/productFamilyBarcodes.service.ts:23 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| get_admin_product_page؛src/services/supabase/products.service.ts:403 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| search_pos_products225؛src/services/supabase/products.service.ts:454 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| search_admin_products؛src/services/supabase/products.service.ts:461 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| search_admin_products؛src/services/supabase/products.service.ts:511 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| create_product_with_opening_stock_v7؛src/services/supabase/products.service.ts:708 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_product_with_opening_stock_v5؛src/services/supabase/products.service.ts:708 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_product_with_opening_stock_v6؛src/services/supabase/products.service.ts:708 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_product_flavor_v1؛src/services/supabase/products.service.ts:779 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_product_family_with_flavors_v4؛src/services/supabase/products.service.ts:890 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_product_family_with_flavors_v2؛src/services/supabase/products.service.ts:890 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_product_family_with_flavors_v3؛src/services/supabase/products.service.ts:890 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_product_flavor_v2؛src/services/supabase/products.service.ts:968 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| reorder_product_flavors_v1؛src/services/supabase/products.service.ts:1003 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_product_master_v7؛src/services/supabase/products.service.ts:1092 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| update_product_master_v6؛src/services/supabase/products.service.ts:1092 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_product_master_v7؛src/services/supabase/productWorkbook.service.ts:58 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| update_product_master_v6؛src/services/supabase/productWorkbook.service.ts:58 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| finalize_import_flavor_identity226؛src/services/supabase/productWorkbook.service.ts:61 | authenticated | owner:22023؛ admin:P0001؛ cashier:P0001 |
| create_product_family_with_flavors_v4؛src/services/supabase/productWorkbook.service.ts:102 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_product_family_with_flavors_v3؛src/services/supabase/productWorkbook.service.ts:103 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_product_family_with_flavors_v2؛src/services/supabase/productWorkbook.service.ts:103 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_product_with_opening_stock_v7؛src/services/supabase/productWorkbook.service.ts:107 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| create_product_with_opening_stock_v6؛src/services/supabase/productWorkbook.service.ts:108 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| import_go_live_products_v1؛src/services/supabase/productWorkbook.service.ts:114 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
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
| lite1_reporting_report2؛src/services/supabase/reportingDispatch.service.ts:22 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_operational_business_report؛src/services/supabase/reportingDispatch.service.ts:23 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| lite1_reporting_home2؛src/services/supabase/reportingDispatch.service.ts:24 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_home_dashboard؛src/services/supabase/reportingDispatch.service.ts:25 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_operational_business_report؛src/services/supabase/reports.service.ts:42 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_admin_sales_aftercare_context_v1؛src/services/supabase/salesAftercare.service.ts:138 | authenticated | owner:23503؛ admin:23503؛ cashier:P0001 |
| lite1_aftercare_context2؛src/services/supabase/salesAftercare.service.ts:138 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| settle_sales_replacement_v1؛src/services/supabase/salesAftercare.service.ts:173 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| settle_admin_sales_return_v1؛src/services/supabase/salesAftercare.service.ts:211 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| settle_sales_replacement_v1؛src/services/supabase/salesAftercare.service.ts:248 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| settle_admin_sales_return_v1؛src/services/supabase/salesAftercare.service.ts:258 | authenticated | owner:22023؛ admin:22023؛ cashier:P0001 |
| get_sales_history_page؛src/services/supabase/salesHistory.service.ts:10 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_delivery2؛src/services/supabase/salesOnlyDelivery.ts:34 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_home2؛src/services/supabase/salesOnlyHome.service.ts:31 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| lite1_transition2؛src/services/supabase/salesOnlyOrderTransition.ts:12 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| lite1_business_report2؛src/services/supabase/salesOnlyReport.service.ts:43 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| get_stock_alert_notifications؛src/services/supabase/stockAlerts.service.ts:72 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| mark_stock_alert_read؛src/services/supabase/stockAlerts.service.ts:95 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| mark_all_stock_alerts_read؛src/services/supabase/stockAlerts.service.ts:112 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_public_storefront_settings؛src/services/supabase/storefront-settings.service.ts:50 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| save_storefront_settings_v3؛src/services/supabase/storefront-settings.service.ts:60 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| preview_supplier_replacement_credit_v1؛src/services/supabase/supplierCredit215.service.ts:6 | authenticated | owner:P0001؛ admin:42501؛ cashier:42501 |
| get_supplier_replacement_credits_v1؛src/services/supabase/supplierCredit215.service.ts:10 | authenticated | owner:success/rollback؛ admin:42501؛ cashier:42501 |
| get_supplier_replacements_page_v1؛src/services/supabase/supplierReplacement.service.ts:30 | authenticated | owner:P0001؛ admin:42501؛ cashier:42501 |
| get_supplier_replacement_options_v1؛src/services/supabase/supplierReplacement.service.ts:39 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| preview_supplier_replacement_v1؛src/services/supabase/supplierReplacement.service.ts:51 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| settle_supplier_replacement_credit_v1؛src/services/supabase/supplierReplacement.service.ts:71 | authenticated | owner:P0001؛ admin:42501؛ cashier:42501 |
| execute_aftercare_supplier_v1؛src/services/supabase/supplierReplacement.service.ts:72 | authenticated | owner:P0001؛ admin:42501؛ cashier:42501 |
| execute_supplier_replacement_v1؛src/services/supabase/supplierReplacement.service.ts:73 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_aftercare_damage_candidates_v1؛src/services/supabase/supplierReplacement.service.ts:95 | authenticated | owner:success/rollback؛ admin:42501؛ cashier:42501 |
| preview_aftercare_supplier_v1؛src/services/supabase/supplierReplacement.service.ts:102 | authenticated | owner:P0001؛ admin:42501؛ cashier:42501 |
| get_owner_warehouses_v1؛src/services/supabase/warehouses.service.ts:28 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| save_owner_warehouse_v1؛src/services/supabase/warehouses.service.ts:38 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| get_public_storefront_offers؛customer-web/src/services/offers.service.ts:55 | anon | anon:success/rollback |
| lite1_preview_guest2؛customer-web/src/services/operatingCatalog.ts:10 | anon | anon:P0001 |
| preview_guest_promotion_v2؛customer-web/src/services/operatingCatalog.ts:11 | anon | anon:P0001 |
| public_storefront_catalog_page225؛customer-web/src/services/operatingCatalog.ts:12 | anon | anon:success/rollback |
| lite1_catalog_page2؛customer-web/src/services/operatingCatalog.ts:13 | anon | anon:success/rollback |
| get_public_storefront_catalog_page؛customer-web/src/services/operatingCatalog.ts:14 | anon | anon:success/rollback |
| get_public_parcel_options225؛customer-web/src/services/operatingCatalog.ts:15 | anon | anon:P0001 |
| lite1_parcel_options2؛customer-web/src/services/operatingCatalog.ts:16 | anon | anon:P0001 |
| get_public_configurable_parcel_options؛customer-web/src/services/operatingCatalog.ts:17 | anon | anon:P0001 |
| public_storefront_merchandising225؛customer-web/src/services/operatingCatalog.ts:18 | anon | anon:success/rollback |
| lite1_merchandising2؛customer-web/src/services/operatingCatalog.ts:19 | anon | anon:success/rollback |
| get_public_storefront_merchandising؛customer-web/src/services/operatingCatalog.ts:20 | anon | anon:success/rollback |
| preview_guest_promotion؛customer-web/src/services/orders.service.ts:153 | anon | anon:P0001 |
| track_guest_order؛customer-web/src/services/orders.service.ts:263 | anon | anon:success/rollback |
| track_guest_order_by_token؛customer-web/src/services/orders.service.ts:278 | anon | anon:success/rollback |
| lite1_public_pos_receipt2؛customer-web/src/services/receipts.service.ts:36 | anon | anon:success/rollback |
| get_public_pos_receipt؛customer-web/src/services/receipts.service.ts:36 | anon | anon:success/rollback |
| lite1_operating_mode؛customer-web/src/services/receipts.service.ts:45 | anon | anon:success/rollback |
| get_public_storefront_settings؛customer-web/src/services/storefront-settings.service.ts:70 | anon | anon:success/rollback |
| authorize_admin_ai_assistant_request؛supabase/functions/admin-ai-assistant/index.ts:1017 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_admin_ai_inventory_snapshot؛supabase/functions/admin-ai-assistant/index.ts:1074 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_home_dashboard؛supabase/functions/admin-ai-assistant/index.ts:1123 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| get_admin_ai_monthly_report؛supabase/functions/admin-ai-assistant/index.ts:1165 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:P0001 |
| has_erp_role؛supabase/functions/manage-staff-users/index.ts:147 | authenticated | owner:success/rollback؛ admin:success/rollback؛ cashier:success/rollback |
| get_erp_staff_accounts؛supabase/functions/manage-staff-users/index.ts:158 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| get_erp_staff_account_audit_logs؛supabase/functions/manage-staff-users/index.ts:211 | authenticated | owner:success/rollback؛ admin:P0001؛ cashier:P0001 |
| create_erp_staff_account_record؛supabase/functions/manage-staff-users/index.ts:250 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| update_erp_staff_account_record؛supabase/functions/manage-staff-users/index.ts:279 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| set_erp_staff_account_active؛supabase/functions/manage-staff-users/index.ts:313 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| record_erp_staff_password_reset؛supabase/functions/manage-staff-users/index.ts:340 | authenticated | owner:P0001؛ admin:P0001؛ cashier:P0001 |
| claim_automation_deliveries؛supabase/functions/n8n-alert-feed/index.ts:85 | service_role | service_role:P0001 |
| complete_automation_delivery؛supabase/functions/n8n-alert-feed/index.ts:102 | service_role | service_role:P0001 |
| claim_owner_telegram_deliveries_v1؛supabase/functions/owner-telegram-dispatch/handler.ts:64 | service_role | service_role:P0001 |
| owner_telegram_dispatch_lease_valid_v1؛supabase/functions/owner-telegram-dispatch/handler.ts:64 | service_role | service_role:success/rollback |
| complete_owner_telegram_delivery_v1؛supabase/functions/owner-telegram-dispatch/handler.ts:64 | service_role | service_role:P0001 |
| release_owner_telegram_dispatch_v1؛supabase/functions/owner-telegram-dispatch/handler.ts:64 | service_role | service_role:success/rollback |
| get_push_webhook_secret؛supabase/functions/send-order-push/index.ts:58 | service_role | service_role:success/rollback |
| get_active_order_push_targets؛supabase/functions/send-order-push/index.ts:129 | service_role | service_role:success/rollback |
| authorize_guest_order_gateway؛supabase/functions/submit-guest-order/index.ts:261 | service_role | service_role:P0001 |
| lite1_operating_mode؛supabase/functions/submit-guest-order/index.ts:297 | service_role | service_role:success/rollback |
| submit_guest_customer_order_v2؛supabase/functions/submit-guest-order/index.ts:334 | service_role | service_role:P0001 |
| lite1_guest2؛supabase/functions/submit-guest-order/index.ts:334 | service_role | service_role:P0001 |
| finalize_guest_order_gateway؛supabase/functions/submit-guest-order/index.ts:345 | service_role | service_role:P0001 |
| finalize_guest_order_gateway؛supabase/functions/submit-guest-order/index.ts:362 | service_role | service_role:P0001 |

#### الدوال السبع في خطة المواءمة القديمة

الخطةتسحبمنحاًصريحة،ولايعنيذلكدائماًزوالEXECUTEالفعلي:PUBLICقديبقيموجوداً. الاختباراستخدمhas_function_privilegeلاقراءةحروفACLفقط. لا تنفيذلخطةالمواءمة.

| الدالة | هل يستدعيها التطبيق؟ | ما يُسحب صراحةً / الفعلي فيالمرجع |
|---|---|---|
| authorize_admin_ai_assistant_request() | supabase/functions/admin-ai-assistant/index.ts:1017 (authenticated) | anon:EXECUTE؛الفعلي:anon=false, authenticated=true, service_role=false |
| enforce_customer_for_debt_order() | لا؛trigger function وليستRPCواجهة | anon:EXECUTE, authenticated:EXECUTE؛الفعلي:anon=true, authenticated=true, service_role=true |
| enforce_product_flavor_inheritance() | لا؛trigger function وليستRPCواجهة | anon:EXECUTE, authenticated:EXECUTE؛الفعلي:anon=false, authenticated=false, service_role=false |
| guard_cash_shift_closing_report_snapshot() | لا؛trigger function وليستRPCواجهة | anon:EXECUTE, authenticated:EXECUTE؛الفعلي:anon=true, authenticated=true, service_role=true |
| set_website_new_order_reservation_expiry() | لا؛trigger function وليستRPCواجهة | anon:EXECUTE, authenticated:EXECUTE؛الفعلي:anon=true, authenticated=true, service_role=true |
| sync_order_payment_state() | لا؛trigger function وليستRPCواجهة | anon:EXECUTE, authenticated:EXECUTE؛الفعلي:anon=true, authenticated=true, service_role=true |
| sync_product_flavor_commercial_settings() | لا؛trigger function وليستRPCواجهة | anon:EXECUTE, authenticated:EXECUTE؛الفعلي:anon=false, authenticated=false, service_role=false |

authorize_admin_ai_assistant_request تستدعيهاEdge بالمستخدمauthenticated (JWTالمستخدم،لاservice_role). منحةauthenticatedموجودةفيالمرجع؛السحبالقديميخصanonغيرمستخدمهنا. الدوالالستالأخرىtrigger-only:لااستدعاءRPCمنالتطبيق،والمنحالصريحةالزائدةتكرّرPUBLICEXECUTEالقائم. لايجوزتجربتهامباشرةبـSELECTوادعاءأنهاعمليةتريغرحقيقية؛إطلاقهامنوظائفهاداخلDDL/DMLهوالمسارالصحيح.

### ب. Storage — حاوية صور المنتجات وسياسات المستخدم

| المصدر | bucket / العملية | الدور |
|---|---|---|
| src/services/supabase/product-images.service.ts:77 | product-images / getPublicUrl | محلي لبناءURL؛لاطلبAPI |
| src/services/supabase/product-images.service.ts:82 | product-images / upload | authenticated |
| src/services/supabase/product-images.service.ts:105 | product-images / upload | authenticated |
| src/services/supabase/product-images.service.ts:113 | product-images / getPublicUrl | محلي لبناءURL؛لاطلبAPI |
| src/services/supabase/product-images.service.ts:118 | product-images / remove | authenticated |
| src/services/supabase/product-images.service.ts:166 | product-images / remove | authenticated |
| src/services/supabase/product-images.service.ts:183 | product-images / remove | authenticated |

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

بحثGitلجميعالملفاتالمتتبعة+غيرالمتجاهلةخارجmigrationsالتاريخية(دونملفاتenv/القيمالسرية):35 ملفاً،القائمةأدناه. ملفاSERVICE_ACCESSالمولدانوكودأداةالبحثنفسهاواختبارهايُستثنيانمنالعدلتجنّبالتغذيةالراجعة؛المخرجاتتحفظأرقامأسطروتصنيفاًفقط. النصالعامللفرانكفورتلايُغيّرمنهذاالبحث.

| الملف | الأسطر | التصنيف/الأثر |
|---|---|---|
| automation/n8n/workflows/nawasrah-alerts.json | 32, 89, 175, 228 | EXTERNAL_CONSUMER |
| docs/agent/HANDOFF_HISTORY.md | 445 | HISTORICAL_DOCUMENTATION |
| docs/agent/OWNER_DECISIONS.md | 808 | HISTORICAL_DOCUMENTATION |
| docs/operations/ENVIRONMENT_SEPARATION_AR.md | 14 | HISTORICAL_DOCUMENTATION |
| docs/operations/FRANKFURT_OWNER_BUILD_AR.md | 100 | HISTORICAL_DOCUMENTATION |
| docs/operations/GO_LIVE_CURRENT_STATE_EVIDENCE.json | 188, 198 | HISTORICAL_DOCUMENTATION |
| docs/operations/GO_LIVE_CUTOVER_OFF_ARCHIVE_AR.md | 174 | HISTORICAL_DOCUMENTATION |
| docs/operations/PREHANDOVER_AUDIT_AR.md | 63 | HISTORICAL_DOCUMENTATION |
| docs/operations/STAGING_FRANKFURT_AR.md | 249 | HISTORICAL_DOCUMENTATION |
| scripts/backup/README.md | 28 | PRESERVE_OLD_BACKUP_LINK |
| scripts/backup/backup-public-config.mjs | 3, 11 | PRESERVE_OLD_BACKUP_LINK |
| scripts/backup/create-backup.mjs | 430 | PRESERVE_OLD_BACKUP_LINK |
| scripts/backup/preflight.mjs | 14 | PRESERVE_OLD_BACKUP_LINK |
| scripts/backup/verify-backup.mjs | 82 | PRESERVE_OLD_BACKUP_LINK |
| scripts/environments/environment.mjs | 7 | BUILD_GUARD_OR_AUDIT |
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
| tests/dual-backup.test.ts | 14, 19 | TEST_CONTRACT |
| tests/fixtures/enqueue-order-push-before139.sql | 23 | TEST_CONTRACT |
| tests/frankfurt-owner-alerts.test.ts | 34 | TEST_CONTRACT |
| tests/frankfurt-preparation.test.ts | 23, 55 | TEST_CONTRACT |
| tests/frankfurt-public-config.test.ts | 22 | TEST_CONTRACT |
| tests/frankfurt-reference150.test.ts | 76 | TEST_CONTRACT |
| tests/frankfurt-staging-csp.test.ts | 7 | TEST_CONTRACT |
| tests/order-push-url139.test.ts | 15 | TEST_CONTRACT |
| tests/phase3-harness-stability.test.ts | 88 | TEST_CONTRACT |
| tests/prelaunch-trial.test.ts | 16 | TEST_CONTRACT |

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
| owner-telegram-dispatch | OWNER_TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_CHAT_ID, OWNER_TELEGRAM_DEVELOPER_CHAT_ID_FOR_COMPARISON, OWNER_TELEGRAM_DISPATCH_SECRET, OWNER_TELEGRAM_ENABLED, OWNER_TELEGRAM_TEST_ENABLED, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL |
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

لاconnectionstringأومفتاحخدمةبعيدفيهذهالأوامر. الأمرالأخيرقراءةملفاتمحفوظةفقط؛لاقيملأسرارفيالمخرجات. قياسEXECUTE على226 ومصدرالاستدعاءاتالحالي؛150 لاتغيرEXECUTE بدليل مقارنةالكتالوجالكاملة،و139تغيّر جسمenqueueغيرالمستدعىمنالواجهةمعإبقاءACL.139سُلّمتمنفصلة3a3893b،وقياسهاالحقيقيأثبتصفرمرجعقديمفيتعريفاتpublic بعدالتطبيقالمحلي؛لايعنيهذاأنهاتطبقتعلىفرانكفورت.

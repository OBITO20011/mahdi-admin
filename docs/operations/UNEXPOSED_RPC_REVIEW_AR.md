# جرد المسارات بلا استدعاء مباشر — مرجع212

24 أكتوبر2026، main d72f709. جرد قاعدة PostgreSQL17 محلية فعلية بعد174migration ومصدر الإدارة والمتجر وEdge عبر محلل TypeScript. لا تعديل منح ولا اتصال مستضاف.

556دالة؛220توقيعاً متاحاً لأحد anon/authenticated/service_role، بما فيها PUBLIC الضمنية. منها41 بلا RPC مباشر، و6 منها trigger.119علاقة تشمل الجداول والعروض والتسلسلات؛67 ذات منحة عميل وبلا وصول جدول مباشر ظاهر في المصدر.

الدليل الكامل: [الجرد](pre-handover-evidence/exposure.json) و[التبعيات](pre-handover-evidence/exposure-dependencies.json). يتضمن المالك وACL وRLS والسياسات وتواقيع overloads وبصمات المصدر. المطابقة النصية للدعوات الداخلية مرشح مراجعة وليست callgraph كاملة. غياب استدعاء مباشر لا يجيز حذفاً أو سحب منحة.

## الدوال41

آخر عمود: عدد مراجع SQL / السياسات / المحفزات المرشحة.

| التوقيع | أدوار التنفيذ | التصنيف | SQL/سياسة/محفز |
|---|---|---|---|
| build_business_summary(text,date,date,timestamp with time zone) | service_role | اعتماد SQL مرشح | 1/0/0 |
| cancel_purchase_receipt_v2(uuid,text) | authenticated | اعتماد SQL مرشح | 1/0/0 |
| create_customer_order(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text) | authenticated | اعتماد SQL مرشح | 1/0/0 |
| create_direct_supplier_receipt(uuid,uuid,uuid,text,date,timestamp with time zone,bigint,bigint,bigint,bigint,text,text,text,text,uuid,jsonb) | authenticated | مراجعة مستقلة | 0/0/0 |
| create_product_family_with_flavors_v1(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb) | authenticated | اعتماد SQL مرشح | 1/0/0 |
| create_product_with_opening_stock_v2(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,integer,integer,uuid,integer,text) | authenticated | اعتماد SQL مرشح | 1/0/0 |
| create_product_with_opening_stock_v3(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,integer,integer,uuid,integer,text,text) | authenticated | اعتماد SQL مرشح | 1/0/0 |
| create_product_with_opening_stock_v4(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text) | authenticated | اعتماد SQL مرشح | 3/0/0 |
| create_product_with_opening_stock(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,text) | authenticated | اعتماد SQL مرشح | 1/0/0 |
| create_purchase_order_v2(uuid,uuid,uuid,timestamp with time zone,bigint,bigint,text,text,text,jsonb) | authenticated | مراجعة مستقلة | 0/0/0 |
| enforce_customer_for_debt_order() | anon, authenticated, service_role | محفّز | 0/0/1 |
| enforce_product_flavor_inheritance() | anon, authenticated, service_role | محفّز | 0/0/1 |
| enqueue_business_summary(text,date,date,timestamp with time zone,timestamp with time zone) | service_role | اعتماد SQL مرشح | 1/0/0 |
| get_admin_product_listing() | authenticated | مراجعة مستقلة | 0/0/0 |
| get_advanced_monitoring_status() | service_role | مراجعة مستقلة | 0/0/0 |
| get_business_summary_monitoring_status() | service_role | مراجعة مستقلة | 0/0/0 |
| get_cash_shift_display_summary(uuid) | authenticated | اعتماد SQL مرشح | 4/0/0 |
| get_cash_shift_summary(uuid) | authenticated | اعتماد SQL مرشح | 10/0/0 |
| get_configurable_parcel_feature_state() | anon, authenticated, service_role | اعتماد SQL مرشح | 6/0/0 |
| get_dashboard_analytics() | authenticated | مراجعة مستقلة | 0/0/0 |
| get_public_product_catalog(integer,integer,uuid,text) | anon, authenticated | اعتماد SQL مرشح | 1/0/0 |
| get_public_storefront_catalog(integer,integer,uuid,text) | anon, authenticated | مراجعة مستقلة | 0/0/0 |
| guard_cash_shift_closing_report_snapshot() | anon, authenticated, service_role | محفّز | 0/0/1 |
| has_erp_role(text[]) | authenticated | اعتماد SQL مرشح | 10/0/0 |
| is_active_erp_staff() | authenticated | اعتماد SQL مرشح | 1/52/0 |
| is_authenticated() | authenticated | مراجعة مستقلة | 0/0/0 |
| is_mfa_policy_satisfied() | authenticated | اعتماد SQL مرشح | 3/0/0 |
| receive_inventory(uuid,uuid,integer,text,uuid,text) | authenticated | مراجعة مستقلة | 0/0/0 |
| receive_purchase_order(uuid,uuid,text,text,jsonb) | authenticated | مراجعة مستقلة | 0/0/0 |
| record_customer_order_payment(uuid,bigint,text,text,text) | authenticated | اعتماد SQL مرشح | 3/0/0 |
| reverse_customer_order_payment(uuid,text) | authenticated | اعتماد SQL مرشح | 2/0/0 |
| reverse_pos_sale(uuid,text,text) | authenticated | اعتماد SQL مرشح | 2/0/0 |
| reverse_supplier_payment(uuid,text,text) | authenticated | اعتماد SQL مرشح | 2/0/0 |
| scan_business_summaries(timestamp with time zone) | service_role | مراجعة مستقلة | 0/0/0 |
| set_product_primary_image(uuid,text) | authenticated | اعتماد SQL مرشح | 3/0/0 |
| set_website_new_order_reservation_expiry() | anon, authenticated, service_role | محفّز | 0/0/1 |
| settle_sales_return_v1(uuid,text,jsonb,text,text,text,text) | authenticated | اعتماد SQL مرشح | 1/0/0 |
| submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text) | service_role | مراجعة مستقلة | 0/0/0 |
| sync_order_payment_state() | anon, authenticated, service_role | محفّز | 0/0/1 |
| sync_product_flavor_commercial_settings() | anon, authenticated, service_role | محفّز | 0/0/1 |
| update_product_master_v4(uuid,timestamp with time zone,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text) | authenticated | اعتماد SQL مرشح | 1/0/0 |

## العلاقات67

المنحة لا تتجاوز RLS تلقائياً. يجب التفريق بين SELECT وDML والتسلسلات.

| العلاقة | النوع PostgreSQL | RLS | المنح |
|---|---|---|---|
| admin_ai_assistant_usage_events | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| admin_ai_assistant_usage_events_id_seq | S | لا | anon:UPDATE؛ authenticated:UPDATE؛ service_role:UPDATE |
| advanced_monitoring_checks | r | نعم | service_role:INSERT؛ service_role:SELECT؛ service_role:UPDATE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| advanced_monitoring_metrics | r | نعم | service_role:INSERT؛ service_role:SELECT؛ service_role:UPDATE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| advanced_monitoring_runtime_incidents | r | نعم | service_role:INSERT؛ service_role:SELECT؛ service_role:UPDATE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| advanced_monitoring_settings | r | نعم | service_role:SELECT؛ service_role:UPDATE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| audit_logs | r | نعم | anon:TRUNCATE؛ anon:REFERENCES؛ anon:TRIGGER؛ anon:MAINTAIN؛ authenticated:TRUNCATE؛ authenticated:REFERENCES؛ authenticated:TRIGGER؛ authenticated:MAINTAIN؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| automation_event_deliveries | r | نعم | service_role:INSERT؛ service_role:SELECT؛ service_role:UPDATE؛ service_role:DELETE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| automation_events | r | نعم | service_role:INSERT؛ service_role:SELECT؛ service_role:UPDATE؛ service_role:DELETE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| business_alert_incidents | r | نعم | service_role:INSERT؛ service_role:SELECT؛ service_role:UPDATE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| business_alert_settings | r | نعم | service_role:SELECT؛ service_role:UPDATE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| business_summary_runs | r | نعم | service_role:INSERT؛ service_role:SELECT؛ service_role:UPDATE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| cash_shift_number_seq | S | لا | anon:UPDATE؛ authenticated:UPDATE؛ service_role:UPDATE |
| cash_shift_reversal_operations | r | نعم | service_role:INSERT؛ service_role:SELECT؛ service_role:UPDATE؛ service_role:DELETE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| cash_shift_reversals | r | نعم | service_role:INSERT؛ service_role:SELECT؛ service_role:UPDATE؛ service_role:DELETE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| cash_shifts | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| configurable_parcel_feature_settings | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN؛ authenticated:SELECT |
| customer_collection_opening_allocations | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| customer_collection_operation_number_seq | S | لا | service_role:UPDATE |
| customer_collection_operations | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| customer_collection_order_payments | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| customer_opening_balance_number_seq | S | لا | service_role:UPDATE |
| customer_opening_balances | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| customer_payment_number_seq | S | لا | anon:UPDATE؛ authenticated:UPDATE؛ service_role:UPDATE |
| customer_payments | r | نعم | authenticated:SELECT؛ authenticated:TRUNCATE؛ authenticated:REFERENCES؛ authenticated:TRIGGER؛ authenticated:MAINTAIN؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| go_live_import_batches | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| go_live_setup_state | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| guest_order_gateway_requests | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| inventory_damage_events | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| inventory_movements | r | نعم | authenticated:SELECT؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| inventory_opening_items | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| inventory_opening_session_number_seq | S | لا | service_role:UPDATE |
| inventory_opening_sessions | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| operational_expense_number_seq | S | لا | anon:UPDATE؛ authenticated:UPDATE؛ service_role:UPDATE |
| operational_expenses | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| order_inventory_reservations | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN؛ authenticated:SELECT |
| owner_cash_withdrawal_number_seq | S | لا | service_role:UPDATE |
| owner_cash_withdrawal_reversals | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| owner_cash_withdrawals | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| phase2_receipt_wac_snapshots | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN؛ authenticated:SELECT |
| phase42_return_inventory_effects | r | نعم | authenticated:SELECT |
| pos_sale_number_seq | S | لا | anon:UPDATE؛ authenticated:UPDATE؛ service_role:UPDATE |
| pos_sale_reversals | r | نعم | service_role:INSERT؛ service_role:SELECT؛ service_role:UPDATE؛ service_role:DELETE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| product_cost_corrections | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| product_parcel_allowed_components | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN؛ authenticated:SELECT |
| product_parcel_configurations | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN؛ authenticated:SELECT |
| promotion_codes | r | نعم | anon:TRUNCATE؛ anon:REFERENCES؛ anon:TRIGGER؛ anon:MAINTAIN؛ authenticated:TRUNCATE؛ authenticated:REFERENCES؛ authenticated:TRIGGER؛ authenticated:MAINTAIN؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| promotion_redemptions | r | نعم | anon:TRUNCATE؛ anon:REFERENCES؛ anon:TRIGGER؛ anon:MAINTAIN؛ authenticated:TRUNCATE؛ authenticated:REFERENCES؛ authenticated:TRIGGER؛ authenticated:MAINTAIN؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| purchase_order_item_components | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN؛ authenticated:SELECT |
| purchase_receipt_commercial_lines | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN؛ authenticated:SELECT |
| sales_aftercare_consumptions | r | نعم | authenticated:SELECT |
| sales_replacement_events | r | نعم | authenticated:SELECT |
| sales_replacement_items | r | نعم | authenticated:SELECT |
| sales_return_component_inspections | r | نعم | authenticated:SELECT |
| sales_return_events | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN؛ authenticated:SELECT |
| sales_return_items | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN؛ authenticated:SELECT |
| sales_return_number_seq | S | لا | anon:UPDATE؛ authenticated:UPDATE؛ service_role:UPDATE |
| stock_alert_reads | r | نعم | anon:TRUNCATE؛ anon:REFERENCES؛ anon:TRIGGER؛ anon:MAINTAIN؛ authenticated:TRUNCATE؛ authenticated:REFERENCES؛ authenticated:TRIGGER؛ authenticated:MAINTAIN؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| stock_alerts | r | نعم | anon:TRUNCATE؛ anon:REFERENCES؛ anon:TRIGGER؛ anon:MAINTAIN؛ authenticated:TRUNCATE؛ authenticated:REFERENCES؛ authenticated:TRIGGER؛ authenticated:MAINTAIN؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| storefront_settings | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| supplier_financial_invoice_identities | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN؛ authenticated:SELECT |
| supplier_opening_balance_number_seq | S | لا | service_role:UPDATE |
| supplier_opening_balances | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| supplier_opening_payments | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| supplier_payment_reversals | r | نعم | service_role:INSERT؛ service_role:SELECT؛ service_role:UPDATE؛ service_role:DELETE؛ service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN |
| supplier_receipt_commercial_lines | r | نعم | service_role:TRUNCATE؛ service_role:REFERENCES؛ service_role:TRIGGER؛ service_role:MAINTAIN؛ authenticated:SELECT |
| supplier_receipt_seq | S | لا | anon:UPDATE؛ authenticated:UPDATE؛ service_role:UPDATE |

## إثبات المسارات القديمة في212

- create_customer_order: صنف طرد فقط عبر المسار القديم رفض PARCEL209_LEGACY_PARCEL_EVIDENCE_REQUIRED، دون تغيير أي جدول أو تسلسل.
- submit_guest_customer_order بدورservice_role: الرفض نفسه وبلا أثر.
- create_pos_sale V1: رفض PACKAGE_D_POS_V2_REQUIRED وبلا أثر؛ لا منحة عميل فعالة في الجرد الحالي.
- POSv2: رفض بيع الوحدة لصنف طرد فقط عند كميات1و10و20؛ مضاعفات حجم الطرد لا تتجاوز نوع السطر.
- aftercare_supplier_links وsupplier_replacement_inventory_effects: رفض القراءة المباشرة لأدوارanon/authenticated/service_role.
- **receive_inventory: خلل مثبت H03.** يقبل زيادة5وحدات بمرجع شراء غير موجود، بلا سند أو ذمة جديدة؛ تكرار الاستدعاء يضيف5أخرى. ثبت للأدوارowner/admin/manager/warehouse_keeper، ورفض بقية الأدوار الستة. الدليل [legacy-receive.json](pre-handover-evidence/legacy-receive.json)، دون إصلاح.

الدليل [adversarial.json](pre-handover-evidence/adversarial.json). بقية التواقيع جُردت مع تبعياتها المرشحة؛ لا ندعي أن كل توقيع خضع لمحاولة هجومية مستقلة بمدخلات أعمال صحيحة. لا سحب جماعي مقترح؛ المسارات القديمة مثل receive_inventory وreceive_purchase_order وكتّاب المنتجات تحتاج مراجعة عقد ومستهلك داخلي منفصلة قبل أي تغيير صلاحيات.

// Phase 5 evidence is reconstructed from this immutable, owner-approved
// Phase-4 closure tree.  Completeness must never be inferred from the audited
// working copy itself: a damaged copy can otherwise redefine "complete".
export const TRUSTED_SOURCE_BASELINE_COMMIT = 'c1632904782f3da770c9880423a0ea5fa506b8be';

// Source reconstruction and activation policy are deliberately separate.
// An absent source-proven owner is evidence uncertainty, never permission to
// assume that the live owner is safe or already equals the activation target.
export const phase5SecurityDefinerOwnerPolicy = Object.freeze({
  targetOwner: 'postgres',
  targetOwnerBasis: 'REPOSITORY_COMPATIBILITY_POLICY',
  activationCatalogVerificationRequired: true,
  preConvergenceOwnerEvaluation: 'REQUIRED_FAIL_CLOSED',
  ownerConvergenceDisposition: 'KEEP_IF_POSTGRES_ELSE_CONVERGE_ONLY_IF_EXACT_TRANSITION_APPROVED_OTHERWISE_ABORT',
  ownerConvergencePhase: 'ACTIVATION',
  activationOwnerConvergence: 'REQUIRED_IF_CURRENT_OWNER_DIFFERS_AND_TRANSITION_IS_APPROVED',
  activationOwnerTransitionPolicy: 'FAIL_CLOSED',
  finalOwnerRequired: 'postgres',
  finalOwnerUnknownAllowed: false,
  exactSignatureAssertionRequired: true,
  searchPathAssertionRequired: true,
  schemaTrustAssertionRequired: true,
  aclAssertionRequired: true,
  securityModeAssertionRequired: true,
  activationExecutorAuthorityVerificationRequired: true,
  slice1DependencyAllowed: false,
  rollbackDisposition: 'ROLLBACK_BEFORE_COMMIT_ELSE_PRESERVE_SAFE_TARGET_AND_FORWARD_REPAIR',
});

export const authorityAFunctionNames = new Set([
  'adjust_inventory_stock',
  'apply_inventory_opening_setup',
  'archive_supplier_receipt',
  'cancel_customer_order_v2',
  'cancel_empty_cash_shift',
  'cancel_purchase_order',
  'cancel_purchase_receipt_v2',
  'cancel_supplier_receipt',
  'close_cash_shift',
  'complete_website_order_with_settlement_v2',
  'create_direct_supplier_receipt_v2',
  'create_operational_expense',
  'create_pos_sale_v2',
  'create_product_family_with_flavors_v1',
  'create_product_flavor_v1',
  'create_product_with_opening_stock_v4',
  'create_purchase_order_v2',
  'delete_draft_purchase_order',
  'get_or_create_pos_receipt_token',
  'open_cash_shift',
  'receive_inventory',
  'receive_purchase_order_v2',
  'record_customer_order_payment_once',
  'record_supplier_payment',
  'record_supplier_receipt_payment',
  'reorder_product_flavors_v1',
  'report_admin_runtime_incident',
  'reverse_cash_shift_with_operations',
  'reverse_operational_expense',
  'reverse_pos_sale',
  'reverse_supplier_payment',
  'settle_admin_sales_return_v1',
  'settle_sales_replacement_v1',
  'settle_sales_return_v1',
  'submit_guest_customer_order_v2',
  'transfer_inventory_between_warehouses',
  'update_product_flavor_v1',
  'update_product_master_v3',
  'update_purchase_order',
  'update_purchase_order_status',
]);

export const authorityCFunctionNames = new Set([
  'accept_order_for_preparation',
  'complete_website_order_with_settlement',
  'create_customer_order',
  'create_direct_supplier_receipt',
  'create_pos_sale',
  'create_product_with_opening_stock',
  'create_product_with_opening_stock_v2',
  'create_product_with_opening_stock_v3',
  'create_purchase_order',
  'receive_purchase_order',
  'return_completed_website_order',
  'start_or_update_order_delivery',
  'submit_guest_customer_order',
  'update_order_status',
  'update_product_master',
  'update_product_master_v2',
]);

export const authorityDFunctionNames = new Set([
  'enqueue_business_summary',
  'expire_stale_new_website_orders',
  'record_external_monitoring_snapshot',
  'run_advanced_monitoring_checks',
  'scan_business_summaries',
  'scan_core_business_alerts',
]);

export const authorityEFunctionNames = new Set([
  'complete_website_order_with_payment',
  'record_customer_order_payment',
  'reverse_customer_order_payment',
]);

// These trigger functions are intentionally outside the Phase 5 mutation
// authority inventory. They maintain timestamps, notifications, delivery-map
// shape, or push transport rather than inventory/financial/accounting truth.
export const excludedTriggerFunctionNames = new Map([
  ['update_updated_at_column', 'generic timestamp maintenance only'],
  ['notify_new_website_order_push', 'notification transport only'],
  ['enqueue_order_push_webhook', 'push-webhook transport only'],
  ['sync_stock_alert_from_balance', 'stock notification projection only'],
  ['sync_stock_alert_from_product', 'stock notification projection only'],
  ['sync_order_delivery_tracking_timestamps', 'delivery-tracking timestamp projection outside Phase 5 accounting authority'],
  ['validate_customer_address_map_url', 'delivery-map validation outside Phase 5 accounting authority'],
]);

// Mutable relations whose correctness feeds Phase 5 payment/reversal,
// inventory/WAC, Return/Replacement, shift, supplier, or reporting contracts.
export const phase5MutableTables = new Set([
  'advanced_monitoring_checks',
  'advanced_monitoring_metrics',
  'automation_events',
  'business_alert_incidents',
  'business_summary_runs',
  'cash_shift_closing_reports',
  'cash_shift_reversal_operations',
  'cash_shift_reversals',
  'cash_shifts',
  'customer_payments',
  'inventory_balances',
  'inventory_movements',
  'operational_expenses',
  'order_inventory_reservations',
  'order_items',
  'order_parcel_components',
  'order_parcel_instances',
  'orders',
  'phase43_replacement_inventory_effects',
  'phase43_replacement_issuance_guards',
  'phase43_replacement_settlement_evidence',
  'pos_receipt_tokens',
  'pos_sale_reversals',
  'purchase_order_items',
  'purchase_orders',
  'purchase_receipt_items',
  'purchase_receipts',
  'sales_replacement_events',
  'sales_replacement_items',
  'sales_return_component_inspections',
  'sales_return_events',
  'sales_return_items',
  'sales_returns',
  'supplier_invoice_identities',
  'supplier_payment_reversals',
  'supplier_payments',
  'supplier_receipt_items',
  'supplier_receipt_payments',
  'supplier_receipts',
]);

// A final X verdict is fail-closed for every mutation: any table written by
// an out-of-scope function must be named here with a reviewed reason. A new
// mutation relation therefore cannot silently inherit an X classification.
export const outOfScopeMutationTableReasons = new Map([
  ['admin_ai_assistant_usage_events', 'AI assistant usage accounting outside commerce authority'],
  ['audit_logs', 'append-only audit transport when no Phase-5 business relation is also mutated'],
  ['automation_event_deliveries', 'automation delivery transport outside commerce authority'],
  ['brands', 'catalog master-data administration'],
  ['categories', 'catalog master-data administration'],
  ['configurable_parcel_feature_settings', 'catalog parcel configuration'],
  ['customer_addresses', 'customer address profile maintenance'],
  ['customers', 'customer profile maintenance'],
  ['guest_order_gateway_requests', 'gateway request envelope outside settlement authority'],
  ['product_images', 'catalog image administration'],
  ['product_parcel_configurations', 'catalog parcel configuration'],
  ['profiles', 'identity profile maintenance'],
  ['promotion_codes', 'promotion administration outside Phase-5 settlement writers'],
  ['push_subscriptions', 'notification transport'],
  ['stock_alert_reads', 'notification read projection'],
  ['stock_alerts', 'notification projection'],
  ['storefront_settings', 'storefront configuration'],
  ['suppliers', 'supplier master-data administration'],
  ['units', 'catalog unit administration'],
  ['user_roles', 'identity authorization administration'],
]);

export const mediumFindings = [
  {
    id: 'MEDIUM A',
    title: 'Payment replay request/result identity',
    implementationStatus: 'OPEN',
    designRemediation: 'DEFINED',
  },
  {
    id: 'MEDIUM B',
    title: 'Alternate non-idempotent payment writer',
    implementationStatus: 'OPEN',
    designRemediation: 'DEFINED',
  },
  {
    id: 'MEDIUM C',
    title: 'Modern Return / Shift / Report source mismatch',
    implementationStatus: 'OPEN',
    designRemediation: 'DEFINED',
  },
  {
    id: 'MEDIUM D',
    title: 'Source-proven current lock-order inversion',
    implementationStatus: 'OPEN',
    designRemediation: 'DEFINED',
  },
];

// Source-reviewed effects of migrations that replace existing function bodies
// through pg_get_functiondef + EXECUTE. Empty arrays mean the patch changes an
// expression/guard but introduces no new repository function call.
export const generatedPatchCallNamesBySignature = new Map([
  ['public._get_cash_shift_closing_report_v1(uuid)', ['phase35_report_package_count_internal']],
  ['public._get_operational_business_report_v1(uuid,date,date)', ['phase35_report_base_unit_count_internal', 'phase35_report_package_count_internal']],
  ['public.get_admin_inventory_product_page(int,int,text,uuid,uuid,uuid,text)', []],
  ['public.get_admin_product_page(int,int,text,uuid,text,text)', []],
  ['public.get_home_dashboard()', []],
  ['public.get_operational_business_report(uuid,date,date)', ['phase35_report_package_count_internal']],
  ['public.record_supplier_payment(uuid,uuid,bigint,text,text,timestamptz,text,text)', ['phase2_lock_payment_shift_internal']],
  ['public.record_supplier_receipt_payment(uuid,bigint,text,text,text,text)', ['phase2_lock_payment_shift_internal']],
  ['public.submit_guest_customer_order_core(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text)', []],
]);

export function authorityClassFor(functionName) {
  if (authorityAFunctionNames.has(functionName)) return 'A';
  if (authorityCFunctionNames.has(functionName)) return 'C';
  if (authorityDFunctionNames.has(functionName)) return 'D';
  if (authorityEFunctionNames.has(functionName)) return 'E';
  return 'B';
}

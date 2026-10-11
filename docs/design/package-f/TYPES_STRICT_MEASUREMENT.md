# Strict TypeScript measurement — 2026-10-12

Measurement only after owner-approved React19 type remediation, baseline 7361d5cbc87ffdfe40bcee59a6bc8a8369b1c7af plus this working diff. React/ReactDOM 19.2.8; @types/react and @types/react-dom 19.3.0; TypeScript 5.8.3.

`node scripts/testing/measure-types-strict.mjs` overrides strict=true **in memory only**. It creates a compiler program from the existing root tsconfig; it does not write config or source. Ordinary typecheck passes; strict is NOT enabled. Existing exclude customer-web and supabase/functions remains unchanged, so this is an Admin/root-project measurement, not a separate customer/Edge audit.

## Result

70 diagnostics in 41 files: source 21, e2e 17, tests 32. No strict diagnostic was fixed under this task.

| File | Diagnostics |
|---|---:|
| e2e/admin-aftercare-recovery.spec.ts | 1 |
| e2e/customer-checkout-isolated.spec.ts | 1 |
| e2e/customer-presentational-characterization.spec.ts | 1 |
| e2e/package-f-administration-harness.tsx | 1 |
| e2e/package-f-auth-assistant-harness.tsx | 1 |
| e2e/package-f-cash-harness.tsx | 1 |
| e2e/package-f-customers-harness.tsx | 1 |
| e2e/package-f-financial-harness.tsx | 1 |
| e2e/package-f-inventory-harness.tsx | 1 |
| e2e/package-f-more-harness.tsx | 2 |
| e2e/package-f-pos-harness.tsx | 2 |
| e2e/package-f-products-harness.tsx | 1 |
| e2e/package-f-purchasing-harness.tsx | 1 |
| e2e/phase6-package-b-harness.tsx | 1 |
| e2e/phase6-package-c-harness.tsx | 1 |
| src/features/crm/CustomerDetailView.tsx | 1 |
| src/features/directReceiving/DirectReceivingView.tsx | 1 |
| src/features/pos/PosView.tsx | 1 |
| src/features/products/ProductFormModal.tsx | 2 |
| src/features/purchases/CreatePurchaseOrderModal.tsx | 1 |
| src/services/supabase/adminAssistant.service.ts | 1 |
| src/services/supabase/auth.service.ts | 1 |
| src/services/supabase/crm.service.ts | 1 |
| src/services/supabase/dashboard.service.ts | 2 |
| src/services/supabase/directReceiving.service.ts | 1 |
| src/services/supabase/orders.service.ts | 1 |
| src/services/supabase/posV2.service.ts | 1 |
| src/services/supabase/purchases.service.ts | 1 |
| src/services/supabase/salesAftercare.service.ts | 4 |
| src/services/supabase/stockAlerts.service.ts | 1 |
| src/stores/useAppStore.ts | 1 |
| tests/database-runtime-suite.ts | 1 |
| tests/developer-monitoring.test.ts | 3 |
| tests/guest-order-security-gateway.test.ts | 4 |
| tests/isolated-db-port-guard.test.ts | 10 |
| tests/isolated-vite-cache.test.ts | 5 |
| tests/offsite-backup.test.ts | 4 |
| tests/package-f-home.test.ts | 2 |
| tests/phase3-harness-stability.test.ts | 1 |
| tests/phase36-isolated-seo-build.test.ts | 1 |
| tests/phase6-bc-dialog-safety.test.ts | 1 |

## Source triage — candidates, not claimed confirmed production defects

- CustomerDetailView:91: narrowing result.customer is lost inside the state callback. The success guard exists outside it; examine snapshot/narrowing when strict is authorized.
- DirectReceivingView:219: supplierName is optional in the type, but is inserted into Set<string>; verify completeness of old receipt metadata. Display context, no financial mutation here.
- PosView:660: optional baseQuantity is summed without a fallback; a malformed/old cart item could display NaN. Current cart constructors supply the field; this measurement does not establish a live failing sale.
- ProductFormModal:673: result.message is not present on every success-result type; the existing success fallback handles an absent message. Line1055: File|null versus File|undefined at image input; verify clear-image path under strict.
- CreatePurchaseOrderModal:388: update-result type has no purchaseOrderId while create-result does; existing poToEdit.id fallback supplies the update id. No required dialog prop or monetary type mismatch found by this diagnostic.
- auth.service:184: email is optional in the SDK user type but toLocaleLowerCase is called. Potential runtime throw if a returned user lacks email; needs a separate authorized test/decision, not fixed here.
- useAppStore:1573: partial notification settings spread may not satisfy required booleans. Verify stored defaults/migration before a strict change.
- Nullable Supabase references across 9 services (13 diagnostics): outer configuration guards exist, but narrowing is lost in asynchronous closures. Verify actual guards/SDK lifetime before choosing a strict annotation or behavior fix.
- e2e harness env optional values, mock/helper property inference, nullable test values and callback annotations account for the remaining diagnostics. They are not production mutation findings.

No conclusion that all runtime bugs are absent is implied. Any strict enablement/remediation requires a separate owner decision; no auth, money, RPC, permissions, migrations, or configuration were changed for this measurement.

## Exact diagnostics (reproducible)

- e2e/admin-aftercare-recovery.spec.ts:187 TS7006: Parameter 'sent' implicitly has an 'any' type.
- e2e/customer-checkout-isolated.spec.ts:679 TS2345: Argument of type 'string | null' is not assignable to parameter of type 'string'.   Type 'null' is not assignable to type 'string'.
- e2e/customer-presentational-characterization.spec.ts:221 TS2339: Property 'turnstileToken' does not exist on type 'never'.
- e2e/package-f-administration-harness.tsx:21 TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string | URL'.   Type 'undefined' is not assignable to type 'string | URL'.
- e2e/package-f-auth-assistant-harness.tsx:18 TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string | URL'.   Type 'undefined' is not assignable to type 'string | URL'.
- e2e/package-f-cash-harness.tsx:20 TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string | URL'.   Type 'undefined' is not assignable to type 'string | URL'.
- e2e/package-f-customers-harness.tsx:20 TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string | URL'.   Type 'undefined' is not assignable to type 'string | URL'.
- e2e/package-f-financial-harness.tsx:20 TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string | URL'.   Type 'undefined' is not assignable to type 'string | URL'.
- e2e/package-f-inventory-harness.tsx:21 TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string | URL'.   Type 'undefined' is not assignable to type 'string | URL'.
- e2e/package-f-more-harness.tsx:21 TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string | URL'.   Type 'undefined' is not assignable to type 'string | URL'.
- e2e/package-f-more-harness.tsx:49 TS18047: 'supabase' is possibly 'null'.
- e2e/package-f-pos-harness.tsx:22 TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string | URL'.   Type 'undefined' is not assignable to type 'string | URL'.
- e2e/package-f-pos-harness.tsx:35 TS18047: 'supabase' is possibly 'null'.
- e2e/package-f-products-harness.tsx:24 TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string | URL'.   Type 'undefined' is not assignable to type 'string | URL'.
- e2e/package-f-purchasing-harness.tsx:28 TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string | URL'.   Type 'undefined' is not assignable to type 'string | URL'.
- e2e/phase6-package-b-harness.tsx:16 TS18047: 'supabase' is possibly 'null'.
- e2e/phase6-package-c-harness.tsx:28 TS18047: 'supabase' is possibly 'null'.
- src/features/crm/CustomerDetailView.tsx:91 TS2345: Argument of type '(current: CrmCustomer | null) => CrmCustomer | { orderHistory: CrmCustomerOrderSummary[]; id?: string | undefined; fullName?: string | undefined; ... 23 more ...; orderHistoryHasMore?: boolean | undefined; } | null' is not assignable to parameter of type 'SetStateAction<CrmCustomer | null>'.   Type '(current: CrmCustomer | null) => CrmCustomer | { orderHistory: CrmCustomerOrderSummary[]; id?: string | undefined; fullName?: string | undefined; ... 23 more ...; orderHistoryHasMore?: boolean | undefined; } | null' is not assignable to type '(prevState: CrmCustomer | null) => CrmCustomer | null'.     Type 'CrmCustomer | { orderHistory: CrmCustomerOrderSummary[]; id?: string | undefined; fullName?: string | undefined; phone?: string | undefined; ... 22 more ...; orderHistoryHasMore?: boolean | undefined; } | null' is not assignable to type 'CrmCustomer | null'.       Type '{ orderHistory: CrmCustomerOrderSummary[]; id?: string | undefined; fullName?: string | undefined; phone?: string | undefined; email?: string | undefined; ... 21 more ...; orderHistoryHasMore?: boolean; }' is not assignable to type 'CrmCustomer'.         Types of property 'id' are incompatible.           Type 'string | undefined' is not assignable to type 'string'.             Type 'undefined' is not assignable to type 'string'.
- src/features/directReceiving/DirectReceivingView.tsx:219 TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.   Type 'undefined' is not assignable to type 'string'.
- src/features/pos/PosView.tsx:660 TS18048: 'item.baseQuantity' is possibly 'undefined'.
- src/features/products/ProductFormModal.tsx:673 TS2339: Property 'message' does not exist on type '{ success: boolean; productId?: string | undefined; error?: string | undefined; errorDetails?: { code?: string | undefined; message: string; details?: string | undefined; hint?: string | undefined; status?: string | ... 1 more ... | undefined; } | undefined; }'.
- src/features/products/ProductFormModal.tsx:1055 TS2345: Argument of type 'File | null' is not assignable to parameter of type 'File | undefined'.   Type 'null' is not assignable to type 'File | undefined'.
- src/features/purchases/CreatePurchaseOrderModal.tsx:388 TS2339: Property 'purchaseOrderId' does not exist on type '{ success: boolean; message?: string | undefined; error?: string | undefined; }'.
- src/services/supabase/adminAssistant.service.ts:85 TS18047: 'supabase' is possibly 'null'.
- src/services/supabase/auth.service.ts:184 TS18048: 'authUpdateData.user.email' is possibly 'undefined'.
- src/services/supabase/crm.service.ts:538 TS18047: 'supabase' is possibly 'null'.
- src/services/supabase/dashboard.service.ts:116 TS18047: 'supabase' is possibly 'null'.
- src/services/supabase/dashboard.service.ts:242 TS18047: 'supabase' is possibly 'null'.
- src/services/supabase/directReceiving.service.ts:681 TS18047: 'supabase' is possibly 'null'.
- src/services/supabase/orders.service.ts:1244 TS18047: 'supabase' is possibly 'null'.
- src/services/supabase/posV2.service.ts:219 TS18047: 'supabase' is possibly 'null'.
- src/services/supabase/purchases.service.ts:1159 TS18047: 'supabase' is possibly 'null'.
- src/services/supabase/salesAftercare.service.ts:165 TS18047: 'supabase' is possibly 'null'.
- src/services/supabase/salesAftercare.service.ts:202 TS18047: 'supabase' is possibly 'null'.
- src/services/supabase/salesAftercare.service.ts:242 TS18047: 'supabase' is possibly 'null'.
- src/services/supabase/salesAftercare.service.ts:252 TS18047: 'supabase' is possibly 'null'.
- src/services/supabase/stockAlerts.service.ts:146 TS18047: 'supabase' is possibly 'null'.
- src/stores/useAppStore.ts:1573 TS2322: Type '{ newOrders?: boolean | undefined; stockAlerts?: boolean | undefined; expiryAlerts?: boolean | undefined; debtAlerts?: boolean | undefined; emailAlerts?: boolean; pushAlerts?: boolean; smsAlerts?: boolean; soundAlerts?: boolean; }' is not assignable to type '{ newOrders: boolean; stockAlerts: boolean; expiryAlerts: boolean; debtAlerts: boolean; emailAlerts?: boolean | undefined; pushAlerts?: boolean | undefined; smsAlerts?: boolean | undefined; soundAlerts?: boolean | undefined; }'.   Types of property 'newOrders' are incompatible.     Type 'boolean | undefined' is not assignable to type 'boolean'.       Type 'undefined' is not assignable to type 'boolean'.
- tests/database-runtime-suite.ts:851 TS7022: 'matches' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
- tests/developer-monitoring.test.ts:55 TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{}'.   No index signature with a parameter of type 'string' was found on type '{}'.
- tests/developer-monitoring.test.ts:82 TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{}'.   No index signature with a parameter of type 'string' was found on type '{}'.
- tests/developer-monitoring.test.ts:88 TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{}'.   No index signature with a parameter of type 'string' was found on type '{}'.
- tests/guest-order-security-gateway.test.ts:356 TS2339: Property 'p_lines' does not exist on type 'never'.
- tests/guest-order-security-gateway.test.ts:357 TS2339: Property 'p_guest_phone_hash' does not exist on type 'never'.
- tests/guest-order-security-gateway.test.ts:358 TS2339: Property 'p_guest_session_hash' does not exist on type 'never'.
- tests/guest-order-security-gateway.test.ts:359 TS2339: Property 'p_expected_total_in_minor_units' does not exist on type 'never'.
- tests/isolated-db-port-guard.test.ts:44 TS18048: 'range.first' is possibly 'undefined'.
- tests/isolated-db-port-guard.test.ts:44 TS18048: 'range.last' is possibly 'undefined'.
- tests/isolated-db-port-guard.test.ts:65 TS7006: Parameter 'port' implicitly has an 'any' type.
- tests/isolated-db-port-guard.test.ts:124 TS2339: Property 'docker' does not exist on type '{ port: any; }'.
- tests/isolated-db-port-guard.test.ts:124 TS2339: Property 'ss' does not exist on type '{ port: any; }'.
- tests/isolated-db-port-guard.test.ts:134 TS2339: Property 'ss' does not exist on type '{ port: any; }'.
- tests/isolated-db-port-guard.test.ts:134 TS2339: Property 'ss' does not exist on type '{ port: any; }'.
- tests/isolated-db-port-guard.test.ts:135 TS2339: Property 'ss' does not exist on type '{ port: any; }'.
- tests/isolated-db-port-guard.test.ts:135 TS2339: Property 'ss' does not exist on type '{ port: any; }'.
- tests/isolated-db-port-guard.test.ts:136 TS2339: Property 'ephemeralPortRange' does not exist on type '{ port: any; }'.
- tests/isolated-vite-cache.test.ts:60 TS7034: Variable 'b' implicitly has type 'any' in some locations where its type cannot be determined.
- tests/isolated-vite-cache.test.ts:69 TS18048: 'a.server.environments.client.depsOptimizer' is possibly 'undefined'.
- tests/isolated-vite-cache.test.ts:70 TS7005: Variable 'b' implicitly has an 'any' type.
- tests/isolated-vite-cache.test.ts:72 TS7022: 'responses' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
- tests/isolated-vite-cache.test.ts:74 TS7022: 'response' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
- tests/offsite-backup.test.ts:152 TS7031: Binding element 'kind' implicitly has an 'any' type.
- tests/offsite-backup.test.ts:153 TS7031: Binding element 'kind' implicitly has an 'any' type.
- tests/offsite-backup.test.ts:154 TS7031: Binding element 'kind' implicitly has an 'any' type.
- tests/offsite-backup.test.ts:156 TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{}'.   No index signature with a parameter of type 'string' was found on type '{}'.
- tests/package-f-home.test.ts:29 TS2345: Argument of type 'null' is not assignable to parameter of type 'Shift | undefined'.
- tests/package-f-home.test.ts:36 TS2345: Argument of type 'null' is not assignable to parameter of type 'Shift | undefined'.
- tests/phase3-harness-stability.test.ts:197 TS2345: Argument of type 'undefined' is not assignable to parameter of type 'AssertPredicate'.
- tests/phase36-isolated-seo-build.test.ts:14 TS2783: 'NAWASRAH_SEO_AUDIT_API_URL' is specified more than once, so this usage will be overwritten.
- tests/phase6-bc-dialog-safety.test.ts:51 TS7022: 'cleanup' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.

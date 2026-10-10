# Customers / receivables — candidate,2026-10-10

## Current approved follow-up (visual review still required)

137 delivered in4a8f395c2afd6847c233cb7852cfa60d69144dce:quality38032453378
all19/19,secrets38032453376 PASS;official delivery verified. Local quality was
not rerun on owner-approved unchanged staged code/HEAD;only official checkpoint
was synchronized. CRM_FILTERS_137.md records the accepted836.295ms overdue
p95 monitoring constraint;no further SQL/performance change.

Only Customers UI follow-up:four new chips forward approved p_status values
has_debt/overdue/over_limit/wholesale through the SAME existing reader. All5old
filters and search/sort/paging remain;no loaded-page financial filtering/counts.
Types share the exact9-value contract;no service/store/RPC/migration/role edits.

Five visual corrections:full-screen phone payment has an opaque viewport-bottom
footer (12px+safe-area),shared StickyActionBar inside it,and120px+safe-area content
padding;desktop payment unchanged. All existing amounts use MoneyText and order
dates use formatUiDate. Arabic customer/day count helpers follow the existing
count-wording pattern;technical subtitle removed. Add-customer text is nowrap.
Four row actions are44px icons in one row with complete accessible names/titles;
contact/block/delete callbacks and confirmations unchanged.

Permanent AST compares all12 existing business calls/load-financial handlers
against the original accepted baseline,and all33action/value/modal bindings
against4a8f395;both PASS. No onChange/payment/validation exception added.
Static/AST/helpers6/6,TypeScript and strict affected ESLint PASS.

Test contracts explicitly updated (not loosened):old absent-financial-chip
expectation becomes exact9labels/values. Existing API/required-reference/busy/
unavailable/axe/containment checks stay. New live-adapter proof shows each filter
with17server results,8-row pages and disjoint page1/page2 identities,then exact
search/sort/reset payloads;no added RPC names. Harness applies the approved
filters before paging and reports filtered total,not its original-page count.
New phone geometry/hit-testing checks both themes:bottom gap12+safe-area,opaque
gap,last content uncovered,stable bar while scrolling.820 checks four44px
actions share a row;390 checks Add Customer one line;amount/date/plural checks
added to all existing theme/viewport cases. No removed assertions/retries/waits.
Initial focused run20/26:four new footer geometry failures correctly detect
space-y-4's16px outer margin (gap28vs12) in both browsers/themes. Product footer
sets margin0;the exact geometry assertions remain untouched. Other2failures:
WebKit Cash harness missing after resource-load timeout (trace console at71354ms
"Failed to load resource: Timeout was reached");Chromium axe lost execution
context with a new Vite connection at88393ms after its first at84850ms. These
are observed loading/navigation failures,not a fabricated contrast PASS. Avoid
editing even docs/checkpoint while browser servers run;do not suppress these
tests or increase their limits. Final focused recheck26/26 PASS,Chromium/WebKit,
both themes and390/820/1440,retries0. Footer geometry passes unchanged in all4
cases;opaque bottom and last content visibility proven. Original Cash/axe cases
also pass unchanged (Cash5.2/5.4s) with frozen repo. No stronger root-cause claim
for the transient loading failures than the recorded trace. Full quality exit0:
817Admin/189Customer units,471browser PASS,59existing conditional skips,retries0;
TypeScript/ESLint,Admin/isolated Customer builds and network isolation PASS.
No001–137,service,store,permission or CI edits. Static/continuity20/20 PASS.
Gitleaks/UI commit/exactCI remain pending,then STOP for owner visual review.

Customers presentation delivered in4db3af1975ae1e70206b2632bb076160d1bb0903:
exact quality38016271763 all19/19 and secrets38016271790 PASS;official delivery
verification PASS. PackageF449s/core749s. No visual approval claimed yet.
Owner-authorized137 follows;136 immutable,financial chips wait137 delivery.
No Production/deploy/Phase7.

Final local gates PASS:full quality exit0,811Admin and465browser tests,
59existing conditional skips,retries0;Admin/Customer builds and network isolation
PASS,external/Production escaped0. All20Customers browser cases pass within the
complete gate too.001–136 unchanged;diff-check PASS;no owned DB/server remains.
Gitleaks/commit/push/exact-SHA CI still required before137;visual review follows.

## Delivered prerequisite

Separate test commits412a5ac (low Supabase ports) and d70cd575b0372e7746c774bec828ab744e9c5b0b
(isolated Vite cache). Gitleaks0 before both; exact push/main quality38012446691
all19/19 and secrets38012446732 PASS; official delivery verification PASS.
Quality core793s,PackageF416s. Supplier before/after port probes10/7ms and POS5ms:
all releaseWaitMs0; actual Linux ephemeral range32768–60999. No measured release
wait in these runs. Local HEAD/remote match and test resources cleaned.

## Candidate presentation

Token/shared-component list/table/details, current all/active/VIP/inactive/blocked
server filters and unchanged search/sort/page.136 supplies total/overdue-count/
over-limit-count and four aging buckets. Unknown age separate/FIFO semantics
remain authoritative in136,not recalculated here. Monthly collection is unavailable
because current customer reader does not supply it. No financial page-only filter.

The profile preserves actual website-order history,not a fabricated cumulative
financial ledger. Existing order-bound payment form opens with explicit order
selection; no invented customer-level payment/FIFO write. Contact/address/edit/
block/delete/history-more and separate receivable/order-payment path remain.
Phone details are full-screen with Back and sticky payment,dialog-stack registration.
Visual harness: `/e2e/package-f-customers-harness.html?theme=light|dark`,with
`&live` for the actual service adapter and controlled test-side RPC replies.

## Owner-approved correction —2026-10-10

The two requests are existing shell reads,not new Customers readers:
- BottomTabs -> refreshOrdersFromSupabase -> fetchOrdersFromSupabase ->
  `get_operational_orders_page` (Migration075:orders/customers),with exactly
  `{p_page:1,p_page_size:1,p_filter:'action',p_search:null,p_sort:'newest'}`.
- Header -> refreshStockNotificationsFromSupabase ->
  `get_stock_alert_notifications` (Migration014:stock_alerts,products,warehouses,
  units,stock_alert_reads),with exactly `{p_include_resolved:false,p_limit:100}`.

Permanent browser proof on the already accepted Cash harness,without Customers,
passed Chromium/WebKit2/2 BEFORE correcting the Customers expectation. Both
network requests appear exactly once with the same payloads. Shell/store/services
are unchanged. Customers' complete expected RPC-name set now explicitly contains
CRM,136 aging,and those two names;the shell sub-list checks exact counts/payloads.
No global ignores or reader removal;no greater-than count.

useDirectoryAging,useCustomerAging and agingSegments moved literally into
src/hooks/useCustomerAccounts.ts. Permanent AST hashes prove identical bodies.
Existing12 business call traces and all existing financial/load handlers match
d70cd575 after separation. Accounts' directory/balances buttons become a shared
SegmentedControl bound to the same setSection;the existing5 status values become
chips,with search/sort value forwarding still exact. These presentation bindings
are tested explicitly rather than masking a financial payload change.

## Previous focused stop (resolved candidate;delivery still pending)

After bounded correction:focused Customers20/20 PASS,Chromium/WebKit,retries0.
This includes unchanged-shell proof2/2,all12theme/viewport/axe/detail checks,
actual CRM adapter exact requests2/2,unavailable2/2,and existing order-bound
CliQ payment payload/required-reference/busy guard2/2. New static/AST/parser
tests4/4 PASS;affected strict ESLint exits0 without disable directives.
The initial AST callback test was corrected to explicitly assert the approved
directory/balances SegmentedControl binding setSection;financial handlers and
payment value callback hashes are untouched. No assertion removed or generalized.
Full quality and exact-SHA delivery remain pending.

AST against d70cd575:all12 existing await/service/openModal traces and all existing
load/financial handler bodies match across AccountsView,CrmView,CustomerList,
CustomerFilters,CustomerDetailView,CustomerBalancesView,RecordCustomerPaymentModal.
Search/sort value callbacks remain;status-select becomes chips with same5values.
136 is a separate new read adapter;no existing service/store/role/writer change.

Focused browsers14/16 PASS,retries0. All12light/dark390/820/1440 layout/Latin/
text containment/axe+profile/Back/sticky checks PASS. Missing aging2/2PASS.
The2failed live-adapter tests fail ONLY at final expected RPC-set assertion70:
expected CRM+aging,actual also get_operational_orders_page and
get_stock_alert_notifications. Those are existing unchanged shell/store reads,
confirmed in d70cd575 source;do not remove them or silently loosen RPC assertions.
Owner instructed stop on failure:checkpoint preserves this candidate for review.

Final TypeScript PASS and git diff--check PASS. Strict ESLint3warnings:
CustomerAging.tsx mixes hooks/helper exports and components;split non-component
exports into a hook/helper module,without changing reading behavior.
Customers full quality/Gitleaks/commit/push/CI and permanent AST/payment probes
remain pending;none claimed as passed. All owned browser resources cleaned.

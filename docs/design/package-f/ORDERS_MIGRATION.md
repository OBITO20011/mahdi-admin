# Orders migration — 2026-10-09

Package F §6.2 only, baseline `c0f0a5471c63377fa1fe33f34407c9e18ac757e2`.
Home corrections were visually accepted by Claude/owner; Orders needs its own
visual acceptance before another screen. No Production or deploy.

## Presentation and preserved contracts

- Shared PageHeader, FilterChips, SearchField, table/selected row, DetailLayout,
  MainColumn/DetailPanel, StatusBadge, MoneyText and UiButton; phone cards carry
  the status border. Both themes use nw tokens; only the obsolete orders-header
  light override was removed. Shell components are unchanged.
- Existing pagination (25), debounced search, sorting, realtime invalidation,
  selected-only heavy reader and request-version guards remain. No RPC, service,
  payload, role/grant, migration or financial formula changed.
- The existing operational reader excludes POS. This change does not add POS
  records just to match illustrative screenshots. Lightweight rows omit source;
  the selected full order provides it; unknown source remains explicitly
  unavailable, never inferred from the order number.
- Existing reader metadata supplies review/active counters and the requested
  filter's total. Other filter counters appear after that filter is read; no
  fake zero or page-size-based global counts and no extra RPCs are introduced.
- All acceptance/preparation, delivery ETA/driver/tracking, full/partial/debt
  settlement, customer/contact/address tools, cancellation reason, history and
  modern Aftercare/recovery remain reachable. Legacy aftercare stays read-only
  or unsupported per its existing capability. The selected panel retains the
  same OrderDetailModal handlers; standalone global-modal callers still work.
- Compact summary uses saved commercial kind, quantity, unit price and complete
  per-instance parcel components. Extended account/location/payment evidence
  stays accessible in expandable sections, not deleted or recomputed.
- Print opens the browser's existing print facility. No new document RPC.
- Home shift time now uses formatUiTime and a single LTR bdi: `08:12 ص`.

## Deterministic harness

Use the isolated preview (`node scripts/testing/run-isolated-vite.mjs admin 4173`),
not a dev server configured for Production. Open
`/e2e/package-f-orders-harness.html?theme=light` or `?theme=dark`.
Inspect390/820/1440; `&select` opens details at narrow widths, `&long` challenges
long Arabic names. Fixture-only action capture is isolated to e2e.
`&live` exercises the actual paginated controller and detail service using a
loopback RPC/REST fixture; this is adapter/browser evidence, not new DB proof.

## Updated old test contracts (no weakened business assertions)

- `tests/orders-pagination.test.ts`: cancelled/expired non-collectible badge
  conditions moved to shared orderStatus; exact conditions and message remain.
  All server paging, selected detail and realtime assertions remain.
- `tests/admin-mobile-ux-characterization.test.ts`: getStatusBadge renamed to
  getOrderStatus; controlled pagination checks both clamped previous/next actions
  and onPage=setPage instead of the previous inline updater syntax. Page size,
  status/payment, order identity, item count, money and opening assertions remain.
- New `tests/package-f-orders.test.ts` covers semantic badge/source fallback,
  seven columns, supplied counters, historical composition/money, all existing
  handler destinations, token-only presentation and time-first Latin formatting.
- FilterChips' 44px opt-in keeps its existing 38px default unchanged.
- New browser matrix checks both themes at all three widths, serious/critical
  axe, actual text containment, Latin digits, touch targets, paging/search reader
  identity, active-action arguments, contact/address/parcel tools and print.
  Initial new harness expectations omitted optional undefined arguments
  (serialized as null); corrected to the exact existing action signature.
  Address-close selector is scoped to the actual foreground dialog.

## Verification

Focused Orders browser matrix20/20 PASS across Chromium/WebKit, retries0.
Focused existing/new units46/46 PASS, characterization recheck13/13 PASS.
Final full quality exit0:765 Admin tests, Customer suite/lint/build/SEO PASS,
327 browser PASS,59 pre-existing conditional skips,retries0. Orders20/20 and
Home24/24 pass in that same uninterrupted run. Isolation:external/Production
escaped0;no owned test listeners remain. Gitleaks and exact-SHA CI follow.
Migrations001–134, services, stores, workflow and shell stay unchanged.

## Owner-approved usability correction — 2026-10-09

Claude/owner visually accepted `a390011` on desktop/phone in both themes and
confirmed identical server calls/actions. Only these follow-up changes are
authorized before another screen:

- Below md, the same detail instance is fixed to the full viewport. Its own
  scroll surface covers the underlying BottomTabs consistently; the sticky
  “رجوع للطلبات” button uses the existing close action/busy guard. Existing
  dialog-stack and dirty-Escape protection also apply to phone details. Closing
  restores focus without scrolling the underlying card; no list remount or
  altered reader/action. Loading/error states also offer a phone back button.
- Desktop remains the existing side panel. Number/time cells do not wrap;
  TableShell retains its internal horizontal scroll instead of page overflow.
- Reader/filter counters remain untouched. Only the technical explanation is
  replaced with “تتحدث القائمة تلقائياً”.
- New e2e assertions (both themes/engines) prove a lower-list card opens inside
  390px viewport immediately, sticky back after scrolling, exact list position
  and focus restoration, hidden-while-open/reachable-after-close bottom tabs,
  axe, plus each number/time on one line at1280 with a selected detail panel.
  Existing browser/reader/business assertions are not removed or relaxed.
  The existing live-controller browser test now navigates back on phone before
  searching the underlying list; its bounded paging, selected-only reader and
  exact debounced search payload expectations are unchanged. First focused run
  exposed that obsolete test sequence (27/28); no timeout/retry change.

Focused/full quality, Gitleaks and one corrective commit/push/exact-SHA CI are
the delivery gates. Stop for the next owner visual review; no next screen,
migrations, Production or deploy.

Corrective focused units20/20 and browser28/28 PASS. Full quality exit0:
766 Admin/189 Customer/335 browser PASS,59 pre-existing conditional skips,
retries0;Home24/24 and Orders28/28 in the complete run. ESLint strict/typecheck,
builds/SEO/network isolation PASS. AST comparison confirms all existing reader
and action calls/arguments are unchanged. Gitleaks/exact-SHA CI follow; no DB,
services, stores, workflow or shell changes.

## Real-reader return-position correction — 2026-10-09

The earlier fixture-only return test did not exercise controller list reloads.
The real controller reproduced scroll857→0: selection and close each start the
existing paginated read;loading unmounts cards and clamps the scroll container.
Owner authorized this additional presentation-only commit after3becc46.

- Capture the phone card identity and actual ancestor scrollTop before opening.
  On close, wait for an accepted list request newer than the close boundary,
  then restore in the layout effect after cards render. Re-find the card by
  identity and restore focus without scrolling;keep it visible if rows moved.
  Stale reads cannot satisfy the boundary. Desktop presentation is unchanged.
- Permanent light/dark390px `&live` tests use the actual OrdersCenterView and
  services over isolated loopback RPC/REST fixtures. Explicit response barriers
  force loading on both open and back;no sleeps,retries or random latency.
  Assert the same scroll/card offset within2px,card in viewport/focused,axe,
  and exactly4 list calls. Before the fix the new test failed by857px.
- Focused browser32/32 across Chromium/WebKit and units21/21 PASS,retries0;
  typecheck/changed-file ESLint PASS. AST reader/subscription calls and arguments
  are identical to3becc46. No RPC,payload,service,store,DB,migration or CI change.
  Full quality/Gitleaks/exact-SHA CI are required before delivery.
- Previous POS CI failure was before tests at DB boot,54322 already in use.
  For this new SHA only,if it repeats,rerun that failed job once;on a third
  occurrence stop with logs before any workflow change. No CI edit authorized.

Stop for owner/Claude visual review;no next screen,Production or deploy.

Full additional-correction quality exit0:767Admin/189Customer/339Browser PASS,
59 pre-existing conditional skips,retries0;Orders32/32 and Home24/24 in the
uninterrupted full run. Lint/typecheck/build/SEO/network isolation PASS.
Gitleaks0 and exact-SHA CI are the remaining delivery gates.

## Owner-approved product focus race correction — 2026-10-09

Cash's final quality exposed a pre-existing phone Orders race from70bb975.
Before correction,the unchanged live-search test at236/262 failed3/20 on
WebKit (workers2,retries0). A new controlled-response test reproduced the
product defect directly: after Back,the user starts a word in search;the
accepted list reload focuses the original card and interrupts their typing.
The new test failed at search-focus retention before the product change.

OrdersWorkbench now remembers the closing detail panel and restores card
focus only while focus is body/unassigned or still in that closing panel
(including its Back button). If the user moved to search/filters/another
control,the pending restoration does not move their focus or scroll. If
dialog cleanup already focused the exact original card,only scroll is
restored;focus is not reassigned. No search state,value or reader is changed.

Permanent light/dark tests use actual OrdersCenterView/adapter with a held
post-Back RPC response;start typing before release,finish the full word,
assert search focus/value and exact p_search after the accepted read. Also
cover explicitly focused filters (focus+Enter on both engines;Safari pointer
activation does not focus buttons). First new filter setup incorrectly assumed
pointer click implied focus on WebKit;only that new setup was corrected,
not the focus assertion. All existing Orders tests,including262 and both
scroll/focus restoration tests,are byte-unchanged;no waits/retries/timeouts
or selectors were relaxed. Focused browser12/12 and units14/14 PASS.

Fixed pre-change AST comparison for the sole modified Orders product file:
6 await/service calls,3 input-value callbacks,all arguments identical to
e122ad6. Subscription/lifecycle handlers unchanged in diff;services/stores/
RPC/payloads/roles/migrations/CI unchanged. Independent product-fix commit
precedes Cash commit;final full quality and exact-SHA CI remain required.

Unchanged live-search WebKit comparison after fix:20/20 PASS (56.2s),same
workers2/retries0 command as before (17PASS/3FAIL). No old test byte changed.
Typecheck/changed-file strict ESLint PASS;Gitleaks changed+untracked scope0.

## Owner-approved desktop/tablet panel correction —2026-10-10

The first additive clipping diagnostic was not a confirmed visible-content
defect:it measured unpainted descendants of closed native details. With every
disclosure expanded,before-change measurements found no clipped visible title,
action,amount or lower section at820/1024/1440 in either theme. Expanded panel
heights were3093/3325/3448px respectively;overflow-y was visible rather than an
internal scroller. The initial address-title warning is superseded by this proof.

Implemented the approved internal-scroll presentation:md+ panel has bounded
viewport height/min-h-0;the flex child retains overflow-y-auto. The primary
next-step section is sticky inside that scroller,with an opaque surface token.
The title's flex column can shrink/wrap. All new styles are md-prefixed except
removal of the md:overflow-visible override;phone behavior remains unchanged.

Permanent tests at820/1024/1440,light/dark,Chromium/WebKit expand every section,
check all text's horizontal containment,scroll to the final status-history row,
and prove that row and primary action are in the viewport. AST snapshots strip
only className and otherwise pin the entire two modified files to8195f87:
all calls,arguments,payloads,validation,confirmations,value callbacks,focus and
scroll restoration are unchanged. Focused panel/product/live reload tests32/32
PASS,retries0. Existing focus/search tests remain unchanged. Full quality and
exact-SHA delivery gates remain required before committing A then B.

Complete existing Orders and controlled focus/search/filter suite40/40 PASS
Chromium/WebKit,retries0,unchanged assertions. Focused units27/27 including
full Orders AST,continuity and immutable001–137 fingerprints;typecheck/ESLint0.

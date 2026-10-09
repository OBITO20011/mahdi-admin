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

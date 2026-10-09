# Inventory migration — 2026-10-09

Baseline faae71afc83d32ae822ac40bb89c6691d61d661d; Package F §6.4 only.
Owner/Claude accepted POS20910cb+faae71a visually and CI15/15.
No Production/deploy, next screen, database/migration/role/RPC changes.

## Owner clarification

- Chips: الكل / منخفض / نفد only. No available chip or page-only filter.
- KPI: إجمالي الأصناف, note يشمل المتوقفة; same metrics.totalItems.
- All metrics remain the server-wide read fields, not sums of displayed rows.
- The existing per-unit cost field is displayed; the reader's exact aggregate
  WAC value remains unchanged. It does not supply a per-product exact inventory
  value, so that column says غير متاح; no multiplication of rounded cost into
  invented exact value. Existing role/RPC visibility remains unchanged.

## Open owner question — deferred, not implemented

هل نضيف للقارئ فلتر «متوفر» وعدّ الأصناف النشطة فقط؟ (قراءة فقط، خطوة منفصلة باختباراتها)

## Presentation and retained behavior

Desktop/tablet table + detail panel, phone stock cards + full-screen detail/back.
Scroll/card restoration waits for accepted current-revision list render.
History selection invokes the existing product-scoped movement reader; no
additional RPC or payload. Existing receive/stock-count/opening/clear/history,
movement feed/paging, advanced branch/warehouse/category/status filters and
retail-value detail remain reachable. ClearInventoryBalanceDialog unchanged.
Tokens and shared UI only; dates/numbers Latin; unknown/error facts not zero.

Two authorized small fixes: shared formatItemCount for POS count wording;
explicit railLabel for each existing SideNav item, full aria-label/title retained.
Existing profile/promotion shortcuts stay reachable as حسابي / الخصم in rail.

Harness: /e2e/package-f-inventory-harness.html?theme=light (or dark), actual
InventoryView and current adapter, fixed READ fixtures, loopback only, mutations
forwarded. Reload hook enables a controlled-response real-controller scroll
regression, not an independent fixture presentation component.
Focused parity/accessibility/layout/scroll/role tests, full quality, Gitleaks0,
one commit/push/exact-SHA CI and owner visual review required before next screen.

## Updated presentation contracts (no business assertions removed)

- tests/admin-mobile-ux.test.ts: obsolete Inventory two-column/expanded-card
  classes become one-column phone cards + full-screen detail/shared components.
  Product-catalog two-column, stock and all existing action assertions stay.
- e2e/admin-mobile-ux.spec.ts: visible phone cards OR desktop rows, full-width
  stock card, visible stock meter (157), actual detail panel/action touch targets,
  390×844 detail, barcode/packages/history/clear and axe retained.
- e2e/admin-large-catalog-performance.spec.ts: visible card/row selector only;
  same 24-row bounded page, exact search result, DOM budget and timing assertions.
- e2e/phase6-package-c.spec.ts: exact old POS count text `1 أصناف` becomes
  owner-approved `صنف واحد`; repeat-Enter, focus/scanner, Space, exact quantity
  and capacity-limit assertions unchanged. First full quality failed only on
  that obsolete text (380 passed/59 existing skips); corrected gate rerun required.
- New tests use SearchField's actual searchbox role and AppState's existing
  currentModal/modalData fields; initial test-authoring errors were corrected,
  not product behavior or timeouts/retries.

AST-normalized await/service/RPC/run/openModal traces against faae71a:
Inventory7, POS31 and PosParcelBuilder0 remain identical. Permanent hash-bound
regression in tests/package-f-inventory.test.ts; no services/stores/DB changes.

## Final local verification

Full quality exit0:777Admin/189Customer/381Browser PASS;59 existing conditional
skips,retries0. Inventory24/24,POS18/18,Orders32/32,Home24/24 in the full run.
ESLint strict,typecheck,Admin/isolated Customer builds/SEO/isolation PASS;
explicit network-isolation proof escaped external/Production0. Focused50/50
plus added history/action coverage and POS keyboard2/2 PASS. No owned test
listeners remain. Migrations001–134,services,stores,roles,payloads and CI unchanged.
Gitleaks,one commit/push and exact-SHA CI are the remaining delivery gates;
the post-delivery official checkpoint records their verified result. Then STOP
for owner/Claude visual review;no next screen or Phase7.

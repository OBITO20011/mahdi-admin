# Home migration — 2026-10-09

Scope: Package F §6.1 only; foundation/handoff `a81e002`. Home uses the shared
token UI kit, four desktop KPIs / four phone KPIs, action orders, current shift,
signed seven-day net sales and stock alerts. Shell files remain unchanged.

## Data boundary

- Existing `get_home_dashboard` call, timeout, realtime coalescing and payload
  are unchanged. The adapter now preserves the already-returned
  `summary.monthNetSalesInMinorUnits` and `sevenDaySales[].netSalesInMinorUnits`.
  Gross sales are never labelled as net.
- Shift card uses the already-loaded `currentShift`, not a new reader. Closing
  navigates to the existing Shifts screen; no mutation is performed by Home.
- The current Home response has no daily Cash/CliQ collection or overdue-client
  count. Those remain explicitly unavailable, not inferred from shift sales,
  active customers or receivables. No fabricated change percentage or operation
  count is introduced. Phone shows the recorded shift opening time.
- `financialFactsStatus='unavailable'` still hides financial KPIs and chart.

## Visual harness

With the existing Vite dev server, open
`/e2e/package-f-home-harness.html?theme=light` or `?theme=dark` at 390/820/1440.
Optional probes: `&unavailable&noShift`, `&long`, `&negative`.
Fixtures are confined to e2e; the real loader and harness share `DashboardHome`.
The `&live` test mode exercises the real DashboardView/adapter with an isolated
RPC response, not a second production data path.

## Updated contracts

- `tests/dashboard-home.test.ts`: presentation text now checked in
  `DashboardHome.tsx`; authenticated single RPC, stock semantics, orders/accounts
  navigation and receiving remain asserted.
- `tests/light-theme-contract.test.ts`: old dashboard-* colour override hooks
  replaced by shared KPI/token/hero contracts; four cards per breakpoint and
  absence of old overrides/raw colours asserted. Other screens' checks retained.
- `tests/app-store-boundaries-characterization.test.ts`: relocated receiving
  callback now checks both item.id forwarding and the exact receive_goods
  productId payload (including the no-product shortcut), not its old file position.
- Home-only legacy overrides removed from index.css; other screens untouched.
- New shared `SalesBarChart` plus opt-in phone KPI grid / 44px segmented control
  have permanent unit coverage; existing component defaults remain unchanged.
- `e2e/package-f-home.spec.ts`: both engines and themes, all three widths,
  serious/critical axe, actual text containment, 44px button heights, navigation,
  financial unavailability and same-RPC refresh. No retries or timeouts added.

Next gate after delivery: Claude visual review against the four reference
screens, then owner approval. Do not begin another screen or Phase 7.

## Local verification

- Full `npm run quality` exit0: 753 Admin, 189 Customer, 301 browser PASS;
  59 pre-existing conditional skips, retries0. Home matrix18/18 in that run.
- Chromium/WebKit isolation: external requests escaped0, Production escaped0.
- Extra final Home build exit0 after the cash-voucher label was clarified.
- Migrations001–134, workflow and shell files unchanged. No Production/deploy.

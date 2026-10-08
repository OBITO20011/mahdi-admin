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

## Owner-approved visual correction — 2026-10-09

Claude approved Home at390/820/1440 in both themes on ea8e030. This follow-up
only shortens visible chart labels to non-wrapping integers (full three-decimal
amounts remain in title/aria-label), formats Arabic dates/times with Latin digits,
and migrates the existing Header to tokens. Existing branch/notification/profile
destinations and assistant role gate are unchanged; desktop title/profile hide
because SideNav already owns them. Removed the obsolete light Header override.

Shared UserAvatar removes all hardcoded external defaults from Header, More,
Profile and local user creation. Profile retains the user's image URL input;
the old remote preset choices become an explicit local-initial option.
No other screen migration or money/RPC/database change is included.
Tests extend the existing Home matrix to360px, check actual single-line chart
labels and Latin text, include Header in axe, and exercise its existing actions.
Existing shape/identity assertions remain intact; the new chart contract preserves
full monetary precision in accessible attributes rather than the narrow label.

Updated `e2e/phase6-package-b.spec.ts`'s old desktop Header profile expectation:
phone/tablet profile remains visible, desktop profile is hidden at1024/1440,
and role text is visible only at768–1023. All shell dimensions/preview/selection
assertions remain;1024 is added as the exact boundary. The Home Header test
also proves the existing SideNav profile remains accessible on desktop.
The first focused axe run was interrupted by Vite reload while documentation
was edited (22:58:20UTC; context lost22:58:22); its unchanged focused recheck
passed. Browser runs thereafter use a frozen worktree, no masking retries.

Final corrective verification: full quality exit0,757 Admin/189 Customer/307
browser PASS,59 existing conditional skips,retries0;Home24/24 across Chromium
and WebKit,360/390/820/1440,both themes. Typecheck/lint/build and network guards
PASS;external/Production escaped0. The initial complete gate failed only the
two obsolete desktop Header expectations described above; the corrected
contract passed4/4 focused checks and then the entire unchanged quality gate.
Migrations001–134,RPCs,workflow and other shell components unchanged.

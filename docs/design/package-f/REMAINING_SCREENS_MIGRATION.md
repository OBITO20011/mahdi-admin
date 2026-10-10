# Package F — remaining screens

## Batch 1 — shared dialogs and More (2026-10-10)

Owner approved Customers891c9a4 and authorized this batch only.
Baseline:891c9a460294d983952c3563a46c6804eedf0fe5.

Scope:common Modal,shared token form presentation,MoreMenuView,ProfileModal,
InstallAppPanel,PushNotificationControls and navigation icon tones.
No services/stores/RPC/payload/roles/auth/MFA/biometric logic or migrations.
Modal animation/data-state,dirty/busy Escape guards,focus stack and close
callbacks remain unchanged. Other screen migrations wait for visual approval.

Proof/gates:baseline AST business calls,all event/value forwarding and handlers;
fixed local fixture harness in both themes;Chromium/WebKit at390/820/1440,
axe including contrast,text/page containment,Latin digits,44px form controls;
existing dialog guards;full quality,Gitleaks0,commit/push/exact CI.

Implementation:all five surfaces use semantic tokens and shared UiButton;
More uses PageHeader/Card;Profile uses the scoped FormFields foundation.
Native form fields retain their exact value/change/disabled/required behavior.
Text inputs/selects/textarea are at least44px;native check/radio labels retain
their semantics. Profile Save/Cancel stays visible inside the existing form.
Existing animation/data-state,Escape/focus/MFA/install/push workflows unchanged.
No general palette values or shell changes. The only fixed-colour exception is
the pre-existing white backing beneath the machine-readable MFA QR image.

Baseline proof:25 business calls,59 event/value bindings and100 native input/
validation/busy properties match891c9a4 by TypeScript AST;handlers also pinned.
No existing assertion or selector was changed. Removed ONLY the obsolete More
assistant/sign-out light overrides now replaced by tokens;all other legacy
light rules wait for batch7. New permanent browser checks include actual token
backgrounds,44px labelled fields,all push capability states,dirty/busy closing,
focus restoration,and four-direction text containment.

Harness:/e2e/package-f-more-harness.html?theme=light|dark
Optional view=profile|install|push|form;push=default|enabled|denied|unsupported.
It uses the actual production components with fixed display fixtures and
loopback-only SDK/browser-capability reads;no fake mutation succeeds.
Preview locally with `node scripts/testing/run-isolated-vite.mjs admin 4173`.
Theme/fixture branches are confined to e2e,not product code.

Focused evidence:42 existing/static tests passed;all40 Chromium/WebKit matrix
cases passed before the stronger vertical bounds/phone Save assertions;final
phone6/6 and Install/Push WebKit1/1 passed with those stricter checks.
AST/native props/continuity/migration focused14/14 passed. Initial failures
were corrected in product presentation:phone email wrapping,Arabic line boxes
and off-screen Save. CSS import moved to the stylesheet entrypoint so Node UI
tests still load;MFA read fixture gained the existing SDK webauthn field.
No retries,timeouts,coverage exclusions or business adjustments.

First full quality:units/lint/build/isolation passed;browser509 passed,
59 existing conditional skips and2 old WebKit navigation contrast failures.
Measured independently:.pb-1 foreground#55657a inherited#020617 through a
transparent component canvas,ratio3.38:1. Product correction:More owns bg-nw-bg
and text-nw-text instead of inheriting an uninitialized host canvas. Existing
navigation tests/assertions remain untouched;new standalone regression added.
Unchanged navigation plus standalone regression:10/10 Chromium/WebKit PASS,
retries0;AST/native props/continuity/migration14/14 still PASS.
Final full quality exit0:821 Admin and189 Customer unit tests;513 browser PASS,
59 existing conditional skips,retries0 (23.6 minutes). Typecheck,ESLint,both
builds,isolated SEO and network isolation PASS;external/Production escapes0.
Standalone light contrast is now5.50:1 (#55657a on #f4f6f9).
Gitleaks/commit/exact-SHA CI remain pending;no further quality rerun needed
for documentation/checkpoint updates alone.

Staged Gitleaks initially flagged two handler SHA-256 baselines as generic keys
because their handler names mention password/MFA secrets. These are source
digests,not credentials. All handler baselines now use explicit {sha256:digest}
records;the same exact digests and complete deepEqual assertion are preserved.
No scanner allowlist/suppression or product change. Focused test/lint rerun only
for this equivalent test representation;full product quality evidence unchanged.

## Batch 2 — products and parcel configuration (2026-10-10)

Owner/Claude accepted ed7772f and authorized this batch only. Baseline:
ed7772f349befb87cc8e2ec5cfb9c8841256c76e. Scope:ProductsView,
ProductDetailModal,ProductFormModal,StockAdjustmentModal,ParcelConfigurationModal.
Also Profile Arabic role display/shared SideNav labels and LTR email truncate/title.
No DB,migration,service,store,RPC,payload,permission or workflow changes.

All five surfaces use token Card/UiButton/FormFields;Products uses PageHeader.
Existing paged readers/filters/sort and all actions remain reachable. The product
card catalog/family expansion remains its existing workflow,not a new authority.
Scoped fields remain44px;phone form/stock/parcel save actions stay visible.
Money uses formatJod;display counters use Latin numbering. Role labels were moved
verbatim from SideNav to a shared pure display module,not permission logic.

Permanent TypeScript AST baseline:79 business/await/read calls,149 event/value
bindings and279 native value/validation/busy properties match ed7772f exactly.
The entire pre-render prefixes of all five components are pinned too:Stock
arithmetic,guards,executeStockCount payload,confirmation paths and finally are
unchanged. Only display-metric value props may change formatting;no input value
is excluded. Existing batch1 AST tests remain unchanged and passing.

Harness:/e2e/package-f-products-harness.html?theme=light|dark
Optional view=detail|form|stock|parcel and family=1. Actual components with fixed
synthetic read fixtures;mutations keep the original isolated RPC transport.
Permanent browser coverage:all surfaces,390/820/1440 and both themes;geometry/
Latin digits/44px/actions at every width;axe all surfaces in both phone themes
plus catalog at every width;explicit parcel/flavor confirmation and stock payload/
busy rejection. The stock RPC probe intentionally rejects without any write.

Contracts updated:light-theme-contract now rejects the obsolete products-only
light gradient and asserts Card/PageHeader/token canvas instead. Remaining old
screen overrides wait for batch7. No existing business assertion was changed.
Initial focused browser16/18 passed;WebKit phone identified parcel Save missing
on-primary text (light #0f1b2d/#13294b1.19:1;dark #e6ebf2/#f08a3c2.08:1).
Fixed with shared primary variant,no token changes/exclusions/timeouts/retries.
Other selected/hover button backgrounds keep their semantic foreground pair.
Focused static55/55 passed before this presentation correction;final contracts/
continuity/migrations22/22,TypeScript and strict lint PASS. Both corrected WebKit
phone-theme matrix cases now PASS (2/2,retries0). The other16 Chromium/WebKit
matrix/stock payload/family confirmation/Profile cases passed previously;
the forthcoming full quality rechecks the complete final source. Gates pending.

First quality stopped at units,before builds/browser:admin-mobile-ux exposed the
initial1-column phone presentation. Final source retains the existing2-column
phone catalog contract unchanged;prices within each card stack at narrow width.
All destination/identity/action assertions retained. The new spec's Locator-only
direct Playwright import was replaced with ReturnType<Page['locator']>;the
existing fail-closed isolated-test import gate was not changed. No financial/
inventory/permission failure. The second quality was stopped early after the old
phone geometry tests exposed that same layout drift;it was corrected in product,
not weakened in tests. admin-mobile-ux's flavor selector changes only Arabic-Indic
2 to Latin2 (same exact count/name);all geometry/actions/axe assertions remain.
Final focused phone regression16/16 Chromium/WebKit PASS,retries0:original
two-column360/390/430,actions/family balances and new full-surface390 light/dark.
Compact card footer buttons retain44px with bounded padding;permanent geometry
also rejects any action extending beyond its card. Product price/detail currency
labels remain present;formatJod/MoneyText change display only. Final quality pending.
The next partial quality identified only the requested Profile email ellipsis:
the old More/Profile Range check measured hidden full email text as overflow.
package-f-more now validates ONLY the named profile-email field's exact full
title,LTR,nowrap/hidden/ellipsis and card bounds;all other4-direction containment,
axe/contrast/dirty/busy assertions remain unchanged. New permanent email test
also proves those exact semantics. No broad text/overflow exclusion or retry.
Final email/More/Profile/install/push phone subset14/14 Chromium/WebKit PASS,
both themes,retries0. Batch1/batch2 AST7/7 still PASS. Code frozen for final quality.
The next run reached all Chromium batch2 cases successfully,then exposed the
pre-existing delayed-read status test's exact success wording. Restored that
original wording in product (not an authorized copy change);the before/after
pending-read assertion remains untouched. No loading/reader logic changed.
Unmodified held-read status test2/2 Chromium/WebKit PASS after restoring wording.

Final complete quality exit0:824 Admin/189 Customer units;531 browser PASS,
59 existing conditional skips,retries0 (26.0 minutes). Both builds,isolated SEO,
TypeScript/ESLint and network isolation PASS;external/Production escapes0.
All final batch2 cases pass on Chromium/WebKit,including the unchanged delayed
reader indicator. Migrations001–137,services/stores/customer-web unchanged.
Gitleaks/commit/push/exact-SHA CI next;visual acceptance not claimed.

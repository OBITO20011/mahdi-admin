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

## Batch2 phone clipping correction —2026-10-10

Owner/Claude accepts8195f87 subject to phone product-header containment.
Header is now flex/w-full/min-w-0/justify-start/text-right;its inner row
is explicitly min-w-0/w-full. Existing line-clamp,actions and 2-column grid
remain unchanged. Reader success copy is now «محدّث الآن»,with the exact
held-read pre/post assertion updated only for that approved wording.
Shared additive checkLayout walks all clipping ancestors,not just the
immediate text parent;intentional truncate/line-clamp/sr-only are distinguished
from an entire clamped box escaping its ancestor. All9Package F specs call
the guard;existing containment/axe checks are retained unchanged.
Before product correction:new390WebKit regression FAIL(header scrollWidth
exceeds clientWidth). After:14/14both browsers,360/390/430,both themes,
including deliberate hidden-clipping/intentional-clamp guard probes PASS.
AST79calls/149bindings/279native properties and five full component prefixes
still match;001–137 fingerprints PASS. Quality/exact CI pending;then batch3.
No RPC/payload/permission/migration/Production/deploy changes.

The additive all-screen run stopped early when the first guard version confused
offscreen scrollable report content with hidden clipping. The guard now projects
ink through actual auto/scroll viewports only after checking local hidden clips.
Permanent positive/negative nested-scroller probes prevent broad exemptions.
Affected report/guard6/6 Chromium/WebKit PASS,retries0;no product/report changes.

### Initial stop — Orders diagnostic,subsequently corrected below

Full quality passed825Admin units,Customer checks,both builds/isolated SEO and
network guard(external/Production escapes0),then stopped early on desktop
Orders layout at820/1440(light/dark) and1280 selected table. No commit/push.
Minimal reproduction:playwright package-f-orders.spec.ts --grep
"Orders light 820:" --project=desktop-chromium --retries=0 FAIL.
Initial geometry diagnostic:DetailPanel bottom1960.78125,first delivery-title ink
top1987.109375/bottom2005.109375;overflowX/Y both hidden. Child detail content
uses md:overflow-visible/min-h-0/flex-1 inside the hidden outer panel.
Orders product files are byte-identical to8195f87;the defect was exposed by
the additive ancestor guard,not introduced by the Products presentation fix.
Phone Orders cases passed;no timeout/retry/assertion workaround was used.
Owner approval is required before expanding the product correction to Orders
desktop/tablet panel sizing/scrolling. Batch3 remains unstarted. All owned
test servers are stopped;no DB was started;owner n8n is untouched.

### Owner-approved A/B correction —2026-10-10

Important diagnostic correction:the address-title warning above measured content
inside closed native details,not painted/visible content. Explicitly opening all
sections BEFORE product changes found no visible title/action/amount/lower-section
clipping at820/1024/1440,both themes. The absent internal scroll was confirmed.
Orders now has md-only bounded height/internal scrolling and sticky next-step
actions;phone and every non-className AST node remain identical to8195f87.
See ORDERS_MIGRATION.md for the baseline geometry and permanent reachability test.

Shared guard now respects closed-disclosure painting while still checking its
summary and all content once expanded. Permanent probes prove closed content
passes,expanded clipped content fails,and a clipped visible summary still fails.
No broad details/scroll exclusions;all existing assertions are retained.
Focused panel/product/live-reload suite32/32PASS on both engines,retries0.
Commit order:Orders(A),Products/general guard(B);one full final quality run,
Gitleaks0 before each commit,exact final-SHA CI,then batch3 presentation.

The final full run stopped with five WebKit More cases (552PASS/59existing
skips) because Motion's JS height animation was measured before completion:
e.g.1440light customers-panel height1px while its title ink was668–689px.
This is transient intentional animation clipping,not a settled layout defect.
No More product change:the audit now waits for actual height='auto',opacity1
and removal of closing panels before the unchanged clipping/axe assertions.
Existing getAnimations alone cannot observe Motion's JS height frames.
All12 More width/theme/engine cases then PASS,retries0. A permanent negative
probe forces settled text outside the clipping ancestor;it must still fail.
No timeout increase,retry,arbitrary sleep,node exclusion or weaker assertion.
Full quality must be rerun successfully before either authorized commit.

### Final quality blocker —2026-10-10

The next full quality run passed Admin827/827,Customer189/189,typecheck,lint,
builds and isolated network checks,but WebKit failed the unchanged
customer-checkout-simplification.spec.ts:202 Turnstile-retry case at line249.
It expected the security-error alert in the review dialog;the review dialog
never opened. The failure snapshot instead shows an empty full-name input
and its required-field alert,although the trace records fill('عميل إعادة تحقق')
before review. This does not yet prove why the name was lost,or a Turnstile
failure. Customer source and this spec have no diff from the task baseline.
No checkout/security/test fix,commit or push;batch3 remains unstarted.
Owner direction is needed for bounded diagnosis outside these display fixes.
Final browser result:558PASS,59existing conditional skips,1FAIL,28.2minutes,
retries0. All Package F cases and Orders reachability/focus/search cases passed.
No false-green claim:full npm quality exit1 prevents both commits and batch3.

### Owner-approved checkout diagnosis —2026-10-10 (no fix)

Preflight/resume PASS;HEAD remains8195f8761f543ff99d899e6f8d3ac7ce4c17f702.
A separate detached worktree at that exact SHA was used;no stash/reset/source
change in either checkout. Dependencies were shared by ignored junctions only.

#### Storefront reachability of every pending file

Static traversal from customer-web/src/main.tsx covers65 local source/style
files,including relative imports,re-exports and literal dynamic imports.
There are no imports outside customer-web. All65 files match the baseline
after LF normalization (the detached Windows checkout uses CRLF).
Every pending file listed below is **neither directly nor transitively imported
by the storefront**;the three product files belong to Admin only.

| Pending file | Storefront import |
| --- | --- |
| docs/agent/ACTIVE_TASK.json | None |
| docs/agent/PHASE_STATUS.md | None |
| docs/agent/PROJECT_OVERVIEW.md | None |
| docs/design/package-f/ORDERS_MIGRATION.md | None |
| docs/design/package-f/REMAINING_SCREENS_MIGRATION.md | None |
| e2e/package-f-cash.spec.ts | None |
| e2e/package-f-customers.spec.ts | None |
| e2e/package-f-home.spec.ts | None |
| e2e/package-f-inventory.spec.ts | None |
| e2e/package-f-more.spec.ts | None |
| e2e/package-f-orders.spec.ts | None |
| e2e/package-f-pos.spec.ts | None |
| e2e/package-f-products.spec.ts | None |
| e2e/package-f-read-extensions.spec.ts | None |
| e2e/phase6-package-a.spec.ts | None |
| src/features/orders/OrderDetailModal.tsx | None |
| src/features/orders/OrdersCenterView.tsx | None |
| src/features/products/ProductsView.tsx | None |
| e2e/orders-panel-clipping.spec.ts | None |
| e2e/package-f-layout.ts | None |
| tests/orders-panel-presentation.test.ts | None |
| tests/package-f-layout-guard.test.ts | None |

Admin src/components/common/Modal.tsx,src/components/ui/* (including
form-fields.css) and src/index.css are unchanged and not storefront imports.
Customer uses its own index.css and dialogFocus. The failing checkout spec
does not import the Package F layout guard. Its isolated fixture,Playwright
config and Vite runner are unchanged after LF normalization.

To challenge indirect CSS generation as well,the actual served customer CSS
was captured on both isolated servers:136722 characters,exact same SHA-256
8bb990da53701ee784d8a653cf76e4223547b16001b855440c36ddb3556a5068.
Thus no changed imported source or served stylesheet was found in this path.

#### Exact requested repeat comparison

Same command in the baseline worktree first,then in the current checkout:
`npx.cmd playwright test e2e/customer-checkout-simplification.spec.ts:202 --grep "Turnstile retry requires" --project=mobile-webkit --repeat-each=20 --workers=2 --retries=0`
Line249 is an assertion inside the test beginning at202,not a separate test.

| Checkout | Pass | Fail | Failure rate | Duration |
| --- | --- | --- | --- | --- |
| Detached8195f87 baseline | 20 | 0 | 0/20 (0%) | 2.5min |
| Current pending changes | 20 | 0 | 0/20 (0%) | 2.9min |

Both use the unchanged mobile-webkit/iPhone13 project,locale ar-JO,
Asia/Amman,workers2,and the same loopback isolation. No retry,timeout,assertion
or product change. All20 cases were executed in each comparison (an initial
anchored CLI grep selected zero tests;that setup attempt is not a test result).
These results do NOT prove an intermittent baseline failure or its absence.
The earlier full-quality558PASS/59skips/1FAIL is not overwritten as PASS.

#### Original failure trace/video:what is actually proven

The app mounts via createRoot,not hydrateRoot;index.html has an empty root.
There is no SSR hydration in this path. Original trace times are milliseconds:

| Snapshot/action | Time | Observed full-name state |
| --- | --- | --- |
| fill start | 655151.518 | Targets the full-name input |
| before fill snapshot | 655158.223 | Empty;Cart still open,Checkout scale95/opacity0 |
| input snapshot | 655235.509 | Empty;Checkout open,Cart closing |
| fill returned / after snapshot | 655274.497 / 655282.074 | Still empty |
| next phone-fill snapshot | 655290.998 | Name still empty |
| after phone fill | 655378.591 | Phone0791234567 accepted;name empty |
| after review click | 657757.130 | Required-name error;review never opens |

The video supports the Cart-to-Checkout transition and the subsequent empty-name
validation. No captured snapshot proves the name was successfully accepted and
then erased. The trace has no input/focus-event or React-setter log;therefore
it cannot distinguish missed insertion/focus interference from a transient
state change between snapshots. Existing useEffect focus-stack handover is a
candidate,not a confirmed root cause. Saved-customer restoration,UNKNOWN-attempt
restoration and receipt-close reset are source-defined paths,but none is proved
to have executed/reset this field in the recorded failure.
Original trace/video/screenshot/context retained in ignored
test-results/checkout-diagnosis/original-failure for owner review.

Conclusion:pending changes do not reach the storefront,40/40 focused runs pass,
but the prior failure is not reproduced and its cause remains unresolved.
The owner's commit condition (intermittent failure proven on baseline too) is
not established. No checkout fix,A/B commit,push or batch3. A narrowly scoped
focus/input/React-commit diagnostic is the suggested next owner decision;
no assertion weakening or random wait. Owned worktree/servers are cleaned up.

#### Owner decision 2026-10-10 — A/B delivery authorized;store issue remains OPEN

The owner accepts the no-import-path proof,identical served storefront CSS and
baseline/current20/20 WebKit runs as sufficient separation from this Package F
work. This supersedes the preceding pending-owner commit condition;it does not
convert the earlier full-quality failure into a pass or close the store issue.
Commit Orders A,then Products/guard B;push and require exact final-SHA CI green
before batch3. If the same checkout case fails in CI,report its log and rerun
at most once. No test weakening,retries or increased timeout.

Independent OPEN issue:
"اسم العميل يظهر فارغاً بعد fill أثناء الانتقال من السلة لنافذة الإتمام
(WebKit، نادر، موجود قبل Package F الحالي على الأرجح)".
Deferred hypothesis,not proven:an effect on checkout opening (draft/saved-data
restoration/form initialization) writes state after typing begins;this may
affect a real customer typing quickly. Temporary input/focus-event and React
commit instrumentation is owner-authorized ONLY after batch7 and before final
delivery regression. No storefront fix or instrumentation in A/B or batch3.

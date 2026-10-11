# Package F — remaining screens

## Batch 7 — legacy palette retirement (2026-10-11)

### Read-only WebKit diagnosis — completed 2026-10-11

Owner decision following this diagnosis:classify as LOCAL ENVIRONMENT STOP
(Windows lid standby),NOT test defect or CPU-load issue. Current/baseline40/40
accepted. Full local quality will NOT be rerun;other passed legs retained.
Separate motion-helper commit followed by batch7,Gitleaks0 for each and exact
Linux CI100% are required before visual review. No product/test repair for this
environment stop;no timeout/retry/CI changes.

Independent motion-gate commit ace8fe7 contains only3test/helper files;staged
Gitleaks0. Batch7 changes below are separate. Exact final-SHA Linux CI must
still prove all delivery jobs,not merely the local standalone diagnosis.

Owner authorized each failing case alone,current and detached1272a786 worktree,
mobile-webkit repeat10,same90s/config/2workers,retries0;no repair.

| Case | Current | Clean baseline1272a786 | Elapsed including server lifecycle |
| --- | --- | --- | --- |
| About customer-accessibility.spec.ts:28 | 10/10 | 10/10 | 65.779s /119.895s |
| Dark SideNav admin-side-navigation.spec.ts:50 | 10/10 | 10/10 | 39.342s /37.562s |

Baseline first attempt with linked dependencies also passed20/20 but logged
Vite font allow-list rejections;NOT used as final comparison. Fresh detached
worktree with npm ci in both packages eliminated those rejections. Identical
locked versions,source unchanged. Logs/results:user Local/Temp/
nawasrah-batch7-webkit-diagnosis-20261011.

Root evidence is WINDOWS MODERN STANDBY,NOT proven CPU contention:
Kernel-Power506 at12:53:59.1770993Z enters standby,Reason=Lid,LidOpenState=false;
507 at12:56:36.7145240Z exits,Reason=Lid,LidOpenState=true;DurationInUs157539005.
Local Asia/Amman15:53:59–15:56:36. Both simultaneous stalls match this interval:
- About context24.010ms,page242.445ms;first goto733.225ms,second536.531ms.
  Third viewport change157005.861ms spans standby;next goto12.078s occurs after
  the90s whole-test budget expired and overlaps teardown. This is NOT evidence
  that Vite spent90s serving About. Prior HTML responses49.367/12.436ms,HTTP200.
- SideNav context24.065ms;native newPage has no completed response and page
  fixture ends156780.919ms later. Test body/goto/fonts/axe never began.
No font/server/motion-gate wait explains the157s gap. No product,test,config,
timeout or retry repair made. Both failures align with the OS power event.

Original full run used2workers. Exact machine-wide Node/WebKit counts or CPU
snapshot AT the old failure were not captured and cannot be reconstructed.
During diagnosis an owned-process snapshot showed8node.exe (supervisor,CLI,
4servers,2workers),2Playwright.exe and6WebKit children (2GPU/2Network/2Web);
this is NOT a historical failure snapshot. PID33256 is no longer alive;4175
free before/after diagnosis. Historic ownership of dead33256 is unverified.
Diagnostic4175 listeners were run-browser-network-guard children,exited normally.

customer-web,two specs,isolation fixture,Playwright config/server tools unchanged.
About does not import modified Admin CSS/code. SideNav DOES consume index.css/
adminNavigation presentation changes,but old failure occurred before newPage
completed/before those resources execute. Neither imports Package F motion gate.
No batch7 behavioral cause found;full non-presentation parity verified separately.

40/40 is NOT a full quality/CI pass. Conditional permission named local load;
actual cause is lid standby,so confirmation requested before delivery exception.
No commit/push/newCI. Two clean-source temporary detached worktrees retained for
reproducibility;no task-owned processes/listeners remain. Await owner decision.

Latest delivery gate BLOCKED (2026-10-11):final bounded-helper quality started
12:37:28.899Z and ended12:57:54.210Z,exit1 after stopping the owned runner on
observed failures. Admin884/Customer189 units,builds/SEO/isolation passed.
Two WebKit failures were preserved:
- customer-accessibility.spec.ts:28 (line33):page.goto About at4174 waiting for
  domcontentloaded exceeded90s,before axe. Earlier two width navigations returned
  HTTP200;the later navigation stalled. No confirmed root cause or flaky claim.
- admin-side-navigation.spec.ts:50:90s timeout while SETTING UP page fixture,
  before the test body/contrast assertion. Adjacent cases passed. No root cause
  conclusion follows from that fact.
Neither test imports the Package F motion helper;both specs/customer-web remain
unchanged. No retries,timeout changes,customer repair or CI change attempted.
Log,exit.json,About trace/context and SideNav setup trace/context preserved in
C:/Users/TOP/AppData/Local/Temp/nawasrah-batch7-quality-bounded-293c7bfa648643cc9f83c2dc3c0b623f.
Only verified owned runner32040 and descendants stopped;owned processes and
listeners4173–4176 absent afterward. This interrupted failed suite is NOT a
complete browser pass. Controls200/200,Orders20/20 per browser,max motion308ms
remain valid focused evidence,not a substitute for final quality.
No commits/push/new exact-SHA CI;owner review required before further work.

Owner/Claude visually approved dd014f5 and1272a78. Baseline1272a786.
Pre-change inventory: BATCH7_COLOR_INVENTORY.md (all24files,1197 lexical utility
occurrences;134 direct compatibility selectors/43CSS blocks). All old families
migrate to existing semantic tokens,no token values changed/no old-family
exceptions. Retained legacy dashboard/chart components and auxiliary inventory,
CRM,category/brand/unit/barcode/notification surfaces are recoloured,not removed.
Existing unused COLORS export preserved with semantic CSS variables;chart paints
read variables,not fixed RGB. Index CSS now only imports,geometry,theme scheme,
body/selection token colours and original body transition;obsolete global field,
shadow,toast and class-based light overrides are gone. Invalid-field selector
now names only border-nw-bad;existing field state/validation unchanged.

Permanent recursive src guard rejects all old Tailwind colour families and light
class patches;empty explicit exception list. Full-source non-presentation AST
compares23 TS/TSX files with1272a786,including every handler,payload,value,disabled,
required/isOpen and condition. Mutation probes reject money/handler/disabled
changes. Initial JSX AST output differed only CRLF/LF;parser input now normalizes
line endings and preserves the full comparison. Focused32/32 and auth pins PASS.
The five old light-theme contracts now assert approved palette/modal/toast/field
semantics directly instead of depending on deleted legacy compatibility rules;
no accessibility/single-toast behavior assertion removed.

Infinite lock pulse was ALREADY handled in1272a78:
effect.getTiming().iterations!==Infinity excludes it from awaiting,not from axe.
No helper edit. Assistant9–10px phone text remains deferred to phone review.
Focused Products/More browser run:75PASS/1 interrupted Products light1440.
Preserved trace proves Vite reloaded the fixture at01:44:50.202Z when this
writer saved HANDOFF_HISTORY.md (01:44:50Z):second harness GET/script timestamp
and second Vite/React boot reset the opening dialog. No product/test repair,
retry,timeout or assertion change. Frozen-tree unchanged Chromium Products
light/dark1440 recheck2/2PASS. Full quality then ran with repository writes
frozen;external log only. First full quality stopped at the batch1 static colour
contract requiring removed border-rose-500. Updated that one assertion to the
exact border-nw-bad selector AND var(--nw-bad)!important declaration;all other
assertions unchanged. No validation/event/SQL change.
Full quality after that correction:883Admin/189Customer PASS;both builds/SEO/
network isolation PASS;browser662PASS/59existing skips/7FAIL,retries0,exit1.
Six failures are the original Bottom Navigation fixture's bg-slate-950 wrapper
and exact legacy RGB expectations (both themes/all3projects),not source policy.
Fixture now uses bg-nw-bg/text-nw-text/muted;light canvas/toast and dark canvas/
toast expectations name exact approved token RGB values. Dark toast exclusion
became a stronger exact-value assertion. All actions/counts/axe rules retained.
Added full AST parity for this one fixture alongside23 source files.
Seventh failure:Chromium Orders dark1440 timed out90s inside the unchanged
waitForPackageFMotion page.evaluate,BEFORE axe. Trace fonts all200/complete;
no Vite reload. Same WebKit case PASS18.7s. Diagnostic3 loads observed only
Infinity pulse,correctly excluded. Root cause NOT yet proven;no helper repair
or blind timeout/retry. Original-case stress diagnosis and final gates follow.
Corrected Bottom Navigation focused19PASS/2existing conditional skips across
Chromium/WebKit/mobileChromium;all21original cases/axe retained. Recursive colour
guard additionally rejects legacy classes in that fixture;its full AST unchanged
outside presentation. No screen-next/Production/DB/CI authorization is inferred.
Final bounded diagnosis:original unchanged Orders dark1440 repeat20 =14PASS/
6TIMEOUT (same2workers,retries0). Temporary phase instrumentation repeat10
=8PASS/2TIMEOUT;readonly frame observer repeat6=5PASS/1TIMEOUT. Both retained
the original predicate and awaited native finished promises;no product edits.
The observer isolated a CSSTransition on BUTTON,property color,duration150ms.
At frame4 currentTime183.234ms and at frame60 currentTime1116.534ms:
playState=finished,pending=false,but captured finished promise still unresolved.
Computed foreground rgb(27,16,4),background rgb(240,138,60),opacity1 already
match final dark primary tokens. Thus native finished-promise dependency can
stall AFTER real rendering completes;this is NOT the excluded Infinity pulse.
Temporary diagnostics removed;helper git diff against1272a786 is empty.
External preserved evidence:motion-observer.log/helper.ts/trace.zip in the
nawasrah-batch7-quality-final-ec153db38f7b40eea3211c658ea1108d temp directory.
Suggested separately approved correction:re-discover finite running/pending/
paused animations after actual frames until none remain,instead of unbounded
waiting on an already-finished transition promise. Add a real CSS-transition
regression with an unresolved finished promise;retain paused-transition waiting,
Infinity exclusion and all axe/contrast rules. NO correction implemented here.
Focused static+AST contracts now37/37;staged Gitleaks exit0/no leaks. Batch7
delivery BLOCKED:quality not green;
no commit/push/new exact-SHA CI/visual closure. No owned processes remain.
No RPC/auth/session/role/permission/migration/CI/customer-app change.

Owner continuation (2026-10-11):implemented the bounded motion-gate correction
in the TEST helper only. Each double requestAnimationFrame re-discovers finite
pending/running/paused state;no captured finished-promise wait. Infinite-pulse
condition unchanged;paused transitions still block;all axe rules/nodes retained.
Existing Users control observes native getAnimations rather than finished getter;
all zero-before-release/one-after/contrast assertions retained. New permanent
real-CSS control substitutes an unresolved finished promise,pauses motion,proves
no premature audit,finishes natively and checks final state/colour before axe.
Original helper Orders dark1440 repeat20:14PASS/6TIMEOUT;corrected helper20/20
Chromium AND20/20 WebKit. Combined controls+Orders repeat20:240/240 PASS(19.8m),
2workers/retries0. A preliminary control run9PASS/1FAIL traced to localhost
React/react_jsx-dev-runtime502 before rendering at spec:9;no test/product edit
for that failure. Preserved accessibility-react-502-trace.zip with earlier logs.
Static39/39 PASS. Final detached full quality,staged Gitleaks0,commit/push and
exact-SHA all CI remain mandatory;no completion claimed until those gates pass.
Final-gate first invocation stopped at TypeScript:the test-only getAnimations
observer incorrectly declared a required argument while Document accepts none.
Corrected only that signature/call (zero arguments);all behavior/assertions
unchanged. No browser leg ran in that failed invocation;full quality follows.
That full quality completed exit0:884Admin/189Customer,673browser PASS and59
existing conditional skips,retries0. Owner then explicitly added a5s frame
deadline and a separate helper commit BEFORE batch7. Final helper throws
PACKAGE_F_MOTION_STUCK with element/property/playState/pending/currentTime;
no silent success,no timers/retries/rule exclusions. Permanent paused control
expects failure at the deadline and zero axe calls. Updated real-transition,
paused-failure,invalid-contrast and unchanged Orders repeat20:200/200 PASS across
Chromium/WebKit;Orders20/20 each. Maximum successful measured frame wait308ms
(200 samples),not total test duration. One sandbox-restricted start interrupted
before tests;no code/workflow change. Final full quality must cover this addition.

## Batch 6 — exact-CI Users transition correction (2026-10-11)

Owner-authorized correction baseline dd014f54ef5dcb8d70ee27ed084229d913ba7d8c.
Exact CI38097042768/job114344969045 failed3 light Chromium Users audits at
390/820/1440,immediately after switching to Security log. Target:inactive
Users button `.hover:text-nw-text` inside `bg-nw-surface-2`;CI measured
foreground#627185/background#e5e8ee,ratio4.05:1 (<4.5).

Actual native CSS color/background transitions were paused and sampled in
Chromium without altering product styles. Light halfway:foreground#7b8898,
composited background approximately#c4cad4,ratio2.197949:1. Final after
document.getAnimations().finished:foreground#55657a/background#f7f9fc,
ratio5.642425:1. Dark halfway:#7d8693 on approximately#41312e,3.350328:1;
final#9aa8bc on#0f172a,7.397092:1. Therefore this failure was transitional,
not an invalid final token pair. No product or global token edit.

`e2e/package-f-accessibility.ts` waits for real finite running,pending and
paused document animations,including CSS transitions,then re-discovers after
actual completion/cancellation. Uses animation.finished and animation frames,
not timers/retries. Infinite loading indicators cannot finish and are not
waited on;their DOM nodes/rules remain audited. Existing dialog data-state
and Motion-specific stabilization remain intact.
All13 existing Package F specs/14 axe calls use this one helper;existing
include selectors,tags,assertions,case names/timeouts/retries remain unchanged.
Permanent control pauses REAL Users CSS transitions (fixture-only duration
extended for deterministic capture),observes the helper awaiting finished,
asserts axe calls0 before release and1 after. A settled deliberately invalid
contrast fixture must still produce a serious color-contrast violation.
Static coverage guard prevents new Package F specs bypassing the shared gate.

Early diagnosis WebKit missed the short150ms transition;the final control
captures it deterministically. First regression fixture incorrectly named
the Users button count2 instead of its actual3;corrected selector derives
the count from staffRows. No old selector/assertion or product logic changed.
Focused controls6/6 (both browsers/themes),unchanged administration24/24,
static/auth16/16 and continuity7/7 PASS. Literal reverse-normalization of
all13 modified old specs recovers their accepted contents exactly:only the
shared import and analysis invocation changed,no old assertion/tag/selector.
First detached quality stopped at Admin units855/856:the new control spec
omitted the mandatory shared clipping guard. Added the real layout check to
the new spec (including its negative fixture);existing guard unchanged.
No financial/auth/runtime defect and no browser leg from that aborted run.
Corrected complete quality exit0,signal=null:Admin856/856,Customer189/189,
browser669PASS+59existing conditional skips=728,retries0,37.2m. Lint/typecheck,
Admin13.57s/Customer9.02s builds,SEO/network isolation PASS;no listeners on
4173–4176 after normal teardown. Started2026-10-11T00:35:32.991Z,
ended01:14:53.053Z,total39m20s. External log/exit proof:
C:/Users/TOP/AppData/Local/Temp/nawasrah-batch6-contrast-quality-16a39824a4c448fe9ac74b476434feeb.
Gitleaks0/independent correction commit/push/all exact-SHA CI precede visual STOP.
001–137,src/services/stores/CI,owner launch file unchanged;no batch7/Production.

## Batch 6 — assistant,login and lock (2026-10-11)

Owner visually accepted batch5 13d7db7 and authorized this batch only.
Baseline:13d7db7dcbb3677aa87a408c5f31a6e9b78bb78c.
Scope:LoginView,TurnstileWidget,IPhoneContainer,AdminAssistantView and App's
loading surfaces;shared SwitchTrack repairs storefront and product switches.
Semantic tokens/shared Card,FormFields and UiButton;associated field labels,
44px controls,scrollable auth surfaces. Existing credentials,disabled/required,
CAPTCHA/MFA/biometric/session/idle behavior and assistant payload remain intact.
Third-party Turnstile keeps its original explicit dark theme/flexible size and
all existing callbacks/reset/retry options;only its surrounding surface changes.

### Per-file AST evidence (baseline13d7db7)

| File | Calls/await | Event/value handlers | Native business props | Result |
| --- | ---: | ---: | ---: | --- |
| auth/LoginView.tsx | 3 | 10 | 24 | Identical |
| auth/TurnstileWidget.tsx | 0 | 0 | 0 | Identical;effects/widget API unchanged |
| layout/IPhoneContainer.tsx | 4 | 9 | 20 | Identical;protected DOM guards unchanged |
| assistant/AdminAssistantView.tsx | 1 | 5 | 11 | Identical;Edge payload/context/SKU unchanged |
| App.tsx | 0 | 0 | 0 | Identical;routing/session/theme effect unchanged |
| more/StorefrontSettingsModal.tsx | 5 | 19 | 30 | Identical;switch/save payload unchanged |
| products/ProductFormModal.tsx | 13 | 36 | 85 | Identical;flavour switch handler unchanged |

Permanent auth contract additionally pins component state/effects/handlers,
rendered security conditions,and complete useAuthStore/useAppStore/session
security/assistant service/navigation-model Git-blob contents (only CRLF→LF
normalized for Windows/Linux). Class-only presentation in
early-return loading markup is excluded explicitly;no business AST exclusion.
Existing batch2/batch5/light-theme/auth/Turnstile/assistant tests remain unchanged.
No old assertion removed,relaxed or renamed;new tests are additive.

SwitchTrack is a visual span only:solid nw-ok ON,nw-muted OFF,nw-surface knob.
The original owning role=switch,aria-checked,handlers and busy rules remain.
Visible storefront state:"يستقبل الطلبات"/"متوقف";section toggles also name state.
Permanent browser test checks each real storefront switch in both states/themes,
different solid colours and measured surrounding contrast≥3:1.

Preview:/e2e/package-f-auth-assistant-harness.html?view=login|mfa|lock|biometric|assistant&theme=light|dark.
Harness uses only loopback,test-only auth/CAPTCHA fixtures and original loopback
Edge transport;no successful real login,external CAPTCHA or Production access.
Browser proofs cover390/820/1440,axe serious/critical=0,shared clipping guard,
Latin digits,44px fields,primary actions in viewport,CAPTCHA gating,known-email
unlock/MFA,protected DOM removal,and exact assistant context/SKU request flow.
Existing session-security/integrated browser tests remain required by quality.

Focused contracts51/51,typecheck/ESLint PASS;final focused browsers38/38
(batch6 24/24 + unchanged session-security14/14),Chromium/WebKit,retries0,
all6theme/size combinations and measured switch contrast PASS.
One new lock-MFA fixture initially returned success=false with mfaRequired=true;
the existing rejection guard correctly refused it. Fixture now uses the actual
store contract success=true,mfaRequired=true;no product/auth correction needed.
Single full quality returned exit0:Admin854/854,Customer189/189,typecheck/ESLint,
both builds10.35s/8.70s,SEO and network isolation PASS;browser663 PASS+59 existing
conditional skips=722,retries0,33.0m. Whole supervisor35m03s,started
2026-10-10T23:24:54.013Z,ended23:59:57.080Z,signal=null,no native abort.
Detached log/exit:C:/Users/TOP/AppData/Local/Temp/nawasrah-batch6-quality-0e7991feccf5469fa3eca1236aa4fdc4.
No product/spec/CI edits during quality;no surviving owned test server/runner.
001–137,services/stores/CI and owner launch file unchanged. Next authorized
Gitleaks0/commit/push/exact-SHA CI then checkpoint/visual STOP;no batch7.

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

### Batch3 —2026-10-10 partial presentation;STOP for existing action wiring

A/B delivered in order:0b5564ee61ec1c7144b4433a8aa755be170b6611,
then a7d2a704aebeae976cc3405b6f2c52f0b21a03ce. Gitleaks staged exit0
before each commit;push/main matches. Exact quality38069513080 all19/19,
secrets38069513089 PASS;official verify-handoff --delivery PASS. No rerun.

Twelve purchasing/direct-receiving screens now use tokens,Card,UiButton,
DataTable and FormFields. DataTable scrolls internally and is keyboard-focusable;
FormFields forwards the existing dialog ref. All calls/payloads,event bindings,
constraints/effective button types and non-render functions are pinned against
a7d2a70 in package-f-remaining-batch3.test.ts:AST2/2 PASS. Pure colour literals
alone are normalized;money strings and guards are NOT excluded. Typecheck0.

| File | calls | events |
| --- | ---: | ---: |
| CreatePurchaseOrderModal |11|24|
| CreateSupplierModal |4|12|
| PurchaseOrderCard |0|4|
| PurchaseOrderDetailView |10|25|
| PurchasesView |7|55|
| ReceiveGoodsModal |2|8|
| SupplierPaymentModal |7|11|
| CancelSupplierReceiptDialog |8|4|
| CreateDirectReceiptModal |16|34|
| DirectReceivingView |10|38|
| RecordSupplierPaymentModal |2|8|
| SupplierReceiptDetailView |2|9|

Loopback-only harness covers open/partial/received POs,partial payment,direct
receipt and cancellation preview including Cash from a closed shift. Display
reads are fixtures;mutation RPCs retain original isolated transport (no fake
committed success). Initial Chromium4/8 revealed390 receipt action overflow,
unnamed close buttons and table keyboard access. Presentation-only fixes
then7/8 PASS;one dark audit timed out awaiting a finite dialog animation.
That audit remains OPEN;no retries/timeouts/assertions weakened. WebKit and
full quality are not yet run for batch3. No batch3 commit/push.

#### Confirmed pre-existing product defect requiring authorization

Baseline a7d2a70 and current PurchasesView both omit isOpen when mounting
ReceiveGoodsModal and SupplierPaymentModal. Their unchanged guards return
null when isOpen is missing. The caller also passes preselectedSupplier,but
SupplierPaymentModal accepts supplierId instead. PurchaseOrderDetailView
passes supported isOpen values correctly;the V2 RPC itself is not the defect.

Permanent real-controller Chromium probes,retries0:quick receive and new
voucher both FAIL `dialog ... element(s) not found` after button clicks,
at purchasing.spec.ts:51/56. No monetary mutation in these probes. Source
before/after confirms the same missing/unsupported props;not a token regression.

Proposed owner decision:authorize existing dialog prop wiring only (isOpen
for both;selected supplier id via supported supplierId). No SQL,service
payload,equation,guard or confirmation change. This activates existing reads
and actions previously unreachable here,so it is not silently included in
the presentation-only AST contract. After approval,prove only intended prop
changes,resolve animation audit,run both browsers/full quality/Gitleaks0,
commit/push/exact CI and STOP for visual review. Checkout instrumentation
stays deferred after batch7. Package E B/C follow-ups are not implemented.

#### Owner-approved purchase-list wiring/type correction —2026-10-10

Separate wiring commit changes only ReceiveGoodsModal.isOpen,
SupplierPaymentModal.isOpen and supported supplierId (selected supplier id).
Both dialog exports now type their destructured parameter explicitly instead
of relying on React.FC. No handler,validation,request builder,idempotency key,
service call,financial equation or permission change.

TypeScript cause verified:all three files are in the root tsconfig;Admin has
no node_modules/@types/react or root React dev-type dependencies (Customer
has its own). noImplicitAny is unset/false. The unresolved React.FC annotation
therefore did not enforce these props;baseline tsc reported zero diagnostics.
A source-grounded in-memory compiler probe with explicit parameter types and
the OLD callers reports TS2741 missing isOpen and TS2322 unsupported
preselectedSupplier. Compile-only tests/types/purchase-dialog-props.tsx locks
non-any parameter contracts and negative required/unsupported props. Expected
errors exist only in test fixtures;no application errors are suppressed.
This hardens the TWO approved components;it does not claim Admin-wide React
declaration completeness or alter global TS rules/dependencies.

History:817c98f (2026-07-24) passed isOpen correctly;0279479
(2026-07-25T03:57:25+03:00,feat(purchases):enhance purchase order management)
removed both isOpen props and introduced unsupported preselectedSupplier.
git show/blame confirms the defect predates Package F and remains on8195f87.
It is LIKELY present in an older deployed release containing this file version,
not verified Production truth:no live access,bundle or deployment inspection.
The owner can use this evidence to notify the shop owner without claiming a
live reproduction. PurchaseOrderDetailView's existing supported wiring remains
unchanged. Runtime payload comparison uses identical committed read fixtures,
rejects intercepted submissions without fake success,and checks ALL business
fields;only independently generated attempt keys may differ (valid,distinct).

#### Batch3 final local presentation evidence

Wiring/type-contract commit:0b9cf9103c08f14c4b2aeea901b1586520632978,
four files only (three scoped component sources + compile-negative fixture).
Staged AST/erased-runtime proof:after removing ONLY approved wiring props,
all three runtime ASTs are identical to a7d2a70. Gitleaks staged exit0.
Additional negative fixtures cover EVERY required prop in both dialogs.
No root TS/compiler/dependency rules were disabled or changed.

Final purchasing focused run28/28 PASS,Chromium+WebKit,width390/820/1440,
light/dark,retries0:four-screen geometry (lists/direct/receipt/PO details),
all seven dialogs,axe serious/critical zero,Latin digits,44px fields,
phone submit visibility,Cancel preview Cash/closed-shift warning,actual list
open/close/supplier selection,full business-payload equality with Details.
Print assertions prove paper stays light/readable regardless of screen theme.
New four print tokens leave existing palette values unchanged and obey the
existing same-theme-set/Tailwind-export foundation contract. No foundation
assertion changed. Native DataTable + FormFields forwarding has a permanent
server-render contract test;all financial/event/native contracts remain pinned.

Earlier27/28 run failed axe with `Execution context was destroyed` while
editing a compile fixture during a running dev server;trace shows Vite
connecting again on the same page. Exact initiating cause is not proved.
After freezing ALL files for the complete rerun,28/28 PASS. No retries,
random wait,timeout increase or axe exclusion. Modal audits wait for its real
data-state=open before existing finite-animation completion (no product change).

Old presentation contract updated:tests/phase6-package-a.test.ts no longer
requires local toFixed(3) spelling in four migrated purchasing displays;
it requires shared formatJod import+use and proves negative,zero,and grouped
three-decimal values. Existing no-cent-rounding and all reader/financial
assertions retained;non-migrated displays still require their old formatter.
Full quality is run ONCE after these focused gates;delivery remains pending.
Harness:/e2e/package-f-purchasing-harness.html?theme=light|dark,views:
purchases,direct,po-detail,receipt,create-po,supplier,receive,payment,
create-direct,receipt-payment,cancel. Fixture reads only;no fabricated writes.

#### Batch3 quality completion —2026-10-10

The single npm run quality invocation passed typecheck/ESLint,831/831 Admin
units,189/189 Customer units,both builds/SEO and isolation(external escaped0,
Production escaped0),then its terminal session disappeared during browser
execution. There was no final exit code or completed full-browser report.
The saved HTML report was the earlier focused28/28 report,NOT full quality.
No assertion was changed and no aggregate exit0 is claimed for that process.

Resumed ONLY the final command(npm run test:e2e),not the preceding gates,on
the exact unchanged checkpoint fingerprint.646 cases:587 PASS,59 existing
conditional skips,retries0,29.3m,exit0;last-run status passed/failedTests[].
The final global network audit also completed;QA ports4173–4176 no longer
listen. agent:resume safeToResume=true proves the worktree stayed unchanged.
The independent intermittent checkout issue remains OPEN despite passing
this run.001–137 unchanged,no138,no Production/deploy. Commit/exact CI next.

## Batch4 — expenses and reports;2026-10-10

Baseline47c958dac0019f28d21d9ac53881b2838fdd304c,visually accepted batch3.
Presentation only:ExpensesView/ExpenseFormModal/ReportsCenterView,plus the
three purchasing phone/header/payment-tone notes. No services,stores,readers,
writers,roles,confirmations,financial equations or migrations changed.

Expenses use shared KPI/Card/MoneyText,Latin grouped three-decimal amounts,
formatUiDate and semantic tokens. Expense forms retain Cash/CliQ,reference,
open-shift,validity and busy/dirty close guards;fields are44px with labels.
Reports keep the9 simple financial cards,expandable details,integrity warning,
date/preset requests and print behavior. Tables scroll inside their containers;
printing uses existing print tokens,not screen dark colours.
Purchasing phone actions occupy3 compact one-line columns with unchanged
accessible full names/actions;payment is primary,not danger. Supplier dues
card has one surface background,not conflicting good/bad backgrounds.

### Permanent baseline AST contracts

| File | Business calls | Event bindings | Native/value/validity properties | Result |
|---|---:|---:|---:|---|
| ExpensesView.tsx | 5 | 2 | 3 | Identical |
| ExpenseFormModal.tsx | 1 | 7 | 15 | Identical |
| ReportsCenterView.tsx | 3 | 9 | 35 | Identical |
| PurchasesView.tsx | 8 | 55 | 59 | Identical |
| PurchaseOrderCard.tsx | 0 | 4 | 2 | Identical |

scripts/testing/package-f-financial-ui-contract.mjs records normalized AST
hashes from the baseline in tests/package-f-remaining-batch4.test.ts. Includes
await/service/RPC/run/openModal calls,payloads,onChange and other handlers,
native validation/busy/value properties,non-render functions and monetary
guards. Normalization excludes ONLY display colour literals and the named
money display formatter;it does not exclude financial calculations/requests.
New KPI display value is not treated as an input binding. UiButton effective
button type is compared to native button type,including form defaults.

### Focused evidence

40/40 Chromium+WebKit,retries0,3.5m:financial harness28 cases plus existing
Phase6A12. Both themes,width390/820/1440,axe serious/critical zero,shared
layout/clipping checks,Latin numbers,form labels44px and phone submit visibility.
Cash/CliQ submissions assert exact existing payloads and reference validation;
reversal asserts original expense identity and explicit trimmed reason.
No-shift,busy Escape,error retry,integrity warning,9 main report cards,
detail-before-print and purchasing visual notes remain covered. Fixtures
intercept rejected mutations;they never fabricate a committed business result.
Initial19 focused unit assertions passed;final focused units23/23 passed.
After preview-only metadata type correction,financial28/28 rerun passed,
2.7m,retries0;typecheck and affected ESLint passed. Full quality pending.

Old presentation expectation changed ONLY in e2e/phase6-package-a.spec.ts:
negative refund amount uses the shared en-US grouped Latin three-decimal
display instead of old ar-JO digit formatting. Same exact signed amount and
precision asserted;all reader/financial assertions remain unchanged.
Preview fixture currentUser inherits existing required metadata;no product
store code changed for fixture typing. Final typecheck/focused gates rerun
after this preview-only correction before full quality.

React19 typing measurement:11 diagnostics/8files,0 confirmed active
financial/inventory behavioral defects. Exact diagnostics/source triage and
primary-tree equality/removal of the separate worktree:TYPES_MEASUREMENT.md.
This is NOT a strict-mode audit or proof of no runtime defects. Full typing
repair remains AFTERbatch7,not hidden inside this presentation commit.

Harness:/e2e/package-f-financial-harness.html?theme=light|dark,
view=expenses|reports|expense-form;shift=closed,integrity=critical,report=error
are explicit fixture scenarios. All traffic is isolated/loopback.
Full npm run quality completed in ONE invocation,exit0:typecheck/ESLint,
Admin and Customer units(Customer189/189),both builds/SEO,isolation and
615 browser PASS/59 existing conditional skips,retries0,30.2m browser leg.
The global network isolation audit reported externalRequestsEscaped=0 and
productionRequestsEscaped=0. No timeout,retry,skip or axe exclusion added.
Migrations001–137,services,stores,CI and root dependency/compiler files unchanged.
Gitleaks0,commit/push/exact CI then STOP for visual approval.
No batch5,Production/deploy or Phase7;the independent checkout issue stays OPEN.

### 2026-10-10 — approved CI-only Package F sharding

Batch4 b06adacfdf8757a4b0f779332e43f6f6fcc14664 contains the accepted
presentation work. Its Package F CI job114305650120 was cancelled after1204s
(20:25:35–20:45:39UTC);the browser gate occupied19m and the last log says
"The operation was canceled". Secrets passed;17 other quality jobs succeeded.
No product failure is inferred from that cancellation.

Owner approves three real Playwright shards (1/3,2/3,3/3),not fewer tests.
Automatic package-f-*.spec.ts selection,base browser settings,network guard,
image digest,retries and20m limit are unchanged. Each shard has its own job
container/filesystem/network namespace and uniquely named failure artifact.
fail-fast=false lets all shards finish;the aggregate requires the matrix's
success,and exact-SHA delivery verifies each of the three unique job names.

Dynamic --list proof at this checkout:674 total =362 core +113+106+93 Package F.
These are observed counts,NOT pinned acceptance constants. Every future
matching spec enters the partition automatically. Permanent tests reject
missing/empty/duplicate/substituted/misrouted cases and failed/skipped/cancelled
shards. Focused CI tests4/4,all Admin units838/838,typecheck and strict ESLint PASS.
CI-mode discovery returns the same674 identities and113/106/93 partition. Final CI pending;
report each shard's actual duration (target <12m) after the push. No source UI,
browser assertions,dependencies,compiler files or migrations modified.
Full local quality already passed on b06adac;CI-only changes are verified by
focused tools and full exact-SHA CI rather than repeating the30m local browser leg.
After green CI/checkpoint STOP for visual review;no batch5 or Production/deploy.

## Batch5 — users,monitoring,storefront settings and promotions (2026-10-11)

Owner visually accepts batch4 b06adac without notes. Sharding dca6e9c is
delivered:quality38085542982 SUCCESS21/21,secrets38085542967 SUCCESS.
Shard job durations7:32/9:05/10:53,all below12m. This batch does not alter CI.

Presentation-only scope:UsersView,UserFormModal,MonitoringDashboardModal,
StorefrontSettingsModal,PromotionCodesModal and scoped shared field CSS.
All5 now use nw tokens,Card/FormFields/UiButton,native fields >=44px,
accessible field/button names,Latin-date formatUiDate and grouped three-decimal
MoneyText for fixed promotion amounts. Native number inputs intentionally keep
their numeric editing values;no formatting changes the value sent to a writer.
User email has deliberate truncation/full title/LTR. Permission chips wrap and
scroll internally. Existing form save actions stick inside their dialog;all
fields,role options,status toggles and cancellation actions remain reachable.
No new data reads,roles,policies,financial calculations or business decisions.

### Per-file baseline AST proof — dca6e9c

| File | Calls/payloads | Event/onChange bindings | Native input/guard properties | Result |
|---|---:|---:|---:|---|
| UsersView.tsx | 8 | 15 | 21 | Identical |
| UserFormModal.tsx | 4 | 9 | 25 | Identical |
| MonitoringDashboardModal.tsx | 1 | 2 | 2 | Identical |
| StorefrontSettingsModal.tsx | 5 | 19 | 30 | Identical |
| PromotionCodesModal.tsx | 7 | 16 | 40 | Identical |

Permanent baseline hashes live in package-f-remaining-batch5.test.ts,using
administrationUiContract and the existing financial UI extractor. It also pins
roleLabels/defaultRole/isOwner/isEditing/currentRolePermissions declarations.
Full non-render handlers preserve validation,owner-grant confirmation,password
constraints,exact forwarding,and try/finally. Only the named pure formatDate
display helper is normalized;its complete NEW implementation is independently
asserted. Other non-render functions remain pinned. No staff service,auth/store,
Edge Function,grant,migration or storefront/promotion service changed.

### Harness and focused verification

/e2e/package-f-administration-harness.html?theme=light|dark
view=users(default)|monitoring|settings|promotions;role=cashier and
monitoring=error are explicit preview scenarios. Only loopback URLs are accepted.
Existing components/services consume fixture reads;writes use the original
transport and the tests reject them deliberately,never fabricate committed success.

Initial fixture failed because Supabase's functions getter creates a fresh
client on each access;the local fixture client is now pinned ONLY in the harness.
No staff API implementation was patched. A real light-theme presentation issue
was caught by axe:active Users tab text#0f1b2d over#13294b gave1.19:1. It now
uses text-nw-on-primary;390px Chromium/WebKit all-screen probes both PASS.
No global token,timeout,retry or contrast exemption was changed.

Focused static/behavioral contracts21/21 PASS (staff ownership,monitoring,
delivery fees plus batch5 AST). Permanent browser suite covers both themes,
390/820/1440,axe serious/critical zero,horizontal containment,shared clipping
guard,Latin dates,44px fields,phone save visibility,last policy reachability,
full staff creation/edit/password/activation payloads,owner-grant cancellation,
busy Escape guards,non-owner denial,storefront exact monetary/policy/toggle
payload,promotion percentage rejection/save/disable,and monitoring read retry.
No previous test assertion or selector changed in this batch.
Focused probe corrections (new tests only):HTTP400 staff failures display the
existing exact FunctionsHttpError text,not its unparsed JSON body;the disabled
Storefront submit is named "جارٍ الحفظ..." while busy. Dialog probes wait for
the real data-state=open before interactions. Diagnostic success screenshots
were removed from the spec after Chromium stalled inside page.screenshot;
all axe/layout/field/action assertions remain and failure traces stay enabled.
The existing promotion input min=.001/step=.01 rejects101 with stepMismatch
before submit. A permanent probe now proves that native rejection AND reaches
the unchanged >100 guard with101.001. No constraint or financial validation
changed;the old percentage step alignment remains a separately noted concern.
Focused final probes:23/24 PASS;the remaining Chromium390 case lost its
execution context during Monitoring layout audit. The SAME case rerun twice
with Vite dependency diagnostics passed2/2,no code/assertion/retry/timeout
change. No late dependency rediscovery/504 occurred in that diagnostic run.
All WebKit12/12 passed,including the six layout and six behavior cases.
Typecheck,strict ESLint and focused contracts21/21 PASS.
Quality attempt1 stopped before browser/build stages:Admin839/840,the sole
failure was the unchanged ACTIVE_TASK <=4096-byte guard. Old task results were
removed from the current-only continuity record;the same guard now PASS5/5.
No assertion or business file was changed for this correction. Full quality
is rerun after that metadata correction;Gitleaks/commit/exact CI pending.
Quality attempt2:Admin840/840 and Customer189/189,typecheck/ESLint PASS.
Admin Vite emitted "built in13.23s",then the Windows Node process aborted:
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),file src\\win\\async.c,line94.
Local runtime Nodev24.18.0,libuv1.52.1 at C:\\Program Files\\nodejs\\node.exe.
Exit1 occurred before Customer build/isolation/full browser stages;therefore
FULL QUALITY IS NOT PASS. No product/test/workflow/runtime adjustment was made
for this native failure;exact root cause not proven. STOP pending owner direction
before another full quality attempt. No staging/commit/push/new CI yet.
001–137 immutable;no138,Production/deploy,Phase7,automations or batch6.
React typing repair and independent checkout investigation remain after batch7.

### Owner-authorized single Windows quality retry —2026-10-11

Pre-retry node -v=v24.18.0 (libuv1.52.1). Exact observed failing leg:
npm run quality -> npm run build -> vite build,at native process shutdown
after Vite's success line. The following run-customer-isolated-build.mjs leg
had NOT started in the saved output;neither Playwright webServer nor the
isolated Vite preview runner was running at this failure boundary.
Only one new full quality attempt is authorized;no product/spec/CI/runtime
change. If the native abort repeats,STOP and propose orderly child exit only.
The exact40 stdout lines BEFORE the assertion (retained from attempt2):

```text
dist/assets/productCalculations-BjPc5x3P.js                             0.51 kB │ gzip:   0.26 kB
dist/assets/ProductGlyph-DlXV7v6i.js                                    0.52 kB │ gzip:   0.35 kB
dist/assets/monitoring.service-B9bdQ41B.js                              1.05 kB │ gzip:   0.56 kB
dist/assets/inventoryFormatter-BJqmzQHi.js                              1.44 kB │ gzip:   0.63 kB
dist/assets/TableShell-7r9JYwsp.js                                      1.54 kB │ gzip:   0.64 kB
dist/assets/uiFormat-DT5WccmT.js                                        1.58 kB │ gzip:   0.72 kB
dist/assets/Surface-CIwaY5rx.js                                         1.97 kB │ gzip:   0.75 kB
dist/assets/Modal-jwXXakcG.js                                           2.32 kB │ gzip:   1.11 kB
dist/assets/DataDisplay-DmYMJFjX.js                                     2.42 kB │ gzip:   1.04 kB
dist/assets/barcodeCamera-DYvxwwcT.js                                   2.58 kB │ gzip:   1.28 kB
dist/assets/businessError-BBOW7EvD.js                                   2.65 kB │ gzip:   1.36 kB
dist/assets/ExpensesView-ITaFqryo.js                                    4.71 kB │ gzip:   1.91 kB
dist/assets/productIdentifiers-BMthA7Z-.js                              5.63 kB │ gzip:   2.22 kB
dist/assets/BarcodeScannerModal-aoIDZrCZ.js                             8.10 kB │ gzip:   2.96 kB
dist/assets/crm.service-CWfW2ZvE.js                                     8.34 kB │ gzip:   2.92 kB
dist/assets/vendor-BXB0Orlr.js                                         10.02 kB │ gzip:   3.49 kB
dist/assets/AdminAssistantView-BJQskJt7.js                             10.34 kB │ gzip:   3.69 kB
dist/assets/RecordCustomerPaymentModal-DMH9TUT5.js                     10.89 kB │ gzip:   3.74 kB
dist/assets/OrdersCenterView-MNntoDt7.js                               12.34 kB │ gzip:   4.76 kB
dist/assets/MoreMenuView-D6EfreXc.js                                   13.98 kB │ gzip:   4.12 kB
dist/assets/ProductsView-Sj6lA3J7.js                                   19.66 kB │ gzip:   5.33 kB
dist/assets/DashboardView-DMCsB5Bu.js                                  22.02 kB │ gzip:   7.03 kB
dist/assets/UsersView-DkWlbQOe.js                                      22.70 kB │ gzip:   6.39 kB
dist/assets/InventoryView-DoVfVBxP.js                                  26.11 kB │ gzip:   7.81 kB
dist/assets/ReportsCenterView-BF7u4rx_.js                              30.08 kB │ gzip:   7.67 kB
dist/assets/AccountsView-BxNc1iPH.js                                   43.47 kB │ gzip:  10.90 kB
dist/assets/ShiftsView-CKSQX6YS.js                                     52.11 kB │ gzip:  11.99 kB
dist/assets/DirectReceivingView-CxGOV778.js                            54.96 kB │ gzip:  11.45 kB
dist/assets/PosView-bWW35l94.js                                        55.32 kB │ gzip:  16.97 kB
dist/assets/icons-CqMuOrz5.js                                          58.91 kB │ gzip:  11.78 kB
dist/assets/CreateDirectReceiptModal-BnqCXMsx.js                       62.02 kB │ gzip:  14.49 kB
dist/assets/OrderDetailModal-5kwOKVGS.js                               92.80 kB │ gzip:  22.88 kB
dist/assets/motion-BOkrvcQP.js                                        128.87 kB │ gzip:  42.38 kB
dist/assets/react-ChRHXLzJ.js                                         189.95 kB │ gzip:  59.24 kB
dist/assets/supabase-DLbJaTt8.js                                      209.62 kB │ gzip:  54.43 kB
dist/assets/AllModals-CECjGgW-.js                                     222.39 kB │ gzip:  50.74 kB
dist/assets/index-Eq4-fXJp.js                                         227.67 kB │ gzip:  59.25 kB
dist/assets/scanner-mT7gTMOQ.js                                       375.21 kB │ gzip: 110.59 kB
dist/assets/monitoring-D4oDJTUm.js                                    494.03 kB │ gzip: 163.17 kB
✓ built in 13.23s
```

### Single retry interrupted before final browser result —2026-10-11

The ONE authorized retry used unchanged product/spec/CI files. Admin840/840
and Customer189/189,typecheck/lint passed. Admin build14.84s and Customer
isolated build8.59s,SEO and browser isolation passed. The native Windows abort
did not recur in the observed output. Full Playwright discovery was698 cases;
the last retained output reached case595,with no observed test failure.
The waiting execution was interrupted;on continuation cell366 and process
session14427 were absent. Read-only process inventory found no surviving
quality/Playwright/Vite child. No current .last-run.json or completed report
exists:playwright-report/index.html timestamp21:33:11UTC predates the retry
checkpoint21:41:19UTC and cannot prove this retry completed.
Therefore no aggregate quality exit0 or complete browser PASS is claimed.
No third full quality attempt,product/CI correction,staging,commit or push.
Owner direction is needed to complete the interrupted browser leg without
repeating the successful lint/unit/build legs.001–137 and owner launch file
remain unchanged;no Production/deploy,batch6 or Phase7.

### Approved detached browser completion —2026-10-11

Owner approved ONLY the full browser leg with its original command/settings:
npm.cmd run test:e2e,no selected files,retries or timeout changes. A temporary
supervisor outside the repository launched the original npm command and wrote
raw stdout/stderr to browser.log plus exit.json after child close. Evidence:
C:/Users/TOP/AppData/Local/Temp/nawasrah-batch5-browser-4561746ef9944f3faeb52ad12223f1fc.
Started22:15:59UTC,ended22:48:15UTC:639 passed,59 known conditional skips,
698 total,32.2m;BROWSER_EXIT_CODE=0,signal=null,.last-run.json passed with
failedTests=[]. Batch5 permanent spec24/24 PASS across Chromium/WebKit.
No product/spec/CI changes during this continuation. Final network-audit
teardown passed (unexpected denied attempts0,escaped external requests0).
Read-only process inventory confirms no surviving owned test runner/server.
All quality component gates are complete:previous Admin840/840,Customer189/189,
lint/typecheck,builds/SEO/isolation PASS plus this complete browser leg. The
interrupted quality parent itself is NOT claimed to have returned exit0.
Next:Gitleaks staged exit0,authorized batch5 commit/push,all exact-SHA CI jobs
and secrets green,checkpoint,STOP for visual review. No batch6/Production.

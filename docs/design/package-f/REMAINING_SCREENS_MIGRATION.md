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

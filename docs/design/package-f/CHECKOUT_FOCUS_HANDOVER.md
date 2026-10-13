# Storefront focus-only handover — 2026-10-12

## Admin follow-up authorized2026-10-13

Measurement d8bc619 complete;see ADMIN_FOCUS_HANDOVER_MEASUREMENT.md. Owner
authorizes Admin display/focus correction;ADMIN_FOCUS_HANDOVER_FIX.md records
the current repair and invariants. The old five shared cases are retained and
two neutral/handover cases now run IDENTICALLY on both utilities. Customer
product files remain unchanged;this is not a new Customer checkout repair.

Owner decision:repair the proven CHECKOUT_NAME_DIAGNOSIS.md race,not a form
reset or a test-readiness workaround. Only two product files change:
customer-web/src/hooks/useDialogFocus.ts and src/utils/dialogFocus.ts.
All CheckoutModal/CartDrawer/App/form/state/coordinator/RPC/validation/business
files and the two original checkout specs remain byte-identical to1473410.

The hook registers/removes focus guards in useLayoutEffect. Inert/aria-hidden
or disconnected dialogs cannot own keyboard/focus. Registration preserves an
already valid active element inside the new panel. Otherwise initial focus goes
to the neutral tabIndex=-1 panel,not a close button which immediate Enter could
activate. Tab wrapping and top-only Escape retain their established semantics.
Cleanup preserves a valid focused element in a newly committed/live dialog;
its original opener is carried across Cart->Checkout for eventual restoration.
Nested dialog restoration must not steal a newer interaction in its parent.
No timing delay,form change,random wait,retry or timeout increase is introduced.

Permanent regressions:new real storefront opening observer focuses the same
name DOM node at the earliest committed opening,then real keyboard input must
remain complete/focused. Immediate Enter cannot close Checkout;normal Checkout
and Cart close restore the Cart trigger. Native deterministic guard control
proves an inert predecessor/cleanup/new registration cannot steal name focus,
and final close restores the original opener. Existing nested/Escape tests stay.

Types (both applications),affected strict ESLint and focused customer unit4/4
PASS. One attempted npm-prefix exec invocation resolved tests from the root and
ran no test;corrected explicit customer-workdir invocation passed all4. No test
expectation or product correction was needed for that invocation error.
Focused browser/original repeat50-per-engine/full-quality/Gitleaks/commit/exactCI
still pending. All tests run on frozen source with isolated logged servers.

First focused browser exit1:22PASS/4FAIL. All4 are the two new real-storefront
cases on both engines:openCart waited for an Add button which never existed,
because the new fixture incorrectly supplied empty saleUnitId;the established
catalog filter in catalog.service.ts:194 excludes it. No Checkout/focus action
was reached. Native focus control and all20old nested/Escape cases PASS.
Correct only the new fixture's category/unit/sale-unit facts and its existing
snapshot response;no product,assertion,timeout or retry correction. Re-run the
new spec only;the20successful old cases are retained as separate evidence.

Corrected new spec PASS6/6,Chromium+WebKit,46.4s/retries0. Immediate real
keyboard/name/node preservation,neutral Enter/ordinary restoration and the
native handover all pass. No product edit was made to correct the fixture.
Next:the two untouched original cases repeat50 each on BOTH engines (200total)
with the current local memory policy,then one full detached logged quality.

Original proof COMPLETE exit0,09:04:28.130–09:35:32.772UTC (31m4.642s):
Chromium100/100 and WebKit100/100,50per original case per engine,1local worker,
retries0. No temporary observation/readiness wait/original-spec change in this
sample. Both original specs and ALL components/App/services/checkout/coordinator
remain literally unchanged against1473410. This deterministic control plus200
passing samples supports the focus repair;it is not a guarantee of zero future
browser defects. Full detached quality/Gitleaks/commit/exactCI still required.

Full quality-focus STOPPED exit1,09:36:05.569–09:37:20.005UTC:Admin915PASS/
1FAIL of916,before customer/build/browser legs. The only failure is
tests/phase6-bc-dialog-safety.test.ts:8,which demands literal whole-file equality
between Customer and Admin dialogFocus utilities. The owner-approved Customer-
only handover repair intentionally breaks that old copy-equality contract.
No behavioral/RPC/financial assertion failed in this gate;it is NOT full PASS.
Admin utility,Checkout/App/components/services and both original specs remain
unchanged. Test ports closed;no owned verification process remains.

STOP before modifying that assertion or widening the product repair. Proposed
contract update for owner review:compare the exact shared Tab/Escape/focusable
ASTs,retain standalone Customer imports/nested-dialog and busy-form checks,and
retain/add explicit Customer handover regressions. Do not change Admin focus
just to restore whole-file equality. No focus commit/push yet;phone12px pending.

## Owner-approved contract replacement

Owner2026-10-12 authorizes a SHARED runtime behavioral suite,not merely a
source/AST comparison. e2e/helpers/dialog-focus-contract.ts registers exactly
the same five cases for each real implementation,loaded natively from its own
isolated Vite origin. No app-specific behavior branch:ordinary and nested Tab
wrap in both directions;Escape closes top only;ordinary/nested opener restores;
focus cannot escape to a lower dialog or outside. Both engines test both copies.
Standalone Customer imports and ALL busy/finally checks stay unchanged.

The two copies now intentionally differ:the owner approved commit-phase focus
handover correction ONLY in Customer after the proven Cart->Checkout race.
Admin source is unchanged;shared behavior protects the old safety guarantees,
while Customer-only handover/neutral Enter/keyboard cases protect its extension.
Real Cart and Checkout neutral-focus panels retain tabIndex=-1 and their explicit
aria-labelledby names;the permanent opening/Enter regression checks both.

Open follow-up (MEASURE ONLY,later):does Admin have the same two-dialog focus
handover pattern when a dialog opens from another dialog? Inventory its actual
paths and measure focus behavior before any proposed Admin change. Not executed
or broadened into the current repair.

Shared contract + real Customer neutral named panels PASS26/26 on Chromium and
WebKit,09:46:40.306–09:47:58.069UTC (77.763s),retries0. Both utilities run all
five IDENTICAL safety cases. Product code has not changed since the200/200
original proof;only the authorized contract/new accessible-context assertions
and documentation changed. Updated static/busy tests2/2,types and strict lint
PASS. Fresh full quality-focus-contract is the next frozen gate.

quality-focus-contract exit1,09:49:32.017–09:51:05.735UTC:Admin915PASS/1FAIL,
before build/browser. Existing phase3-harness-stability isolation guard requires
EVERY spec to import ./isolated-test directly;the new shared registration spec
initially only imported its helper (which already uses that exact isolated
test instance). Correct the NEW spec to use the isolated test.describe wrapper
directly. No change to network guard,assertion,product,timeout or retry. Shared
fixture/behavior implementation unchanged;static isolation recheck precedes
the corrected full gate. Neither failed quality run is an aggregate PASS.

Final quality-focus-final COMPLETE exit0,09:53:07.123–11:20:29.046UTC
(87m21.923s):Admin916/916,Customer191/191,browser771PASS+59existing conditional
skips=830,retries0;types/lints/builds/SEO/isolation PASS. Same detached process
continued across the session/usage interruption;NO restart or duplicate run.
agent:resume at the end confirms the pre-run checkpoint fingerprint matches;
source stayed frozen. All owned listeners4173–4176 stopped. Original200/200,
shared26/26 and old nested20/20 proofs retained. Gitleaks/commit/exactCI next.

Delivered95058f7849c860f6953f07e8fd848dc57f4298d2 after stagedGitleaks0;
exact quality38242137444 all21/21 and secrets38242137405 PASS. Official delivery
verifier confirms HEAD/remote/workflows. Only phone12px presentation remains.

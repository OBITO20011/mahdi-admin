# Checkout name input — bounded diagnosis, 2026-10-12

Status: reproduced focus-handover defect; STOP for owner approval of product correction. No repair, test-readiness workaround, commit, push, Production or deploy in this diagnosis.

## Delivered baseline and method

HEAD/main: `1807f93a5f9439f4a6eba768ae9e3de02d17b8c7`. Its earlier delivery is green: quality38180882639 (21/21), secrets38180882601. This does not turn the recorded local full-quality checkout failure into a PASS.

The original two tests retained their fill/actions/assertions. Temporary observation recorded every existing setForm source, mounts/commits, DOM focus/input/beforeinput, native value setters, actual input identity using a WeakMap, added/removed inputs and animation state. Before/after name-fill snapshots add observation round trips, not waits or readiness guards. No forced focus timing in this run. A previous deliberately delayed-focus probe is NOT counted as a natural failure or part of these100.

Command: `playwright test e2e/customer-presentational-characterization.spec.ts e2e/customer-checkout-simplification.spec.ts --project=mobile-webkit --grep "successful checkout preserves|Turnstile retry requires" --repeat-each=50 --workers=2 --retries=0 --trace=on`. Same repository browser/isolation configuration, no retry or timeout change. All100 listed cases executed.

| Original case | Passed | Failed | Observed failure rate |
| --- | --- | --- | --- |
| Presentational receipt: test114, assertion195 | 50 | 0 | 0/50 |
| Checkout fresh-token retry: test202, assertion249 | 46 | 4 | 4/50 (8%) |

Exit1. Wall time01:47:25.418–01:57:48.035 UTC (10m22.617s). Failed repeat indices6,15,19,20 (zero-based). The temporary hooks shift the second case to277/assertion326; its original assertion249 is unchanged. Previous natural receipt-only20/20 is a separate sample. These are instrumented test-sample rates, NOT an estimate of real customer frequency or proof that the receipt failure has the identical cause.

## Proven mechanism in all four failures

The name input is the SAME connected DOM node before and after fill (node1); no replacement. All100 have one component instance (StrictMode effect replay is not a new instance), empty saved-customer storage, no UNKNOWN recovery restoration, and no saved-data write/reset during name fill.

Repeat6 timeline, relative to BEFORE_NAME_FILL:

| Time | Event |
| --- | --- |
| +64ms | Name input gains focus; value empty |
| +65ms | Old Cart focusin guard calls focusFirst on ASIDE while active input is name; stack points to customer dialogFocus |
| +65ms | Cart cleanup restores focus to the cart-opening button while name was active |
| +69ms | Checkout activateDialog unconditionally focuses its close button |
| +97ms | fill has returned without error; same name input still empty, close button active |

There is NO name beforeinput/input event or name SET_FIELD_EVENT in the failed fills. Phone/address input events and React updates subsequently work and retain empty name. Review therefore stays closed with the required-name error; the later Turnstile assertion cannot find the review dialog. This is missed insertion due to focus stealing, NOT an accepted name overwritten by setForm.

Trace repeat6: name fill `call196`,142133.558–142210.702ms, no action error; review click `call206`,142418.432–143889.962ms. The other three failures show the same Cart guard → Cart restore → Checkout close-focus sequence. Both snapshots log dialog data-state=null (the storefront does not currently have that attribute), and actual native transitions are pending/running during handover; no readiness state is invented by the diagnostic.

Hypotheses A/B/C were not observed in this sample. D's handleClose/EMPTY reset did not execute during these fills either. The proven path is focus-stack handover, not handleClose.

## Why this is not approved as a test-only readiness fix

customer-web/src/hooks/useDialogFocus.ts:8 registers/removes the focus guard in a passive useEffect. CheckoutModal makes the new panel non-inert and pointer-events-auto in the render first (lines730–733). The old Cart guard can therefore remain active while the new name input is focusable; its focusin handler redirects outside focus (dialogFocus.ts:40–41). Cart cleanup restores previous focus (line52); Checkout activation then always focuses first (line24), even if interaction began inside the new panel.

No input-node substitution was observed, so the owner's conditional permission to repair a replaced-node test does not apply. A real user/keyboard interaction can encounter the same product focus handlers while the new panel is interactable. A real customer's lost keystroke was NOT manually reproduced in this bounded run; the natural test reproduction plus the unguarded product path establish a risk that must not be hidden with a test wait. Already accepted text was not shown being erased.

## Proposed correction — NOT IMPLEMENTED

Synchronize old-dialog teardown/new-dialog registration with the render commit before exposing interaction (for example, layout-effect registration); closed/inert dialogs must not keep trapping focus. Preserve an already valid active element inside the newly opened dialog instead of unconditional focusFirst. During dialog-to-dialog handover, previous-dialog restoration must not override a new active interaction. Keep top-dialog Escape/Tab/nesting and ordinary close-to-opener restoration intact.

After owner approval: deterministic permanent regression for immediate Cart→Checkout name input/keyboard and focus preservation, existing original assertions unchanged; verify nested dialogs/normal close restoration and both original WebKit repeat50 cases plus Chromium. No form/state/RPC/payload/financial rule change, random wait, retry or timeout increase.

## Evidence and cleanup

External isolated evidence root: `C:/Users/TOP/AppData/Local/Temp/nawasrah-checkout-diagnosis-20261012/`: original100.log, original100-exit.json,100 uniquely named original100-*.json journals, original100-summary.json and original100-output trace/video/error-context folders. Repeat6 trace is in `original100-output/customer-checkout-simplifi-da9f1-he-submit-action-is-enabled-mobile-webkit-repeat6/trace.zip`. Only fake fixture customer data/test challenge values were observed; no real credentials/secrets persisted.

All temporary tracing removed after completion. CheckoutModal.tsx and both specs restored to baseline1807f93 exactly under Git canonical contents; no behavior/test changes remain. Owned test process and listeners4173–4176 stopped. Only diagnosis documentation/continuity changes remain uncommitted. Owner approval required before product repair.

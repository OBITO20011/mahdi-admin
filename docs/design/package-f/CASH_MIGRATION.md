# Package F Cash / Shifts — 2026-10-09

Owner accepted e122ad6/135 and exact-SHA CI16/16. Scope §6.5 only,against
Cash-light/dark and PhoneCash-light/dark. Shared tokens/components;no shell,
service,store,RPC,payload,role or migration changes. Stop after one commit/CI
for owner/Claude visual review;no next screen,Production/deploy or Phase7.

## Facts and parity boundary

Current Shift reader provides opening/expected cash,Cash/CliQ sales,receipts,
supplier payments,expenses and refunds. It does not provide total operation
count or credit-sales amount:display غير متاح,never derive from order lists.
Cash receipts include first payments:keep سندات قبض كاش,not falsely label all
as debt collection. CliQ movement components stay separately visible;do not
invent a net figure absent from this reader. No deposit/withdrawal action exists
in this ShiftsView or shift service;do not invent a mutation or fake button.
Existing expense destination remains reachable through unchanged AppShell.

Cash denomination counting is the explicitly requested local input aid only:
50/20/10/5/1 and loose change;does not replace server expected cash. Applying
the count fills the same actualCashInput. Existing manual field,onChange,
discrepancy calculation,reason guard and closeShift(actualCash,reason) stay.
Close opens the existing report;printing remains its existing window.print
button,not a new automatic printing side effect. All cancel/reversal guards,
owner/MFA messages,preview/key/reference,history and archive filters stay.

Pre-change AST baseline e122ad6:ShiftsView13 calls/6 onChange,archive2 calls/
6 onChange,report0 calls/0 onChange. Also pin every existing handle*/loadPage/
applyFilters/changePage function body (including handlePrint). New local
denomination/phone-panel callbacks are explicit presentation-only additions.

## Focused break matrix / gates

Light/dark390/820/1440,axe serious/critical0,no page horizontal scroll/text
escape/Arabic-Indic digits. Phone close-count action always in viewport;count
panel focus/back/busy guard. Denomination total -> exact old close payload;
short reason blocks discrepancy;open/close/report/error/retry and full reversal
retain real adapter contract. Closed/cancelled/reversed history and archive
filter/page payloads retained;unavailable facts explicit. Existing business
tests unchanged except named obsolete presentation selectors,if any.
Then full quality,Gitleaks0,independent commit/push/exact-SHA CI,checkpoint/STOP.

## Focused verified evidence

48 focused units PASS:existing shift/archive/report/snapshot/full-reversal
contracts unchanged,plus fixed-baseline AST parity and safe denomination aid.
ShiftsView13 await/service calls and6 onChange callbacks;archive2 calls and6
callbacks;report handlePrint unchanged. Every existing financial handler body
has its own exact AST fingerprint. No services/stores/shell/migrations changed.

Browser reads use fixed fixtures and the actual existing adapters/controller;
mutations are intercepted at the isolated RPC boundary with exact payload
assertions (not claimed as new real-DB proof). Layout/axe/Latin390/820/1440,
phone sticky-count/focus/back,close809800+reason,busy close guard,open50125,
cancel reason,all six archive filters/server paging,blocked/supported owner
reversal and print/report evidence pass on Chromium/WebKit. New archive fields
received explicit accessible names;initial contrast issue in token report header
fixed. During own formatting edit,Vite reload destroyed one layout-test context;
stable-file rerun6/6 passed including both report themes. No retries,timeouts,
exclusions or old assertions changed. Existing financial tests all retained.

Harness: `/e2e/package-f-cash-harness.html?theme=light|dark`;`?live=1` exercises
the real service adapter with test-controlled loopback responses. Full quality,
Gitleaks/commit/push/exact-SHA CI remain pending;results recorded after proof.

First full quality PASS:784Admin/189Customer/415Browser,59 existing conditional
skips,retries0. Before commit,final scope review found recent history had been
placed only inside the open-shift branch. Moved the exact same presentation to
a shared node rendered also with no current shift;no new call/input/handler.
New closed-center phone/desktop regressions4/4 PASS on both engines,including
cancel/reversal audit metadata and closed report access. Final quality rerun
required on that correction,not hidden behind the first green gate.

## Final delivery gate blocked — 2026-10-09

Final candidate quality exit1:420Browser PASS,59 existing conditional skips,
one unchanged Orders WebKit failure. Cash32/32 PASS;final typecheck and
fixed-baseline business-call/input/handler parity PASS. Missing historical
cash discrepancy displays unavailable rather than manufacturing a match.
No existing test assertion,timeout,retry or exclusion changed.

Failure:`e2e/package-f-orders.spec.ts:236`,assertion262 expects last
`get_operational_orders_page.p_search=الأمل`,receives null after returning
from phone details. Focused current candidate WebKit10 repeats,workers2,
retries0:2fail/8pass at exactly262. Independent clean e122ad6 worktree with
separate dependencies,same command:1fail/9pass at exactly262 (43.0s).
Therefore this failure predates Cash;not a Cash-induced financial change.
An initial dependency-junction comparison was discarded because Vite could
not serve its font assets. A cold independent run had two startup502 failures,
not search failures;not counted as the clean search comparison above.

Trace on current failure:back click ends18772.628ms;fill starts18782.134ms,
ends18882.065ms;all three bounded list RPCs have p_search=null and the final
snapshot marks the original order card active,with search empty. Existing
OrdersWorkbench restoration focuses that card after accepted list reload.
This supports a focus-restoration/input race;it is not yet an independently
instrumented proof of the exact event that loses the input. Do not label it
harmless flakiness or repair by increasing the wait. Owner approval required
before a focused Orders controller/test correction outside this Cash scope.

Gitleaks changed/untracked scope exit0;001–135/services/stores/Orders/shell
unchanged. No Cash commit/push/CI performed while final quality is red.
Production/deploy0. Official checkpoint preserves this delivery blocker.

## Owner-authorized prerequisite resolved — 2026-10-09

Product-only Orders fix57e53d4 is a separate commit before Cash. Exact details
and call/input parity:ORDERS_MIGRATION.md. Unchanged live-search WebKit20
before17PASS/3FAIL;after20PASS,retries0. New response-barrier typing regression
failed before because focus moved to the card;after correction it and filter
focus plus unchanged back/scroll regressions pass12/12 across both engines.
No old test byte,timeout,retry,waitForTimeout,RPC/payload or migration changed.
Final full quality rerun now required for Cash+this prerequisite;only after
green,Gitleaks0 and Cash commit/push may exact-SHA CI/visual review proceed.

## Final local candidate verification

Full `npm run quality` exit0 on Cash + approved separate Orders fix57e53d4:
785Admin/189Customer/429Browser PASS,59 pre-existing conditional skips,
retries0 (browser15.4m). Cash32/32,new focus8/8 and unchanged Orders32/32
inside that same uninterrupted run. Typecheck,ESLint,builds,isolatedSEO and
Chromium/WebKit network isolation PASS;external/Production escapes0.
No service,store,role,DB,migration,workflow or old test change. Await final
Gitleaks0,Cash commit/push/exact-SHA CI,then stop for visual review.

## Owner visual acceptance and Arabic time correction — 2026-10-09

Owner/Claude accepted57e53d4 and de879ae;exact push/main quality37921517045
16/16 and secrets37921516922 PASS. Cash start time now uses bdi dir=auto,
not forced LTR,so the Arabic period follows the time visually (08:30 ص).
Report/archive were reviewed:neither wraps formatUiTime in LTR;their existing
Latin Arabic date/time formatting is unchanged. A permanent browser regression
checks actual glyph positions,not just DOM text,in both themes/engines.
No business calls,handlers,payloads or migrations change. Actual-cash prefill
remains unchanged;the question is recorded only in OWNER_DECISIONS.md.

Time-correction quality attempt was invalidated by this agent's documentation/
checkpoint writes while Vite was serving browser tests. Open-shift Chromium
test64 timed out after a full page reload reset the opening field. Trace records
Cash document loads11:36:20.440Z and11:36:27.132Z;Vite logs docs reloads at
14:36:21/14:36:25 Asia/Amman. Not a claimed product defect or passing gate.
Stop old preview;repeat full quality once on frozen files,without test/code,
assertion,timeout or retry changes. No other work/checkpoint write during gate.

Frozen-files full quality exit0:786Admin units,Customer checks/build PASS,
433Browser PASS/59 pre-existing conditional skips/retries0 (18.0m). New
glyph-position tests4/4 and all existing Cash36/36 pass in the full run;
open-shift case3.4s Chromium/4.9s WebKit with unchanged assertions. External/
Production escaped0.001–135/services/stores untouched. Gitleaks0/commit/push/
exact-SHA CI follow this evidence;136/Customers wait for completion-date policy.

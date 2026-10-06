# Phase 5 re-scope (owner decision 2026-10-06)

This file is the current Phase 5 contract. It supersedes the Slice 5 package plan
(A1–A5, B–E). Any agent continuing Phase 5 follows this file.

## Why

- Phase 5 was opened to fix four Medium findings (A–D) recorded on 2026-09-29.
- Slices 1–4 (Migrations 123–127) built a private, inactive parallel financial
  layer. Slice 5 (activation preparation) grew to ~15k lines of inactive SQL
  without closing any finding on the operational paths.
- The system has not been handed over to the shop owner. Production runs
  migrations 001–111 with test data only. There is no live business data that
  needs a shadow layer or staged coexistence. Findings are fixed directly in the
  operational RPCs.

## What happened to existing work

- Slice 5 work is parked unchanged on branch `codex/phase5-slice5-wip`
  (commit `246066e`). It is not merged and not activated.
- Migrations 123–127 stay as they are (historical migrations are immutable).
  They remain private, with no grants and no callers. Nothing new depends on them.

## Scope: direct fixes on operational paths (Migrations 128–130)

| ID | Finding | Verified location | Fix |
| --- | --- | --- | --- |
| C | Shift summary/close ignores Phase 4.2 Return refunds | `get_cash_shift_summary` base (043/078) reads refunds only from legacy `sales_returns`; Migration 121 records new refunds in `sales_return_events` and increments `cash_shifts.cash_refunds_in_minor_units`. Open-shift expected cash is overstated and close overwrites the counter. | Include settled `sales_return_events` cash/CliQ refunds for the Shift in the summary. |
| B | Non-idempotent payment writer still callable | `record_customer_order_payment` re-granted to `authenticated` in Migration 121; app uses only `record_customer_order_payment_once`. | Revoke EXECUTE from `authenticated` (keep for internal callers). |
| A | Payment replay accepts a different payload | `record_customer_order_payment_once` (078) returns the stored payment for the same user/key without comparing order, amount or method. | Reject same-key replay whose order/amount/method differ. |
| A+ | Receipt reversal on a completed non-debt order would leave it "paid" | `sync_order_payment_state` (043) forces `amount_paid = total` on every UPDATE of a completed non-debt order. **Not reachable through current writers:** `record_customer_order_payment` (017) needs a completed order with an outstanding balance, and settlement completions (060, 116) write a receipt only when `payment_method = 'debt'`. Same conclusion as Codex's 2026-09-29 note (`CURRENT TRIGGER RUNTIME DEFECT = NOT PROVEN`). | **Owner decision 2026-10-06: block.** Migration 129 rejects such a reversal at the table (`PAYMENT_REVERSAL_PAID_ORDER_UNSUPPORTED`) and marks it BLOCKED in the full-shift preview. No alternative correction route; a Return is not used to fix a wrong collection. Guard against future writers. |
| D | Lock-order inversion | Codex 2026-09-29: `complete_website_order_with_payment` (042) locks Order → Shift (FOR SHARE); full-shift reversal (084/120) locks Shift → Orders where `cash_shift_id = shift`. A cycle needs the same order in both lock sets while 042 holds it. Website orders get `cash_shift_id` only at completion (042/060/116). Correction from the independent review: an uncompleted order *can* be attached at insert by the 041 POS trigger when `create_customer_order` is called with `p_source='pos'`; 042 rejects `source='pos'`, `update_order_status` completion takes no shift lock, and 060/116 lock the shift first via their 120 wrappers, so the cycle is still not formed. | **Not reachable on the actual path.** Runtime: both real orderings on real functions, deadlock counter delta 0, pre-completion `cash_shift_id` NULL asserted for website orders. Remaining unproven: a future Order→Shift writer that accepts orders already attached at insert. Restricting `create_customer_order.p_source` is deferred (owner decision; it changes a public RPC). |

## Result (2026-10-06)

Migration 128 fixes C, B, A. Migration 129 applies the A+ owner decision. Migration 130 fixes the
review follow-ups (H1, M2, L7, L8). Runtime proof `npm run test:phase5-operational-fixes:runtime` is two-sided:

| Check | 001-127 (`NAWASRAH_PHASE5_FIX_MODE=before`) | 001-130 |
| --- | --- | --- |
| C shift with Phase 4.2 cash 1000 + CliQ 1000 + legacy cash 5000: cash/CliQ refund delta | 5000 / 0 | 6000 / 1000 |
| C expected cash delta; refunds stored at close | -5000; cash 5000 | -6000; cash 6000, CliQ 1000 |
| C closing report / snapshot returnCount | 1 / 1 | 3 / 3 |
| B `authenticated` executes legacy writer (real role) | executable | permission denied |
| A same-key replay with changed amount / order / method / CliQ reference | all silently accepted | all `PAYMENT_IDEMPOTENCY_CONFLICT` |
| A+ (fault-injected website receipt) preview / full-shift / standalone | SUPPORTED / accepted, order stays paid | BLOCKED / rejected / rejected, zero writes |
| H1 cancel a shift whose only activity is a Phase 4.2 refund | accepted | rejected, zero writes |
| M2 monitoring mismatch delta for an open shift with a refund | +1 | 0 |
| Full-shift reversal with non-reversible op (pre-write gate) | rejected, zero writes | rejected, zero writes |
| Full-shift reversal with fault after the expense reversal (in-loop) | full rollback | full rollback |
| D completion-first / reversal-first, real functions | — | safe retry (40001) then business block / business error; deadlock delta 0 |
| DB lint | — | PASS |

Regression on fresh 001-130: full-shift reversal 60 scenarios, Phase 4.2 atomic return (core/temporal/
concurrency/cross-operation, deadlock delta 0), closing-report snapshot 6/6, advanced monitoring runtime PASS.
Note: `run-advanced-monitoring-runtime.mjs` needs `NAWASRAH_ISOLATED_PROJECT_ID=nawasrah-advanced-monitoring-test`
(its default id predates the bootstrap `-test` suffix rule).

## Independent review follow-up (Migration 130)

The focused independent review of 128–129 (2026-10-06) found High 1, Medium 2, Low 7, Info 1, Critical 0.

| Review item | Disposition |
| --- | --- |
| H1 `cancel_empty_cash_shift` (046) ignored `sales_return_events` | Fixed in 130: wrapper locks the shift and rejects any non-cancelled return event |
| M2 monitoring `integrity:shifts:closing` false critical on open shifts | Fixed in 130: verbatim 116 body, formula limited to non-open shifts (static test proves single change) |
| M3 129 preview wrapper not runtime-covered | Runtime: fault-injected website receipt is SUPPORTED pre-fix and BLOCKED post-fix |
| L4 atomicity only proved at the pre-write gate | Runtime: fault after the expense reversal inside the loop → full rollback, zero residue |
| L5 runtime never ran as `authenticated` | Runtime: `SET LOCAL ROLE authenticated` for payment-once and summary; legacy writer denied |
| L6 C coverage gaps | Runtime: Phase 4.2 cash + CliQ + legacy refund on one shift, snapshot count both modes, expected cash at close asserted; A covers changed order/amount/method |
| L7 CliQ replay ignored reference | Fixed in 130 |
| L8 preview ignored Phase 4.2 refunds | Fixed in 130: `phase42_sales_return` BLOCKED rows; Admin label added |
| L9 `create_customer_order` accepts any `p_source` | **Deferred, owner decision** (public RPC behavior); D analysis corrected above |
| L10 closing-report breakdown per event, not per item/component | Deferred to Phase 6 reporting |
| Info: daily summaries/business reports read legacy returns only; no index on `sales_return_events(cash_shift_id)`; 128 private functions not revoked from `service_role` | Deferred to Phase 6/7 (pre-existing or harmless; inner functions check ERP roles) |

## Definition of done (Phase 5)

- Migrations 128–130 apply on a fresh isolated rebuild 001–130 with DB lint PASS.
- A runtime test proves each of C, B, A fails before the fix and passes after;
  A+ is proven on a fault-injected state (unreachable through current writers).
- Full-shift reversal with a non-reversible operation is rejected with zero writes.
- D: both real lock orderings complete with deadlock delta 0.
- `npm test`, typecheck and strict ESLint PASS; affected existing runtime suites PASS.
- Owner closes Phase 5. Then Phase 6 (UI terminology/cleanup) and Phase 7
  (final regression, controlled rollout through the approved migration ceiling,
  test-data cleanup and handover; separate owner authorization required).

## Owner closure (2026-10-06)

Phase 5 is OWNER-CLOSED by explicit owner decision after push/main CI for
`bdea567562b1de8c64fe3aa286076258decf3d26` passed: quality `37408582997`,
secret scanning `37408583034`. Closure retains the documented L9/L10/Info
deferrals; it is not a claim that those items were fixed. Phase 6 planning only
is authorized next. Production access and deploy remain prohibited.

## Working rules for this re-scope

- Keep docs short: `ACTIVE_TASK.json` holds the current step only.
- No new private/inactive layers. Fix the operational path, test it, done.
- Production access and deploy still need explicit owner authorization.

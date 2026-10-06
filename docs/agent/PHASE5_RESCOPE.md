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

## Scope: direct fixes on operational paths (Migrations 128–129)

| ID | Finding | Verified location | Fix |
| --- | --- | --- | --- |
| C | Shift summary/close ignores Phase 4.2 Return refunds | `get_cash_shift_summary` base (043/078) reads refunds only from legacy `sales_returns`; Migration 121 records new refunds in `sales_return_events` and increments `cash_shifts.cash_refunds_in_minor_units`. Open-shift expected cash is overstated and close overwrites the counter. | Include settled `sales_return_events` cash/CliQ refunds for the Shift in the summary. |
| B | Non-idempotent payment writer still callable | `record_customer_order_payment` re-granted to `authenticated` in Migration 121; app uses only `record_customer_order_payment_once`. | Revoke EXECUTE from `authenticated` (keep for internal callers). |
| A | Payment replay accepts a different payload | `record_customer_order_payment_once` (078) returns the stored payment for the same user/key without comparing order, amount or method. | Reject same-key replay whose order/amount/method differ. |
| A+ | Receipt reversal on a completed non-debt order would leave it "paid" | `sync_order_payment_state` (043) forces `amount_paid = total` on every UPDATE of a completed non-debt order. **Not reachable through current writers:** `record_customer_order_payment` (017) needs a completed order with an outstanding balance, and settlement completions (060, 116) write a receipt only when `payment_method = 'debt'`. Same conclusion as Codex's 2026-09-29 note (`CURRENT TRIGGER RUNTIME DEFECT = NOT PROVEN`). | **Owner decision 2026-10-06: block.** Migration 129 rejects such a reversal at the table (`PAYMENT_REVERSAL_PAID_ORDER_UNSUPPORTED`) and marks it BLOCKED in the full-shift preview. No alternative correction route; a Return is not used to fix a wrong collection. Guard against future writers. |
| D | Lock-order inversion | Codex 2026-09-29: `complete_website_order_with_payment` (042) locks Order → Shift (FOR SHARE); full-shift reversal (084/120) locks Shift → Orders where `cash_shift_id = shift`. A cycle needs the same order in both lock sets, i.e. a not-yet-completed website order already attached to the shift. Only POS inserts are attached by trigger (041); website orders get `cash_shift_id` at completion (042/060/116). | **Not reachable on the actual path.** Runtime: both real orderings on real functions, deadlock counter delta 0, pre-completion `cash_shift_id` NULL asserted. Remaining unproven: a future writer that attaches an uncompleted order to a shift would make the inversion reachable. |

## Result (2026-10-06)

Migration 128 fixes C, B, A. Migration 129 applies the A+ owner decision.
Runtime proof `npm run test:phase5-operational-fixes:runtime` is two-sided:

| Check | 001-127 (`NAWASRAH_PHASE5_FIX_MODE=before`) | 001-129 |
| --- | --- | --- |
| C summary refund delta / expected cash delta | 0 / 0 | 1000 / -1000 |
| C refund counter after close | 1000 → 0 (overwritten) | 1000 |
| C closing report / snapshot returnCount | 0 / 0 | 1 / 1 |
| B `authenticated` can execute legacy writer | true | false |
| A same-key replay with changed amount | silently accepted | `PAYMENT_IDEMPOTENCY_CONFLICT` |
| A+ (fault-injected state) receipt reversal | accepted, order stays paid | rejected, zero writes |
| Full-shift reversal with a non-reversible op (2 reversible ops present) | rejected, zero writes | rejected, zero writes |
| D completion-first / reversal-first, real functions | — | safe retry (40001) then business block / business error; deadlock delta 0 |
| DB lint | — | PASS |

Regression on fresh 001-129: full-shift reversal 60 scenarios, Phase 4.2 atomic return
(core/temporal/concurrency/cross-operation, deadlock delta 0) PASS. Closing-report snapshot 6/6 PASS on 001-128.

## Definition of done (Phase 5)

- Migrations 128–129 apply on a fresh isolated rebuild 001–129 with DB lint PASS.
- A runtime test proves each of C, B, A fails before the fix and passes after;
  A+ is proven on a fault-injected state (unreachable through current writers).
- Full-shift reversal with a non-reversible operation is rejected with zero writes.
- D: both real lock orderings complete with deadlock delta 0.
- `npm test`, typecheck and strict ESLint PASS; affected existing runtime suites PASS.
- Owner closes Phase 5. Then Phase 6 (UI terminology/cleanup) and Phase 7
  (final regression, deploy 112–128 to Production, test-data cleanup, handover).

## Working rules for this re-scope

- Keep docs short: `ACTIVE_TASK.json` holds the current step only.
- No new private/inactive layers. Fix the operational path, test it, done.
- Production access and deploy still need explicit owner authorization.

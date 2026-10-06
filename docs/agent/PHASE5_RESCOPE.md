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

## Scope: direct fixes on operational paths (new Migration 128)

| ID | Finding | Verified location | Fix |
| --- | --- | --- | --- |
| C | Shift summary/close ignores Phase 4.2 Return refunds | `get_cash_shift_summary` base (043/078) reads refunds only from legacy `sales_returns`; Migration 121 records new refunds in `sales_return_events` and increments `cash_shifts.cash_refunds_in_minor_units`. Open-shift expected cash is overstated and close overwrites the counter. | Include settled `sales_return_events` cash/CliQ refunds for the Shift in the summary. |
| B | Non-idempotent payment writer still callable | `record_customer_order_payment` re-granted to `authenticated` in Migration 121; app uses only `record_customer_order_payment_once`. | Revoke EXECUTE from `authenticated` (keep for internal callers). |
| A | Payment replay accepts a different payload | `record_customer_order_payment_once` (078) returns the stored payment for the same user/key without comparing order, amount or method. | Reject same-key replay whose order/amount/method differ. |
| A+ | Payment reversal on completed non-debt order is undone | `sync_order_payment_state` (043) forces `amount_paid = total` on every UPDATE of a completed non-debt order, so a reversed receipt (standalone or via full-shift reversal, Migration 084) leaves the order fully paid. Not reachable from Admin UI except full-shift reversal of a website-order receipt. | **OWNER DECISION REQUIRED, not in Migration 128.** Either the order becomes customer debt after reversal, or such reversals are blocked. |
| D | Lock-order inversion | Not pinpointed. Worst case is a detected PostgreSQL deadlock (one transaction aborts with an error, no wrong money). | Deferred. Add a concurrency probe if found; not a closure blocker. |

## Result (2026-10-06)

Migration 128 (`128_phase5_operational_payment_and_shift_refund_fixes.sql`) fixes C, B and A.
Runtime proof `npm run test:phase5-operational-fixes:runtime` is two-sided:

| Check | 001-127 (`NAWASRAH_PHASE5_FIX_MODE=before`) | 001-128 |
| --- | --- | --- |
| C summary refund delta / expected cash delta | 0 / 0 | 1000 / -1000 |
| C refund counter after close | 1000 → 0 (overwritten) | 1000 |
| C closing report / snapshot returnCount | 0 / 0 | 1 / 1 |
| B `authenticated` can execute legacy writer | true | false |
| A same-key replay with changed amount | silently accepted | `PAYMENT_IDEMPOTENCY_CONFLICT` |
| DB lint | — | PASS |

## Definition of done (Phase 5)

- Migration 128 applies on a fresh isolated rebuild 001–128 with DB lint PASS.
- A runtime test proves each of C, B, A fails before the fix and passes after.
- Owner decides A+ policy (fix in a follow-up migration once decided).
- `npm test`, typecheck and strict ESLint PASS; affected existing runtime suites PASS.
- Owner closes Phase 5. Then Phase 6 (UI terminology/cleanup) and Phase 7
  (final regression, deploy 112–128 to Production, test-data cleanup, handover).

## Working rules for this re-scope

- Keep docs short: `ACTIVE_TASK.json` holds the current step only.
- No new private/inactive layers. Fix the operational path, test it, done.
- Production access and deploy still need explicit owner authorization.

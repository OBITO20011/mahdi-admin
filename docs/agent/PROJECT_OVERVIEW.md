# Project overview

Nawasrah ERP is an Arabic RTL commerce system with:

- Admin React/TypeScript application for POS, orders, inventory, purchasing, payments, shifts, returns, reporting, and operations.
- `customer-web/` React/TypeScript storefront for catalog, parcel construction, checkout, tracking, and receipts.
- Supabase/PostgreSQL as the authoritative business-state layer; sensitive inventory and financial changes live in authenticated atomic RPCs with evidence/audit records.

## Canonical reading order

1. `AGENTS.md`
2. `docs/agent/project-state.json`
3. `docs/agent/PHASE_STATUS.md`
4. `docs/agent/OWNER_DECISIONS.md`
5. `docs/agent/ARCHITECTURE.md`
6. `docs/agent/VERIFICATION_GATES.md`
7. `docs/agent/ACTIVE_TASK.json`

VS Code and dual-agent setup: `docs/agent/VS_CODE_SETUP.md`.

Current owner-authorized task: record Slice 4 owner closure and prepare its local
baseline following the bounded independent read-only re-sign-off. Migration 127
is closed as a private inactive financial read/reconciliation layer. The
[reviewed design](evidence/phase5-slice4/SLICE4_SCOPE_DESIGN.md) retains its
historical proposal wording; current authorization and closure are recorded in
project-state, phase-status and ACTIVE_TASK. The owner authorized one baseline
commit/push and exact-SHA CI verification. No public activation or later-slice
implementation is authorized.

Repository architecture references remain useful: `ARCHITECTURE.md`, `DATABASE_DESIGN.md`, and `docs/operations/`. Where an older document conflicts with `docs/agent/`, the current approved state and owner decisions in `docs/agent/` govern until deliberately updated and verified.

## Current boundary

Phases 3 and 4 are owner-closed. Phase 4.1 through Phase 4.5 each passed their required implementation, regression and independent sign-off gates, with the final Phase 4.5 closure review reporting zero findings and zero material evidence gaps. Phase 5 is in progress: Slice 1 is owner-closed as a private inactive Migration 123 foundation. Slice 2 is owner-closed after independent re-sign-off: its Migration 124 canonical collection/full-payment-reversal writers have no application grants or callers and remain non-activatable pending later coordinator/cutover work. Slice 3 private inactive coordinator in Migration 126 is owner-closed after bounded independent re-sign-off; closure commit `095245e6bd30d2f40850e8779232f806f2cd0beb` is on `main` / `origin/main` with exact-SHA code-quality and secret-scanning CI PASS. Slice 4 private read/reconciliation in Migration 127 is OWNER-CLOSED after bounded independent re-sign-off with zero scoped findings/gaps; its local baseline is being prepared and has not been committed or pushed. Public activation and later-slice implementation remain prohibited. The exact baseline, migration hashes, and ceiling are recorded in `project-state.json`.

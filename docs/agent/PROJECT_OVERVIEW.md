# Project overview

Nawasrah ERP is an Arabic RTL commerce system with:

- Admin React/TypeScript application for POS, orders, inventory, purchasing, payments, shifts, returns, reporting, and operations.
- `customer-web/` React/TypeScript storefront for catalog, parcel construction, checkout, tracking, and receipts.
- Supabase/PostgreSQL as the authoritative business-state layer; sensitive inventory and financial changes live in authenticated atomic RPCs with evidence/audit records.

## Canonical reading order

> **Current Phase 5 contract (2026-10-06): read `docs/agent/PHASE5_RESCOPE.md` first.**
> Slice 5 is parked on branch `codex/phase5-slice5-wip`. Phase 5 now closes by
> direct operational fixes in Migrations 128–130, now owner-closed.

1. `AGENTS.md`
2. `docs/agent/project-state.json`
3. `docs/agent/PHASE_STATUS.md`
4. `docs/agent/OWNER_DECISIONS.md`
5. `docs/agent/ARCHITECTURE.md`
6. `docs/agent/VERIFICATION_GATES.md`
7. `docs/agent/ACTIVE_TASK.json`
8. `docs/agent/PHASE5_RESCOPE.md` (current Phase 5 contract)

VS Code and dual-agent setup: `docs/agent/VS_CODE_SETUP.md`.

Current owner-authorized task: Phase 6 package B items 3,4,7,8,12,13,16,18,19
under `PHASE6_PLAN.md`, UI-only, following Claude's package A remediation.
Phase 5 operational baseline is `bdea567562b1de8c64fe3aa286076258decf3d26`;
exact-SHA push/main quality and secret-scanning CI passed. Package A remediation
at `0b31eec0949519eefdac398dd6a034f956d0b5f9` passed both exact-SHA CI workflows.
Package B authorizes its UI corrections, tests, commit/push and exact-SHA CI.
No database/migration changes, Production access, deploy or package C work.
Mobile shell geometry remains unchanged; desktop/tablet layout only for item 8.
`ACTIVE_TASK.json` records only the current step; prior detailed continuity
evidence is preserved in Git at that baseline and in the phase evidence files.

Repository architecture references remain useful: `ARCHITECTURE.md`, `DATABASE_DESIGN.md`, and `docs/operations/`. Where an older document conflicts with `docs/agent/`, the current approved state and owner decisions in `docs/agent/` govern until deliberately updated and verified.

## Current boundary

Phases 3, 4 and 5 are owner-closed. Phase 5 closes under `PHASE5_RESCOPE.md`,
not the superseded private-layer activation plan. Migrations 123–127 stay
historical, private and inactive; parked Slice 5 work is not merged or activated.
Migrations 128–130 fix the operational paths. L9 remains a policy decision;
L10 and legacy-only daily reporting are addressed by Phase 6 package A.
No broad zero-findings or Production-readiness claim is implied by this closure.
The approved migration ceiling is 131; fingerprints remain in `project-state.json`.

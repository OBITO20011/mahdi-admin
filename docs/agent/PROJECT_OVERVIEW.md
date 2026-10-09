# Project overview

Nawasrah ERP is an Arabic RTL commerce system with:

- Admin React/TypeScript application for POS, orders, inventory, purchasing, payments, shifts, returns, reporting, and operations.
- `customer-web/` React/TypeScript storefront for catalog, parcel construction, checkout, tracking, and receipts.
- Supabase/PostgreSQL as the authoritative business-state layer; sensitive inventory and financial changes live in authenticated atomic RPCs with evidence/audit records.

## Canonical reading order

**Current owner boundary — 2026-10-09:** Inventory f8d88ac visually accepted.
Only135 read extensions:POS customer debt/limit from CRM's existing helper,
inventory whole-catalog available filter and active-item count. Old fields,
signatures,roles/grants and all writers unchanged. Small value-column/emoji/unit
presentation fixes approved. READ_EXTENSIONS_135.md is the current task contract;
runtime/JSON/ACL/scale,quality,Gitleaks0,one commit/push/exact-SHA CI then STOP.
No next screen,Production/deploy or Phase7.

**Previous owner boundary — 2026-10-09:** POS20910cb+faae71a visually accepted;
Inventory §6.4 presentation authorized, plus POS Arabic item count and short
collapsed rail labels. Chips only all/low/out; totalItems labelled إجمالي الأصناف
with يشمل المتوقفة. No new available filter, active count or readers. Preserve
all existing readers/actions/roles/migrations. See INVENTORY_MIGRATION.md.
Full quality/Gitleaks0/one commit/push/exact-SHA CI then STOP for visual review.
No next screen, Production/deploy, DB changes or Phase7.

**Previous owner boundary — 2026-10-09:** Orders70bb975 visually accepted;
POS §6.3/4.1/4.2 presentation authorized. Customer selector name/phone only,no
debt line or extra read. Preserve all V2/recovery/shift/price/payload/role paths,
migrations and shell. Read POS_MIGRATION.md for parity,harness/test changes and
deferred debt-read question. Full quality/Gitleaks0/one commit/push/exact-SHA CI
then STOP for visual review. No next screen,Production/deploy,DB or Phase7.

**Previous owner boundary — 2026-10-09:** Additional Orders scroll correction
after3becc46 is authorized:restore the chosen phone card/scroll after the actual
controller list reload,permanent live regression,full quality,Gitleaks0 and one
commit/push/exact-SHA CI. No CI edits;only one failed-job rerun if the new SHA
repeats54322 boot failure,then stop if it repeats again. Stop for visual review.
No next screen,DB/migrations,Production/deploy or Phase7.

**Previous owner boundary — 2026-10-09:** Orders a390011 passed exact-SHA CI and
owner/Claude visual/server-action review. Only three Orders usability fixes are
authorized: phone full-screen detail/back preserving card scroll, nowrap table
numbers/times and nontechnical hint. Same readers/actions; one corrective
commit after quality/Gitleaks0, exact-SHA CI, then STOP for visual review.
No next screen, DB/migrations, Production/deploy or Phase7.

**Previous Orders implementation boundary — 2026-10-09:** Home c0f0a54 corrections passed exact-SHA
CI and Claude/owner visual review. Orders §6.2 is now authorized, plus Home's
time-first shift label only. Read PACKAGE_F_DESIGN_SPEC.md and ORDERS_MIGRATION.md
under docs/design/package-f. Preserve readers/RPCs/payloads/permissions/migrations
and shell components. One Orders commit/push after full quality and Gitleaks0,
exact-SHA CI, then stop for owner visual review before another screen.
No Production/deploy or Phase7.

**Previous owner boundary — 2026-10-08:** Package E is OWNER-CLOSED at
`5bb5c8877978ee4cb1b0a0de9d516d25d319d617`; exact push/main quality37786962873
(15/15) and secrets37786962944 PASS. The current authorization is documentation
closure only, not more implementation. Package F and Phase7 are NOT STARTED;
Claude will supply F's tokens/font/AppShell/shared-component specifications.
The deferredF B/C, post-deliveryA, Phase7 decisions and opening-balances/Excel/047
startup scope are recorded in OWNER_DECISIONS.md and PACKAGE_E_PLAN.md.
The older implementation/checkpoint descriptions below are historical, not
current permission. No Production access or deploy in this task.

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

Phase 6 is OWNER-CLOSED on 2026-10-07 at
`5aaeab11e13c2be454af677ee176f77aa2d9cde4`: exact-SHA push/main quality
37531634141 and secret scanning 37531634136 PASS. The current task is its
documentation closure delivered at `54e669cb195b69af1536cf7bcf64f18bc36519c0`,
quality 37534064206 and secret scanning 37534064164 PASS.
Package D is OWNER-CLOSED at `f58c9556f55222698629d881a59ec1d387c5e978`;
push/main quality37576896581 (12/12) and secrets37576896555 PASS.
Current authorization: implement Package E golden-day reconciliation as permanent CI,
then manual scale measurements and test cleanup; each part permits commit/push.
Owner approved133 for supplier direct/PO receipts minus active payments,
including advances, reversals, cancellation and monitoring. The later owner
correction authorizes one-time supplier balance recalculation with old/new audit,
without rewriting historical invoices or inventory. Legacy PO V1 uses recorded
receipt cost, except an exact fully received matching PO uses its final net total
once; adjusted partial/mismatched POs retain recorded cost and manual-review evidence.
Production access remains prohibited.
The owner additionally approved133's closing reader/UI: preserve Cash/CliQ
sales, vouchers, counters and reconciliation; show first voucher payments
separately, sale-time remaining credit, and gross including both. Old closed
snapshots remain unchanged. Prove inflows before/after, then resume the day.
The third gap is now owner-approved: closing net deducts settled Return
entitlement (money + debt), with separate displayed components, not just money.
Any further numeric mismatch or index requirement stops for owner review.
Feature activation outside isolated fixtures, Production/deploy and Phase7 remain prohibited.
Phase 5 operational baseline is `bdea567562b1de8c64fe3aa286076258decf3d26`;
exact-SHA push/main quality and secret-scanning CI passed. Package A remediation
at `0b31eec0949519eefdac398dd6a034f956d0b5f9` passed both exact-SHA CI workflows.
Package B at `b3eda6fffe2cd68e12e5464647bafd3ed75bee46` passed exact-SHA
push/main code quality (37432050153) and secret scanning (37432050171).
Package C authorizes accessibility corrections and Base Return allocation:
original first, replacement issuance oldest first, missing dates use lineage
depth, sourceId is the final deterministic tie-breaker. Tests, commit/push and
exact-SHA CI are authorized. No database/migration changes, Production, deploy
or Phase 7 work.
Package C delivered at `aab9c5b84fde34e6ab16039a9adf68cc6f77514e`;
push/main quality 37509903035 and secret scanning 37509903022 passed.
The accepted B+C correction covers dirty/busy Escape, dialog stack/Tab,
POS keyboard/scanner focus, fresh Return capacity checks, Arabic errors,
self-contained Customer focus utility and replacement date chronology.
The fresh UI capacity check is not an atomic server-side guarantee;
server capacity enforcement is reserved for separately approved package D.
Mobile shell geometry remains unchanged; desktop/tablet layout only for item 8.
`ACTIVE_TASK.json` records only the current step; prior detailed continuity
evidence is preserved in Git at that baseline and in the phase evidence files.

Repository architecture references remain useful: `ARCHITECTURE.md`, `DATABASE_DESIGN.md`, and `docs/operations/`. Where an older document conflicts with `docs/agent/`, the current approved state and owner decisions in `docs/agent/` govern until deliberately updated and verified.

## Current boundary

Phases 3, 4, 5 and 6 are owner-closed. Phase 5 closes under `PHASE5_RESCOPE.md`,
not the superseded private-layer activation plan. Migrations 123–127 stay
historical and byte-identical. Package D132 retires their unused private schema
with locked empty-state/caller guards and explicit RESTRICT drops; parked Slice 5
work is not merged or activated. Superseded pre-implementation artifacts are
archived in Git at `2238b102c8935b9d60d6c25c1f6fcb0c0a4178aa`, not active contracts.
Migrations 128–130 fix the operational paths. L9 source-pos rejection is owner-approved in Package D;
L10 and legacy-only daily reporting are addressed by Phase 6 package A.
No broad zero-findings or Production-readiness claim is implied by this closure.
The current approved migration ceiling is134:133 supplier/closing consistency,
then134's two operation_id indexes and explicit existing home reader optimization:
remove overwritten legacy financial calculations, reuse monthly daily facts only
for a fully contained week, and keep the old unavailable response unchanged.
Literal JSON parity on golden/full/unavailable is mandatory; no grants/writers
or permanent DB-setting changes. Owner2026-10-08 now authorizes134 report/summary
reads with evidence=false, preserving literal financial JSON. The existing
scanner strictly checks last7days Return/Replacement evidence and queues the
existing integrity alert; reports warn on failed/missing/>24h monitoring.
No changes to write validation121/122/132 or monitoring/report authority.
Full-history scan is a manual Phase7 rehearsal obligation. Owner permits
baseline JSON capture only to use SET LOCAL15min after60s timeout in the disposable
DB, with both readers using the same two approved indexes; all benchmarks stay60s.
All E2 paths are measured
before the final verdict. Owner2026-10-08 accepts the measured home2.367605s,
monthly4.085672s and daily3.461212s on concentrated stress; no further reader
optimization now. The single post-delivery improvement and <1s/<2s targets are
in `POST_DELIVERY.md`. Final golden/quality/Gitleaks/commit/exact-SHA CI precede E3.
Fingerprints remain in `project-state.json`.
Historical migrations001–132 are immutable; feature activation remains an owner
action in Phase7.

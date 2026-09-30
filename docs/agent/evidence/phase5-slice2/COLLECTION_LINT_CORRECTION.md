# Slice 2 bounded collection-lint correction

Status: bounded independent re-sign-off PASS; owner-authorized corrective
commit/push, with exact-SHA CI pending. Slice 3 is NOT STARTED.
No Production access or deployment.

## Exact scope

Execution baseline: `8ad617a979f27b888c0f3fc6d018f67e447abb80`.
That commit's DB-runtime CI job rejected a new unused `v_shift_id` warning
from the private collection writer. Historical migrations 001-124 are unchanged.
Migration 125 replaces only that writer, removing its unused local variable and
using `PERFORM` for the identical lock helper, arguments and acquisition position.
Its static test proves the complete function text is otherwise identical to 124.
The signature, invoker security, search path, owner and zero application grants
remain unchanged. No business path is activated.

Migration 125 canonical-LF SHA-256:
`D1CDA688B835C2791A0890F4E000A85FA7309B1A4E4DE02F21819491330A546B`
Migration 126 is absent.

## Fail-closed lint policy

Slice-2 runtime now parses structured lint findings and rejects every
unapproved warning/error, including the exact CI `v_shift_id` finding.
The only accepted compatibility warning is the exact `p_transfer_date`
unused-parameter warning from the warehouse-transfer function or its
repository-renamed `_transfer_inventory_between_warehouses_phase2_legacy`.
Migration 113 proves the historical rename. Phase 2/3 lint assertions are unchanged.

The first strengthened runtime rejected that legitimate historical alias because
the policy initially listed only its old name. After the source-grounded exact
alias correction, the complete Slice-2 runtime was rerun successfully; no
assertion, timeout or coverage was weakened to hide the failure.

The independent review identified one Low parser issue: selecting `results`
could discard a simultaneous root-level finding. The correction rejects mixed
wrapper/finding shapes and unknown wrapper siblings before inspecting results.
Permanent adversarial tests first reproduced the failure and then passed.
The bounded read-only re-sign-off accepted six supported clean/compatibility
cases and rejected 36 malformed or concealed-finding cases with no failures.

## Current verification

- Focused static/lint matrix: 12/12 PASS.
- Fresh isolated Slice-2 rebuild/runtime 001-125: PASS.
- Runtime lock call preserved, private ACL unchanged, replay and rollback: PASS.
- Six observed idempotency-lock races: A-first 3/3, B-first 3/3; deadlockDelta 0.
- DB lint: only the exact historical compatibility warning; zero errors.
- Affected Phase 2 runtime: PASS under original assertions and current schema.
- Affected Phase 3 runtime: PASS under original assertions and current schema;
  concurrency deadlockDelta 0, only the historical compatibility lint warning.
- TypeScript and strict ESLint: PASS.
- Final repository unit tests after the parser correction: 644/644 PASS.
- Focused correction/Slice-2/continuity matrix: 24/24 PASS.
- Gitleaks over all 12 changed/untracked files, diff integrity, preflight and
  handoff validation: PASS. Zero staged files; HEAD remains the execution baseline.
- No task-owned test containers remain; pre-existing `nawasrah-n8n` was untouched.

Full quality, Canonical and Browser QA are not claimed as rerun by this bounded
correction. Exact-SHA CI for the owner-authorized corrective commit remains required.

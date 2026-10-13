# Verification gates

## Prepared private cadence — owner2026-10-13 (NOT activated)

Only private visibility + PRIVATE_CI_BUDGET_MODE=true enables affected push/PR:
types/lint/all units/secrets/all affected browser cases. Full DB+browser gates
remain unchanged for manual and weekly dispatch. No light-only release:delivery
verifier requires complete exact-SHA full jobs and secrets,including every DB
matrix. Weekly dispatcher dormant while public/unset. Current public mode still
runs complete CI on every push. Scope job adds one mandatory branch(current22
quality jobs),not a fixed-count acceptance assertion. Activation/uptime disable
and workload arithmetic in docs/operations/PRIVATE_CI_BUDGET.md;not executed.

Select gates proportionate to the task; phase closure requires all gates named by its approved contract.

## Owner gate decision — 2026-10-12 (current)

Before EACH commit run typecheck,lint,ALL unit tests,and ALL browser/isolated DB
runtime specs affected by the changed files,with both browsers where applicable.
Gitleaks must exit0. Complete exact-SHA GitHub quality plus secret scanning is
the mandatory acceptance gate for EVERY step;local focused PASS is not delivery.
Local unsplit full quality runs only before major milestones (Frankfurt project
creation/release) or an unexplained CI failure. This supersedes ordinary-step
local full-quality requirements below,not the full CI coverage. Repair a pushed
CI failure in a subsequent ordinary commit:no force-push,retries or weakened
checks. No Production/release authorization is conferred by this gate decision.

## Always

- `npm run agent:preflight`
- focused tests for changed behavior
- `npm run typecheck`
- `npm run lint:eslint:strict`
- `git diff --check`
- secret scan on changed and non-ignored untracked files

## Frontend/browser changes

- Admin and/or Customer build as affected
- Chromium and Mobile WebKit for affected flows
- Real two-tab/reload/recovery where concurrency or browser persistence is involved
- `npm run test:browser:isolation`; Production requests must be zero

## Database/business changes

- Static contract tests and affected runtime suites
- Fresh isolated rebuild through the approved migration ceiling
- DB lint and real independent-session concurrency probes when locks change
- Verify idempotency, replay, atomic rollback, zero partial writes, and evidence relationships

## Repository-wide/final candidate

- `npm run quality`
- full canonical isolated runner required by the phase
- Gitleaks changed + untracked scope
- migration immutability and final migration hash
- zero stale test-owned servers/processes/containers

## Exact-SHA delivery after the Package F browser split

Local `npm run quality` remains the complete unsplit gate. CI selects browser
files automatically: `e2e/package-f-*.spec.ts` in Package F, all others in core.
Dynamic Playwright discovery must prove the disjoint union equals full discovery
by test identity and browser project (no fixed count). Both independent pinned
containers retain the original configuration and20m limit. Package F now runs
three isolated matrix containers with Playwright --shard=1/3,2/3,3/3; discovery
compares each actual shard list plus core with the full list, rejecting duplicate,
missing, substituted or empty shards. The CI aggregate requires every matrix
shard, core and all DB jobs to succeed, never skip/cancel (fail-fast=false).
Before declaring delivery run `npm run agent:verify-handoff -- --delivery`:
this additionally verifies HEAD=remote main and successful exact-SHA quality,
core plus all three uniquely named shards, the aggregate/all DB jobs and secret scanning via GitHub.
Plain verify-handoff checks continuity only and reports deliveryReady=false.

A passing corrective suite is a claim until an independent read-only re-sign-off verifies it. A phase is closed only by owner decision after that sign-off.

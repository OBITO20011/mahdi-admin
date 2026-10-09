# Verification gates

Select gates proportionate to the task; phase closure requires all gates named by its approved contract.

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
containers retain the original configuration and20m limit. The CI aggregate
requires both browser jobs and all DB jobs to succeed, never skip/cancel.
Before declaring delivery run `npm run agent:verify-handoff -- --delivery`:
this additionally verifies HEAD=remote main and successful exact-SHA quality,
both browser branches, the aggregate/all DB jobs and secret scanning via GitHub.
Plain verify-handoff checks continuity only and reports deliveryReady=false.

A passing corrective suite is a claim until an independent read-only re-sign-off verifies it. A phase is closed only by owner decision after that sign-off.

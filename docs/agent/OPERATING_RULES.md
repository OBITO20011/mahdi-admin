# Multi-agent operating rules

Current explicit owner integration2026-10-15 supersedes historical reservations
below:merge PR2 accepted170/171,ceiling171;cloud170–179,next180–189 reserved.
140–149 permanent unused;152–159 and165–169 deferred,no backfill. No implied
permission for another migration or hosted access. Designs are docs-only.

## Single writer

Only one agent may write in a worktree at a time. Codex and Claude may not edit, stage, run mutating DB tests, or operate long-lived servers concurrently in the same checkout. A reviewer may inspect read-only after confirming no writer-owned process will mutate shared state.

## Start or resume

1. Read the canonical documents listed in `PROJECT_OVERVIEW.md`.
2. Run `npm run agent:preflight`.
3. For an active handoff, run `npm run agent:resume`.
4. Confirm task scope, prohibitions, baseline, dirty files, and active processes before editing.
5. If baseline, branch, migration ceiling/hash, or working-tree fingerprint differs, stop for owner review, except the owner's bounded2026-10-15 permission to synchronize task baseline/checkpoint to our known delivered commits. Unknown/other-writer changes still require review; no migration/hash authorization is implied.

For a newly authorized task starting from a clean tree:

```powershell
npm.cmd run agent:start -- --owner codex --phase 4.3 --objective "Approved bounded objective"
```

This captures the exact task baseline. Do not run it merely to explore an unapproved phase.

## While working

- Keep `ACTIVE_TASK.json` factual and concise; never paste secrets, tokens, environment values, customer data, or full chat transcripts.
- Use isolated test databases and fail-closed browser network guards.
- Preserve unrelated changes. Do not use destructive Git commands.
- Record verified facts separately from claims and remaining evidence gaps.
- Do not edit tracked files (including docs, task logs, and checkpoints) while
  verification processes are running. Keep live logs outside the checkout and
  checkpoint between completed gates. Isolated QA Vite servers disable HMR and
  file watching; ordinary development servers are unchanged.

## Handoff

Before another agent continues:

1. Stop or identify every task-owned process/server/container.
2. Run appropriate focused verification.
3. Run `npm run agent:checkpoint -- --next "<exact next action>"`.
4. Run `npm run agent:verify-handoff`.
5. The next agent runs `npm run agent:resume` before doing work.

Chat context is helpful but non-authoritative. Git, migrations, canonical docs, test evidence, and `ACTIVE_TASK.json` are the durable handoff.

## Authorization boundaries

Owner2026-10-15 standing delegation is recorded in `OWNER_DECISIONS.md`:
within approved scope,diagnose failures and repair non-product test/tool/CI
infrastructure without weakening assertions,retries,skips or increased timeouts;
one evidence-backed environmental rerun;known-own-delivery baseline/checkpoint
sync;presentation-only corrections without call/payload changes. Document each.
Money/inventory/balance/permission/auth logic,new or unapproved DB changes,
Production/Frankfurt/secrets/password access,deploy and new business decisions
still require specific approval. Existing139 local-only approval is unchanged;
140–149 are a permanent unused gap(owner2026-10-15);152–159 are this writer's
approved numbering lane ONLY,not approval to implement new migrations.
160–169 are reserved for the separate startup branch,which renumbers140–142
to160–162 itself. Do not touch that branch. Integration/ceiling/reference/CI
is a later explicit owner task;never use --include-all to backfill the old gap.

No Production access, deploy, commit, push, new migration, or phase transition is implied by ordinary implementation or handoff requests. Each requires explicit owner authorization in the current task.

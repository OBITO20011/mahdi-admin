# Multi-agent operating rules

## Single writer

Only one agent may write in a worktree at a time. Codex and Claude may not edit, stage, run mutating DB tests, or operate long-lived servers concurrently in the same checkout. A reviewer may inspect read-only after confirming no writer-owned process will mutate shared state.

## Start or resume

1. Read the canonical documents listed in `PROJECT_OVERVIEW.md`.
2. Run `npm run agent:preflight`.
3. For an active handoff, run `npm run agent:resume`.
4. Confirm task scope, prohibitions, baseline, dirty files, and active processes before editing.
5. If baseline, branch, migration ceiling/hash, or working-tree fingerprint differs, stop for owner review.

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

## Handoff

Before another agent continues:

1. Stop or identify every task-owned process/server/container.
2. Run appropriate focused verification.
3. Run `npm run agent:checkpoint -- --next "<exact next action>"`.
4. Run `npm run agent:verify-handoff`.
5. The next agent runs `npm run agent:resume` before doing work.

Chat context is helpful but non-authoritative. Git, migrations, canonical docs, test evidence, and `ACTIVE_TASK.json` are the durable handoff.

## Authorization boundaries

No Production access, deploy, commit, push, new migration, or phase transition is implied by ordinary implementation or handoff requests. Each requires explicit owner authorization in the current task.

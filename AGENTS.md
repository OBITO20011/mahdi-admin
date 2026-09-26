# Nawasrah ERP agent contract

Before changing this repository:

1. Read `docs/agent/OPERATING_RULES.md` and `docs/agent/PHASE_STATUS.md`.
2. Read `docs/agent/ACTIVE_TASK.json`. Run `npm run agent:preflight`.
3. Read the task-specific contracts linked from `docs/agent/PROJECT_OVERVIEW.md`.
4. Do not infer current truth from old chat transcripts or `docs/HANDOFF.md`; that file is historical operational context.

Hard rules:

- PostgreSQL/Supabase is authoritative for inventory, money, returns, and lifecycle state.
- Never edit historical migrations. The current approved ceiling is recorded in `docs/agent/project-state.json`.
- Never access Production, deploy, commit, push, or begin a new phase without explicit owner authorization.
- Use isolated local/test environments. Never print or persist secrets.
- One writing agent per worktree. A second agent may review read-only, but must not write concurrently.
- Before yielding, run the applicable verification and `npm run agent:checkpoint -- --next "<exact next action>"`.
- On takeover, run `npm run agent:resume`; stop if it reports a mismatch.

Prefer the smallest root-cause correction consistent with existing architecture. Preserve unrelated user changes.

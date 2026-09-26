# Claude Code entrypoint — Nawasrah ERP

This repository uses one agent-neutral source of truth. Read and obey:

1. `AGENTS.md`
2. `docs/agent/OPERATING_RULES.md`
3. `docs/agent/PHASE_STATUS.md`
4. `docs/agent/ACTIVE_TASK.json`
5. The task-specific contracts linked from `docs/agent/PROJECT_OVERVIEW.md`

Before edits, run `npm run agent:preflight`. When taking over an existing task, run `npm run agent:resume`; do not continue on a mismatch. Before handing back to Codex or the owner, run `npm run agent:checkpoint -- --next "<exact next action>"`.

Do not treat Claude memory, chat history, or `docs/HANDOFF.md` as current project truth. Do not access Production, deploy, commit, push, or start a new phase unless the owner explicitly authorizes it. Only one agent may write in this worktree at a time.

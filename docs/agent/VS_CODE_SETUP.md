# VS Code setup

The machine currently has both official integrations installed:

- OpenAI Codex: `openai.chatgpt`
- Anthropic Claude Code: `anthropic.claude-code`

Open `C:\Users\TOP\mahdi-admin` as the workspace. Use the built-in terminal at the repository root. VS Code tasks are available under **Terminal → Run Task** for preflight, resume, handoff verification, and the full quality gate.

## Safe takeover sequence

```powershell
npm.cmd run agent:preflight
npm.cmd run agent:resume
```

If `agent:resume` fails, do not ask either agent to “continue anyway.” Compare the reported branch, HEAD, migration state, and working-tree fingerprint with `ACTIVE_TASK.json`.

For a brand-new owner-authorized task on a clean tree:

```powershell
npm.cmd run agent:start -- --owner claude --phase 4.3 --objective "Approved bounded objective"
```

## Safe handoff sequence

```powershell
npm.cmd run agent:checkpoint -- --owner codex --next "Describe the exact next action"
npm.cmd run agent:verify-handoff
```

Use `--owner claude` when Claude is handing off. Stop task-owned servers/containers first or list them accurately in `ACTIVE_TASK.json`.

Do not enable dangerous permission bypasses. Grant only the tools needed for the current bounded task. Credentials remain in their established protected stores and never in agent documents.

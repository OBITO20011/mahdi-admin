# Nawasrah developer monitoring

This layer is exclusively for technical alerts sent to the developer. It is
separate from `automation_events`, the Telegram Business workflow, and the
WhatsApp Business workflow. It must never carry customer details, addresses,
phone numbers, order contents, balances, or financial totals.

## Architecture

- `Nawasrah Developer Watchdog` runs under Windows `SYSTEM` every five minutes
  and once after startup. It sends directly to the dedicated developer Telegram
  bot, so n8n is not required for delivery.
- The watchdog keeps a local incident state in
  `C:\ProgramData\NawasrahDeveloperMonitoring\incidents.json`. An incident is
  delivered once, persistent incidents use severity-based cooldown reminders,
  and a single recovery is delivered when the check becomes healthy.
- GitHub's `Nawasrah developer alerts` workflow watches completion transitions
  for Code Quality, Secret Scanning, and Public Uptime. Consecutive failures are
  deduplicated from GitHub run history and the first success after a failure
  sends recovery directly to the same developer-only Telegram channel.
- Cloudflare Pages is read using an API token with Pages read-only permission.
  Deployment status and source SHA are compared with the latest repository
  commit that affects each application.
- Supabase is queried read-only with the existing machine-protected backup
  credentials. n8n still receives no PostgreSQL password and no service-role
  key.
- After migrations `099`–`101`, the same watchdog reads sanitized integrity
  counters and publishes only allowlisted external health states to the
  owner+AAL2 Admin dashboard. No Business row, customer field, credential, or
  detailed financial payload is copied. Migration `102` also removes customer
  identity/address/location from the new-order Business event before n8n sees it.

## Checks

- Docker Safe Startup status.
- n8n container state and `/healthz`.
- recent n8n workflow execution errors, counted without forwarding logs.
- nightly backup success and 36-hour freshness.
- isolated restore drill success and 91-day freshness.
- independent ERP and n8n R2 off-site upload/download/restore status, with
  separate incident keys and 36-hour upload freshness.
- expected Supabase cron jobs, recent cron failures, and schedule freshness.
- automation delivery backlog and exhausted retry count, without payloads.
- missed or overdue Business summary delivery, as technical counts only.
- Cloudflare Admin and Customer production deployment status/SHA.
- GitHub CI, secret scan, and public uptime failure/recovery.
- database, inventory, accounting, shift, runtime, and security integrity state
  produced by the private advanced-monitoring RPC.

Runbooks for each incident family are in
`docs/operations/MONITORING_RUNBOOKS.md`.

## Required dedicated credentials

Do not reuse the owner/business bot or recipient.

1. Create a developer-only Telegram bot and obtain its bot token.
2. Open that bot chat from the developer Telegram account and obtain its Chat ID.
3. Create a Cloudflare API token limited to Account / Cloudflare Pages / Read.
4. Run `npm run monitoring:setup`. Values are entered via secure prompts, stored
   with Windows DPAPI `LocalMachine`, and protected by an ACL for the current
   user, Administrators, and `SYSTEM`.
   Browser-assisted local activation may use `npm run monitoring:activate-local`.
   That helper listens only on `127.0.0.1`, validates both providers, and writes
   a one-time machine-protected credential envelope. The elevated setup consumes
   and deletes the envelope; plaintext credentials are never passed on a command
   line or written to disk.
5. Add GitHub repository secrets `DEV_TELEGRAM_BOT_TOKEN` and
   `DEV_TELEGRAM_CHAT_ID`, then set repository variable
   `DEVELOPER_ALERTS_ENABLED=true`.

The setup validates Telegram and read-only Cloudflare access before registering
the scheduled task. No secret is accepted on a command line or committed to Git.

Before entering real credentials, run `npm run monitoring:test-system-dpapi`.
It protects a disposable random value as the interactive user and verifies its
decryption through a one-time Scheduled Task running as `SYSTEM`. The probe
persists only a sanitized PASS/FAIL result and removes its temporary ciphertext.

Use `npm run monitoring:status` to inspect the task and active incident keys. It
never outputs Telegram, Cloudflare, PostgreSQL, or backup credentials.

Do not infer `Healthy` from an old registration file. Compare the Scheduled Task,
the latest watchdog log, `incidents.json`, GitHub Actions, Cloudflare deployments,
and the Admin Health Dashboard. At the 2026-09-08 handoff audit, recent watchdog
logs existed but Task Scheduler enumeration returned no watchdog task and the
incident state still contained unreconciled failures. Treat that as an open
operational item until one scheduled SYSTEM run records clean checks/recoveries.

## Operational files

- Configuration: `C:\ProgramData\NawasrahDeveloperMonitoring\config.json`
- Incident state: `C:\ProgramData\NawasrahDeveloperMonitoring\incidents.json`
- Logs: `C:\ProgramData\NawasrahDeveloperMonitoring\logs`

Telegram delivery performs at most three attempts per run. Windows Task
Scheduler ignores overlapping executions and the Node runner also uses an
exclusive lock. There is no unbounded retry loop.

The current Business Telegram recipient is intentionally not documented here.
It is stored only in protected Business channel configuration and must be cut
over to the real store owner during final handoff. Developer bot credentials and
recipient remain separate.

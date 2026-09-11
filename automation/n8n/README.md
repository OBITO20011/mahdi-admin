# Nawasrah n8n automation

This local Community Edition instance is an automation layer around the ERP.
PostgreSQL RPC functions remain the only source of inventory and accounting
mutations. n8n must never update ERP tables directly.

## First setup

1. Verify `Nawasrah Docker Safe Startup` and Docker Server health. Do not start
   with Factory Reset or delete the n8n volume when Docker itself fails.
2. From PowerShell run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\automation\n8n\setup.ps1
   ```

3. Open `http://127.0.0.1:5678` and create the one owner account.
4. Use a new password. Do not reuse Supabase, Cloudflare, or Windows passwords.

The instance is bound only to `127.0.0.1`; it is not exposed to the internet.
The encryption key is generated locally in the ignored `.env` file and is not
printed. Workflow data and credentials live in the named Docker volume
`nawasrah_n8n_data`.

## Daily commands

```powershell
.\automation\n8n\start.ps1
.\automation\n8n\status.ps1
.\automation\n8n\stop.ps1
.\automation\n8n\backup.ps1
```

The n8n backup includes its database, managed files, encryption key, and the
Supabase feed secret inside one AES-256-GCM encrypted `.nwb` archive. It reuses the separate archive
passphrase from the existing Nawasrah backup configuration and verifies the
encrypted archive before publishing it to the configured backup folder.

The intended production schedule is registered with:

```powershell
.\automation\n8n\register-backup-schedule.ps1
```

`Nawasrah n8n Daily Backup` runs under Windows `SYSTEM` every day at 01:30,
uses the existing machine-scope DPAPI backup configuration, and runs missed
schedules when the machine becomes available. A backup is published only after
AES-GCM verification, isolated extraction, and a read of the restored SQLite
database by the n8n CLI. Status and bounded daily logs live in
`C:\ProgramData\NawasrahN8nBackup`, outside the n8n volumes. The newest 30
archives are retained (or the configured ERP retention count); overlapping
runs are locked and Task Scheduler ignores a second instance.

Always verify current registration and last result instead of trusting an old
registration file:

```powershell
schtasks.exe /Query /TN "Nawasrah n8n Daily Backup" /FO LIST /V
Get-Content C:\ProgramData\NawasrahN8nBackup\last-status.json
```

On 2026-09-11 the task was re-registered under `SYSTEM`, ran successfully with
exit code `0`, and produced an encrypted archive with `restoreVerified=true`.
Its R2 upload, download verification, and isolated restore drill also passed.
`OPERATIONAL RECOVERY = VERIFIED`.

## Security boundary

- Do not place the Supabase `service_role` key in n8n.
- Do not use PostgreSQL credentials in a workflow.
- ERP changes must call a dedicated authenticated Edge Function or an existing
  role-checked RPC contract.
- The Execute Command and Read/Write Files nodes are disabled.
- The Code node, Python runner, and third-party community packages are disabled.
- The public n8n API is disabled.
- Before exposing webhooks publicly, add HTTPS, a stable hostname, webhook
  authentication, and rate limiting.

n8n 2.x may still log a harmless missing-Python-runner warning even when Python
is disabled. The Code node is also blocked here, so that runner isn't available
to workflows.

## Secure Supabase alert feed

Migration `057_secure_n8n_automation_events.sql` records immutable operational
events for new website orders, low/out-of-stock alerts, and closed cash shifts.
The `n8n-alert-feed` Edge Function is the only n8n gateway. It authenticates a
scoped shared secret and calls service-role-only claim/complete RPCs internally.
Each event has an independent Telegram and WhatsApp delivery state, lease, and
retry counter.

Migration `096_harden_automation_delivery_lifecycle.sql` makes exhausted
deliveries explicit as `dead_letter` after the existing fixed ten-attempt
budget. Expired leases remain reclaimable, active leases are never stolen, and
first/last attempt timestamps support aggregate latency monitoring. The
Developer Watchdog reports only technical counts for backlog, stuck leases,
dead letters, and latency; it never reads Business payloads into an alert.

Migration `097_core_business_alerts.sql` adds a private incident state machine
and one bounded five-minute database scanner. It reuses this same outbox and
recipient: no new delivery path or credential is added. Website orders that
actually become `expired` and purchase orders past a recorded
`expected_delivery_date` are enabled. Migration
`105_harden_business_alert_rules_and_thresholds.sql` later adopts the approved
two-hour delayed-order rule, any-non-zero cash difference, calendar-day expense
reporting in `Asia/Amman` without an amount alert, and the shift cutoff at the
earlier of 15 elapsed hours or next local midnight. Customer/supplier
overdue-debt alerts remain unavailable until the source records have a
trustworthy due date.

Migration `098_business_summaries.sql` adds one deduplicated summary ledger and
one bounded five-minute scheduler. The default owner schedule is 08:00 daily
and 09:00 each Monday for the preceding Monday-Sunday period in `Asia/Amman`.
The message contains aggregate operational figures only, reuses the existing
Business recipient and hardened delivery lifecycle, and never goes to the
Developer bot. Developer monitoring receives only missed-period and overdue
delivery counts when a summary fails.

Migrations `099`–`101` add the owner+AAL2 Health Dashboard, read-only Business
Integrity/performance/security checks, and correct incident ownership and
supplier-receipt monitoring. Migration `102` removes customer name, phone,
address, notes, and location from the new-order payload before it leaves
PostgreSQL. Business delivery failures expose only sanitized technical counts
to Developer Monitoring.

The shared secret is generated in the protected ignored `.env.feed` file. It is
uploaded to Supabase with `supabase secrets set --env-file` and imported into
n8n as the encrypted `Nawasrah Supabase Alert Feed` Header Auth credential. It
is never stored in a workflow JSON file.

## Alert workflows

The repository contains two workflow definitions in
`workflows/nawasrah-alerts.json`:

1. `Nawasrah ERP - Telegram Alerts`
2. `Nawasrah ERP - WhatsApp Alerts`

They poll once per minute, split claimed events, send an Arabic operational
message, and acknowledge Supabase only after the channel succeeds. A provider
failure leaves the leased event available for a safe retry.

Notification destinations are centralized in the protected ignored
`.env.channels` file. Telegram uses its numeric Chat ID and WhatsApp uses the
approved international recipient format. `import-workflows.ps1` validates these
values and substitutes them into a temporary workflow copy, so recipient IDs
are never stored in the repository workflow template or documentation.

Current production intent:

- Telegram Business delivery is live with encrypted n8n credentials and the
  current temporary Business recipient. Cutover to the real store-owner Chat ID
  is deferred to final handoff; do not record either ID in Git.
- WhatsApp remains inactive until an official Meta WhatsApp Business Cloud
  credential, Sender Phone Number ID, recipient, and template/session policy
  are approved and tested.
- Developer Telegram is a separate bot/recipient and is never configured in
  `.env.channels` or routed through these workflows.

To re-import them after a restore:

```powershell
.\automation\n8n\import-feed-credential.ps1 -ProjectId <personal-project-id>
.\automation\n8n\import-workflows.ps1 -ProjectId <personal-project-id>
```

Always run a manual execution successfully before publishing either workflow.

## Live Business coverage

- New website orders, low/out-of-stock, and shift close/cash discrepancy events.
- Expired website orders and overdue purchase orders with trusted due dates.
- Delayed orders after two hours and overdue open shifts at the earlier of 15
  elapsed hours or next `Asia/Amman` midnight, with deduplication and recovery.
- Any non-zero cash difference in the existing shift-close event; daily expense
  totals remain calendar-day summary data with no monetary-threshold alert.
- Daily and weekly aggregate Business summaries.
- Business-integrity warning summaries when a real invariant is violated.

Details stay in Admin to avoid alert fatigue. Delivery uses one outbox with
per-channel leases, deduplication, bounded retry, dead-letter, and latency
monitoring.

# Nawasrah n8n automation

This local Community Edition instance is an automation layer around the ERP.
PostgreSQL RPC functions remain the only source of inventory and accounting
mutations. n8n must never update ERP tables directly.

## First setup

1. Keep Docker Desktop running.
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

The shared secret is generated in the protected ignored `.env.feed` file. It is
uploaded to Supabase with `supabase secrets set --env-file` and imported into
n8n as the encrypted `Nawasrah Supabase Alert Feed` Header Auth credential. It
is never stored in a workflow JSON file.

## Alert workflows

The repository contains two inactive workflows in
`workflows/nawasrah-alerts.json`:

1. `Nawasrah ERP - Telegram Alerts`
2. `Nawasrah ERP - WhatsApp Alerts`

They poll once per minute, split claimed events, send an Arabic operational
message, and acknowledge Supabase only after the channel succeeds. A provider
failure leaves the leased event available for a safe retry.

Notification destinations are centralized in the protected ignored
`.env.channels` file. The initial WhatsApp recipient is `0772838886` in local
format and `962772838886` in international format. Telegram uses its numeric
Chat ID instead of a phone number. `import-workflows.ps1` validates these
values and substitutes them into a temporary workflow copy, so the private
Telegram Chat ID is never stored in the repository workflow template.

Both workflows must stay inactive until their provider credentials are added:

- Telegram: a BotFather token saved as a Telegram API credential, then the
  target user opens the bot chat and the Chat ID is selected.
- WhatsApp: an official Meta WhatsApp Business Cloud credential and Sender
  Phone Number ID. Meta template/session rules still apply to outbound text.

To re-import them after a restore:

```powershell
.\automation\n8n\import-feed-credential.ps1 -ProjectId <personal-project-id>
.\automation\n8n\import-workflows.ps1 -ProjectId <personal-project-id>
```

Always run a manual execution successfully before publishing either workflow.

## First production events

1. New website order notification.
2. Low/out-of-stock notification.
3. Closed-shift summary.

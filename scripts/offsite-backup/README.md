# Cloudflare R2 off-site backups

This layer copies only already-verified encrypted `.nwb` archives to the private
EU-jurisdiction bucket `nawasrah-offsite-backups`. It does not connect to the
Production database and does not change the existing ERP or n8n backup jobs.

## Object layout

- `erp/daily/YYYY/MM/DD/<archive>.nwb`
- `erp/monthly/YYYY/MM/<archive>.nwb`
- `n8n/daily/YYYY/MM/DD/<archive>.nwb`
- `n8n/monthly/YYYY/MM/<archive>.nwb`

Every archive has a sibling `.sha256` object. Object names are immutable: a
rerun with the same size and SHA-256 is a no-op; a mismatch is a hard failure.
The uploader never calls an object-delete API.

## Credentials and state

The R2 S3 access-key pair is bucket-scoped and stored only in
`C:\ProgramData\NawasrahOffsiteBackup\config.json` with Windows DPAPI
`LocalMachine`. The file and directory ACL allow only the setup user,
Administrators, and `SYSTEM`. Secrets are not written to logs, status JSON,
documentation, or Git. `setup-offsite-backup.ps1` verifies decryption and R2
access through a one-time task running as `SYSTEM` before registering schedules.

Cloudflare's Object Read & Write permission is the narrowest R2 permission that
supports upload plus restore download. It cannot edit bucket configuration.
The committed uploader contains no delete operation, and a 30-day bucket lock
protects uploaded backup prefixes after the first successful restore drills.

## Schedules

- Upload: daily at 02:10 and 20 minutes after startup. This follows the ERP
  23:30 and n8n 01:30 local jobs.
- Remote download/SHA-256 verification: Sunday at 03:00, due every 7 days.
- Remote isolated restore drill: daily gate at 03:30, executes only when the
  last successful drill is at least 90 days old.

All tasks run as `SYSTEM`, ignore overlap, have a two-hour execution limit, and
use two bounded Task Scheduler retries separated by 10 minutes. SDK requests
also use three bounded attempts. A shared exclusive lock prevents concurrent
off-site operations.

## Operator commands

```powershell
npm.cmd run offsite:upload
npm.cmd run offsite:verify
npm.cmd run offsite:restore-test
```

Status and logs are stored outside backup data:

- `C:\ProgramData\NawasrahOffsiteBackup\erp-status.json`
- `C:\ProgramData\NawasrahOffsiteBackup\n8n-status.json`
- `C:\ProgramData\NawasrahOffsiteBackup\logs`

Healthy status requires a recent verified upload and a remote download that
passed the existing isolated ERP or n8n restore tooling. Restore work files are
temporary and are removed after each run. Production Supabase and live n8n
volumes are never restore targets.

## Cloudflare retention controls

Configure only after both first remote restore drills pass:

- daily prefixes expire after 90 days;
- monthly prefixes expire after 365 days;
- `erp/` and `n8n/` prefixes have a 30-day retention lock.

Lifecycle and lock changes use an administrator's Wrangler session, never the
runtime credential. Read the rules back after applying them.

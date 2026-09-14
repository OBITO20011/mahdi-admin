# Nawasrah ERP automatic backup

This Windows-only workflow creates one encrypted `.nwb` archive per run. A
successful archive contains:

- the `public` PostgreSQL schema and data from the linked Supabase project;
- the project's Supabase migrations and `config.toml`;
- every object currently stored in the public `product-images` bucket;
- a manifest with SHA-256 checksums for every archived file.

The backup is encrypted with AES-256-GCM. The Supabase database password and
archive passphrase are stored outside the repository. The interactive copy at
`%LOCALAPPDATA%\NawasrahBackup\config.json` is protected with Windows DPAPI for
the current user. The unattended copy at `config-machine.json` is protected
with machine-scoped DPAPI and an ACL restricted to the setup user, local
Administrators, and `SYSTEM`. No service-role key is required or stored.

## One-time setup

Prerequisites:

1. Install the official PostgreSQL 17 Windows binary tools under
   `%LOCALAPPDATA%\NawasrahBackup\postgresql-17.11` so that `bin\pg_dump.exe`,
   `bin\pg_dumpall.exe`, `bin\pg_restore.exe`, and `bin\psql.exe` exist. The
   official Windows download page links to the EDB binary ZIP. The nightly
   backup uses these native tools and does not need Docker Desktop. Preflight
   fails before credentials are requested if the tools are missing.
2. The project remains linked to `acjtabdqqnpwhdvbvnyw`.
3. You know the Supabase database password.
4. Choose a separate archive passphrase of at least 16 characters and keep a
   written recovery copy outside the computer.

From PowerShell in the project root:

```powershell
npm.cmd run backup:setup
```

The default schedule is daily at 23:30, keeps the newest 30 verified archives,
and uses `OneDrive\Nawasrah ERP Backups` when OneDrive is available. Custom
example:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\setup-backup.ps1 `
  -ScheduleTime 22:00 `
  -RetentionCount 45 `
  -BackupRoot 'D:\Nawasrah Backups'
```

The first setup asks for Windows elevation once and registers **Nawasrah ERP
Nightly Backup** as a `SYSTEM` service-account task. The task runs even when no
user is signed in, uses native `pg_dump`/`pg_dumpall`, and does not start or
depend on Docker Desktop. `StartWhenAvailable` catches up after a missed
schedule while Windows remains available. A second trigger runs the same task
five minutes after system startup, covering a
schedule missed while the machine was fully powered off. Transient failures are
retried up to three times at 15-minute intervals. The computer needs an internet
connection when the backup runs.

To recreate both reliable schedules without changing backup credentials, run:

```powershell
npm.cmd run backup:schedule
```

This command does not request or store the Windows account password. The machine
does not need to stay signed in. A completely powered-off computer cannot create
a local backup at the scheduled time; the startup trigger catches it up after
Windows next boots.

`backup:background` remains as a backwards-compatible alias for registering the
same unattended `SYSTEM` schedule.

The same command also creates a second scheduled task named **Nawasrah ERP
Quarterly Restore Drill**. It wakes daily at 02:17, reads only the timestamp of
the last safe restore report, and runs the isolated restore test only when 90
days have elapsed (or when no successful report exists). This drill remains an
interactive task because the isolated Supabase PostgreSQL container uses Docker
Desktop; it never connects to or overwrites the live Supabase database. Daily
backup reliability does not depend on this quarterly Docker task.

Check the schedule and latest backup without exposing any secret:

```powershell
npm.cmd run backup:status
```

The status output includes `restoreDrillTask` and `latestRestoreDrill`. Before
relying on the new schedule, perform one fresh safe drill now:

```powershell
npm.cmd run backup:restore-test
```

It must finish with a report containing `"ok": true` and
`"liveSupabaseTouched": false`. You can manually run the scheduled 90-day gate
without forcing a new drill with:

```powershell
npm.cmd run backup:restore-schedule
```

Run manual verification and restore commands from the same Windows account that
completed `backup:setup`. Its interactive configuration is deliberately bound
to that Windows account. Only the registered `SYSTEM` task uses the separate,
machine-protected configuration.

If the Supabase Database password is reset later, update only that credential
without changing the archive passphrase:

```powershell
npm.cmd run backup:update-password
```

The updater tests the new password first, creates a verified backup, and only
then refreshes the machine-protected configuration and daily task. If the
original setup stopped before task creation, the updater completes that step
automatically at the saved time (or 23:30 by default). A rejected password
leaves the schedule disabled and restores the previous encrypted configuration
value.

## Verification and safe extraction

Verify the newest archive without changing Supabase:

```powershell
npm.cmd run backup:verify
```

Extract a verified archive for inspection only:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\verify-latest-backup.ps1 `
  -ExtractTo 'C:\Nawasrah Restore Inspection\2026-08-13'
```

Extraction never restores or overwrites the live database. A live restore must
be performed deliberately with Supabase tooling after reviewing the extracted
schema, data, migrations, and Storage objects.

## Safe restore drill

Run a real recovery test without touching the live Supabase project:

```powershell
npm.cmd run backup:restore-test
```

The drill decrypts and verifies the newest archive, starts an ephemeral Docker
container using the project's Supabase PostgreSQL version, restores the public
schema and data, and validates tables, row counts, foreign keys, constraints,
and PostgreSQL functions. It then force-removes the isolated container and its
temporary decrypted files even when validation fails. No database password,
project URL, persistent Docker volume, or live Supabase connection is used.

The role dump is checksum-verified but is not applied during this drill because
the Supabase PostgreSQL image already owns its platform roles. The result is
written beside the archive as `last-restore-drill-status.json`. A successful
report must contain `"ok": true` and `"liveSupabaseTouched": false`.

If OneDrive moved the backup folder, the runner searches for a folder named
`Nawasrah ERP Backups` below the current OneDrive root and selects the newest
archive. Update the saved `backupRoot` before the next scheduled production
backup so new archives continue to be written to the intended folder. The
update command also refreshes the unattended machine configuration and may ask
for elevation.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\update-backup-root.ps1 `
  -BackupRoot 'C:\Users\TOP\OneDrive\سطح المكتب\Nawasrah ERP Backups'
```

This project's current logical workflow excludes managed `auth` and `storage`
database schemas. Product-image bytes are copied separately, but the current
artifact does not contain Auth users, password hashes, identities, sessions or MFA
factors. For recovery from this artifact, staff accounts must be recreated through
supported Auth APIs, passwords reset and MFA re-enrolled. Public rows that retain an
old `auth.users.id` require a reviewed UUID mapping; never write Auth internals merely
to preserve an identifier. A separately designed full-platform backup/clone may have
different capabilities, but it is not evidence supplied by this artifact.

## Full isolated recovery evidence — 2026-09-14

The exact R2 ERP object for `2026-09-14T03-34-51Z` was independently downloaded,
matched by size/SHA-256, decrypted with the off-device passphrase copy and restored
to a network-disabled local PostgreSQL container. Active database restoration took
`43.7s`: 54 public tables, 465 rows, 109 foreign keys, 0 unvalidated constraints and
209 public functions were present.

The artifact's role dump is verified but not applied by the local runner, and the
database dump uses `--no-privileges`. Consequently the standalone artifact restore
is not a cutover-ready authorization model. The tested recovery order is:

1. create a clean Supabase target and prove it is not Production;
2. apply canonical migrations `001–111` so grants, RLS and platform integration are
   reconstructed from reviewed history;
3. restore the verified public data for the selected cutoff;
4. reprovision Auth/configuration/Edge secrets and deploy repository functions;
5. recreate users through supported Auth APIs, reset passwords, re-enroll MFA and
   perform reviewed UUID mapping for public references;
6. restore verified Storage object bytes, then run application and reconciliation
   smoke tests before any cutover.

An approved synthetic-only Managed Supabase target applied `001–111` in `11m53.4s`
and matched Production's compared application schema, policies and ACLs; only the
platform-generated `rls_auto_enable` helper was absent. Synthetic Managed Auth/TOTP,
Admin Chromium/Mobile WebKit, Customer gateway idempotency, Edge Function deployment
and Storage upload/download/hash tests passed. Real Production data was not uploaded
to that cloud target. Therefore:

- `DATABASE CANONICAL REBUILD = VERIFIED`
- `R2 ARTIFACT RECOVERY = VERIFIED`
- `HOST-INDEPENDENT R2 ACCESS = PARTIALLY VERIFIED` because R2 credentials came from
  current-machine protected configuration
- `FULL ISOLATED DISASTER-RECOVERY DRILL = PARTIALLY VERIFIED`

The partial verdict is intentional: the current artifact is not a complete Managed
Supabase project backup, Production Auth cannot be restored from it, historical UUID
remapping and a full Production-data cloud cutover were not executed, and the same
physical Windows host was used for the drill.

After the target was confirmed free of synthetic Auth/business/Storage rows, the
approved cleanup deleted the temporary Managed DR project, isolated local container,
DR volumes/network and temporary working files. It did not delete or alter the
original ERP backup, the private R2 object, Production or `nawasrah-n8n`.

Provider references for a separately approved platform-level recovery design:
[restore a platform project](https://supabase.com/docs/guides/self-hosting/restore-from-platform),
[migrate Auth users](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects),
and [clone a project](https://supabase.com/docs/guides/platform/clone-project).
These describe broader provider capabilities; they do not expand what the current
Nawasrah artifact contains.

## Monitoring

The backup destination contains:

- `last-backup-status.json`: machine-readable status of the latest attempt;
- `backup.log`: append-only success/failure history;
- `nawasrah-backup-<UTC timestamp>.nwb`: verified encrypted archives.

The runner also writes early setup/runner failures beside the configuration as
`%LOCALAPPDATA%\NawasrahBackup\runner.log`, including the Windows execution
identity and explicit `STARTED`, `SUCCESS`, or `FAILED` state. Secret values are
never written to this log.

Restore-drill scheduling failures are written separately to
`%LOCALAPPDATA%\NawasrahBackup\restore-drill-runner.log`.

Verified encrypted archives are additionally copied by the independent R2
off-site layer documented in
[`scripts/offsite-backup/README.md`](../offsite-backup/README.md). The local
backup path, local retention, encryption format, and nightly task remain
unchanged; off-site upload failure therefore cannot invalidate a successful
local backup.

## Handoff status

Do not treat a recent manual archive as proof that the unattended schedule is
healthy. Check `task.lastTaskResult` from `npm.cmd run backup:status`; it must be
`0`. The 2026-09-08 failure (`1`) is historical: Operational Recovery subsequently
verified the scheduled task under SYSTEM. The 2026-09-14 read-only audit observed
the 2026-09-13 23:30 scheduled run at `0`. Fresh local/R2 artifact verification
on 2026-09-14 is separate evidence, not a new scheduled-run claim. See
[`docs/HANDOFF.md`](../../docs/HANDOFF.md) for current evidence and recovery ownership.

## New-machine recovery checklist

1. Distinguish loss of the Windows host from loss of Supabase. A lost host alone
   does not justify overwriting the still-healthy cloud database.
2. The owner authorizes a named operator and recovery target. Recover Git access,
   the archive passphrase from its independently held recovery copy, and R2 read
   access. DPAPI ciphertext copied from the lost Windows machine is not a portable
   recovery secret. If the independent passphrase is unavailable, STOP.
3. Install the documented Windows/Node/PostgreSQL prerequisites. Docker is needed
   for isolated restore drills/n8n, not native nightly ERP dumps. Check out the
   approved code and migration state; recreate protected configuration through
   official setup under a separately approved recovery task.
4. Download the chosen immutable R2 object and sidecar to a restricted temporary
   directory; match size/SHA-256 and verify/decrypt the exact archive. Never print
   passphrases, tokens, decrypted business data or signed URLs.
5. Restore to an isolated target first. Check tables, constraints, row counts,
   financial/inventory reconciliation and application compatibility. Retain the
   prior restore evidence as a dated artifact-specific result.
6. A new Supabase project additionally needs Auth identities and UUID relationships,
   Auth/MFA configuration, Edge Functions/secrets, Storage policy and object setup,
   external integrations and public build configuration. The public-schema archive
   is not a full managed-project backup. The drill's placeholder Auth rows are not
   usable staff login accounts; do not replace IDs casually or assume MFA recovery.
7. Only after owner approval, choose a production cutover/restore procedure and
   reconcile transactions after the backup cutoff. For host-only loss, restore n8n
   and protected task configuration without restoring the healthy ERP database.
8. Confirm login/roles, read-only Admin/Customer smoke, schedules, notifications and
   backup freshness. Resume real operations only with the owner's decision.

RPO/RTO targets and responsibility handoff are recommendations recorded in HANDOFF;
this checklist does not prove a timed new-machine recovery or authorize a live restore.

# Nawasrah ERP automatic backup

This Windows-only workflow creates one encrypted `.nwb` archive per run. A
successful archive contains:

- the `public` PostgreSQL schema and data from the linked Supabase project;
- the project's Supabase migrations and `config.toml`;
- every object currently stored in the public `product-images` bucket;
- a manifest with SHA-256 checksums for every archived file.

The backup is encrypted with AES-256-GCM. The Supabase database password and
archive passphrase are stored outside the repository in
`%LOCALAPPDATA%\NawasrahBackup\config.json`, encrypted with Windows DPAPI for
the current user. No service-role key is required or stored.

## One-time setup

Prerequisites:

1. Docker Desktop is installed. The runner starts it when needed because the
   official Supabase `db dump` command uses Docker.
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

The first setup registers a Docker-compatible **Interactive** task for the
current Windows user. This is intentional: Docker Desktop needs an active
Windows desktop session. If the computer is off or the user is signed out at
the planned time, `StartWhenAvailable` runs the missed task after the next
Windows sign-in. The device must have an internet connection.

To recreate both reliable schedules without changing backup credentials, run:

```powershell
npm.cmd run backup:schedule
```

This command does not request or store the Windows account password. The machine
must be powered on, the configured Windows user must be signed in, and Docker
Desktop must be available. A completely powered-off computer cannot create a
local backup.

`backup:background` remains as a backwards-compatible alias for the same safe
interactive schedule; it does not promise signed-out Docker execution.

The same command also creates a second scheduled task named **Nawasrah ERP
Quarterly Restore Drill**. It wakes daily at 02:17, reads only the timestamp of
the last safe restore report, and runs the isolated restore test only when 90
days have elapsed (or when no successful report exists). It never connects to
or overwrites the live Supabase database.

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

Run these commands from the same Windows account that completed
`backup:setup`. The encrypted configuration is deliberately bound to that
Windows account, so another account (including a restricted automation
session) cannot decrypt it or impersonate the backup owner.

If the Supabase Database password is reset later, update only that credential
without changing the archive passphrase:

```powershell
npm.cmd run backup:update-password
```

The updater tests the new password first, creates a verified backup, and only
then creates or replaces the daily task. If the original setup stopped before
task creation, the updater completes that step automatically at the saved time
(or 23:30 by default). A rejected password leaves the schedule disabled and
restores the previous encrypted configuration value.

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
backup so new archives continue to be written to the intended folder.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\update-backup-root.ps1 `
  -BackupRoot 'C:\Users\TOP\OneDrive\سطح المكتب\Nawasrah ERP Backups'
```

Supabase CLI intentionally excludes managed `auth` and `storage` database
schemas. The actual product images are copied separately by this workflow, but
Supabase Auth passwords are not exportable by this logical backup. For a full
project disaster migration, staff Auth accounts must be recreated and their
passwords reset. Supabase's paid platform backup remains the stronger recovery
option once the system is in daily production use.

## Monitoring

The backup destination contains:

- `last-backup-status.json`: machine-readable status of the latest attempt;
- `backup.log`: append-only success/failure history;
- `nawasrah-backup-<UTC timestamp>.nwb`: verified encrypted archives.

The runner also writes early setup/runner failures to
`%LOCALAPPDATA%\NawasrahBackup\runner.log` when it cannot yet access the backup
destination.

Restore-drill scheduling failures are written separately to
`%LOCALAPPDATA%\NawasrahBackup\restore-drill-runner.log`.

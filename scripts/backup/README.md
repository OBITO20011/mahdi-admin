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
schedule, and transient failures are retried up to three times at 15-minute
intervals. The computer must be powered on and have an internet connection.

To recreate both reliable schedules without changing backup credentials, run:

```powershell
npm.cmd run backup:schedule
```

This command does not request or store the Windows account password. The machine
must be powered on, but the configured Windows user does not need to be signed
in. A completely powered-off computer cannot create a local backup; the missed
run starts when Windows next becomes available.

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

The runner also writes early setup/runner failures beside the configuration as
`%LOCALAPPDATA%\NawasrahBackup\runner.log`, including the Windows execution
identity and explicit `STARTED`, `SUCCESS`, or `FAILED` state. Secret values are
never written to this log.

Restore-drill scheduling failures are written separately to
`%LOCALAPPDATA%\NawasrahBackup\restore-drill-runner.log`.

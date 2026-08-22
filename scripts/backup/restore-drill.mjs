import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { verifyBackupArchive } from './verify-backup.mjs';

const execFileAsync = promisify(execFile);
const DATABASE_NAME = 'nawasrah_restore_drill';
const REQUIRED_CORE_TABLES = [
  'products',
  'inventory_balances',
  'inventory_movements',
  'customers',
  'orders',
];
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_$]*$/u;

async function docker(args, options = {}) {
  return execFileAsync('docker.exe', args, {
    windowsHide: true,
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
}

function safeErrorMessage(error) {
  if (!(error instanceof Error)) return 'Unknown restore drill failure.';
  const passphrase = process.env.NAWASRAH_BACKUP_PASSPHRASE;
  const message = passphrase
    ? error.message.replaceAll(passphrase, '[redacted]')
    : error.message;
  return message.slice(0, 4000);
}

async function waitForPostgres(containerName, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { stdout, stderr } = await docker(['logs', containerName]);
      const logs = `${stdout}\n${stderr}`;
      const initializationFinished = logs.includes('PostgreSQL init process complete; ready for start up.')
        || logs.includes('Skipping initialization');
      if (!initializationFinished) {
        throw new Error('PostgreSQL initialization is still running.');
      }
      await docker([
        'exec', containerName,
        'pg_isready', '--username', 'postgres', '--dbname', 'postgres',
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('The isolated PostgreSQL container did not finish initialization in time.');
}

async function psql(containerName, sql) {
  const { stdout } = await docker([
    'exec', containerName,
    'psql', '-X', '--no-psqlrc', '--tuples-only', '--no-align',
    '--set', 'ON_ERROR_STOP=1',
    '--username', 'postgres', '--dbname', DATABASE_NAME,
    '--command', sql,
  ]);
  return stdout.trim();
}

async function restoreSqlFile(containerName, containerPath) {
  await docker([
    'exec', containerName,
    'psql', '-X', '--no-psqlrc', '--single-transaction',
    '--set', 'ON_ERROR_STOP=1',
    '--username', 'postgres', '--dbname', DATABASE_NAME,
    '--file', containerPath,
  ]);
}

async function inspectRestoredDatabase(containerName) {
  const tableOutput = await psql(
    containerName,
    "select tablename from pg_catalog.pg_tables where schemaname = 'public' order by tablename;"
  );
  const tables = tableOutput.split(/\r?\n/u).filter(Boolean);
  if (tables.length === 0) {
    throw new Error('Restore validation found no tables in the public schema.');
  }

  for (const table of tables) {
    if (!SAFE_IDENTIFIER.test(table)) {
      throw new Error(`Restore validation found an unsafe table identifier: ${table}`);
    }
  }

  const missingCoreTables = REQUIRED_CORE_TABLES.filter((table) => !tables.includes(table));
  if (missingCoreTables.length > 0) {
    throw new Error(`Restore validation is missing core tables: ${missingCoreTables.join(', ')}`);
  }

  const rowCounts = {};
  let totalRows = 0;
  for (const table of tables) {
    const count = Number(await psql(containerName, `select count(*) from public."${table}";`));
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Restore validation received an invalid row count for ${table}.`);
    }
    rowCounts[table] = count;
    totalRows += count;
  }

  if (totalRows === 0) {
    throw new Error('Restore validation found no application rows in the backup.');
  }

  const foreignKeyCount = Number(await psql(
    containerName,
    "select count(*) from pg_catalog.pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace;"
  ));
  const unvalidatedConstraintCount = Number(await psql(
    containerName,
    "select count(*) from pg_catalog.pg_constraint where connamespace = 'public'::regnamespace and not convalidated;"
  ));
  const functionCount = Number(await psql(
    containerName,
    "select count(*) from pg_catalog.pg_proc where pronamespace = 'public'::regnamespace;"
  ));

  if (!Number.isSafeInteger(foreignKeyCount) || foreignKeyCount <= 0) {
    throw new Error('Restore validation found no public foreign-key relationships.');
  }
  if (unvalidatedConstraintCount !== 0) {
    throw new Error(`Restore validation found ${unvalidatedConstraintCount} unvalidated constraints.`);
  }
  if (!Number.isSafeInteger(functionCount) || functionCount <= 0) {
    throw new Error('Restore validation found no public PostgreSQL functions.');
  }

  return {
    tableCount: tables.length,
    totalRows,
    foreignKeyCount,
    unvalidatedConstraintCount,
    functionCount,
    coreTableRows: Object.fromEntries(
      REQUIRED_CORE_TABLES.map((table) => [table, rowCounts[table]])
    ),
  };
}

async function writeReport(reportPath, report) {
  if (!reportPath) return;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export async function runRestoreDrill({
  archivePath,
  passphrase,
  reportPath = undefined,
  postgresImage = 'public.ecr.aws/supabase/postgres:17.6.1.147',
}) {
  const startedAt = new Date();
  const resolvedArchive = path.resolve(archivePath);
  const resolvedReport = reportPath ? path.resolve(reportPath) : undefined;
  const tempBase = path.resolve(tmpdir());
  const tempRoot = await mkdtemp(path.join(tempBase, 'nawasrah-restore-drill-'));
  const extractedRoot = path.join(tempRoot, 'verified-backup');
  const containerName = `nawasrah-restore-drill-${process.pid}-${randomBytes(4).toString('hex')}`;
  const temporaryPostgresPassword = randomBytes(32).toString('base64url');
  let containerStarted = false;
  let report;

  if (!/^nawasrah-restore-drill-[0-9]+-[a-f0-9]{8}$/u.test(containerName)) {
    throw new Error('Refusing to use an unexpected Docker container name.');
  }

  try {
    await access(resolvedArchive);
    const verification = await verifyBackupArchive({
      archivePath: resolvedArchive,
      passphrase,
      extractTo: extractedRoot,
    });

    const manifest = JSON.parse(await readFile(path.join(extractedRoot, 'manifest.json'), 'utf8'));
    const schemaPath = path.join(extractedRoot, 'database', 'schema.sql');
    const dataPath = path.join(extractedRoot, 'database', 'data.sql');

    await docker(['info', '--format', '{{.ServerVersion}}']);
    await docker([
      'run', '--detach', '--rm', '--name', containerName,
      '--env', 'POSTGRES_PASSWORD',
      '--env', `POSTGRES_DB=${DATABASE_NAME}`,
      postgresImage,
    ], {
      env: { ...process.env, POSTGRES_PASSWORD: temporaryPostgresPassword },
    });
    containerStarted = true;
    await waitForPostgres(containerName);

    // Supabase's PostgreSQL image creates POSTGRES_DB under its platform admin.
    // Transfer only this ephemeral database to postgres so the public-schema
    // dump can recreate/own its schema exactly as it does in a real restore.
    await docker([
      'exec', containerName,
      'psql', '-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1',
      '--username', 'supabase_admin', '--dbname', 'postgres',
      '--command', `alter database "${DATABASE_NAME}" owner to postgres;`,
    ]);

    await docker(['exec', containerName, 'mkdir', '--parents', '/restore']);
    await docker(['cp', schemaPath, `${containerName}:/restore/schema.sql`]);
    await docker(['cp', dataPath, `${containerName}:/restore/data.sql`]);
    await restoreSqlFile(containerName, '/restore/schema.sql');
    await restoreSqlFile(containerName, '/restore/data.sql');

    const validation = await inspectRestoredDatabase(containerName);
    const completedAt = new Date();
    report = {
      ok: true,
      mode: 'isolated-docker-restore-drill',
      liveSupabaseTouched: false,
      archiveName: path.basename(resolvedArchive),
      backupCreatedAt: verification.createdAt,
      completedAt: completedAt.toISOString(),
      durationSeconds: Number(((completedAt - startedAt) / 1000).toFixed(1)),
      postgresImage,
      verifiedFileCount: verification.verifiedFileCount,
      storageObjectCount: verification.storageObjectCount,
      manifestFormatVersion: manifest.formatVersion,
      rolesFileVerifiedButNotApplied: true,
      ...validation,
    };
    return report;
  } catch (error) {
    const completedAt = new Date();
    report = {
      ok: false,
      mode: 'isolated-docker-restore-drill',
      liveSupabaseTouched: false,
      archiveName: path.basename(resolvedArchive),
      completedAt: completedAt.toISOString(),
      durationSeconds: Number(((completedAt - startedAt) / 1000).toFixed(1)),
      error: safeErrorMessage(error),
    };
    throw error;
  } finally {
    if (containerStarted) {
      await docker(['rm', '--force', containerName]).catch(() => undefined);
    }
    const resolvedTempRoot = path.resolve(tempRoot);
    const relativeTempPath = path.relative(tempBase, resolvedTempRoot);
    if (!relativeTempPath.startsWith('..') && !path.isAbsolute(relativeTempPath)) {
      await rm(resolvedTempRoot, { recursive: true, force: true });
    }
    await writeReport(resolvedReport, report ?? {
      ok: false,
      mode: 'isolated-docker-restore-drill',
      liveSupabaseTouched: false,
      archiveName: path.basename(resolvedArchive),
      completedAt: new Date().toISOString(),
      error: 'Restore drill ended before a report was produced.',
    });
  }
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--file') result.archivePath = argv[++index];
    else if (argument === '--report') result.reportPath = argv[++index];
    else if (argument === '--image') result.postgresImage = argv[++index];
  }
  return result;
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const options = parseArguments(process.argv.slice(2));
  const passphrase = process.env.NAWASRAH_BACKUP_PASSPHRASE;
  if (!options.archivePath || !passphrase) {
    throw new Error('Use --file and set NAWASRAH_BACKUP_PASSPHRASE.');
  }

  const result = await runRestoreDrill({
    archivePath: options.archivePath,
    passphrase,
    reportPath: options.reportPath,
    postgresImage: options.postgresImage,
  });
  console.log(JSON.stringify(result, null, 2));
}

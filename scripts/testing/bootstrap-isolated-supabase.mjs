import { cp, mkdtemp, mkdir, readFile, writeFile, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const sourceSupabaseRoot = path.join(projectRoot, 'supabase');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'nawasrah-isolated-supabase-'));
const isolatedSupabaseRoot = path.join(temporaryRoot, 'supabase');
const isolatedConfigPath = path.join(isolatedSupabaseRoot, 'config.toml');
const isolatedProjectId = process.env.NAWASRAH_ISOLATED_PROJECT_ID ||
  'nawasrah-phase7-test';
const skipRedundantReset = process.env.NAWASRAH_SKIP_REDUNDANT_DB_RESET === 'true';
if (!/^nawasrah-[a-z0-9-]+-test$/u.test(isolatedProjectId)) {
  throw new Error('Isolated bootstrap requires an explicit Nawasrah test project identity.');
}
const excludedServices = (process.env.NAWASRAH_SUPABASE_EXCLUDE || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .join(',');
const cleanupMigrationPath = path.join(
  isolatedSupabaseRoot,
  'migrations',
  '034_prelaunch_test_data_cleanup.sql',
);
const expectedFragment = `    public.supplier_payments,
    public.supplier_receipt_items,`;
const isolatedFragment = `    public.supplier_payments,
    public.supplier_return_items,
    public.supplier_returns,
    public.stock_count_items,
    public.stock_counts,
    public.supplier_receipt_items,`;

// Serialize bootstrap discovery/start: concurrent invocations must not tear
// down each other's database. A crashed bootstrap leaves this guard in place;
// investigate before removing it rather than assuming its owner is dead.
const bootstrapGuard = path.join(tmpdir(), 'nawasrah-isolated-bootstrap.guard');
await mkdir(bootstrapGuard);
try {
// Default CLI ports are shared. Refuse an active test stack, never kill it.
const { stdout: knownContainers } = await execFileAsync('docker', [
  'ps', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.State}}',
], { windowsHide: true });
const testContainers = knownContainers
  .split(/\r?\n/)
  .map((line) => line.trim().split('\t'))
  .filter(([id, name]) => id && /^supabase_.+_nawasrah-[a-z0-9-]+-test$/i.test(name || ''));
if (testContainers.some(([, , state]) => !['exited', 'dead', 'created'].includes(state))) {
  throw new Error('ISOLATED_TEST_STACK_ACTIVE: stop the owning test normally before starting another.');
}
const staleIds = testContainers
  .filter(([, name]) => name.endsWith(`_${isolatedProjectId}`))
  .map(([id]) => id);
if (staleIds.length > 0) {
  await execFileAsync('docker', ['rm', ...staleIds], { windowsHide: true });
}
// Temp workdir != fresh database: Supabase reuses volumes by project_id.
const { stdout: volumes } = await execFileAsync('docker', ['volume', 'ls', '--format', '{{.Name}}'],
  { windowsHide: true });
const reusedDatabaseVolume = volumes.split(/\r?\n/).includes(`supabase_db_${isolatedProjectId}`);
const resetSkipped = skipRedundantReset && !reusedDatabaseVolume;

const cleanupProjectContainers = async () => {
  const { stdout } = await execFileAsync('docker', [
    'ps', '-aq', '--filter', `name=^/supabase_.+_${isolatedProjectId}$`,
  ], { windowsHide: true });
  const ids = stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (ids.length > 0) await execFileAsync('docker', ['rm', '-f', ...ids], { windowsHide: true });
};

await mkdir(isolatedSupabaseRoot, { recursive: true });
await Promise.all([
  cp(path.join(sourceSupabaseRoot, 'config.toml'), isolatedConfigPath),
  cp(path.join(sourceSupabaseRoot, 'seed.sql'), path.join(isolatedSupabaseRoot, 'seed.sql')),
  cp(path.join(sourceSupabaseRoot, 'functions'), path.join(isolatedSupabaseRoot, 'functions'), {
    recursive: true,
  }),
  cp(path.join(sourceSupabaseRoot, 'migrations'), path.join(isolatedSupabaseRoot, 'migrations'), {
    recursive: true,
  }),
]);

if (process.env.NAWASRAH_FUNCTION_ENV_FILE_CONTENT) {
  await writeFile(
    path.join(isolatedSupabaseRoot, 'functions', '.env'),
    process.env.NAWASRAH_FUNCTION_ENV_FILE_CONTENT,
    'utf8',
  );
}

const sourceConfig = await readFile(isolatedConfigPath, 'utf8');
if (!/^project_id\s*=\s*"[^"]+"\s*$/mu.test(sourceConfig)) {
  throw new Error('The Supabase config is missing its project_id declaration.');
}

const isolatedTurnstileSecret = process.env.TURNSTILE_SECRET;
if (isolatedTurnstileSecret && !/^[A-Za-z0-9_-]+$/.test(isolatedTurnstileSecret)) {
  throw new Error('TURNSTILE_SECRET contains unsupported characters for isolated TOML config.');
}

await writeFile(
  isolatedConfigPath,
  sourceConfig.replace(
    /^project_id\s*=\s*"[^"]+"\s*$/mu,
    `project_id = "${isolatedProjectId}"`,
  ).replace(
    'secret = "env(TURNSTILE_SECRET)"',
    isolatedTurnstileSecret
      ? `secret = "${isolatedTurnstileSecret}"`
      : 'secret = "env(TURNSTILE_SECRET)"',
  ),
  'utf8',
);

const cleanupMigration = await readFile(cleanupMigrationPath, 'utf8');
if (!cleanupMigration.includes(expectedFragment)) {
  throw new Error(
    'The production migration 034 no longer matches the expected immutable history.',
  );
}

await writeFile(
  cleanupMigrationPath,
  cleanupMigration.replace(expectedFragment, isolatedFragment),
  'utf8',
);

const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
try {
  const startArguments = [cliPath, 'start', '--workdir', temporaryRoot];
  if (excludedServices) startArguments.push('--exclude', excludedServices);
  await execFileAsync(process.execPath, startArguments, {
    cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 240_000,
  });
  if (!resetSkipped) {
    await execFileAsync(process.execPath, [cliPath, 'db', 'reset', '--local', '--workdir', temporaryRoot], {
      cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 180_000,
    });
  }
  const { stdout: authBaseline } = await execFileAsync('docker', [
    'exec', `supabase_db_${isolatedProjectId}`, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT COUNT(*) FROM auth.users;',
  ], { windowsHide: true });
  if (authBaseline.trim() !== '0') throw new Error('ISOLATED_AUTH_BASELINE_NOT_EMPTY');
} catch (error) {
  await cleanupProjectContainers();
  throw error;
}

console.log(JSON.stringify({
  ok: true,
  isolatedProjectRoot: temporaryRoot,
  isolatedProjectId,
  resetSkipped,
  reusedDatabaseVolume,
  authBaselineEmpty: true,
  excludedServices: excludedServices || null,
  note: 'This temporary copy is for local destructive integrity tests only. Production migration 034 remains unchanged.',
}, null, 2));
} finally {
  await rmdir(bootstrapGuard);
}

import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
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

await writeFile(
  isolatedConfigPath,
  sourceConfig.replace(
    /^project_id\s*=\s*"[^"]+"\s*$/mu,
    `project_id = "${isolatedProjectId}"`,
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
await execFileAsync(
  process.execPath,
  [cliPath, 'start', '--workdir', temporaryRoot],
  {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  },
);

await execFileAsync(
  process.execPath,
  [cliPath, 'db', 'reset', '--local', '--workdir', temporaryRoot],
  {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  },
);

console.log(JSON.stringify({
  ok: true,
  isolatedProjectRoot: temporaryRoot,
  isolatedProjectId,
  note: 'This temporary copy is for local destructive integrity tests only. Production migration 034 remains unchanged.',
}, null, 2));

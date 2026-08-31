import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const bootstrapPath = path.join(here, 'bootstrap-isolated-supabase.mjs');
const sqlPath = path.join(here, 'rate-limit-cleanup-runtime.sql');
const projectId = process.env.NAWASRAH_ISOLATED_PROJECT_ID || 'nawasrah-rate-limit-cleanup-test';
const databaseContainer = `supabase_db_${projectId}`;

const runSql = (sql) => new Promise((resolve, reject) => {
  const child = spawn('docker', [
    'exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A',
  ], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(`Rate-limit cleanup SQL failed (exit ${code}): ${stderr.trim()}`));
  });
  child.stdin.end(sql);
});

if (process.env.NAWASRAH_SKIP_BOOTSTRAP !== '1') {
  const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: root,
    env: { ...process.env, NAWASRAH_ISOLATED_PROJECT_ID: projectId },
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const bootstrap = JSON.parse(stdout);
  if (!bootstrap.ok) throw new Error('Isolated Supabase bootstrap failed.');
}

const output = await runSql(await readFile(sqlPath, 'utf8'));
const summaryLine = output.split(/\r?\n/).find((line) => line.startsWith('{'));
const summary = summaryLine ? JSON.parse(summaryLine) : null;
if (!summary?.ok || summary.runtime_scenarios !== 4 || summary.rows_before !== 504 || summary.rows_after !== 3) {
  throw new Error(`Rate-limit cleanup runtime suite failed: ${output}`);
}

const staleId = crypto.randomUUID();
const currentId = crypto.randomUUID();
const insertStale = `
  INSERT INTO public.guest_order_gateway_requests(
    idempotency_key, ip_hash, session_hash, phone_hash, decision, reason, outcome, created_at
  ) VALUES (
    '${staleId}', repeat('9', 64), repeat('8', 64), repeat('7', 64),
    'rate_limited', 'ip_short_window', 'rate_limited', NOW() - INTERVAL '49 hours'
  );`;
const authorizeCurrent = `SELECT public.authorize_guest_order_gateway(
  '${currentId}'::uuid, repeat('6', 64), repeat('5', 64), repeat('4', 64)
);`;
await runSql(insertStale);
const [cleanupResult, authorizationResult] = await Promise.all([
  runSql('SELECT public.cleanup_guest_order_gateway_requests(500);').then(JSON.parse),
  runSql(authorizeCurrent).then(JSON.parse),
]);
const concurrentState = JSON.parse(await runSql(`SELECT json_build_object(
  'stale_deleted', NOT EXISTS (SELECT 1 FROM public.guest_order_gateway_requests WHERE idempotency_key = '${staleId}'),
  'current_preserved', EXISTS (SELECT 1 FROM public.guest_order_gateway_requests WHERE idempotency_key = '${currentId}'),
  'deleted_count', ${Number(cleanupResult.deleted_count || 0)}
);`));
if (authorizationResult.allowed !== true || concurrentState.stale_deleted !== true || concurrentState.current_preserved !== true || concurrentState.deleted_count !== 1) {
  throw new Error(`Concurrent insert/cleanup safety failed: ${JSON.stringify(concurrentState)}`);
}

console.log(JSON.stringify({
  ok: true,
  runtimeScenarios: summary.runtime_scenarios,
  rowsBefore: summary.rows_before,
  rowsAfter: summary.rows_after,
  concurrentInsertDuringCleanup: concurrentState,
}, null, 2));

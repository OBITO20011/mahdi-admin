import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const bootstrapPath = path.join(here, 'bootstrap-isolated-supabase.mjs');
const sqlPath = path.join(here, 'guest-order-gateway-runtime.sql');
const databaseContainer = 'supabase_db_nawasrah-phase7-test';

const runSql = (sql) => new Promise((resolve, reject) => {
  const child = spawn('docker', [
    'exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A',
  ], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(`Guest gateway SQL failed (exit ${code}): ${stderr.trim()}`));
  });
  child.stdin.end(sql);
});

const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
  cwd: projectRoot,
  windowsHide: true,
  maxBuffer: 1024 * 1024,
});
const bootstrap = JSON.parse(stdout);
if (!bootstrap.ok) throw new Error('The isolated Supabase bootstrap failed.');

const output = await runSql(await readFile(sqlPath, 'utf8'));
const summaryLine = output.split(/\r?\n/).find((line) =>
  line.startsWith('{') && line.includes('runtime_scenarios')
);
if (!summaryLine) throw new Error(`Gateway runtime summary is missing: ${output}`);
const summary = JSON.parse(summaryLine);
if (
  summary.unexpected_failures !== 0 ||
  summary.passed !== summary.runtime_scenarios ||
  summary.direct_rpc_anon !== false ||
  summary.direct_rpc_authenticated !== false ||
  summary.gateway_anon !== false ||
  summary.gateway_authenticated !== false ||
  summary.gateway_service_role !== true ||
  summary.audit_table_anon_select !== false ||
  summary.audit_table_authenticated_select !== false
) {
  throw new Error(`Gateway runtime failed: ${JSON.stringify(summary)}`);
}

await runSql('TRUNCATE public.guest_order_gateway_requests;');
const identicalKey = '86000000-0000-4000-8500-000000000000';
const identicalSql = `SELECT public.authorize_guest_order_gateway('${identicalKey}'::UUID, '${'f'.repeat(64)}', '${'e'.repeat(64)}', '${'a'.repeat(64)}');`;
const identicalResults = await Promise.all([
  runSql(identicalSql).then(JSON.parse),
  runSql(identicalSql).then(JSON.parse),
]);
const identicalRows = Number(await runSql(
  `SELECT COUNT(*) FROM public.guest_order_gateway_requests WHERE idempotency_key = '${identicalKey}'::UUID;`
));
if (
  identicalRows !== 1 ||
  identicalResults.some((result) => result.allowed !== true) ||
  identicalResults.filter((result) => result.idempotent_replay === true).length !== 1
) {
  throw new Error(`Concurrent identical idempotency failed: rows=${identicalRows}`);
}

await runSql('TRUNCATE public.guest_order_gateway_requests;');
const sharedSessionHash = 'e'.repeat(64);
const concurrentResults = await Promise.all(
  Array.from({ length: 10 }, async (_, index) => {
    const sequence = index + 1;
    const idempotencyKey = `86000000-0000-4000-8500-${String(sequence).padStart(12, '0')}`;
    const ipHash = `${String(sequence).padStart(64, '0')}`;
    const phoneHash = `${String(sequence + 100).padStart(64, '0')}`;
    const result = await runSql(
      `SELECT public.authorize_guest_order_gateway('${idempotencyKey}'::UUID, '${ipHash}', '${sharedSessionHash}', '${phoneHash}');`
    );
    return JSON.parse(result);
  })
);
const allowed = concurrentResults.filter((result) => result.allowed === true).length;
const limited = concurrentResults.filter((result) => result.allowed === false).length;
if (allowed !== 4 || limited !== 6) {
  throw new Error(`Atomic concurrent session limit failed: allowed=${allowed}, limited=${limited}`);
}

console.log(JSON.stringify({
  ok: true,
  ...summary,
  concurrent_requests: concurrentResults.length,
  concurrent_allowed: allowed,
  concurrent_rate_limited: limited,
  concurrent_identical_requests: identicalResults.length,
  concurrent_identical_rows: identicalRows,
}, null, 2));
